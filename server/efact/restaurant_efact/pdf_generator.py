"""
PDF representativo del comprobante (no sustituye al XML legal ni al CDR).
Útil para impresión en cocina/caja o envío al cliente.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .models import VentaInput
from .ubl_generator import calcular_totales_venta, formato_monto

logger = logging.getLogger(__name__)


def _qr_drawing(payload: str, size: float):
    from reportlab.graphics.barcode import qr as qrbarcode
    from reportlab.graphics.shapes import Drawing

    widget = qrbarcode.QrCodeWidget(payload)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    if width <= 0 or height <= 0:
        return None
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    return drawing


def generar_pdf_comprobante(venta: VentaInput, ruta_salida: Path, codigo_qr: str = "") -> Path:
    """
    Genera un PDF simple con datos del emisor, cliente, líneas y totales.
    """
    ruta_salida = Path(ruta_salida)
    ruta_salida.parent.mkdir(parents=True, exist_ok=True)

    # Ticket de 80 mm: el PDF que se descarga y el que sale en la térmica usan el mismo ancho.
    page_w = 80 * mm
    page_h = (150 + max(0, len(venta.lineas) - 1) * 7) * mm
    margin = 3.5 * mm
    doc = SimpleDocTemplate(
        str(ruta_salida),
        pagesize=(page_w, page_h),
        rightMargin=margin,
        leftMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
    )
    usable = page_w - (margin * 2)
    center = ParagraphStyle("ticketCenter", fontName="Helvetica", fontSize=8, leading=10, alignment=TA_CENTER)
    title = ParagraphStyle("ticketTitle", parent=center, fontName="Helvetica-Bold", fontSize=9, leading=11)
    left = ParagraphStyle("ticketLeft", fontName="Helvetica", fontSize=7.5, leading=9, alignment=TA_LEFT)
    story = []

    titulo = "FACTURA ELECTRÓNICA" if venta.tipo.value == "01" else "BOLETA DE VENTA ELECTRÓNICA"
    story.append(Paragraph(titulo, title))
    story.append(Spacer(1, 2 * mm))

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
    story.append(Paragraph(emisor_txt, center))
    story.append(Spacer(1, 2 * mm))

    story.append(Paragraph(f"<b>Comprobante:</b> {venta.numero_completo()}", left))
    story.append(Paragraph(f"<b>Fecha:</b> {venta.fecha_emision} {venta.hora_emision}", left))
    story.append(Paragraph(f"<b>Moneda:</b> {venta.moneda}", left))
    story.append(Spacer(1, 2 * mm))

    c = venta.cliente
    story.append(Paragraph("<b>Cliente</b>", left))
    cli = f"{c.razon_social}<br/>Doc: ({c.tipo_doc}) {c.numero_doc}<br/>{c.direccion or ''}"
    story.append(Paragraph(cli, left))
    story.append(Spacer(1, 2 * mm))

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

    t = Table(data, colWidths=[usable * 0.14, usable * 0.46, usable * 0.20, usable * 0.20])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.black),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 1),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 2 * mm))

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
    story.append(Paragraph(tot_txt, left))
    story.append(Spacer(1, 2 * mm))
    qr_text = str(codigo_qr or "").strip()
    if qr_text:
        try:
            drawing = _qr_drawing(qr_text, 28 * mm)
        except Exception:
            logger.warning("No se pudo dibujar el QR del comprobante", exc_info=True)
            drawing = None
        if drawing is not None:
            qr_table = Table([[drawing]], colWidths=[usable])
            qr_table.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]))
            story.append(qr_table)
            story.append(Spacer(1, 1.5 * mm))
            story.append(Paragraph("Código QR de consulta de validez SUNAT", center))
            story.append(Spacer(1, 1.5 * mm))
    story.append(Paragraph("Representación impresa. Conserve su comprobante.", center))

    doc.build(story)
    logger.info("PDF generado: %s", ruta_salida)
    return ruta_salida
