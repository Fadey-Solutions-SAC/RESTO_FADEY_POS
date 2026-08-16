import { useEffect, useState, useCallback } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import {
  MdAccessTime,
  MdDashboard,
  MdTrendingUp,
  MdStore,
  MdEmojiEvents,
  MdNotificationsActive,
  MdPsychology,
  MdHistory,
  MdDownload,
} from 'react-icons/md';
import WorkTimeReportTab from '../../components/workTime/WorkTimeReportTab';
import WorkTimeAnalyticsPanel from '../../components/workTime/WorkTimeAnalyticsPanel';

const MAIN_TABS = [
  { id: 'panel', label: 'Panel', icon: MdDashboard },
  { id: 'reporte', label: 'Jornadas', icon: MdHistory },
  { id: 'productividad', label: 'Productividad', icon: MdTrendingUp },
  { id: 'areas', label: 'Por área', icon: MdStore },
  { id: 'rankings', label: 'Rankings', icon: MdEmojiEvents },
  { id: 'alertas', label: 'Alertas', icon: MdNotificationsActive },
  { id: 'ia', label: 'IA operativa', icon: MdPsychology },
];

export default function WorkTime() {
  const [mainTab, setMainTab] = useState('panel');
  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', user_id: 'all' });
  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [photoModal, setPhotoModal] = useState(null);
  const [classifyDraft, setClassifyDraft] = useState({});
  const [classifySavingId, setClassifySavingId] = useState('');

  const openSessionPhotos = async (sessionId) => {
    try {
      const data = await api.get(`/users/work-sessions/${sessionId}/photos`);
      setPhotoModal(data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await api.get('/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (_) {
      setUsers([]);
    }
  };

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.user_id !== 'all') qs.set('user_id', filters.user_id);
      const data = await api.get(`/users/work-sessions${qs.toString() ? `?${qs.toString()}` : ''}`);
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      setSessions(list);
      setSummary(Array.isArray(data?.summary) ? data.summary : []);
      const draft = {};
      list.forEach((r) => {
        if (r.attendance_status === 'pending') draft[r.id] = 'asistente';
      });
      setClassifyDraft(draft);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters.from, filters.to, filters.user_id]);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.user_id !== 'all') qs.set('user_id', filters.user_id);
      const data = await api.get(`/users/work-analytics${qs.toString() ? `?${qs.toString()}` : ''}`);
      setAnalytics(data);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar la analítica');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [filters.from, filters.to, filters.user_id]);

  const applyClassification = async (sessionId) => {
    const status = classifyDraft[sessionId] || 'asistente';
    try {
      setClassifySavingId(sessionId);
      await api.patch(`/users/work-sessions/${encodeURIComponent(sessionId)}/attendance`, { status });
      toast.success('Asistencia registrada');
      await loadReport();
      await loadAnalytics();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setClassifySavingId('');
    }
  };

  const exportCsv = () => {
    if (!analytics?.productivity?.length) {
      toast.error('No hay datos para exportar');
      return;
    }
    const header = ['Empleado', 'Rol', 'Minutos', 'Pedidos', 'Ventas', 'Productividad/h'];
    const rows = analytics.productivity.map((p) => [
      p.full_name,
      p.role,
      p.worked_minutes,
      p.orders_paid,
      p.sales_total,
      p.productivity_per_hour,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tiempo-trabajado-${filters.from || 'todo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exportación lista');
  };

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (mainTab !== 'reporte') loadAnalytics();
  }, [loadAnalytics, mainTab]);

  useSocket('staff-data-update', () => {
    if (mainTab !== 'reporte') void loadAnalytics();
  });

  useSocket('order-update', () => {
    if (mainTab !== 'reporte') void loadAnalytics();
  });

  const analyticsSubTab = mainTab === 'reporte' ? null : mainTab;
  const alertCount = analytics?.alerts?.length ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[var(--ui-body-text)] flex items-center gap-2 rf-module-page-title">
        <MdAccessTime className="text-gold-600" /> Recursos humanos
      </h1>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-1.5 h-9 px-2 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] bg-[var(--ui-surface)]">
            <span className="text-[var(--ui-muted)] shrink-0">Desde</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
              className="bg-transparent border-0 p-0 text-xs outline-none text-[var(--ui-body-text)] min-w-0"
            />
          </label>
          <label className="flex items-center gap-1.5 h-9 px-2 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] bg-[var(--ui-surface)]">
            <span className="text-[var(--ui-muted)] shrink-0">Hasta</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
              className="bg-transparent border-0 p-0 text-xs outline-none text-[var(--ui-body-text)] min-w-0"
            />
          </label>
          <label className="flex items-center gap-1.5 h-9 px-2 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] bg-[var(--ui-surface)] min-w-[10rem]">
            <span className="text-[var(--ui-muted)] shrink-0">Usuario</span>
            <select
              value={filters.user_id}
              onChange={(e) => setFilters((p) => ({ ...p, user_id: e.target.value }))}
              className="bg-transparent border-0 p-0 text-xs outline-none text-[var(--ui-body-text)] flex-1 min-w-0"
            >
              <option value="all">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={() => { loadReport(); loadAnalytics(); }} disabled={loading || analyticsLoading}>
            Actualizar
          </button>
          <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={exportCsv}>
            <MdDownload /> Exportar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {MAIN_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMainTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition ${
              mainTab === t.id
                ? 'bg-gold-600 text-white border-gold-600'
                : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            <t.icon />
            {t.label}
            {t.id === 'alertas' && alertCount > 0 ? (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">{alertCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {mainTab === 'reporte' ? (
        <WorkTimeReportTab
          sessions={sessions}
          summary={summary}
          loading={loading}
          loadReport={loadReport}
          photoModal={photoModal}
          setPhotoModal={setPhotoModal}
          openSessionPhotos={openSessionPhotos}
          classifyDraft={classifyDraft}
          setClassifyDraft={setClassifyDraft}
          classifySavingId={classifySavingId}
          applyClassification={applyClassification}
        />
      ) : analyticsLoading && !analytics ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <WorkTimeAnalyticsPanel
          data={analytics}
          subTab={analyticsSubTab}
          filters={filters}
          setFilters={setFilters}
          users={users}
          onExport={exportCsv}
        />
      )}
    </div>
  );
}
