import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import AttendancePhotoCapture from './AttendancePhotoCapture';
import HrQrScanner from './hr/HrQrScanner';
import { formatMinutes, formatSqlTime, getHrDeviceId } from './hr/hrFormat';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import toast from 'react-hot-toast';

/**
 * Finalizar jornada:
 * - QR activo + jornada abierta → escanear QR (salida), registra horas y cierra sesión.
 * - QR inactivo → foto si la política lo exige, luego cerrar sesión.
 * - Sin jornada QR abierta → solo cerrar sesión (no reingresa sola).
 */
export default function EndShiftModal({ isOpen, onClose }) {
  const { logout } = useAuth();
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [logoutRequired, setLogoutRequired] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [qrMode, setQrMode] = useState(false);
  const [openAttendance, setOpenAttendance] = useState(null);
  const [branchId, setBranchId] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [checkoutSummary, setCheckoutSummary] = useState(null);

  const needsQrCheckout = qrMode && Boolean(openAttendance?.check_in_at && !openAttendance?.check_out_at);

  useEffect(() => {
    if (!isOpen) {
      setPhoto(null);
      setLoading(false);
      setScanBusy(false);
      setCheckoutSummary(null);
      setOpenAttendance(null);
      setPolicyLoading(true);
      return;
    }

    let cancelled = false;
    setPolicyLoading(true);

    (async () => {
      try {
        const [photos, mode, branches, me] = await Promise.all([
          api.get('/auth/attendance-photos-required').catch(() => ({ logoutRequired: false })),
          api.get('/hr/asistencia-qr-mode').catch(() => ({ active: false })),
          api.get('/hr/branches').catch(() => []),
          api.get('/hr/me').catch(() => null),
        ]);
        if (cancelled) return;
        const qrOn = mode?.active !== false;
        setQrMode(qrOn);
        setLogoutRequired(!!photos?.logoutRequired);
        const list = Array.isArray(branches) ? branches : [];
        setBranchId(list[0]?.id || '');
        setOpenAttendance(me?.open || null);
        try {
          localStorage.setItem('resto-asistencia-qr-activa', qrOn ? '1' : '0');
        } catch { /* ignore */ }
      } finally {
        if (!cancelled) setPolicyLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const finishLogout = useCallback(async (opts = {}) => {
    setLoading(true);
    try {
      await logout(opts);
    } catch (err) {
      toast.error(err?.message || 'No se pudo cerrar la sesión');
      setLoading(false);
    }
  }, [logout]);

  const handleConfirmSession = async () => {
    if (!qrMode && logoutRequired && !photo) {
      toast.error('Tome una foto para finalizar la jornada');
      return;
    }
    await finishLogout(!qrMode && logoutRequired && photo ? { photo_logout: photo } : {});
  };

  const onQrScan = useCallback(async (token) => {
    if (scanBusy || loading || !needsQrCheckout) return;
    setScanBusy(true);
    try {
      const data = await api.post('/hr/attendance/scan', {
        token,
        branch_id: branchId,
        device_id: getHrDeviceId(),
      });
      if (data?.action !== 'check_out') {
        toast.error('Escanee de nuevo el QR para registrar la salida (tiene jornada abierta).');
        setScanBusy(false);
        return;
      }
      setCheckoutSummary(data);
      toast.success(data.title || 'Salida registrada');
      // Horas/productividad ya quedan en HR; cerrar sesión sin volver a entrar.
      await finishLogout({});
    } catch (err) {
      toast.error(err?.message || 'No se pudo registrar la salida');
      setScanBusy(false);
    }
  }, [scanBusy, loading, needsQrCheckout, branchId, finishLogout]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={loading || scanBusy ? () => {} : onClose}
      title="Finalizar jornada"
      size="md"
      placement="center"
    >
      {policyLoading ? (
        <p className="text-sm text-[var(--ui-muted)] mb-4">Cargando…</p>
      ) : needsQrCheckout ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--ui-muted)]">
            Su jornada por QR está activa (ingreso:{' '}
            <strong className="text-[var(--ui-body-text)]">{formatSqlTime(openAttendance.check_in_at)}</strong>
            ). Escanee el QR del local para registrar la salida; el sistema guardará las horas y cerrará la sesión automáticamente.
          </p>
          <HrQrScanner onScan={onQrScan} paused={scanBusy || loading} />
          {checkoutSummary ? (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm space-y-1">
              <p className="font-semibold text-[var(--ui-body-text)]">Salida registrada</p>
              <p>Horas: {checkoutSummary.display?.worked || formatMinutes(checkoutSummary.attendance?.worked_minutes)}</p>
              <p className="text-[var(--ui-muted)]">Cerrando sesión…</p>
            </div>
          ) : null}
          {scanBusy || loading ? (
            <p className="text-center text-sm text-[var(--ui-muted)]">
              {loading ? 'Cerrando sesión…' : 'Registrando salida…'}
            </p>
          ) : null}
          <div className="flex gap-3 mt-2 justify-end">
            <button
              type="button"
              disabled={loading || scanBusy}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-body-text)] text-sm hover:bg-[var(--ui-surface-2)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : logoutRequired && !qrMode ? (
        <>
          <p className="text-sm text-[var(--ui-muted)] mb-4">
            Tome una foto para registrar el cierre de su jornada. Después podrá salir del sistema.
          </p>
          {isOpen && (
            <AttendancePhotoCapture onCapture={setPhoto} disabled={loading} />
          )}
          <div className="flex gap-3 mt-6 justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-body-text)] text-sm hover:bg-[var(--ui-surface-2)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={loading || !photo}
              onClick={() => void handleConfirmSession()}
              className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {loading ? 'Cerrando…' : 'Tomar foto y salir'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--ui-muted)] mb-4">
            {qrMode
              ? 'No hay jornada QR abierta. Se cerrará su sesión en el sistema.'
              : 'Se cerrará su sesión en el sistema.'}
          </p>
          <div className="flex gap-3 mt-6 justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-body-text)] text-sm hover:bg-[var(--ui-surface-2)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleConfirmSession()}
              className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {loading ? 'Cerrando…' : 'Salir'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
