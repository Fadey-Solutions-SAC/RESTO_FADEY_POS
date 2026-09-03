import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import {
  MdDashboard,
  MdPeople,
  MdSchedule,
  MdHistory,
  MdBeachAccess,
  MdAssessment,
  MdTrendingUp,
  MdQrCodeScanner,
  MdToggleOn,
  MdToggleOff,
} from 'react-icons/md';
import HrDashboardTab from '../../components/hr/HrDashboardTab';
import HrStaffTab from '../../components/hr/HrStaffTab';
import HrSchedulesTab from '../../components/hr/HrSchedulesTab';
import HrHistoryTab from '../../components/hr/HrHistoryTab';
import HrLeavesTab from '../../components/hr/HrLeavesTab';
import HrReportsTab from '../../components/hr/HrReportsTab';
import WorkTime from './WorkTime';
import { Link } from 'react-router-dom';
import Modal from '../../components/Modal';

const TABS = [
  { id: 'panel', label: 'Panel', icon: MdDashboard },
  { id: 'personal', label: 'Personal', icon: MdPeople },
  { id: 'horarios', label: 'Horarios', icon: MdSchedule },
  { id: 'historial', label: 'Historial', icon: MdHistory },
  { id: 'permisos', label: 'Permisos', icon: MdBeachAccess },
  { id: 'reportes', label: 'Reportes', icon: MdAssessment },
  { id: 'productividad', label: 'Productividad POS', icon: MdTrendingUp },
];

export default function HrModule() {
  const [tab, setTab] = useState('panel');
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [branches, setBranches] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [qrActiva, setQrActiva] = useState(true);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  const loadCore = useCallback(async () => {
    try {
      const [emps, sch, br, mode] = await Promise.all([
        api.get('/hr/employees'),
        api.get('/hr/schedules'),
        api.get('/hr/branches'),
        api.get('/hr/asistencia-qr-mode').catch(() => ({ active: true })),
      ]);
      setEmployees(Array.isArray(emps) ? emps : []);
      setSchedules(Array.isArray(sch) ? sch : []);
      setBranches(Array.isArray(br) ? br : []);
      setQrActiva(mode?.active !== false);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoadingDash(true);
    try {
      const data = await api.get('/hr/dashboard');
      setDashboard(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (tab === 'panel') loadDashboard();
  }, [tab, loadDashboard]);

  const confirmToggleQr = async () => {
    const pwd = String(adminPassword || '').trim();
    if (!pwd) {
      toast.error('Ingrese la contraseña de administrador');
      return;
    }
    setPwdBusy(true);
    try {
      const next = !qrActiva;
      const data = await api.put('/hr/asistencia-qr-mode', {
        active: next,
        admin_password: pwd,
      });
      const on = data?.active !== false && next;
      setQrActiva(Boolean(data?.active ?? next));
      try {
        localStorage.setItem('resto-asistencia-qr-activa', (data?.active ?? next) ? '1' : '0');
      } catch { /* ignore */ }
      setPwdOpen(false);
      setAdminPassword('');
      toast.success(on
        ? 'Jornada por QR activada'
        : 'Jornada por QR desactivada: se cuenta desde inicio a fin de sesión');
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el modo');
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Recursos humanos</h1>
          <p className="text-sm text-[var(--ui-muted)]">Asistencia QR, horarios, permisos y reportes · FADEY Solutions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/admin/asistencia" className="btn-primary text-sm inline-flex items-center gap-1.5">
            <MdQrCodeScanner /> Control de asistencia
          </Link>
          <button
            type="button"
            onClick={() => { setAdminPassword(''); setPwdOpen(true); }}
            className={`text-sm inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border font-medium transition ${
              qrActiva
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
            }`}
            title={qrActiva
              ? 'QR activo: la jornada se marca con código QR'
              : 'QR desactivado: la jornada se cuenta por inicio y fin de sesión'}
          >
            {qrActiva ? <MdToggleOn className="text-xl" /> : <MdToggleOff className="text-xl" />}
            {qrActiva ? 'QR jornada: activo' : 'QR jornada: off'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition ${
              tab === t.id
                ? 'bg-gold-600 text-white border-gold-600'
                : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            <t.icon />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'panel' && <HrDashboardTab data={dashboard} loading={loadingDash} />}
      {tab === 'personal' && (
        <HrStaffTab
          employees={employees}
          schedules={schedules}
          branches={branches}
          onReload={loadCore}
        />
      )}
      {tab === 'horarios' && (
        <HrSchedulesTab schedules={schedules} employees={employees} onReload={loadCore} />
      )}
      {tab === 'historial' && <HrHistoryTab employees={employees} branches={branches} />}
      {tab === 'permisos' && <HrLeavesTab employees={employees} />}
      {tab === 'reportes' && <HrReportsTab />}
      {tab === 'productividad' && <WorkTime />}

      <Modal
        isOpen={pwdOpen}
        onClose={() => { if (!pwdBusy) { setPwdOpen(false); setAdminPassword(''); } }}
        title={qrActiva ? 'Desactivar jornada por QR' : 'Activar jornada por QR'}
        size="sm"
      >
        <p className="text-sm text-[var(--ui-muted)] mb-3">
          {qrActiva
            ? 'Al desactivar, el tiempo se cuenta desde el inicio hasta el fin de sesión de cada usuario.'
            : 'Al activar, el personal marca entrada y salida con el código QR (Control de asistencia).'}
        </p>
        <label className="block text-sm font-medium mb-1">Contraseña de administrador</label>
        <input
          type="password"
          className="input-field w-full mb-4"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          autoComplete="current-password"
          disabled={pwdBusy}
          onKeyDown={(e) => { if (e.key === 'Enter') void confirmToggleQr(); }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={pwdBusy}
            onClick={() => { setPwdOpen(false); setAdminPassword(''); }}
          >
            Cancelar
          </button>
          <button type="button" className="btn-primary flex-1" disabled={pwdBusy} onClick={() => void confirmToggleQr()}>
            {pwdBusy ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
