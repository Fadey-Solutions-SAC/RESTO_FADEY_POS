import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MdDownload, MdPrint, MdRefresh } from 'react-icons/md';
import { api } from '../../utils/api';

export default function HrSharedAttendanceQr({ compact = false }) {
  const [qr, setQr] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/hr/attendance-qr');
      setQr(data);
    } catch (err) {
      toast.error(err.message);
      setQr(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = async () => {
    if (!window.confirm('¿Regenerar el QR del local? El código anterior dejará de funcionar.')) return;
    try {
      const data = await api.post('/hr/attendance-qr/regenerate', {});
      setQr(data);
      toast.success('QR del local regenerado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deactivate = async () => {
    try {
      await api.post('/hr/attendance-qr/deactivate', {});
      toast.success('QR desactivado');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const downloadQr = () => {
    if (!qr?.png_base64) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${qr.png_base64}`;
    a.download = 'qr-asistencia-local.png';
    a.click();
  };

  const printQr = () => {
    if (!qr?.png_base64) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR Asistencia</title>
      <style>body{font-family:system-ui;text-align:center;padding:24px} img{width:280px;height:280px}</style></head>
      <body><h2>Asistencia · QR del local</h2>
      <p style="font-size:14px;color:#444">Un solo código para todo el personal. Cada trabajador escanea con su sesión iniciada.</p>
      <img src="data:image/png;base64,${qr.png_base64}" alt="QR" />
      <p style="font-size:12px;color:#666">Resto-FADEY</p>
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  if (loading) {
    return <p className="text-sm text-center text-[var(--ui-muted)] py-8">Cargando QR…</p>;
  }

  return (
    <div className={`space-y-3 text-center ${compact ? '' : ''}`}>
      <p className="text-sm text-[var(--ui-muted)] text-left">
        Imprima o muestre este código en el local. Todo el personal usa el mismo QR; la marcación se asocia al usuario
        que tenga la sesión abierta en Control de asistencia.
      </p>
      <p className="text-sm text-[var(--ui-muted)]">
        Estado: {qr?.active ? 'Activo' : 'Inactivo'}
        {qr?.created_at ? ` · creado ${qr.created_at}` : ''}
      </p>
      {qr?.png_base64 ? (
        <img
          src={`data:image/png;base64,${qr.png_base64}`}
          alt="Código QR de asistencia del local"
          className="mx-auto w-56 h-56 rounded-xl border border-[color:var(--ui-border)] bg-white p-2"
        />
      ) : (
        <p className="text-sm py-8">No hay imagen QR. Genere el código.</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={regenerate}>
          <MdRefresh /> Generar / Regenerar
        </button>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={downloadQr} disabled={!qr?.png_base64}>
          <MdDownload /> Descargar
        </button>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={printQr} disabled={!qr?.png_base64}>
          <MdPrint /> Imprimir
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={deactivate} disabled={!qr?.active}>
          Desactivar
        </button>
      </div>
    </div>
  );
}
