"""
Cliente SOAP para BillService de SUNAT (sendBill): envío del ZIP del XML firmado y recepción del CDR.

Autenticación: WS-Security UsernameToken (usuario = RUC + usuario SOL, contraseña = clave SOL).
Documentación: Manual del Programador SUNAT — Facturación Electrónica.
"""

from __future__ import annotations

import base64
import io
import logging
import zipfile
from dataclasses import dataclass
from typing import Optional, Tuple
from xml.etree import ElementTree as ET

import requests

from .config import SunatConfig

logger = logging.getLogger(__name__)

# SOAP 1.1 — BillService
SOAP_ENV = "http://schemas.xmlsoap.org/soap/envelope/"
SER_NS = "http://service.sunat.gob.pe"
WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"


@dataclass
class RespuestaSunat:
    """Resultado de sendBill."""

    ok: bool
    codigo: Optional[str] = None
    mensaje: Optional[str] = None
    # ZIP del CDR (bytes) si SUNAT aceptó y devolvió applicationResponse
    cdr_zip_bytes: Optional[bytes] = None
    raw_response: Optional[str] = None


def empaquetar_xml_en_zip(xml_bytes: bytes, nombre_xml_dentro_zip: str) -> bytes:
    """
    SUNAT exige un .zip cuyo único archivo se llama `{RUC}-{TIPO}-{SERIE}-{CORRELATIVO}.xml`.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(nombre_xml_dentro_zip, xml_bytes)
    return buf.getvalue()


def _soap_send_bill(file_name_zip: str, zip_bytes: bytes, cfg: SunatConfig) -> str:
    """Construye el sobre SOAP 1.1 con sendBill."""
    b64 = base64.b64encode(zip_bytes).decode("ascii")
    # Password en texto plano (perfil UsernameToken SUNAT)
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="{SOAP_ENV}" xmlns:ser="{SER_NS}" xmlns:wsse="{WSSE_NS}">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>{_xml_escape(cfg.soap_username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">{_xml_escape(cfg.clave_sol)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>{_xml_escape(file_name_zip)}</fileName>
      <contentFile>{b64}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>"""
    return body


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _parse_send_bill_response(xml_text: str) -> RespuestaSunat:
    """
    Interpreta la respuesta SOAP: applicationResponse (base64 ZIP) o SOAP Fault.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        logger.error("Respuesta no es XML válido: %s", e)
        return RespuestaSunat(ok=False, mensaje=f"XML inválido: {e}", raw_response=xml_text)

    # Fault
    fault_string = None
    for el in root.iter():
        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
        if tag == "faultstring" and el.text:
            fault_string = el.text.strip()
        if tag == "Fault":
            pass

    if fault_string:
        return RespuestaSunat(ok=False, mensaje=fault_string, raw_response=xml_text)

    # Buscar applicationResponse (namespace varía)
    app_resp = None
    for el in root.iter():
        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
        if tag == "applicationResponse" and el.text:
            app_resp = el.text.strip()
            break

    if not app_resp:
        return RespuestaSunat(
            ok=False,
            mensaje="No se encontró applicationResponse ni faultstring reconocible.",
            raw_response=xml_text[:8000],
        )

    try:
        cdr_zip = base64.b64decode(app_resp)
    except Exception as e:
        return RespuestaSunat(
            ok=False,
            mensaje=f"Error decodificando applicationResponse: {e}",
            raw_response=xml_text[:2000],
        )

    return RespuestaSunat(ok=True, cdr_zip_bytes=cdr_zip, raw_response=xml_text[:4000])


def parsear_codigo_cdr(xml_bytes: bytes):
    """Lee ResponseCode y Description del XML CDR (ApplicationResponse)."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None, None
    code = None
    desc = None
    for el in root.iter():
        tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag
        if tag == "ResponseCode" and el.text and code is None:
            code = el.text.strip()
        if tag in ("Description", "StatusReason") and el.text and desc is None:
            desc = el.text.strip()
    return code, desc


def cdr_es_aceptado(codigo) -> bool:
    """0 y 0100–1999 = aceptado (a veces con observaciones). 2000–3999 = rechazo."""
    if codigo is None:
        return True
    digits = "".join(c for c in str(codigo) if c.isdigit())
    if not digits:
        return False
    n = int(digits)
    return n == 0 or (100 <= n <= 1999)


def enviar_comprobante(zip_bytes: bytes, nombre_zip: str, cfg: SunatConfig, timeout: int = 120) -> RespuestaSunat:
    """
    POST al BillService con sendBill.

    :param zip_bytes: contenido del archivo `{nombre_base}.zip`
    :param nombre_zip: solo el nombre del archivo, ej. `20123456789-01-F001-00000001.zip`
    """
    url = cfg.bill_service_url
    payload = _soap_send_bill(nombre_zip, zip_bytes, cfg)
    headers = {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "urn:sendBill",
    }
    logger.info("Enviando a SUNAT: %s (%s)", nombre_zip, url)

    try:
        r = requests.post(url, data=payload.encode("utf-8"), headers=headers, timeout=timeout)
    except requests.RequestException as e:
        logger.exception("Error de red contra SUNAT")
        return RespuestaSunat(ok=False, mensaje=f"Error de red: {e}")

    text = r.text or ""
    if r.status_code >= 400:
        logger.error("HTTP %s desde SUNAT", r.status_code)
        return RespuestaSunat(
            ok=False,
            mensaje=f"HTTP {r.status_code}",
            raw_response=text[:8000],
        )

    res = _parse_send_bill_response(text)
    if res.ok and res.cdr_zip_bytes:
        try:
            _nombre, xml_cdr = extraer_xml_cdr_desde_zip(res.cdr_zip_bytes)
        except Exception as e:
            logger.warning("No se pudo abrir el ZIP del CDR: %s", e)
            xml_cdr = None
        if xml_cdr:
            code, desc = parsear_codigo_cdr(xml_cdr)
            res.codigo = code
            if code is not None and not cdr_es_aceptado(code):
                res.ok = False
                res.mensaje = f"SUNAT rechazó (código {code}): {desc or 'Revise el CDR'}".strip()
                logger.warning("CDR rechazo: %s", res.mensaje)
            else:
                res.ok = True
                res.mensaje = (
                    f"SUNAT aceptó (código {code or '0'}): {desc or 'Correcto'}".strip()
                    if code is not None
                    else (desc or "SUNAT respondió con CDR")
                )
                logger.info("SUNAT respondió con CDR: %s", res.mensaje)
        else:
            logger.info("SUNAT respondió con CDR (ZIP sin XML reconocible).")
            res.mensaje = res.mensaje or "SUNAT respondió con CDR"
    elif res.ok:
        logger.info("SUNAT respondió con CDR (ZIP).")
    else:
        logger.warning("SUNAT / parse: %s", res.mensaje)
    return res


def extraer_xml_cdr_desde_zip(cdr_zip_bytes: bytes) -> Tuple[Optional[str], Optional[bytes]]:
    """
    Abre el ZIP del CDR y devuelve (nombre_archivo, contenido_xml) del primer .xml que empiece por 'R-'.
    """
    with zipfile.ZipFile(io.BytesIO(cdr_zip_bytes), "r") as zf:
        names = zf.namelist()
        for n in names:
            base = n.split("/")[-1]
            if base.lower().endswith(".xml") and base.upper().startswith("R-"):
                return n, zf.read(n)
        for n in names:
            if n.lower().endswith(".xml"):
                return n, zf.read(n)
    return None, None
