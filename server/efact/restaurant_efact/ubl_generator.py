"""
Generación de XML UBL 2.1 para comprobantes de pago electrónicos (Factura/Boleta) según lineamientos SUNAT.
Referencia: esquemas UBL 2.1 + Personalización SUNAT (CustomizationID 2.0).
"""

from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Tuple

from lxml import etree

from .models import LineaVenta, VentaInput

logger = logging.getLogger(__name__)

# Namespaces UBL 2.1 (comprobantes Perú)
NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
NS_EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
NS_DS = "http://www.w3.org/2000/09/xmldsig#"
NS_SAC = "urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"

NSMAP = {
    None: NS_INVOICE,
    "cac": NS_CAC,
    "cbc": NS_CBC,
    "ext": NS_EXT,
    "ds": NS_DS,
    "sac": NS_SAC,
}


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def _money(d: Decimal) -> str:
    return str(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def formato_monto(d: Decimal) -> str:
    """Formato decimal para PDF / UI (2 decimales)."""
    return _money(d)


def calcular_totales_venta(venta: VentaInput) -> Tuple[Decimal, Decimal, Decimal]:
    """Op. gravadas, IGV, importe total (solo líneas gravadas cat. 10)."""
    return _calc_lineas(venta.lineas, venta.porcentaje_igv)


def _calc_lineas(lineas: list, pct_igv: Decimal) -> Tuple[Decimal, Decimal, Decimal]:
    """Retorna (op_gravadas, igv, total). Solo ítems gravados (10) suman base IGV."""
    op_gravadas = Decimal("0")
    igv_total = Decimal("0")
    rate = pct_igv / Decimal("100")
    for ln in lineas:
        if ln.codigo_afectacion_igv == "10":
            line_ext = (ln.cantidad * ln.precio_unitario_sin_igv).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            op_gravadas += line_ext
            igv_total += (line_ext * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # Exonerados/inafectos: ampliar según catálogo SUNAT si lo necesita su negocio
    total = (op_gravadas + igv_total).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return op_gravadas, igv_total, total


def _party_identification(parent_cac, doc_type: str, doc_num: str) -> None:
    pid = etree.SubElement(parent_cac, _q(NS_CAC, "PartyIdentification"))
    cbc_id = etree.SubElement(pid, _q(NS_CBC, "ID"), schemeID=doc_type, schemeName="Documento de Identidad", schemeAgencyName="PE:SUNAT")
    cbc_id.text = doc_num


def _party_legal_entity(parent_cac, reg_name: str, address: str) -> None:
    ple = etree.SubElement(parent_cac, _q(NS_CAC, "PartyLegalEntity"))
    rn = etree.SubElement(ple, _q(NS_CBC, "RegistrationName"))
    rn.text = reg_name
    if address:
        addr = etree.SubElement(ple, _q(NS_CAC, "RegistrationAddress"))
        al = etree.SubElement(addr, _q(NS_CAC, "AddressLine"))
        ln = etree.SubElement(al, _q(NS_CBC, "Line"))
        ln.text = address
        country = etree.SubElement(addr, _q(NS_CAC, "Country"))
        cid = etree.SubElement(
            country,
            _q(NS_CBC, "IdentificationCode"),
            listID="ISO 3166-1",
            listAgencyName="United Nations Economic Commission for Europe",
            listName="Country",
        )
        cid.text = "PE"


def _supplier_party(root, venta: VentaInput) -> None:
    e = venta.emisor
    sup = etree.SubElement(root, _q(NS_CAC, "AccountingSupplierParty"))
    party = etree.SubElement(sup, _q(NS_CAC, "Party"))
    _party_identification(party, "6", e.ruc)
    ple = etree.SubElement(party, _q(NS_CAC, "PartyLegalEntity"))
    rn = etree.SubElement(ple, _q(NS_CBC, "RegistrationName"))
    rn.text = e.razon_social
    addr = etree.SubElement(ple, _q(NS_CAC, "RegistrationAddress"))
    lid = etree.SubElement(addr, _q(NS_CBC, "ID"), schemeName="Ubigeos", schemeAgencyName="PE:INEI")
    lid.text = e.ubigeo
    ad = etree.SubElement(addr, _q(NS_CBC, "AddressTypeCode"))
    ad.text = "0000"
    city = etree.SubElement(addr, _q(NS_CBC, "CityName"))
    city.text = e.distrito
    ctry = etree.SubElement(addr, _q(NS_CBC, "CountrySubentity"))
    ctry.text = e.departamento
    dist = etree.SubElement(addr, _q(NS_CBC, "District"))
    dist.text = e.distrito
    al = etree.SubElement(addr, _q(NS_CAC, "AddressLine"))
    aline = etree.SubElement(al, _q(NS_CBC, "Line"))
    aline.text = e.direccion
    c = etree.SubElement(addr, _q(NS_CAC, "Country"))
    cid = etree.SubElement(c, _q(NS_CBC, "IdentificationCode"), listID="ISO 3166-1", listAgencyName="United Nations Economic Commission for Europe", listName="Country")
    cid.text = "PE"


def _customer_party(root, venta: VentaInput) -> None:
    c = venta.cliente
    cust = etree.SubElement(root, _q(NS_CAC, "AccountingCustomerParty"))
    party = etree.SubElement(cust, _q(NS_CAC, "Party"))
    _party_identification(party, c.tipo_doc, c.numero_doc)
    _party_legal_entity(party, c.razon_social, c.direccion)


def _tax_total(root, igv: Decimal, op_gravadas: Decimal, pct: Decimal, moneda: str) -> None:
    tt = etree.SubElement(root, _q(NS_CAC, "TaxTotal"))
    taa = etree.SubElement(tt, _q(NS_CBC, "TaxAmount"), currencyID=moneda)
    taa.text = _money(igv)
    ts = etree.SubElement(tt, _q(NS_CAC, "TaxSubtotal"))
    tbi = etree.SubElement(ts, _q(NS_CBC, "TaxableAmount"), currencyID=moneda)
    tbi.text = _money(op_gravadas)
    ta2 = etree.SubElement(ts, _q(NS_CBC, "TaxAmount"), currencyID=moneda)
    ta2.text = _money(igv)
    cat = etree.SubElement(ts, _q(NS_CAC, "TaxCategory"))
    tid = etree.SubElement(cat, _q(NS_CBC, "ID"), schemeID="UN/ECE 5305", schemeName="Tax Category Identifier", schemeAgencyName="United Nations Economic Commission for Europe")
    tid.text = "S"
    pct_el = etree.SubElement(cat, _q(NS_CBC, "Percent"))
    pct_el.text = _money(pct)
    te = etree.SubElement(cat, _q(NS_CBC, "TaxExemptionReasonCode"), listAgencyName="PE:SUNAT", listName="Afectacion del IGV", listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07")
    te.text = "10"
    tsch = etree.SubElement(cat, _q(NS_CAC, "TaxScheme"))
    sid = etree.SubElement(tsch, _q(NS_CBC, "ID"), schemeID="UN/ECE 5153", schemeName="Tax Scheme Identifier", schemeAgencyName="United Nations Economic Commission for Europe")
    sid.text = "1000"
    sn = etree.SubElement(tsch, _q(NS_CBC, "Name"))
    sn.text = "IGV"
    st = etree.SubElement(tsch, _q(NS_CBC, "TaxTypeCode"))
    st.text = "VAT"


def _legal_monetary_total(root, op_gravadas: Decimal, igv: Decimal, total: Decimal, moneda: str) -> None:
    lmt = etree.SubElement(root, _q(NS_CAC, "LegalMonetaryTotal"))
    # Orden UBL: LineExtension, TaxExclusive, TaxInclusive, Payable al final.
    for tag, val in (
        ("LineExtensionAmount", op_gravadas),
        ("TaxExclusiveAmount", op_gravadas),
        ("TaxInclusiveAmount", total),
        ("PayableAmount", total),
    ):
        el = etree.SubElement(lmt, _q(NS_CBC, tag), currencyID=moneda)
        el.text = _money(val)


def _invoice_line(root, idx: int, ln: LineaVenta, moneda: str, pct_igv: Decimal) -> None:
    line = etree.SubElement(root, _q(NS_CAC, "InvoiceLine"))
    cbc_id = etree.SubElement(line, _q(NS_CBC, "ID"))
    cbc_id.text = str(idx)
    qty = etree.SubElement(line, _q(NS_CBC, "InvoicedQuantity"), unitCode="NIU", unitCodeListID="UN/ECE rec 20", unitCodeListAgencyName="United Nations Economic Commission for Europe")
    qty.text = _money(ln.cantidad)
    lea = etree.SubElement(line, _q(NS_CBC, "LineExtensionAmount"), currencyID=moneda)
    line_ext = (ln.cantidad * ln.precio_unitario_sin_igv).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    lea.text = _money(line_ext)
    pp = etree.SubElement(line, _q(NS_CAC, "PricingReference"))
    alt = etree.SubElement(pp, _q(NS_CAC, "AlternativeConditionPrice"))
    pamount = etree.SubElement(alt, _q(NS_CBC, "PriceAmount"), currencyID=moneda)
    # Precio con IGV (referencia)
    pu_igv = (ln.precio_unitario_sin_igv * (Decimal("1") + pct_igv / Decimal("100"))).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    pamount.text = _money(pu_igv)
    pcode = etree.SubElement(alt, _q(NS_CBC, "PriceTypeCode"), listName="Tipo de Precio", listAgencyName="PE:SUNAT", listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16")
    pcode.text = "01"
    # Impuestos por línea, luego ítem y precio (orden UBL / SUNAT).
    tt = etree.SubElement(line, _q(NS_CAC, "TaxTotal"))
    tax_amt = (line_ext * pct_igv / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if ln.codigo_afectacion_igv == "10" else Decimal("0")
    t_el = etree.SubElement(tt, _q(NS_CBC, "TaxAmount"), currencyID=moneda)
    t_el.text = _money(tax_amt)
    ts = etree.SubElement(tt, _q(NS_CAC, "TaxSubtotal"))
    tb = etree.SubElement(ts, _q(NS_CBC, "TaxableAmount"), currencyID=moneda)
    tb.text = _money(line_ext) if ln.codigo_afectacion_igv == "10" else _money(Decimal("0"))
    ta2 = etree.SubElement(ts, _q(NS_CBC, "TaxAmount"), currencyID=moneda)
    ta2.text = _money(tax_amt)
    cat = etree.SubElement(ts, _q(NS_CAC, "TaxCategory"))
    cid = etree.SubElement(cat, _q(NS_CBC, "ID"), schemeID="UN/ECE 5305", schemeName="Tax Category Identifier", schemeAgencyName="United Nations Economic Commission for Europe")
    cid.text = "S"
    p_el = etree.SubElement(cat, _q(NS_CBC, "Percent"))
    p_el.text = _money(pct_igv)
    ter = etree.SubElement(cat, _q(NS_CBC, "TaxExemptionReasonCode"), listAgencyName="PE:SUNAT", listName="Afectacion del IGV", listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07")
    ter.text = ln.codigo_afectacion_igv
    tsch = etree.SubElement(cat, _q(NS_CAC, "TaxScheme"))
    sid = etree.SubElement(tsch, _q(NS_CBC, "ID"), schemeID="UN/ECE 5153")
    sid.text = ln.codigo_tributo
    sname = etree.SubElement(tsch, _q(NS_CBC, "Name"))
    sname.text = "IGV"
    stc = etree.SubElement(tsch, _q(NS_CBC, "TaxTypeCode"))
    stc.text = "VAT"
    item = etree.SubElement(line, _q(NS_CAC, "Item"))
    desc = etree.SubElement(item, _q(NS_CBC, "Description"))
    desc.text = ln.descripcion
    pr = etree.SubElement(line, _q(NS_CAC, "Price"))
    pa = etree.SubElement(pr, _q(NS_CBC, "PriceAmount"), currencyID=moneda)
    pa.text = _money(ln.precio_unitario_sin_igv)


def generar_xml_ubl(venta: VentaInput) -> Tuple[bytes, str]:
    """
    Construye el XML UBL 2.1 (sin firmar).
    Retorna (xml_utf8_bytes, nombre_base_archivo sin extensión).
    """
    if not venta.lineas:
        raise ValueError("La venta debe tener al menos una línea de detalle.")

    op_gravadas, igv, total = _calc_lineas(venta.lineas, venta.porcentaje_igv)
    moneda = venta.moneda
    ruc = venta.emisor.ruc
    tipo = venta.tipo.value
    nombre_base = f"{ruc}-{tipo}-{venta.serie}-{venta.correlativo_str()}"

    root = etree.Element(_q(NS_INVOICE, "Invoice"), nsmap=NSMAP)

    # UBLExtensions vacío o placeholder — la firma se inserta con signer (ext + ds:Signature)
    ublext = etree.SubElement(root, _q(NS_EXT, "UBLExtensions"))
    ublex = etree.SubElement(ublext, _q(NS_EXT, "UBLExtension"))
    _ext_content = etree.SubElement(ublex, _q(NS_EXT, "ExtensionContent"))
    # La firma XMLDSig la inserta `signer.py` (enveloped en el raíz o según su ajuste SUNAT).

    etree.SubElement(root, _q(NS_CBC, "UBLVersionID")).text = "2.1"
    etree.SubElement(root, _q(NS_CBC, "CustomizationID")).text = "2.0"
    # Catálogo 51 (tipo de operación); 0101 es frecuente en venta gravada — valide según su caso en SUNAT.
    etree.SubElement(root, _q(NS_CBC, "ProfileID")).text = "0101"
    etree.SubElement(root, _q(NS_CBC, "ID")).text = venta.numero_completo()
    etree.SubElement(root, _q(NS_CBC, "IssueDate")).text = venta.fecha_emision
    etree.SubElement(root, _q(NS_CBC, "IssueTime")).text = venta.hora_emision
    itc = etree.SubElement(
        root,
        _q(NS_CBC, "InvoiceTypeCode"),
        listID="0101",
        listAgencyName="PE:SUNAT",
        listName="SUNAT:Identificador de Tipo de Documento",
        listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01",
    )
    itc.text = tipo
    etree.SubElement(root, _q(NS_CBC, "Note")).text = venta.observaciones or "-"
    doc_curr = etree.SubElement(root, _q(NS_CBC, "DocumentCurrencyCode"), listID="ISO 4217 Alpha", listName="Currency", listAgencyName="United Nations Economic Commission for Europe")
    doc_curr.text = moneda

    # Firma “cac:Signature” referencia (SUNAT); el bloque XMLDSig real lo agrega signer
    sig = etree.SubElement(root, _q(NS_CAC, "Signature"))
    sid = etree.SubElement(sig, _q(NS_CBC, "ID"))
    sid.text = "IDSignKG"
    sp = etree.SubElement(sig, _q(NS_CAC, "SignatoryParty"))
    pid = etree.SubElement(sp, _q(NS_CAC, "PartyIdentification"))
    pid_id = etree.SubElement(pid, _q(NS_CBC, "ID"))
    pid_id.text = ruc
    da = etree.SubElement(sig, _q(NS_CAC, "DigitalSignatureAttachment"))
    ex = etree.SubElement(da, _q(NS_CAC, "ExternalReference"))
    uri = etree.SubElement(ex, _q(NS_CBC, "URI"))
    uri.text = "#SignatureSP"

    _supplier_party(root, venta)
    _customer_party(root, venta)

    _tax_total(root, igv, op_gravadas, venta.porcentaje_igv, moneda)
    _legal_monetary_total(root, op_gravadas, igv, total, moneda)

    for i, ln in enumerate(venta.lineas, start=1):
        _invoice_line(root, i, ln, moneda, venta.porcentaje_igv)

    xml_bytes = etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        pretty_print=True,
    )
    logger.info("UBL generado: %s", nombre_base)
    return xml_bytes, nombre_base
