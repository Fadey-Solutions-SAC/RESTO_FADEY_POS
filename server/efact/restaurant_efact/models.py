"""
Modelos de datos de entrada para comprobantes electrónicos.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import List


class TipoComprobante(str, Enum):
    """Código de tipo de documento SUNAT (catálogo 01)."""

    FACTURA = "01"
    BOLETA = "03"


def normalizar_serie_sunat(serie: str, tipo: str) -> str:
    """SUNAT exige serie de 4 caracteres: boleta B###, factura F###.

    FC001 (5 caracteres) en una boleta se convierte en B001.
    """
    tipo_s = str(getattr(tipo, "value", tipo) or "")
    prefix = "F" if tipo_s in ("01", "1") else "B"
    raw = "".join(ch for ch in str(serie or "").upper() if ch.isalnum())
    if len(raw) == 4 and raw.startswith(prefix):
        return raw
    digits = "".join(ch for ch in raw if ch.isdigit()) or "001"
    return prefix + digits[-3:].zfill(3)


@dataclass
class ClienteInput:
    """Cliente receptor del comprobante."""

    # Catálogo 06: 1=DNI, 6=RUC, 4=CE, 7=Pasaporte, 0=Doc.trib.no domiciliado sin RUC, etc.
    tipo_doc: str
    numero_doc: str
    razon_social: str
    direccion: str = ""


@dataclass
class LineaVenta:
    """Línea de detalle (producto/servicio)."""

    descripcion: str
    cantidad: Decimal
    # Precio unitario sin IGV (valor unitario por ítem gravado)
    precio_unitario_sin_igv: Decimal
    # Catálogo 07: 10=Gravado - Op. Onerosa, 20=Exonerado, 30=Inafecto, etc.
    codigo_afectacion_igv: str = "10"
    # Catálogo 05 (UN/ECE 5305): 1000=IGV
    codigo_tributo: str = "1000"


@dataclass
class EmisorConfig:
    """Datos del contribuyente emisor (restaurante)."""

    ruc: str
    razon_social: str
    nombre_comercial: str
    ubigeo: str
    direccion: str
    provincia: str
    departamento: str
    distrito: str
    telefono: str = ""
    correo: str = ""


@dataclass
class VentaInput:
    """Datos completos de una venta a facturar."""

    tipo: TipoComprobante
    serie: str
    correlativo: int
    fecha_emision: str  # YYYY-MM-DD
    hora_emision: str  # HH:MM:SS
    moneda: str  # PEN, USD
    emisor: EmisorConfig
    cliente: ClienteInput
    lineas: List[LineaVenta] = field(default_factory=list)
    # Porcentaje IGV (18% estándar Perú)
    porcentaje_igv: Decimal = field(default_factory=lambda: Decimal("18"))
    # Leyendas opcionales (SUNAT / comercial)
    observaciones: str = ""

    def numero_completo(self) -> str:
        """Serie-correlativo para cbc:ID (ej. F001-00000001)."""
        return f"{self.serie}-{self.correlativo:08d}"

    def correlativo_str(self) -> str:
        return f"{self.correlativo:08d}"
