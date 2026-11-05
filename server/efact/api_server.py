#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
API HTTP mínima para que el backend Node envíe ventas al bot (XML, firma, SUNAT, PDF).

Variables de entorno (además de las de `.env` del bot):
  EFACT_HTTP_SECRET   — si está definido, el header X-EFACT-SECRET debe coincidir (mismo valor que "Token API" en el panel).
  EFACT_HTTP_HOST     — default 127.0.0.1
  EFACT_HTTP_PORT     — default 8765

Ejecutar desde la raíz del repo:
  python server/efact/api_server.py
  (o cd server/efact && python api_server.py)
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from main import procesar_venta, venta_desde_dict
from restaurant_efact.config import (
    AmbienteSunat,
    CertificadoConfig,
    SunatConfig,
    load_certificado_from_env,
    load_rutas_from_env,
    load_sunat_config_from_env,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("api_server")

SECRET = os.environ.get("EFACT_HTTP_SECRET", "").strip()


def _merge_sunat_from_payload(data: dict, env_cfg: SunatConfig) -> SunatConfig:
    """Credenciales SOL y ambiente: JSON del panel Node (panel_credenciales) o .env del bot."""
    pc = data.get("panel_credenciales") or {}
    em = data.get("emisor") or {}
    ruc = str(pc.get("ruc") or em.get("ruc") or env_cfg.ruc or "").strip()
    usu = str(pc.get("usuario_sol") or env_cfg.usuario_sol or "").strip()
    cla = str(pc.get("clave_sol") or env_cfg.clave_sol or "").strip()
    amb_s = str(pc.get("ambiente") or "beta").lower()
    ambiente = AmbienteSunat.PRODUCCION if amb_s == "produccion" else AmbienteSunat.BETA
    return SunatConfig(ruc=ruc, usuario_sol=usu, clave_sol=cla, ambiente=ambiente)


def _merge_cert_from_payload(data: dict, env_cert: CertificadoConfig | None) -> CertificadoConfig | None:
    """Certificado .pfx: JSON del panel (panel_certificado) o variables CERT_* del bot."""
    pc = data.get("panel_certificado") or {}
    ruta = str(pc.get("ruta_pfx") or "").strip()
    pwd = str(pc.get("password") or "").strip()
    b64 = str(pc.get("pfx_base64") or "").strip()
    if b64 and pwd:
        try:
            raw = base64.b64decode(b64)
        except Exception:
            raw = b""
        if raw:
            dest_dir = ROOT / "certs"
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / "_relay_emisor.pfx"
            dest.write_bytes(raw)
            return CertificadoConfig(ruta_pfx=dest, password_pfx=pwd)
    if ruta and pwd:
        pth = Path(ruta)
        if not pth.is_absolute():
            pth = (ROOT / ruta).resolve()
        return CertificadoConfig(ruta_pfx=pth, password_pfx=pwd)
    return env_cert


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def _attach_file_bytes(result: dict) -> None:
    """El navegador reenvía estos bytes al API de internet; las rutas locales no existen allá."""
    paths = result.get("paths") if isinstance(result.get("paths"), dict) else {}
    files: dict[str, str] = {}
    for key in ("pdf", "xml_firmado", "xml_sin_firma", "cdr_xml", "cdr_zip"):
        raw_path = str(paths.get(key) or "").strip()
        if not raw_path:
            continue
        try:
            blob = Path(raw_path).read_bytes()
        except Exception:
            continue
        if not blob or len(blob) > 4_000_000:
            continue
        files[key] = base64.b64encode(blob).decode("ascii")
    if files:
        result["files_base64"] = files


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        logger.info("%s - %s", self.address_string(), fmt % args)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-EFACT-SECRET")

    def _send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/health":
            self._send_json(200, {"ok": True, "service": "restaurant_efact_api"})
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path != "/emitir":
            self._send_json(404, {"error": "not_found"})
            return

        if SECRET:
            if self.headers.get("X-EFACT-SECRET", "") != SECRET:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "invalid_json", "detail": str(e)})
            return

        try:
            venta = venta_desde_dict(data)
        except Exception as e:
            logger.warning("Payload inválido: %s", e)
            self._send_json(400, {"ok": False, "error": "invalid_sale", "detail": str(e)})
            return

        rutas = load_rutas_from_env()
        cert_env = load_certificado_from_env()
        if cert_env and not cert_env.password_pfx:
            logger.warning("CERT_PFX_PASSWORD vacío; se omite firma SUNAT")
            cert_env = None
        if cert_env and not cert_env.ruta_pfx.exists():
            logger.warning("No existe CERT_PFX_PATH; se omite firma SUNAT")
            cert_env = None

        cert_cfg = _merge_cert_from_payload(data, cert_env)
        if cert_cfg and (not cert_cfg.password_pfx or not cert_cfg.ruta_pfx.exists()):
            cert_cfg = (
                cert_env
                if cert_env and cert_env.password_pfx and cert_env.ruta_pfx.exists()
                else None
            )

        sunat_cfg = _merge_sunat_from_payload(data, load_sunat_config_from_env())
        if sunat_cfg.ambiente == AmbienteSunat.PRODUCCION:
            logger.warning("Ambiente SUNAT PRODUCCIÓN activo.")

        enviar_sunat = cert_cfg is not None
        motivo_sin_firma = None if cert_cfg else "sin_certificado"

        try:
            result = procesar_venta(
                venta,
                rutas=rutas,
                cert_cfg=cert_cfg,
                sunat_cfg=sunat_cfg,
                enviar_sunat=enviar_sunat,
                motivo_sin_firma=motivo_sin_firma,
            )
        except Exception as e:
            logger.exception("Error procesando venta: %s", e)
            self._send_json(500, {"ok": False, "error": str(e)})
            return

        if isinstance(result, dict):
            _attach_file_bytes(result)
        self._send_json(200, result)


def main() -> int:
    host = os.environ.get("EFACT_HTTP_HOST", "127.0.0.1")
    port = int(os.environ.get("EFACT_HTTP_PORT", "8765"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    logger.info("API e-fact escuchando en http://%s:%s (POST /emitir, GET /health)", host, port)
    if SECRET:
        logger.info("Autenticación X-EFACT-SECRET activa")
    else:
        logger.warning("EFACT_HTTP_SECRET no definido: la API acepta peticiones sin token")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Detenido")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
