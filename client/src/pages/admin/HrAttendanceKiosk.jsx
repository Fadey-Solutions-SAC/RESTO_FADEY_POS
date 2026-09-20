import { useEffect, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import HrQrScanner from '../../components/hr/HrQrScanner';
import { formatMinutes, formatSqlTime, getHrDeviceId } from '../../components/hr/hrFormat';
import { MdCheckCircle, MdLogout, MdWarningAmber } from 'react-icons/md';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getProductionStaffPath } from '../../utils/staffModuleAccess';

export default function HrAttendanceKiosk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [qrActiva, setQrActiva] = useState(true);
  const [modeLoading, setModeLoading] = useState(true);
  const [meLoading, setMeLoading] = useState(true);
  const [openAttendance, setOpenAttendance] = useState(null);

  const productionPath = useMemo(() => getProductionStaffPath(user), [user]);
  const isProductionStaff = ['produccion', 'cocina', 'bar'].includes(String(user?.role || '').toLowerCase());
  const jornadaActiva = Boolean(openAttendance?.check_in_at && !openAttendance?.check_out_at);

  const loadMyStatus = useCallback(async () => {
    setMeLoading(true);
    try {
      const me = await api.get('/hr/me');
      setOpenAttendance(me?.open || null);
    } catch (_) {
      setOpenAttendance(null);
    } finally {
      setMeLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (modeLoading || !qrActiva) return;
    void loadMyStatus();
  }, [modeLoading, qrActiva, loadMyStatus]);

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
      await loadMyStatus();
      if (data.action === 'check_in' && isProductionStaff && productionPath && productionPath !== '/') {
        toast.success('Jornada activa. Entrando al módulo…');
        setTimeout(() => navigate(productionPath, { replace: true }), 900);
      }
    } catch (err) {
      toast.error(err.message);
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }, [busy, branchId, qrActiva, loadMyStatus, isProductionStaff, productionPath, navigate]);

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
        <p className="text-sm text-[var(--ui-muted)]">
          Escanea el QR del local con la cámara. Debe tener su sesión iniciada.
        </p>
      </div>

      {!meLoading ? (
        <div
          className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${
            jornadaActiva
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-amber-500/40 bg-amber-500/10'
          }`}
        >
          <div className="min-w-0 flex items-start gap-2">
            {jornadaActiva ? (
              <MdCheckCircle className="text-emerald-600 text-xl shrink-0 mt-0.5" />
            ) : (
              <MdWarningAmber className="text-amber-600 text-xl shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${jornadaActiva ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-900 dark:text-amber-100'}`}>
                {jornadaActiva ? 'Jornada activa' : 'Falta activar jornada'}
              </p>
              <p className="text-xs text-[var(--ui-muted)] mt-0.5">
                {jornadaActiva
                  ? `Ingreso: ${formatSqlTime(openAttendance.check_in_at)}. Escanee de nuevo para registrar salida.`
                  : 'Escanee el QR del local para marcar ingreso y empezar a trabajar.'}
              </p>
            </div>
          </div>
          {jornadaActiva && isProductionStaff && productionPath && productionPath !== '/' ? (
            <Link to={productionPath} className="btn-primary text-sm shrink-0">
              Ir al módulo
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-xs text-[var(--ui-muted)]">Comprobando su jornada…</p>
      )}

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
              {isProductionStaff && productionPath && productionPath !== '/' ? (
                <Link to={productionPath} className="btn-primary text-sm mt-2 inline-flex">Ir al módulo</Link>
              ) : null}
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
