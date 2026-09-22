import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { useSocket } from '../../hooks/useSocket';
import {
  MdDashboard,
  MdTrendingUp,
  MdStore,
  MdEmojiEvents,
  MdNotificationsActive,
  MdHistory,
  MdDownload,
  MdKeyboardArrowDown,
} from 'react-icons/md';
import WorkTimeReportTab from '../../components/workTime/WorkTimeReportTab';
import WorkTimeAnalyticsPanel from '../../components/workTime/WorkTimeAnalyticsPanel';
import { InlineDateField } from '../../components/DateFilterControls';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import { INDICADORES_CTRL } from '../../components/indicadores/IndicatorsDateFilters';

const MAIN_TABS = [
  { id: 'panel', label: 'Panel', icon: MdDashboard },
  { id: 'reporte', label: 'Jornadas', icon: MdHistory },
  { id: 'productividad', label: 'Productividad', icon: MdTrendingUp },
  { id: 'areas', label: 'Por área', icon: MdStore },
  { id: 'rankings', label: 'Rankings', icon: MdEmojiEvents },
  { id: 'alertas', label: 'Alertas', icon: MdNotificationsActive },
  { id: 'ia', label: 'IA Operativa', pix: true },
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
  const [waiterRatings, setWaiterRatings] = useState([]);
  const [photoModal, setPhotoModal] = useState(null);
  const [classifyDraft, setClassifyDraft] = useState({});
  const [classifySavingId, setClassifySavingId] = useState('');
  const [moduleOpen, setModuleOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const moduleRef = useRef(null);
  const menuListRef = useRef(null);

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

  const loadWaiterRatings = useCallback(async () => {
    try {
      const data = await api.get('/loyalty/waiter-ratings');
      setWaiterRatings(Array.isArray(data?.waiters) ? data.waiters : []);
    } catch (_) {
      setWaiterRatings([]);
    }
  }, []);

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
    loadWaiterRatings();
  }, [loadWaiterRatings]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (mainTab !== 'reporte') loadAnalytics();
  }, [loadAnalytics, mainTab]);

  useSocket('staff-data-update', (p) => {
    if (mainTab !== 'reporte') void loadAnalytics();
    if (!p?.domain || p.domain === 'loyalty') void loadWaiterRatings();
  });

  useSocket('order-update', () => {
    if (mainTab !== 'reporte') void loadAnalytics();
  });

  const updateMenuPos = useCallback(() => {
    const el = moduleRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 168) });
  }, []);

  useEffect(() => {
    if (!moduleOpen) return undefined;
    const onDoc = (e) => {
      if (moduleRef.current?.contains(e.target)) return;
      if (menuListRef.current?.contains(e.target)) return;
      setModuleOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moduleOpen]);

  const analyticsSubTab = mainTab === 'reporte' ? null : mainTab;
  const alertCount = analytics?.alerts?.length ?? 0;
  const activeModule = MAIN_TABS.find((t) => t.id === mainTab) || MAIN_TABS[0];

  const panelBody = mainTab === 'reporte' ? (
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
      waiterRatings={waiterRatings}
      onExport={exportCsv}
    />
  );

  const moduleMenu = moduleOpen && menuPos
    ? createPortal(
      <div
        ref={menuListRef}
        className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-lg py-1 max-h-80 overflow-auto z-[80]"
        style={{
          position: 'fixed',
          top: menuPos.top,
          left: menuPos.left,
          width: menuPos.width,
        }}
        role="listbox"
      >
        {MAIN_TABS.map((t) => {
          const selected = mainTab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={selected}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                selected
                  ? 'bg-[var(--ui-accent)] text-white'
                  : 'text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
              onClick={() => {
                setMainTab(t.id);
                setModuleOpen(false);
              }}
            >
              {t.pix ? (
                <img
                  src={getFadeyAiAvatarSrc(selected ? 'asesorando' : 'saludo')}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover shrink-0 border border-white/30"
                  draggable={false}
                />
              ) : (
                <Icon className="text-base shrink-0" />
              )}
              <span className="flex-1 truncate">{t.label}</span>
              {t.id === 'alertas' && alertCount > 0 ? (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${selected ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>
                  {alertCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>,
      document.body,
    )
    : null;

  /* Vista IA: mismo patrón que Indicadores → IA analítica (selector arriba + panel a pantalla completa). */
  if (mainTab === 'ia') {
    return (
      <div className="space-y-2 relative flex-1 min-h-0 min-w-0 flex flex-col">
        <div className="flex items-center gap-1 min-w-0 shrink-0">
          <div className="relative shrink-0 min-w-[7.5rem] w-[10.5rem] z-30" ref={moduleRef}>
            <button
              type="button"
              className={`${INDICADORES_CTRL} w-full justify-between bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]`}
              onClick={() => {
                if (moduleOpen) {
                  setModuleOpen(false);
                  return;
                }
                updateMenuPos();
                setModuleOpen(true);
              }}
              aria-haspopup="listbox"
              aria-expanded={moduleOpen}
            >
              <img
                src={getFadeyAiAvatarSrc('saludo')}
                alt=""
                className="w-5 h-5 rounded-full object-cover shrink-0 border border-[color:var(--ui-border)]"
                draggable={false}
              />
              <span className="flex-1 text-left truncate">{activeModule.label}</span>
              <MdKeyboardArrowDown className={`shrink-0 text-[var(--ui-muted)] transition ${moduleOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {moduleMenu}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin pr-0.5">
          {panelBody}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-stretch flex-1 min-h-0 h-full">
      <nav
        className="w-full sm:w-44 shrink-0 flex flex-col gap-2"
        aria-label="Secciones de productividad"
      >
        {MAIN_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMainTab(t.id)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition text-left ${
              mainTab === t.id
                ? 'bg-gold-600 text-white border-gold-600'
                : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            {t.pix ? (
              <img
                src={getFadeyAiAvatarSrc(mainTab === t.id ? 'asesorando' : 'saludo')}
                alt=""
                className="w-5 h-5 rounded-full object-cover shrink-0 border border-white/30"
                draggable={false}
              />
            ) : (
              <t.icon className="text-lg shrink-0" />
            )}
            <span className="flex-1 min-w-0 truncate">{t.label}</span>
            {t.id === 'alertas' && alertCount > 0 ? (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] leading-none">
                {alertCount}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4 w-full">
        <div className="shrink-0 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <InlineDateField
              label="Desde"
              value={filters.from}
              onChange={(from) => setFilters((p) => ({ ...p, from }))}
              roundedNone={false}
              className="!rounded-lg"
            />
            <InlineDateField
              label="Hasta"
              value={filters.to}
              onChange={(to) => setFilters((p) => ({ ...p, to }))}
              roundedNone={false}
              className="!rounded-lg"
            />
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

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin pr-0.5">
          {panelBody}
        </div>
      </div>
    </div>
  );
}
