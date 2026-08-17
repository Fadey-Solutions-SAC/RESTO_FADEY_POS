#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flujo principal: venta → XML UBL → firma → ZIP → SUNAT (opcional) → CDR → PDF → disco.

Ejecutar desde server/efact:
  python main.py --dry-run
  python main.py

Variables de entorno (ver `.env.example`): credenciales SOL, PFX y OUTPUT_DIR.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# Raíz del proyecto (donde está este archivo)
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from restaurant_efact.config import (
    AmbienteSunat,
    CertificadoConfig,
    RutasAlmacenamiento,
    SunatConfig,
    load_certificado_from_env,
    load_rutas_from_env,
    load_sunat_config_from_env,
)
from restaurant_efact.models import (
    ClienteInput,
    EmisorConfig,
    LineaVenta,
    TipoComprobante,
    VentaInput,
)
from restaurant_efact.pdf_generator import generar_pdf_comprobante
from restaurant_efact.signer import firmar_xml_ubl
from restaurant_efact.sunat_client import (
    empaquetar_xml_en_zip,
    enviar_comprobante,
    extraer_xml_cdr_desde_zip,
)
from restaurant_efact.ubl_generator import generar_xml_ubl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("main")


def venta_demo() -> VentaInput:
    """Datos de prueba (RUC/dirección ficticios — reemplace por su empresa real)."""
    hoy = date.today().isoformat()
    ahora = datetime.now().strftime("%H:%M:%S")
    emisor = EmisorConfig(
        ruc="20123456789",
        razon_social="RESTAURANTE DEMO SAC",
        nombre_comercial="Restaurante Demo",
        ubigeo="150101",
        direccion="Av. Ejemplo 123",
        provincia="LIMA",
        departamento="LIMA",
        distrito="LIMA",
    )
    cliente = ClienteInput(
        tipo_doc="1",
        numero_doc="12345678",
        razon_social="JUAN PEREZ GARCIA",
        direccion="Jr. Cliente 456",
    )
    lineas = [
        LineaVenta(
            descripcion="Menú ejecutivo",
            cantidad=Decimal("2"),
            precio_unitario_sin_igv=Decimal("25.00"),
        ),
        LineaVenta(
            descripcion="Bebida gaseosa 500ml",
            cantidad=Decimal("2"),
            precio_unitario_sin_igv=Decimal("5.00"),
        ),
    ]
    return VentaInput(
        tipo=TipoComprobante.BOLETA,
        serie="B001",
        correlativo=1,
        fecha_emision=hoy,
        hora_emision=ahora,
        moneda="PEN",
        emisor=emisor,
        cliente=cliente,
        lineas=lineas,
        porcentaje_igv=Decimal("18"),
        observaciones="Gracias por su preferencia.",
    )


def venta_desde_dict(data: dict) -> VentaInput:
    """Construye VentaInput desde un dict (mismo esquema que el JSON de archivo)."""
    em = data["emisor"]
    cl = data["cliente"]
    emisor = EmisorConfig(
        ruc=str(em["ruc"]),
        razon_social=em["razon_social"],
        nombre_comercial=em.get("nombre_comercial", em["razon_social"]),
        ubigeo=str(em["ubigeo"]),
        direccion=em["direccion"],
        provincia=em["provincia"],
        departamento=em["departamento"],
        distrito=em["distrito"],
        telefono=str(em.get("telefono", "") or ""),
        correo=str(em.get("correo", "") or ""),
    )
    cliente = ClienteInput(
        tipo_doc=str(cl["tipo_doc"]),
        numero_doc=str(cl["numero_doc"]),
        razon_social=cl["razon_social"],
        direccion=cl.get("direccion", ""),
    )
    lineas = [
        LineaVenta(
            descripcion=ln["descripcion"],
            cantidad=Decimal(str(ln["cantidad"])),
            precio_unitario_sin_igv=Decimal(str(ln["precio_unitario_sin_igv"])),
            codigo_afectacion_igv=str(ln.get("codigo_afectacion_igv", "10")),
        )
        for ln in data["lineas"]
    ]
    tipo = TipoComprobante(data["tipo"])
    return VentaInput(
        tipo=tipo,
        serie=data["serie"],
        correlativo=int(data["correlativo"]),
        fecha_emision=data["fecha_emision"],
        hora_emision=data["hora_emision"],
        moneda=data.get("moneda", "PEN"),
        emisor=emisor,
        cliente=cliente,
        lineas=lineas,
        porcentaje_igv=Decimal(str(data.get("porcentaje_igv", "18"))),
        observaciones=data.get("observaciones", ""),
    )


def venta_desde_json(path: Path) -> VentaInput:
    data = json.loads(path.read_text(encoding="utf-8"))
    return venta_desde_dict(data)


def _finalize_abs_paths(result: dict) -> None:
    """Rutas absolutas en JSON para que el API Node copie PDF/XML desde el mismo disco."""
    p = result.get("paths")
    if not isinstance(p, dict):
        return
    for k, v in list(p.items()):
        if not v or not isinstance(v, str):
            continue
        lv = v.lower()
        if lv.startswith("http://") or lv.startswith("https://"):
            continue
        try:
            p[k] = str(Path(v).expanduser().resolve(strict=False))
        except (OSError, RuntimeError):
            pass


def procesar_venta(
    venta: VentaInput,
    *,
    rutas: RutasAlmacenamiento,
    cert_cfg: CertificadoConfig | None,
    sunat_cfg: SunatConfig | None,
    enviar_sunat: bool,
    motivo_sin_firma: str | None = None,
) -> dict:
    """Devuelve resumen con rutas generadas (para API HTTP del restaurante)."""
    rutas.ensure_all()
    result: dict = {
        "ok": True,
        "nombre_base": "",
        "paths": {},
        "sunat": None,
        "mensaje": "",
    }

    xml_bytes, nombre_base = generar_xml_ubl(venta)
    result["nombre_base"] = nombre_base
    path_xml = rutas.xml_sin_firma / f"{nombre_base}.xml"
    path_xml.write_bytes(xml_bytes)
    result["paths"]["xml_sin_firma"] = str(path_xml)
    logger.info("XML sin firma guardado: %s", path_xml)

    if cert_cfg is None:
        if motivo_sin_firma:
            logger.info("No se firma ni se envía a SUNAT (%s).", motivo_sin_firma)
        else:
            logger.warning("Sin certificado configurado: no se firma ni se envía a SUNAT.")
        path_pdf = rutas.pdf / f"{nombre_base}.pdf"
        generar_pdf_comprobante(venta, path_pdf)
        result["paths"]["pdf"] = str(path_pdf)
        result["mensaje"] = motivo_sin_firma or "XML y PDF sin firma SUNAT"
        _finalize_abs_paths(result)
        return result

    signed_bytes = firmar_xml_ubl(xml_bytes, cert_cfg)
    path_signed = rutas.xml_firmado / f"{nombre_base}.xml"
    path_signed.write_bytes(signed_bytes)
    result["paths"]["xml_firmado"] = str(path_signed)
    logger.info("XML firmado guardado: %s", path_signed)

    nombre_zip = f"{nombre_base}.zip"
    nombre_xml_interior = f"{nombre_base}.xml"
    zip_bytes = empaquetar_xml_en_zip(signed_bytes, nombre_xml_interior)

    if enviar_sunat and sunat_cfg:
        if not sunat_cfg.ruc or not sunat_cfg.usuario_sol or not sunat_cfg.clave_sol:
            logger.error("Faltan SUNAT_RUC, SUNAT_USUARIO_SOL o SUNAT_CLAVE_SOL.")
            result["ok"] = False
            result["mensaje"] = "Faltan credenciales SOL en .env"
            path_pdf = rutas.pdf / f"{nombre_base}.pdf"
            generar_pdf_comprobante(venta, path_pdf)
            result["paths"]["pdf"] = str(path_pdf)
            _finalize_abs_paths(result)
            return result
        res = enviar_comprobante(zip_bytes, nombre_zip, sunat_cfg)
        result["sunat"] = {
            "ok": bool(res.ok),
            "codigo": res.codigo or "",
            "mensaje": res.mensaje or "",
            "respondio": bool(res.cdr_zip_bytes) or bool(res.raw_response),
        }
        if res.ok and res.cdr_zip_bytes:
            cdr_zip_path = rutas.cdr / nombre_zip
            cdr_zip_path.write_bytes(res.cdr_zip_bytes)
            result["paths"]["cdr_zip"] = str(cdr_zip_path)
            logger.info("CDR (ZIP) guardado: %s", cdr_zip_path)
            nombre_r, xml_cdr = extraer_xml_cdr_desde_zip(res.cdr_zip_bytes)
            if xml_cdr and nombre_r:
                out_xml = rutas.cdr / Path(nombre_r).name
                out_xml.write_bytes(xml_cdr)
                result["paths"]["cdr_xml"] = str(out_xml)
                logger.info("XML de respuesta CDR: %s", out_xml)
        else:
            logger.error("Envío SUNAT fallido: %s", res.mensaje)
            result["ok"] = bool(res.ok)
            if res.raw_response:
                logger.debug("Fragmento respuesta: %s", res.raw_response[:2000])
    elif enviar_sunat:
        logger.warning("No hay configuración SUNAT; omitiendo envío.")

    path_pdf = rutas.pdf / f"{nombre_base}.pdf"
    generar_pdf_comprobante(venta, path_pdf)
    result["paths"]["pdf"] = str(path_pdf)
    if not result.get("mensaje"):
        result["mensaje"] = "Procesado"
    _finalize_abs_paths(result)
    return result


def main() -> int:
    p = argparse.ArgumentParser(description="Facturación electrónica SUNAT (restaurante / POS)")
    p.add_argument("--dry-run", action="store_true", help="Genera XML y PDF; no envía a SUNAT")
    p.add_argument("--no-sign", action="store_true", help="No firma (solo XML + PDF si aplica)")
    p.add_argument("--data", type=Path, help="JSON con la venta (default: datos demo en código)")
    args = p.parse_args()

    venta = venta_desde_json(args.data) if args.data else venta_demo()
    rutas = load_rutas_from_env()

    cert_cfg = None if args.no_sign else load_certificado_from_env()
    if not args.no_sign and cert_cfg and not cert_cfg.password_pfx:
        logger.warning("CERT_PFX_PASSWORD vacío; configure .env o use --no-sign")
        cert_cfg = None

    sunat_cfg = load_sunat_config_from_env()
    if sunat_cfg.ambiente == AmbienteSunat.PRODUCCION:
        logger.warning("Ambiente PRODUCCIÓN: los comprobantes son reales.")

    enviar = not args.dry_run and cert_cfg is not None
    motivo = "--no-sign" if args.no_sign else None

    try:
        procesar_venta(
            venta,
            rutas=rutas,
            cert_cfg=cert_cfg,
            sunat_cfg=sunat_cfg,
            enviar_sunat=enviar,
            motivo_sin_firma=motivo,
        )
    except Exception as e:
        logger.exception("Error en el flujo: %s", e)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
