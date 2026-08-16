import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { getPresetRange } from '../../utils/indicatorsDatePresets';
import {
  MdDashboard,
  MdAttachMoney,
  MdStore,
  MdTrendingUp,
  MdInventory,
  MdPeople,
  MdRestaurantMenu,
  MdBarChart,
  MdNotificationsActive,
  MdPsychology,
  MdDownload,
  MdSync,
  MdKeyboardArrowDown,
} from 'react-icons/md';
import {
  IndicatorsGeneralPanel,
  IndicatorsFinancialPanel,
  IndicatorsOperationalPanel,
  IndicatorsProductivityPanel,
  IndicatorsInventoryPanel,
  IndicatorsCustomersPanel,
  IndicatorsProductsPanel,
  IndicatorsChartsPanel,
  IndicatorsInsightsPanel,
} from '../../components/indicadores/IndicatorsHubPanels';
import IndicatorsAlertsPanel from '../../components/indicadores/IndicatorsAlertsPanel';
import IndicatorsDateFilters, { INDICADORES_CTRL } from '../../components/indicadores/IndicatorsDateFilters';
import IndicatorsExportMenu from '../../components/indicadores/IndicatorsExportMenu';

const TABS = [
  { id: 'general', label: 'Panel', icon: MdDashboard },
  { id: 'financiero', label: 'Financiero', icon: MdAttachMoney },
  { id: 'operativo', label: 'Operativo', icon: MdStore },
  { id: 'productividad', label: 'Productividad', icon: MdTrendingUp },
  { id: 'inventario', label: 'Inventario', icon: MdInventory },
  { id: 'clientes', label: 'Clientes', icon: MdPeople },
  { id: 'productos', label: 'Productos', icon: MdRestaurantMenu },
  { id: 'graficos', label: 'Gráficos', icon: MdBarChart },
  { id: 'alertas', label: 'Alertas', icon: MdNotificationsActive },
  { id: 'ia', label: 'IA analítica', icon: MdPsychology },
];

const TAB_IDS = new Set(TABS.map((t) => t.id));

export default function Indicadores() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = String(searchParams.get('tab') || '').trim();
  const [tab, setTab] = useState(() => (TAB_IDS.has(tabFromUrl) ? tabFromUrl : 'general'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preset, setPreset] = useState('month');
  const [filters, setFilters] = useState(() => getPresetRange('month'));
  const [exportOpen, setExportOpen] = useState(false);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const debounceRef = useRef(null);
  const moduleRef = useRef(null);

  useEffect(() => {
    const next = String(searchParams.get('tab') || '').trim();
    if (TAB_IDS.has(next) && next !== tab) setTab(next);
  }, [searchParams, tab]);

  const selectTab = (id) => {
    setTab(id);
    const next = new URLSearchParams(searchParams);
    if (id && id !== 'general') next.set('tab', id);
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const loadHub = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      const hub = await api.get(`/reports/indicators-hub${qs.toString() ? `?${qs}` : ''}`);
      setData(hub);
    } catch (err) {
      console.error(err);
      setLoadError(err?.message || 'No se pudieron cargar los indicadores');
      if (!soft) setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters.from, filters.to]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  const scheduleReload = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void loadHub(true), 600);
  }, [loadHub]);

  useSocket('order-update', scheduleReload);
  useSocket('new-order', scheduleReload);
  useSocket('inventory-update', scheduleReload);
  useSocket('staff-data-update', scheduleReload);
  useSocket('table-update', scheduleReload);
  useSocket('delivery-update', scheduleReload);
  useSocket('register-update', scheduleReload);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useEffect(() => {
    if (!moduleOpen) return undefined;
    const onDoc = (e) => {
      if (moduleRef.current && !moduleRef.current.contains(e.target)) setModuleOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moduleOpen]);

  const handlePresetChange = (id) => {
    setPreset(id);
    if (id !== 'custom') setFilters(getPresetRange(id));
  };

  const alertCount = data?.alerts?.length ?? 0;
  const activeModule = TABS.find((t) => t.id === tab) || TABS[0];
  const ActiveModuleIcon = activeModule.icon;

  const renderPanel = () => {
    if (loadError && !data) {
      return (
        <div className="card border border-red-500/30 bg-red-500/5 p-6 text-center space-y-3">
          <p className="text-sm text-[var(--ui-body-text)]">{loadError}</p>
          <button type="button" className="btn-primary text-sm" onClick={() => void loadHub()}>
            Reintentar
          </button>
        </div>
      );
    }
    if (!data) {
      return (
        <div className="card p-6 text-center text-sm text-[var(--ui-muted)]">
          Sin datos. Pulse Actualizar o cambie el rango de fechas (pruebe «Mes»).
        </div>
      );
    }
    switch (tab) {
      case 'general':
        return <IndicatorsGeneralPanel data={data} />;
      case 'financiero':
        return <IndicatorsFinancialPanel data={data} />;
      case 'operativo':
        return <IndicatorsOperationalPanel data={data} />;
      case 'productividad':
        return <IndicatorsProductivityPanel data={data} />;
      case 'inventario':
        return <IndicatorsInventoryPanel data={data} />;
      case 'clientes':
        return <IndicatorsCustomersPanel data={data} />;
      case 'productos':
        return <IndicatorsProductsPanel data={data} />;
      case 'graficos':
        return <IndicatorsChartsPanel data={data} />;
      case 'alertas':
        return <IndicatorsAlertsPanel data={data} />;
      case 'ia':
        return <IndicatorsInsightsPanel data={data} />;
      default:
        return <IndicatorsGeneralPanel data={data} />;
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="animate-spin w-10 h-10 border-4 border-gold-500 border-t-transparent rounded-full" />
        <p className="text-sm text-[var(--ui-muted)]">Cargando indicadores…</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 relative -mt-1 sm:-mt-3">
      {refreshing ? (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gold-500/30 overflow-hidden z-10">
          <div className="h-full w-1/3 bg-gold-500 animate-pulse" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <IndicatorsDateFilters
          preset={preset}
          onPresetChange={handlePresetChange}
          filters={filters}
          onFiltersChange={setFilters}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`${INDICADORES_CTRL} w-[7.5rem] justify-center bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] disabled:opacity-60`}
            disabled={refreshing}
            onClick={() => void loadHub(true)}
          >
            <MdSync className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button
            type="button"
            className={`${INDICADORES_CTRL} w-[7.5rem] justify-center bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]`}
            onClick={() => setExportOpen(true)}
          >
            <MdDownload /> Exportar
          </button>
        </div>
      </div>

      <div className="relative min-w-[7.5rem] w-[11.5rem]" ref={moduleRef}>
        <button
          type="button"
          className={`${INDICADORES_CTRL} w-full justify-between bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]`}
          onClick={() => setModuleOpen((open) => !open)}
          aria-haspopup="listbox"
          aria-expanded={moduleOpen}
        >
          <ActiveModuleIcon className="text-gold-600 shrink-0 text-sm" />
          <span className="flex-1 text-left truncate">{activeModule.label}</span>
          {activeModule.id === 'alertas' && alertCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">{alertCount}</span>
          ) : null}
          <MdKeyboardArrowDown className={`shrink-0 text-[var(--ui-muted)] transition ${moduleOpen ? 'rotate-180' : ''}`} />
        </button>
        {moduleOpen ? (
          <div
            className="absolute z-20 mt-1 w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-lg py-1 max-h-80 overflow-auto"
            role="listbox"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    selectTab(t.id);
                    setModuleOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left ${
                    selected
                      ? 'bg-gold-600 text-white'
                      : 'text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                  }`}
                >
                  <Icon />
                  <span className="flex-1">{t.label}</span>
                  {t.id === 'alertas' && alertCount > 0 ? (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${selected ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>
                      {alertCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className={refreshing ? 'opacity-90 transition-opacity' : ''}>{renderPanel()}</div>

      <IndicatorsExportMenu
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        hub={data}
        filters={filters}
        activeTab={tab}
      />
    </div>
  );
}
