import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import HrQrScanner from '../../components/hr/HrQrScanner';
import { formatMinutes, formatSqlTime, getHrDeviceId } from '../../components/hr/hrFormat';
import { MdCheckCircle, MdLogout } from 'react-icons/md';
import { Link } from 'react-router-dom';

export default function HrAttendanceKiosk() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [qrActiva, setQrActiva] = useState(true);
  const [modeLoading, setModeLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/hr/branches').catch(() => []),
      api.get('/hr/asistencia-qr-mode').catch(() => ({ active: true })),
    ]).then(([list, mode]) => {
      const arr = Array.isArray(list) ? list : [];
      setBranches(arr);
      if (arr[0]?.id) setBranchId(arr[0].id);
      setQrActiva(mode?.active !== false);
    }).finally(() => setModeLoading(false));
  }, []);

  const onScan = useCallback(async (token) => {
    if (busy || !qrActiva) return;
    setBusy(true);
    try {
      const data = await api.post('/hr/attendance/scan', {
        token,
        branch_id: branchId,
        device_id: getHrDeviceId(),
      });
      setResult(data);
      toast.success(data.title || 'Marcación registrada');
    } catch (err) {
      toast.error(err.message);
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }, [busy, branchId, qrActiva]);

  if (modeLoading) {
    return <p className="text-center text-sm text-[var(--ui-muted)] py-12">Cargando…</p>;
  }

  if (!qrActiva) {
    return (
      <div className="max-w-lg mx-auto card p-6 space-y-3 text-center">
        <h1 className="text-xl font-semibold">Jornada por QR desactivada</h1>
        <p className="text-sm text-[var(--ui-muted)]">
          El tiempo se cuenta desde el inicio hasta el fin de sesión. Un administrador puede activar el QR en Recursos humanos.
        </p>
        <Link to="/admin" className="btn-secondary inline-flex text-sm">Volver</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Control de asistencia</h1>
        <p className="text-sm text-[var(--ui-muted)]">Escanea tu código QR</p>
      </div>

      {branches.length > 1 ? (
        <label className="flex items-center gap-2 text-sm justify-center">
          <span className="text-[var(--ui-muted)]">Sede</span>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)]"
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      ) : null}

      <HrQrScanner onScan={onScan} paused={busy} />

      {result && !result.error ? (
        <div className={`card p-6 text-center space-y-2 ${result.action === 'check_out' ? 'ring-2 ring-sky-500/40' : 'ring-2 ring-emerald-500/40'}`}>
          <div className="flex justify-center text-4xl">
            {result.action === 'check_out' ? <MdLogout className="text-sky-500" /> : <MdCheckCircle className="text-emerald-500" />}
          </div>
          <h2 className="text-xl font-semibold">{result.title}</h2>
          <p className="text-lg">{result.employee?.full_name}</p>
          {result.action === 'check_in' ? (
            <>
              <p>Ingreso: {formatSqlTime(result.display?.check_in)}</p>
              <p className="text-sm text-[var(--ui-muted)]">Horario: {result.display?.schedule}</p>
              {Number(result.display?.late_minutes) > 0 && !result.display?.on_time ? (
                <p className="text-amber-600 font-medium">Tardanza: {result.display.late_minutes} minutos</p>
              ) : (
                <p className="text-emerald-600 font-medium">A tiempo</p>
              )}
            </>
          ) : (
            <>
              <p>Ingreso: {formatSqlTime(result.display?.check_in)}</p>
              <p>Salida: {formatSqlTime(result.display?.check_out)}</p>
              <p>Horas trabajadas: {result.display?.worked || formatMinutes(result.attendance?.worked_minutes)}</p>
              <p className="text-sm">Horas extras: {result.display?.overtime || formatMinutes(result.attendance?.overtime_minutes)}</p>
            </>
          )}
          <button type="button" className="btn-secondary text-sm mt-2" onClick={() => setResult(null)}>Nueva marcación</button>
        </div>
      ) : null}

      {busy ? <p className="text-center text-sm text-[var(--ui-muted)]">Registrando…</p> : null}
    </div>
  );
}
