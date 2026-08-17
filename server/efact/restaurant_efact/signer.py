"""
Firma digital XMLDSig del UBL con certificado .pfx (PKCS#12).

Usa `cryptography` para leer el PFX y `signxml` para firmar (RSA-SHA256, C14N exclusivo).
Valide el XML resultante con el validador SUNAT; algunos emisores requieren la firma solo
dentro de `ext:UBLExtensions/.../ExtensionContent` según XSD — ajuste la colocación si
el validador oficial lo indica (Manual del Programador / plantillas xmlsec).
"""

from __future__ import annotations

import logging
from pathlib import Path

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.serialization import pkcs12
from lxml import etree
from signxml import XMLSigner, methods

from .config import CertificadoConfig

logger = logging.getLogger(__name__)


def _cargar_clave_y_certificado(cfg: CertificadoConfig):
    ruta = Path(cfg.ruta_pfx)
    if not ruta.is_file():
        raise FileNotFoundError(f"No se encuentra el certificado PFX: {ruta}")

    with open(ruta, "rb") as f:
        pfx_data = f.read()

    private_key, certificate, additional = pkcs12.load_key_and_certificates(
        pfx_data,
        cfg.password_pfx.encode("utf-8"),
        default_backend(),
    )
    if private_key is None or certificate is None:
        raise ValueError("El archivo PFX no contiene clave privada o certificado X.509.")

    return private_key, certificate, additional or ()


def firmar_xml_ubl(xml_bytes: bytes, cert_cfg: CertificadoConfig) -> bytes:
    """
    Firma el documento Invoice en memoria (firma enveloped en el raíz).

    - Asigna `Id` al elemento raíz si falta (referencia del digest).
    """
    parser = etree.XMLParser(remove_blank_text=False, resolve_entities=False)
    root = etree.fromstring(xml_bytes, parser)

    if root.get("Id") is None:
        root.set("Id", "SignSUNAT")

    key, cert_x509, _chain = _cargar_clave_y_certificado(cert_cfg)

    signer = XMLSigner(
        method=methods.enveloped,
        signature_algorithm="rsa-sha256",
        digest_algorithm="sha256",
        c14n_algorithm="http://www.w3.org/2001/10/xml-exc-c14n#",
    )

    signed_root = signer.sign(root, key=key, cert=cert_x509, reference_uri="#" + root.get("Id"))

    ns_ds = "http://www.w3.org/2000/09/xmldsig#"
    ns_ext = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
    sig_el = signed_root.find(f".//{{{ns_ds}}}Signature")
    ext_content = signed_root.find(f".//{{{ns_ext}}}ExtensionContent")
    if sig_el is not None:
        sig_el.set("Id", "SignatureSP")
        parent = sig_el.getparent()
        if ext_content is not None and parent is not None and parent is not ext_content:
            parent.remove(sig_el)
            ext_content.append(sig_el)

    out = etree.tostring(
        signed_root,
        xml_declaration=True,
        encoding="UTF-8",
        pretty_print=True,
    )
    logger.info("XML firmado correctamente (RSA-SHA256).")
    return out
