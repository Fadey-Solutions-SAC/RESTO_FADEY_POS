import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, formatCurrency, formatInstantTime } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { MdTrendingUp, MdShoppingCart, MdAttachMoney, MdWarning, MdAccessTime, MdAccountBalance, MdReceiptLong } from 'react-icons/md';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#f04438', '#ffa520', '#10b981', '#3b82f6', '#8b5cf6'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    api.get('/reports/dashboard').then(setData).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(loadData, []);
  useSocket('order-update', loadData);
  useSocket('table-update', loadData);
  useSocket('delivery-update', loadData);
  useSocket('register-update', loadData);
  useSocket('inventory-update', loadData);
  useSocket('billing-document-update', loadData);
  useSocket('staff-data-update', (p) => {
    const d = p?.domain;
    if (d === 'finance_ops' || d === 'catalog' || d === 'app_config') loadData();
  });

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;
  if (!data) return null;

  const bi = data.businessIntel || {};
  const kpiPreset = bi.dash_kpi_preset || 'basic';
  const showStockPanel = bi.show_stock_alert_panel !== false;
  const predDays = Number(bi.pred_horizon_days);

  const statCards = [
    { label: 'Ventas Hoy', value: formatCurrency(data.today.total), sub: `${data.today.count} cuentas`, icon: MdAttachMoney, color: 'bg-emerald-500' },
    { label: 'Ventas del Mes', value: formatCurrency(data.month.total), sub: `${data.month.count} cuentas`, icon: MdTrendingUp, color: 'bg-blue-500' },
    { label: 'Pedidos Activos', value: data.activeOrders, sub: 'En proceso', icon: MdShoppingCart, color: 'bg-amber-500' },
    { label: 'Stock Bajo', value: (data.lowStock || []).length, sub: 'Productos', icon: MdWarning, color: 'bg-red-500' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        {(kpiPreset !== 'basic' || (Number.isFinite(predDays) && predDays > 0)) && (
          <p className="text-xs text-gray-500 mt-2">
            {kpiPreset === 'finance' && <span>Preset de panel: finanzas (módulo empresarial). </span>}
            {kpiPreset === 'operations' && <span>Preset de panel: operaciones (módulo empresarial). </span>}
            {Number.isFinite(predDays) && predDays > 0 && (
              <span>Horizonte predictivo: {predDays} días (planificación / informes futuros).</span>
            )}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card, i) => (
          <div key={i} className="card flex items-center gap-4">
            <div className={`w-12 h-12 ${card.color} rounded-xl flex items-center justify-center`}>
              <card.icon className="text-white text-2xl" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-xl font-bold text-gray-800">{card.value}</p>
              <p className="text-xs text-gray-400">{card.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {data.financeMonth && (
        <div className="card mb-8 border border-slate-200 bg-slate-50/80">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <MdAccountBalance className="text-xl text-[var(--ui-muted)]" />
                Finanzas del mes ({data.financeMonth.month_key || 'actual'})
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                Ventas cobradas, compras registradas, egresos de caja y eventos de pérdida. Utilidad y margen son{' '}
                <strong>aproximados</strong> (misma base que Informes · Finanzas); no sustituyen un cierre contable.
              </p>
            </div>
            <Link
              to="/admin/informes?seccion=finanzas"
              className="text-sm font-semibold text-blue-700 hover:underline whitespace-nowrap"
            >
              Ver detalle en informes
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Ventas cobradas</p>
              <p className="text-lg font-bold text-emerald-700 tabular-nums">{formatCurrency(data.financeMonth.sales_total)}</p>
              <p className="text-[11px] text-gray-400">{data.financeMonth.orders_count ?? 0} cuentas</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Compras / insumos</p>
              <p className="text-lg font-bold rf-section-title tabular-nums">{formatCurrency(data.financeMonth.purchases_total)}</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <MdReceiptLong className="text-base shrink-0" /> Gastos caja
              </p>
              <p className="text-lg font-bold text-amber-800 tabular-nums">{formatCurrency(data.financeMonth.cash_expenses_total)}</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Pérdidas registradas</p>
              <p className="text-lg font-bold text-amber-900 tabular-nums">{formatCurrency(data.financeMonth.loss_events_total)}</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Margen bruto aprox.</p>
              <p className="text-lg font-bold text-sky-800 tabular-nums">{formatCurrency(data.financeMonth.approx_gross_margin)}</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-100 p-3">
              <p className="text-xs text-gray-500">Utilidad neta aprox.</p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  Number(data.financeMonth.approx_profit) < 0 ? 'text-red-600' : 'text-emerald-800'
                }`}
              >
                {formatCurrency(data.financeMonth.approx_profit)}
              </p>
              <p className="text-[11px] text-gray-400">
                Salidas comb.: {formatCurrency(data.financeMonth.losses_combined_total)}
              </p>
            </div>
          </div>
        </div>
      )}

      {(data.operationalSummary ||
        (Array.isArray(data.operationalAlerts) && data.operationalAlerts.length > 0) ||
        data.insightToday) && (
        <div className="card mb-8 p-4 border-l-4 border-amber-400 bg-amber-50/30">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-bold text-gray-800">Estado operativo</h3>
            {data.generated_at && (
              <span className="text-xs text-gray-500">
                Actualizado{' '}
                {formatInstantTime(data.generated_at, { withSeconds: true })}
              </span>
            )}
          </div>
          {data.operationalSummary &&
          (data.operationalSummary.pendingCount != null ||
            data.operationalSummary.readyCount != null ||
            data.operationalSummary.staleReadyCount != null) && (
            <div className="flex flex-wrap gap-2 mb-3 text-xs text-gray-700">
              <span className="rounded-md border border-gray-200 bg-white px-2 py-1 tabular-nums">
                Pendientes: <strong>{Number(data.operationalSummary.pendingCount ?? 0)}</strong>
              </span>
              <span className="rounded-md border border-gray-200 bg-white px-2 py-1 tabular-nums">
                Listos: <strong>{Number(data.operationalSummary.readyCount ?? 0)}</strong>
              </span>
              <span
                className={`rounded-md border px-2 py-1 tabular-nums ${
                  Number(data.operationalSummary.staleReadyCount ?? 0) > 0
                    ? 'border-amber-400 bg-amber-100 text-amber-900'
                    : 'border-gray-200 bg-white'
                }`}
              >
                Listos {'>'}25 min: <strong>{Number(data.operationalSummary.staleReadyCount ?? 0)}</strong>
              </span>
            </div>
          )}
          {data.insightToday ? <p className="text-sm text-amber-900/90 mb-3">{data.insightToday}</p> : null}
          {Array.isArray(data.operationalAlerts) && data.operationalAlerts.length > 0 ? (
            <ul className="space-y-2">
              {data.operationalAlerts.map((a) => (
                <li
                  key={a.id}
                  className={`text-sm rounded-lg px-3 py-2 ${
                    a.severity === 'warning'
                      ? 'bg-amber-100 text-amber-950 border border-amber-200'
                      : 'bg-sky-50 text-gray-800 border border-sky-100'
                  }`}
                >
                  <span className="font-semibold">{a.title}: </span>
                  {a.message}
                  {a.linkTo && a.linkLabel ? (
                    <div className="mt-1">
                      <Link to={a.linkTo} className="text-xs font-semibold text-blue-800 hover:underline underline-offset-2">
                        {a.linkLabel}
                      </Link>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">Sin alertas operativas en este momento.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h3 className="font-bold text-gray-800 mb-4">Productos Más Vendidos</h3>
          {data.topProducts.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.topProducts.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="product_name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [v, 'Vendidos']} />
                <Bar dataKey="total_sold" fill="#f04438" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-center py-8">Sin datos aún</p>}
        </div>

        <div className="card">
          <h3 className="font-bold text-gray-800 mb-4">Métodos de Pago (Hoy)</h3>
          {data.paymentMethods.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={data.paymentMethods} dataKey="total" nameKey="payment_method" cx="50%" cy="50%" outerRadius={100} label={({ payment_method, percent }) => `${payment_method} ${(percent * 100).toFixed(0)}%`}>
                  {data.paymentMethods.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-center py-8">Sin ventas hoy</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-bold text-gray-800 mb-4">Pedidos Recientes</h3>
          <div className="space-y-3">
            {data.recentOrders.slice(0, 6).map(order => (
              <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                    <span className="text-xs font-bold text-gray-600">#{order.order_number}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{order.customer_name || 'Cliente'}</p>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <MdAccessTime className="text-xs" />
                      {formatTime(order.created_at)}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{formatCurrency(order.total)}</p>
                  <span className={`badge badge-${order.status}`}>{order.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-bold text-gray-800 mb-4">Alertas de Stock</h3>
          {!showStockPanel ? (
            <p className="text-sm text-gray-500 py-4">
              El seguimiento de stock crítico en alertas está desactivado en Configuración → Módulo empresarial. Consulte
              inventario en Productos o Almacén.
            </p>
          ) : (data.lowStock || []).length > 0 ? (
            <div className="space-y-3">
              {(data.lowStock || []).map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <span className={`badge ${p.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {p.stock} unid.
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">Todo el stock está bien</p>
          )}
        </div>
      </div>
    </div>
  );
}
