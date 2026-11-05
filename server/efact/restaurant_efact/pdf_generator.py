"""
PDF representativo del comprobante (no sustituye al XML legal ni al CDR).
Útil para impresión en cocina/caja o envío al cliente.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import VentaInput
from .ubl_generator import calcular_totales_venta, formato_monto

logger = logging.getLogger(__name__)


def generar_pdf_comprobante(venta: VentaInput, ruta_salida: Path) -> Path:
    """
    Genera un PDF simple con datos del emisor, cliente, líneas y totales.
    """
    ruta_salida = Path(ruta_salida)
    ruta_salida.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(ruta_salida),
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    titulo = "FACTURA ELECTRÓNICA" if venta.tipo.value == "01" else "BOLETA DE VENTA ELECTRÓNICA"
    story.append(Paragraph(f"<b>{titulo}</b>", styles["Title"]))
    story.append(Spacer(1, 0.5 * cm))

    e = venta.emisor
    nc = (e.nombre_comercial or "").strip()
    rs = (e.razon_social or "").strip()
    emisor_parts = []
    if nc and nc.upper() != rs.upper():
        emisor_parts.append(f"<b>{nc}</b>")
    emisor_parts.append(f"<b>{rs}</b>")
    emisor_parts.append(f"RUC: {e.ruc}")
    emisor_parts.append(f"{e.direccion}")
    geo = " — ".join(part for part in (e.distrito, e.provincia, e.departamento) if str(part or "").strip())
    if geo:
        emisor_parts.append(geo)
    tel = (getattr(e, "telefono", None) or "").strip()
    mail = (getattr(e, "correo", None) or "").strip()
    if tel:
        emisor_parts.append(f"Tel: {tel}")
    if mail:
        emisor_parts.append(f"Correo: {mail}")
    emisor_txt = "<br/>".join(emisor_parts)
    story.append(Paragraph(emisor_txt, styles["Normal"]))
    story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph(f"<b>Comprobante:</b> {venta.numero_completo()}", styles["Normal"]))
    story.append(Paragraph(f"<b>Fecha:</b> {venta.fecha_emision} {venta.hora_emision}", styles["Normal"]))
    story.append(Paragraph(f"<b>Moneda:</b> {venta.moneda}", styles["Normal"]))
    story.append(Spacer(1, 0.3 * cm))

    c = venta.cliente
    story.append(Paragraph("<b>Cliente</b>", styles["Heading2"]))
    cli = f"{c.razon_social}<br/>Doc: ({c.tipo_doc}) {c.numero_doc}<br/>{c.direccion or ''}"
    story.append(Paragraph(cli, styles["Normal"]))
    story.append(Spacer(1, 0.4 * cm))

    data = [["Cant.", "Descripción", "P. unit.", "Total"]]
    for ln in venta.lineas:
        line_ext = (ln.cantidad * ln.precio_unitario_sin_igv).quantize(Decimal("0.01"))
        data.append(
            [
                formato_monto(ln.cantidad),
                ln.descripcion[:80],
                formato_monto(ln.precio_unitario_sin_igv),
                formato_monto(line_ext),
            ]
        )

    t = Table(data, colWidths=[2 * cm, 8 * cm, 3 * cm, 3 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 0.5 * cm))

    op_gravadas, igv, total, op_exoneradas, op_inafectas = calcular_totales_venta(venta)
    lineas_tot = []
    if op_gravadas:
        lineas_tot.append(f"<b>Op. gravadas:</b> {venta.moneda} {formato_monto(op_gravadas)}")
    if op_exoneradas:
        lineas_tot.append(f"<b>Op. exoneradas:</b> {venta.moneda} {formato_monto(op_exoneradas)}")
    if op_inafectas:
        lineas_tot.append(f"<b>Op. inafectas:</b> {venta.moneda} {formato_monto(op_inafectas)}")
    if igv:
        lineas_tot.append(
            f"<b>IGV ({formato_monto(venta.porcentaje_igv)}%):</b> {venta.moneda} {formato_monto(igv)}"
        )
    lineas_tot.append(f"<b>Total:</b> {venta.moneda} {formato_monto(total)}")
    tot_txt = "<br/>".join(lineas_tot)
    story.append(Paragraph(tot_txt, styles["Normal"]))
    story.append(Spacer(1, 0.3 * cm))
    story.append(
        Paragraph(
            "<i>Representación impresa. Consulte validez en SUNAT con el XML y CDR.</i>",
            styles["Italic"],
        )
    )

    doc.build(story)
    logger.info("PDF generado: %s", ruta_salida)
    return ruta_salida
