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
  MdPerson,
  MdTrendingUp,
  MdQrCodeScanner,
} from 'react-icons/md';
import HrDashboardTab from '../../components/hr/HrDashboardTab';
import HrStaffTab from '../../components/hr/HrStaffTab';
import HrSchedulesTab from '../../components/hr/HrSchedulesTab';
import HrHistoryTab from '../../components/hr/HrHistoryTab';
import HrLeavesTab from '../../components/hr/HrLeavesTab';
import HrReportsTab from '../../components/hr/HrReportsTab';
import HrMyDayTab from '../../components/hr/HrMyDayTab';
import WorkTime from './WorkTime';
import { Link } from 'react-router-dom';

const TABS = [
  { id: 'panel', label: 'Panel', icon: MdDashboard },
  { id: 'personal', label: 'Personal', icon: MdPeople },
  { id: 'horarios', label: 'Horarios', icon: MdSchedule },
  { id: 'historial', label: 'Historial', icon: MdHistory },
  { id: 'permisos', label: 'Permisos', icon: MdBeachAccess },
  { id: 'reportes', label: 'Reportes', icon: MdAssessment },
  { id: 'mi', label: 'Mi asistencia', icon: MdPerson },
  { id: 'productividad', label: 'Productividad POS', icon: MdTrendingUp },
];

export default function HrModule() {
  const [tab, setTab] = useState('panel');
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [branches, setBranches] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loadingDash, setLoadingDash] = useState(false);

  const loadCore = useCallback(async () => {
    try {
      const [emps, sch, br] = await Promise.all([
        api.get('/hr/employees'),
        api.get('/hr/schedules'),
        api.get('/hr/branches'),
      ]);
      setEmployees(Array.isArray(emps) ? emps : []);
      setSchedules(Array.isArray(sch) ? sch : []);
      setBranches(Array.isArray(br) ? br : []);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Recursos humanos</h1>
          <p className="text-sm text-[var(--ui-muted)]">Asistencia QR, horarios, permisos y reportes · FADEY Solutions</p>
        </div>
        <Link to="/admin/asistencia" className="btn-primary text-sm inline-flex items-center gap-1.5">
          <MdQrCodeScanner /> Control de asistencia
        </Link>
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
      {tab === 'mi' && <HrMyDayTab />}
      {tab === 'productividad' && <WorkTime />}
    </div>
  );
}
