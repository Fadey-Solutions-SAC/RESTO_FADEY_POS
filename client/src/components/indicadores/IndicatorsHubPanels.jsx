import {
  MdAttachMoney,
  MdShoppingCart,
  MdTableBar,
  MdDeliveryDining,
  MdKitchen,
  MdPeople,
  MdInventory,
  MdWarning,
} from 'react-icons/md';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { useState } from 'react';
import { formatCurrency, formatDateTime } from '../../utils/api';
import IndicatorStatCard from './IndicatorStatCard';
import Modal from '../Modal';

const COLORS = ['#de3024', '#f04438', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b'];

function ChartCard({ title, hint, children }) {
  return (
    <div className="card">
      <h3 className="font-bold text-[var(--ui-body-text)] mb-1">{title}</h3>
      {hint ? <p className="text-xs text-[var(--ui-muted)] mb-3">{hint}</p> : null}
      {children}
    </div>
  );
}

export function IndicatorsGeneralPanel({ data }) {
  const g = data?.general || {};
  const cmp = data?.financial?.comparison_prev_period;
  return (
    <div className="space-y-3 min-w-0">
      <div className="grid grid-cols-5 gap-3 w-full min-w-0">
        <IndicatorStatCard size="lg" icon={MdAttachMoney} label="Ventas período" value={formatCurrency(g.period_sales)} sub={`${g.period_orders ?? 0} cuentas`} accent="emerald" />
        <IndicatorStatCard size="lg" icon={MdAttachMoney} label="Ventas hoy" value={formatCurrency(g.sales_today)} sub={`${g.orders_today ?? 0} cuentas`} />
        <IndicatorStatCard size="lg" icon={MdAttachMoney} label="Ventas semana" value={formatCurrency(g.sales_week)} accent="sky" />
        <IndicatorStatCard size="lg" icon={MdAttachMoney} label="Ventas mes" value={formatCurrency(g.sales_month)} trend={g.growth_month_pct} />
        <IndicatorStatCard size="lg" icon={MdAttachMoney} label="Utilidad neta (aprox.)" value={formatCurrency(g.net_profit_approx)} sub="En estas fechas" accent="emerald" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 w-full min-w-0">
        <IndicatorStatCard icon={MdShoppingCart} label="Ticket promedio" value={formatCurrency(g.avg_ticket)} sub="En estas fechas" />
        <IndicatorStatCard icon={MdShoppingCart} label="Pedidos activos" value={g.active_orders ?? 0} accent="amber" />
        <IndicatorStatCard icon={MdTableBar} label="Mesas ocupadas" value={g.tables_occupied ?? 0} />
        <IndicatorStatCard icon={MdDeliveryDining} label="Delivery activos" value={g.delivery_active ?? 0} />
        <IndicatorStatCard icon={MdKitchen} label="En cocina" value={g.kitchen_preparing ?? 0} />
        <IndicatorStatCard icon={MdPeople} label="Clientes hoy" value={g.customers_served_today ?? 0} />
        <IndicatorStatCard icon={MdInventory} label="Stock crítico" value={g.critical_stock ?? 0} accent={g.critical_stock > 0 ? 'amber' : 'default'} />
        <IndicatorStatCard icon={MdWarning} label="Agotados" value={g.out_of_stock ?? 0} accent={g.out_of_stock > 0 ? 'amber' : 'default'} />
        {cmp ? <IndicatorStatCard label="vs período ant." value={`${cmp.change_pct >= 0 ? '+' : ''}${cmp.change_pct}%`} accent={cmp.change_pct >= 0 ? 'emerald' : 'amber'} /> : null}
        <IndicatorStatCard label="Personal en turno" value={g.staff_on_shift ?? 0} />
        <IndicatorStatCard label="Productividad" value={g.productivity_index ?? 0} />
        <IndicatorStatCard label="Caja" value={g.register_open ? 'Abierta' : 'Cerrada'} accent={g.register_open ? 'emerald' : 'default'} />
      </div>
    </div>
  );
}

export function IndicatorsFinancialPanel({ data }) {
  const f = data?.financial || {};
  const pm = f.payment_methods || [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <IndicatorStatCard label="Ingresos período" value={formatCurrency(f.total_sales)} />
        <IndicatorStatCard label="Utilidad bruta" value={formatCurrency(f.gross_profit_approx)} accent="emerald" />
        <IndicatorStatCard label="Utilidad neta" value={formatCurrency(f.net_profit_approx)} accent="emerald" />
        <IndicatorStatCard label="Margen neto" value={`${f.margin_pct ?? 0}%`} />
        <IndicatorStatCard
          label="Inversión período"
          value={formatCurrency(f.investment_total)}
          sub="Compras de almacén e insumos en estas fechas"
          accent="violet"
        />
        <IndicatorStatCard
          label="Productos de almacén"
          value={formatCurrency(f.investment_warehouse)}
          sub="Compras en estas fechas"
        />
        <IndicatorStatCard
          label="Insumos"
          value={formatCurrency(f.investment_insumos)}
          sub="Compras en estas fechas"
        />
        <IndicatorStatCard
          label="Pagos"
          value={formatCurrency(f.payroll_total)}
          sub="En estas fechas"
        />
        <IndicatorStatCard
          label="Gastos operativos"
          value={formatCurrency(f.operating_expenses)}
          sub="Precio de compra e insumos de cada producto, pérdidas, egresos y pagos"
          accent="amber"
        />
        <IndicatorStatCard label="Flujo caja (+)" value={formatCurrency(f.cash_flow_in)} />
        <IndicatorStatCard label="Flujo caja (-)" value={formatCurrency(f.cash_flow_out)} />
        <IndicatorStatCard label="Efectivo" value={formatCurrency(f.sales_efectivo)} />
        <IndicatorStatCard label="Yape" value={formatCurrency(f.sales_yape)} />
        <IndicatorStatCard label="Tarjeta" value={formatCurrency(f.sales_tarjeta)} />
        {f.projection_next_7d ? <IndicatorStatCard label="Proyección 7d" value={formatCurrency(f.projection_next_7d)} accent="sky" /> : null}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Utilidad vs gastos (período)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={[
              { name: 'Ventas', monto: f.total_sales },
              { name: 'Inversión', monto: f.investment_total },
              { name: 'Gastos', monto: f.operating_expenses },
              { name: 'Utilidad', monto: Math.max(0, f.net_profit_approx) },
            ]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="monto" fill="#de3024" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Métodos de pago">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pm.map((p) => ({ name: p.payment_method, value: p.total }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} label>
                {pm.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(v)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function orderTypeLabel(type) {
  if (type === 'delivery') return 'Delivery';
  if (type === 'pickup') return 'Llevar';
  return 'Salón';
}

function OperationalDetailBody({ detailKey, rows }) {
  if (!rows?.length) {
    return <p className="text-sm text-[var(--ui-muted)] py-4 text-center">Sin registros en este período.</p>;
  }
  if (detailKey === 'delays_kitchen_bar' || detailKey === 'delays_delivery') {
    return (
      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-2">Pedido</th>
              <th className="py-2 pr-2">Estación</th>
              <th className="py-2 pr-2">Mesa</th>
              <th className="py-2 pr-2">Min</th>
              <th className="py-2 pr-2">Límite</th>
              <th className="py-2 pr-2">Detectado</th>
              <th className="py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[color:var(--ui-border)] last:border-0">
                <td className="py-2 pr-2 font-medium">#{r.order_number || '—'}</td>
                <td className="py-2 pr-2 capitalize">{r.station || '—'}</td>
                <td className="py-2 pr-2">{r.table_number || '—'}</td>
                <td className="py-2 pr-2 tabular-nums">{r.elapsed_minutes ?? '—'}</td>
                <td className="py-2 pr-2 tabular-nums">{r.threshold_minutes ?? '—'}</td>
                <td className="py-2 pr-2 whitespace-nowrap">{formatDateTime(r.detected_at)}</td>
                <td className="py-2">
                  <span className={r.active ? 'text-amber-600 font-medium' : 'text-[var(--ui-muted)]'}>
                    {r.active ? 'Activo' : 'Resuelto'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (detailKey === 'reservations') {
    return (
      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-2">Cliente</th>
              <th className="py-2 pr-2">Fecha</th>
              <th className="py-2 pr-2">Hora</th>
              <th className="py-2 pr-2">Pers.</th>
              <th className="py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[color:var(--ui-border)] last:border-0">
                <td className="py-2 pr-2 font-medium">{r.client_name || '—'}</td>
                <td className="py-2 pr-2">{r.date || '—'}</td>
                <td className="py-2 pr-2">{r.time || '—'}</td>
                <td className="py-2 pr-2">{r.guests ?? '—'}</td>
                <td className="py-2 capitalize">{r.status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto max-h-[60vh]">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
            <th className="py-2 pr-2">Pedido</th>
            <th className="py-2 pr-2">Tipo</th>
            <th className="py-2 pr-2">Mesa</th>
            <th className="py-2 pr-2">Estado</th>
            <th className="py-2 pr-2">Total</th>
            <th className="py-2">Creado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[color:var(--ui-border)] last:border-0">
              <td className="py-2 pr-2 font-medium">#{r.order_number || '—'}</td>
              <td className="py-2 pr-2">{orderTypeLabel(r.type)}</td>
              <td className="py-2 pr-2">{r.table_number || '—'}</td>
              <td className="py-2 pr-2 capitalize">{r.status || '—'}</td>
              <td className="py-2 pr-2 tabular-nums">{formatCurrency(r.total)}</td>
              <td className="py-2 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IndicatorsOperationalPanel({ data }) {
  const o = data?.operational || {};
  const s = o.summary || {};
  const d = o.details || {};
  const [detail, setDetail] = useState(null);

  const openDetail = (key, title) => {
    setDetail({ key, title, rows: d[key] || [] });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <IndicatorStatCard
          label="Pedidos activos"
          value={s.activeOrders ?? 0}
          onClick={() => openDetail('active_orders', 'Pedidos activos')}
        />
        <IndicatorStatCard
          label="Pendientes"
          value={s.pendingCount ?? 0}
          accent="amber"
          onClick={() => openDetail('pending', 'Pedidos pendientes')}
        />
        <IndicatorStatCard
          label="Listos"
          value={s.readyCount ?? 0}
          onClick={() => openDetail('ready', 'Pedidos listos')}
        />
        <IndicatorStatCard
          label="Tiempo cocina (7d)"
          value={`${o.avg_kitchen_minutes ?? 0} min`}
          sub="Solo informativo"
        />
        <IndicatorStatCard
          label="Tiempo delivery (7d)"
          value={`${o.avg_delivery_minutes ?? 0} min`}
          sub="Solo informativo"
        />
        <IndicatorStatCard
          label="Retraso cocina/bar"
          value={o.orders_delayed_kitchen_bar ?? o.orders_delayed_kitchen ?? 0}
          sub={
            Number(o.orders_delayed_kitchen_bar_open || 0) > 0
              ? `${o.orders_delayed_kitchen_bar_open} activos ahora`
              : 'Registrados en el período'
          }
          accent="amber"
          onClick={() => openDetail('delays_kitchen_bar', 'Retrasos cocina/bar')}
        />
        <IndicatorStatCard
          label="Retraso delivery"
          value={o.orders_delayed_delivery ?? 0}
          sub={
            Number(o.orders_delayed_delivery_open || 0) > 0
              ? `${o.orders_delayed_delivery_open} activos ahora`
              : 'Registrados en el período'
          }
          accent="amber"
          onClick={() => openDetail('delays_delivery', 'Retrasos delivery')}
        />
        <IndicatorStatCard
          label="Entregados período"
          value={o.orders_delivered_period ?? 0}
          accent="emerald"
          onClick={() => openDetail('delivered', 'Entregados del período')}
        />
        <IndicatorStatCard
          label="Reservas"
          value={o.reservations_period ?? 0}
          onClick={() => openDetail('reservations', 'Reservas del período')}
        />
        <IndicatorStatCard
          label="Rotación mesas"
          value={o.table_rotation_avg ?? 0}
          sub="Solo informativo"
        />
      </div>

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title || 'Detalle'}
        size="lg"
      >
        {detail ? <OperationalDetailBody detailKey={detail.key} rows={detail.rows} /> : null}
      </Modal>
    </div>
  );
}

export function IndicatorsProductivityPanel({ data }) {
  const rows = data?.productivity?.by_user || [];
  const rankings = data?.productivity?.rankings || {};
  const rankItems = Object.values(rankings).filter(Boolean);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rankItems.map((r) => (
          <div key={r.label} className="card border-gold-500/20">
            <p className="text-xs text-[var(--ui-muted)]">{r.label}</p>
            <p className="font-bold text-[var(--ui-body-text)] mt-1">{r.full_name}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2">Empleado</th><th className="py-2">Horas</th><th className="py-2">Cuentas</th><th className="py-2">Ventas</th><th className="py-2">Prod./h</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((p) => (
              <tr key={p.user_id} className="border-b border-[color:var(--ui-border)] last:border-0">
                <td className="py-2 font-medium">{p.full_name}</td>
                <td className="py-2">{Math.round((p.worked_minutes || 0) / 60)}h</td>
                <td className="py-2">{p.orders_paid}</td>
                <td className="py-2">{formatCurrency(p.sales_total)}</td>
                <td className="py-2 text-gold-600 font-semibold">{p.productivity_per_hour}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function IndicatorsInventoryPanel({ data }) {
  const inv = data?.inventory || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <IndicatorStatCard label="Valor inventario" value={formatCurrency(inv.inventory_value)} sub="Stock actual" />
        <IndicatorStatCard label="Valor de insumos" value={formatCurrency(inv.insumos_value ?? 0)} sub="Stock actual" />
        <IndicatorStatCard label="Compras almacén" value={formatCurrency(inv.purchases_products ?? 0)} sub="En estas fechas" />
        <IndicatorStatCard label="Compras insumos" value={formatCurrency(inv.purchases_insumos ?? 0)} sub="En estas fechas" />
        <IndicatorStatCard label="Stock crítico" value={inv.critical_count ?? 0} accent="amber" />
        <IndicatorStatCard label="Agotados" value={inv.oos_count ?? 0} accent="amber" />
        <IndicatorStatCard label="Consumo (uds.)" value={inv.daily_consumption_units ?? 0} sub="En estas fechas" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-bold text-sm mb-2">Stock crítico</h3>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {(inv.critical_stock || []).map((p) => (
              <li key={p.id} className="flex justify-between"><span>{p.name}</span><span className="text-amber-600">{p.stock} uds.</span></li>
            ))}
          </ul>
        </div>
        <div className="card">
          <h3 className="font-bold text-sm mb-2">Agotados</h3>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {(inv.out_of_stock || []).map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function IndicatorsCustomersPanel({ data }) {
  const c = data?.customers || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <IndicatorStatCard label="Clientes registrados" value={c.total_registered ?? 0} />
        <IndicatorStatCard label="Nuevos (período)" value={c.new_in_period ?? 0} accent="emerald" />
      </div>
      <div className="card">
        <h3 className="font-bold text-sm mb-3">Clientes frecuentes</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[var(--ui-muted)] text-left border-b border-[color:var(--ui-border)]">
              <th className="py-2">Nombre</th><th className="py-2">Cuentas</th><th className="py-2">Total</th><th className="py-2">Ticket prom.</th>
            </tr>
          </thead>
          <tbody>
            {(c.frequent_buyers || []).map((row, i) => (
              <tr key={i} className="border-b border-[color:var(--ui-border)] last:border-0">
                <td className="py-2">{row.name}</td>
                <td className="py-2">{row.orders}</td>
                <td className="py-2">{formatCurrency(row.spent)}</td>
                <td className="py-2">{formatCurrency(row.avg_ticket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function IndicatorsProductsPanel({ data }) {
  const p = data?.products || {};
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card">
        <h3 className="font-bold mb-3">Más vendidos</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={(p.top_sellers || []).map((x) => ({ name: String(x.product_name).slice(0, 14), cantidad: x.qty }))} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="cantidad" fill="#de3024" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <h3 className="font-bold mb-3">Más rentables (margen × volumen)</h3>
        <ul className="text-sm space-y-2">
          {(p.most_profitable || []).map((x, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{x.name}</span>
              <span className="text-emerald-600 font-medium">{formatCurrency(x.revenue)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function IndicatorsChartsPanel({ data }) {
  const ch = data?.charts || {};
  const last7 = (ch.sales_by_day || []).slice(-7);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Ventas por día">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={last7.length ? last7 : ch.sales_by_day}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => formatCurrency(v)} />
            <Area type="monotone" dataKey="ventas" stroke="#de3024" fill="#de3024" fillOpacity={0.2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Ventas por hora">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={ch.sales_by_hour || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v) => formatCurrency(v)} />
            <Bar dataKey="ventas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Pedidos por canal">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={ch.sales_by_channel || []} dataKey="value" nameKey="name" outerRadius={80} label>
              {(ch.sales_by_channel || []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Pedidos por día">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={last7.length ? last7 : ch.sales_by_day}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="pedidos" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

export function IndicatorsInsightsPanel({ data }) {
  const insights = data?.insights || [];
  const priorityClass = (p) => {
    if (p === 'high') return 'border-l-red-500';
    if (p === 'medium') return 'border-l-amber-500';
    return 'border-l-gold-500';
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ui-muted)] card">
        Recomendaciones generadas automáticamente a partir de ventas, productos, inventario, productividad y operación en tiempo real.
      </p>
      <ul className="space-y-3">
        {insights.map((ins, i) => (
          <li key={i} className={`card border-l-4 pl-4 ${priorityClass(ins.priority)}`}>
            <p className="text-sm text-[var(--ui-body-text)]">{ins.message}</p>
            <span className="text-[10px] uppercase text-[var(--ui-muted)] mt-1 inline-block">{ins.priority}</span>
          </li>
        ))}
        {insights.length === 0 ? <p className="text-sm text-[var(--ui-muted)]">Generando recomendaciones…</p> : null}
      </ul>
    </div>
  );
}
