import { useState, useEffect, useCallback, useRef } from 'react';
import { api, formatInstantTime } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { getPresetRange } from '../../utils/indicatorsDatePresets';
import {
  MdInsights,
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
  MdCircle,
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
import IndicatorsDateFilters from '../../components/indicadores/IndicatorsDateFilters';
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

export default function Indicadores() {
  const [tab, setTab] = useState('general');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preset, setPreset] = useState('month');
  const [filters, setFilters] = useState(() => getPresetRange('month'));
  const [exportOpen, setExportOpen] = useState(false);
  const [livePulse, setLivePulse] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const debounceRef = useRef(null);

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
      setLivePulse(true);
      setTimeout(() => setLivePulse(false), 800);
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

  const handlePresetChange = (id) => {
    setPreset(id);
    if (id !== 'custom') setFilters(getPresetRange(id));
  };

  const alertCount = data?.alerts?.length ?? 0;

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
    <div className="space-y-4 relative">
      {refreshing ? (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gold-500/30 overflow-hidden z-10">
          <div className="h-full w-1/3 bg-gold-500 animate-pulse" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdInsights className="text-gold-600" /> Indicadores
          </h1>
          <p className="text-sm text-[var(--ui-muted)] mt-1 max-w-2xl">
            Centro de análisis conectado con caja, mesas, cocina, delivery, inventario, clientes y tiempo trabajado.
          </p>
          <div className={`flex items-center gap-1.5 text-xs mt-2 ${livePulse ? 'text-emerald-600' : 'text-[var(--ui-muted)]'}`}>
            <MdCircle className="text-[6px]" />
            {livePulse ? 'Actualizado en vivo' : 'Sincronización en tiempo real activa'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm flex items-center gap-1"
            disabled={refreshing}
            onClick={() => void loadHub(true)}
          >
            <MdSync className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" className="btn-secondary text-sm flex items-center gap-1" onClick={() => setExportOpen(true)}>
            <MdDownload /> Exportar
          </button>
        </div>
      </div>

      <IndicatorsDateFilters
        preset={preset}
        onPresetChange={handlePresetChange}
        filters={filters}
        onFiltersChange={setFilters}
      />

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
            {t.id === 'alertas' && alertCount > 0 ? (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">{alertCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      {data?.generated_at ? (
        <p className="text-[10px] text-[var(--ui-muted)]">
          Período {data.filters?.from} — {data.filters?.to} · Actualizado {formatInstantTime(data.generated_at)}
        </p>
      ) : null}

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
