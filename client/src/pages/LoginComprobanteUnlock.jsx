import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MdArrowBack, MdUpload } from 'react-icons/md';
import { api } from '../utils/api';

export default function LoginComprobanteUnlock() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lockInfo, setLockInfo] = useState(null);
  const [monto, setMonto] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [restaurantName, setRestaurantName] = useState('Resto Fadey App');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lock, restaurant] = await Promise.all([
          api.getSystemLockStatus(),
          api.get('/restaurant').catch(() => null),
        ]);
        if (cancelled) return;
        const name = String(restaurant?.name || '').trim();
        if (name) setRestaurantName(name);
        setLockInfo(lock);
        if (!lock?.locked) {
          toast.success('El sistema no está bloqueado. Puede iniciar sesión.');
          navigate('/', { replace: true });
        }
      } catch (err) {
        if (!cancelled) toast.error(err?.message || 'No se pudo verificar el estado del sistema.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const onPickFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file.type?.startsWith('image/') ? URL.createObjectURL(file) : '');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Cargue una imagen o PDF del comprobante.');
      return;
    }
    const amount = Number(monto);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Indique el monto pagado (S/) mayor a cero.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.submitUnlockComprobante({ file: selectedFile, monto: amount });
      toast.success(result?.message || 'Comprobante enviado.');
      if (result?.unlocked) {
        navigate('/', { replace: true });
      } else {
        const lock = await api.getSystemLockStatus();
        setLockInfo(lock);
      }
    } catch (err) {
      toast.error(err?.message || 'No se pudo enviar el comprobante.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--ui-bg)]">
        <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const pago = lockInfo?.pago_uso || {};

  return (
    <div className="min-h-screen bg-[var(--ui-bg)] px-4 py-8">
      <div className="max-w-lg mx-auto">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--ui-muted)] hover:text-[var(--ui-body-text)] mb-4">
          <MdArrowBack /> Volver al inicio de sesión
        </Link>

        <div className="card p-5 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--ui-body-text)]">{restaurantName}</h1>
            <p className="text-sm text-[var(--ui-muted)] mt-1">
              Sistema bloqueado por falta de pago. Cargue su comprobante para desbloquear al instante.
            </p>
            {lockInfo?.reason ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                {lockInfo.reason}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Número de cuenta</label>
              <input className="input-field text-sm" value={pago.numero_cuenta || ''} readOnly />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Empresa a pagar</label>
              <input className="input-field text-sm" value={pago.nombre_empresa_cobro || ''} readOnly />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Monto pagado (S/)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="input-field text-sm"
                placeholder="Ej. 99.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Comprobante de pago</label>
              <p className="text-xs text-[var(--ui-muted)] mb-2">
                Sube una imagen (o PDF) del voucher o transferencia.
              </p>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={submitting}
                onClick={() => fileRef.current?.click()}
              >
                <MdUpload /> {submitting ? 'Enviando…' : 'Cargar comprobante'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf,application/pdf"
                className="sr-only"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
              />
              {selectedFile ? (
                <p className="text-xs text-[var(--ui-muted)] mt-2 truncate">{selectedFile.name}</p>
              ) : null}
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Vista previa del comprobante"
                  className="mt-3 max-h-48 rounded-lg border border-[color:var(--ui-border)] object-contain"
                />
              ) : null}
            </div>

            <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900">
              Indique el <strong>monto pagado (S/)</strong>, cargue el archivo y pulse <strong>Enviar comprobante</strong>.
              El acceso se restaura al instante.
            </div>

            <button
              type="submit"
              disabled={submitting || !selectedFile}
              className="btn-primary w-full py-3 font-semibold disabled:opacity-50"
            >
              {submitting ? 'Enviando comprobante…' : 'Enviar comprobante y desbloquear'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
