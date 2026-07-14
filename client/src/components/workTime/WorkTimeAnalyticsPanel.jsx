import { MdDashboard, MdNotificationsActive, MdPsychology } from 'react-icons/md';
import { formatMinutes, formatMoney, severityBadge, ROLE_LABEL } from './workTimeUtils';

function StatCard({ label, value, sub, accent = 'gold' }) {
  const ring = accent === 'emerald' ? 'border-emerald-500/30' : accent === 'amber' ? 'border-amber-500/30' : 'border-gold-500/30';
  return (
    <div className={`rounded-xl border ${ring} bg-[var(--ui-surface)] p-4 transition hover:shadow-md`}>
      <p className="text-xs text-[var(--ui-muted)] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-[var(--ui-body-text)] mt-1">{value}</p>
      {sub ? <p className="text-xs text-[var(--ui-muted)] mt-1">{sub}</p> : null}
    </div>
  );
}

function AreaBlock({ title, metrics }) {
  return (
    <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4">
      <h4 className="font-semibold text-[var(--ui-body-text)] mb-3">{title}</h4>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[var(--ui-muted)] text-xs">{k}</dt>
            <dd className="font-medium text-[var(--ui-body-text)]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function WorkTimeAnalyticsPanel({ data, subTab, filters, setFilters, users, onExport }) {
  if (!data) return <p className="text-sm text-[var(--ui-muted)]">Cargando analítica…</p>;

  const { dashboard, productivity, areas, rankings, alerts, insights, shifts, hours } = data;

  if (subTab === 'panel') {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Personal en turno" value={dashboard?.operations?.staff_online ?? 0} sub="Jornadas abiertas" />
          <StatCard label="Ventas hoy" value={formatMoney(dashboard?.today?.sales_total)} sub={`${dashboard?.today?.orders_paid ?? 0} cuentas`} accent="emerald" />
          <StatCard label="Horas hoy" value={formatMinutes(dashboard?.today?.worked_minutes)} sub={`${dashboard?.today?.sessions ?? 0} sesiones`} />
          <StatCard label="Cocina / Delivery" value={`${dashboard?.operations?.kitchen_preparing ?? 0} / ${dashboard?.operations?.delivery_active ?? 0}`} sub="Activos ahora" accent="amber" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="font-bold text-[var(--ui-body-text)] mb-3 flex items-center gap-2"><MdDashboard /> Empleados activos</h3>
            {(dashboard?.active_staff || []).length === 0 ? (
              <p className="text-sm text-[var(--ui-muted)]">Nadie con jornada abierta.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {dashboard.active_staff.map((s) => (
                  <li key={s.session_id} className={`flex justify-between gap-2 p-2 rounded-lg border ${s.is_idle ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : 'border-[color:var(--ui-border)]'}`}>
                    <div>
                      <p className="text-sm font-medium">{s.full_name}</p>
                      <p className="text-xs text-[var(--ui-muted)]">{ROLE_LABEL[s.role] || s.role} · turno {s.shift_label}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold">{formatMinutes(s.active_minutes)} activo</p>
                      {s.is_idle ? <span className="text-amber-600">Inactivo {formatMinutes(s.idle_minutes)}</span> : <span className="text-emerald-600">En línea</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3 className="font-bold text-[var(--ui-body-text)] mb-3">Horas por turno (período)</h3>
            <ul className="space-y-2">
              {(shifts || []).map((sh) => (
                <li key={sh.shift_label} className="flex justify-between text-sm border-b border-[color:var(--ui-border)] py-2 last:border-0">
                  <span className="capitalize">{sh.shift_label}</span>
                  <span className="font-medium">{formatMinutes(sh.total_minutes)} · {sh.sessions} ses.</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--ui-muted)] mt-3">Semana: {formatMinutes(hours?.weekly_minutes)} · Mes: {formatMinutes(hours?.monthly_minutes)}</p>
          </div>
        </div>
      </div>
    );
  }

  if (subTab === 'productividad') {
    return (
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="py-2 pr-2">Empleado</th>
              <th className="py-2">Rol</th>
              <th className="py-2">Horas</th>
              <th className="py-2">Activo</th>
              <th className="py-2">Cuentas</th>
              <th className="py-2">Ventas</th>
              <th className="py-2">Delivery</th>
              <th className="py-2">Prod./h</th>
            </tr>
          </thead>
          <tbody>
            {(productivity || []).map((p) => (
              <tr key={p.user_id} className="border-b border-[color:var(--ui-border)] last:border-0 hover:bg-[var(--ui-sidebar-hover)]">
                <td className="py-2 pr-2 font-medium">{p.full_name}</td>
                <td className="py-2">{ROLE_LABEL[p.role] || p.role}</td>
                <td className="py-2">{formatMinutes(p.worked_minutes)}</td>
                <td className="py-2">{formatMinutes(p.active_minutes)}</td>
                <td className="py-2">{p.orders_paid}</td>
                <td className="py-2">{formatMoney(p.sales_total)}</td>
                <td className="py-2">{p.deliveries || '—'}</td>
                <td className="py-2 font-semibold text-gold-600">{p.productivity_per_hour}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (subTab === 'areas') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AreaBlock title="Caja" metrics={[
          ['Ventas', formatMoney(areas?.caja?.sales_total)],
          ['Cuentas cobradas', areas?.caja?.tickets_paid],
          ['Velocidad cobro', `${areas?.caja?.avg_checkout_minutes ?? 0} min`],
        ]} />
        <AreaBlock title="Cocina" metrics={[
          ['Pedidos', areas?.cocina?.orders_tracked],
          ['Tiempo promedio', `${areas?.cocina?.avg_kitchen_minutes ?? 0} min`],
          ['Retrasos ahora', areas?.cocina?.delayed_now],
        ]} />
        <AreaBlock title="Delivery" metrics={[
          ['Entregas', areas?.delivery?.delivered],
          ['Tiempo promedio', `${areas?.delivery?.avg_delivery_minutes ?? 0} min`],
          ['Demorados', areas?.delivery?.delayed_active],
        ]} />
        <AreaBlock title="Mesas" metrics={[
          ['Pedidos mesa', areas?.mesas?.table_orders],
          ['Mesas atendidas', areas?.mesas?.tables_touched],
          ['Tiempo atención', `${areas?.mesas?.avg_table_minutes ?? 0} min`],
        ]} />
      </div>
    );
  }

  if (subTab === 'rankings') {
    const items = [
      rankings?.best_seller,
      rankings?.most_orders,
      rankings?.most_productive,
      rankings?.fastest_service,
      rankings?.best_delivery,
      rankings?.kitchen_role,
    ].filter(Boolean);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((r) => (
          <div key={r.label} className="card border-gold-500/20 bg-gradient-to-br from-[var(--ui-surface)] to-gold-500/5">
            <p className="text-xs text-[var(--ui-muted)]">{r.label}</p>
            <p className="text-lg font-bold text-[var(--ui-body-text)] mt-1">{r.full_name}</p>
            <p className="text-sm text-gold-600 font-medium mt-1">
              {typeof r.value === 'number' && r.label?.includes('ventas') ? formatMoney(r.value) : r.value}
            </p>
          </div>
        ))}
        {items.length === 0 ? <p className="text-sm text-[var(--ui-muted)] col-span-full">Sin datos suficientes en el período.</p> : null}
      </div>
    );
  }

  if (subTab === 'alertas') {
    return (
      <ul className="space-y-2">
        {(alerts || []).length === 0 ? (
          <p className="text-sm text-[var(--ui-muted)] card">Sin alertas operativas en este momento.</p>
        ) : (
          alerts.map((a) => (
            <li key={a.id} className={`card border flex gap-3 items-start ${severityBadge(a.severity)}`}>
              <MdNotificationsActive className="text-xl shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="text-xs mt-0.5 opacity-90">{a.message}</p>
                <span className="text-[10px] uppercase mt-1 inline-block opacity-70">{a.category}</span>
              </div>
            </li>
          ))
        )}
      </ul>
    );
  }

  if (subTab === 'ia') {
    return (
      <ul className="space-y-3">
        {(insights || []).map((ins, i) => (
          <li key={i} className="card flex gap-3 items-start border-l-4 border-l-gold-500">
            <MdPsychology className="text-2xl text-gold-600 shrink-0" />
            <p className="text-sm text-[var(--ui-body-text)]">{ins.message}</p>
          </li>
        ))}
        {(insights || []).length === 0 ? <p className="text-sm text-[var(--ui-muted)]">Aún no hay recomendaciones para el período.</p> : null}
      </ul>
    );
  }

  return null;
}
