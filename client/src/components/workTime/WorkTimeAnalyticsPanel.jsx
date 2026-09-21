import { MdDashboard, MdNotificationsActive, MdCheckCircle, MdStars } from 'react-icons/md';
import { formatMinutes, formatMoney, formatRankingValue, severityBadge, ROLE_LABEL } from './workTimeUtils';
import { getFadeyAiAvatarSrc, OPEN_FADEY_AI_EVENT } from '../../constants/fadeyAiBranding';

const HR_CHAT_PROMPTS = [
  '¿Quién está en jornada ahora?',
  '¿Cómo va la productividad del equipo?',
  '¿Hay demoras en cocina?',
  '¿Qué me recomiendas para el personal?',
];

function openHrChat(prompt) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_FADEY_AI_EVENT, {
      detail: prompt ? { prompt } : { prompt: 'Resumen de productividad y personal' },
    }));
  } catch (_) {
    /* noop */
  }
}

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

function WaiterRatingsBlock({ waiterRatings = [] }) {
  const list = Array.isArray(waiterRatings) ? waiterRatings : [];
  return (
    <div className="card">
      <h3 className="font-bold text-[var(--ui-body-text)] mb-3 flex items-center gap-2">
        <MdStars className="text-amber-500" /> Calificación de mozos (clientes)
      </h3>
      {list.length === 0 ? (
        <p className="text-sm text-[var(--ui-muted)]">
          Aún no hay calificaciones. Cuando los clientes elijan mozo en la encuesta de fidelización, aquí verás el promedio de cada uno.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
                <th className="py-2 pr-2">Mozo</th>
                <th className="py-2">Promedio</th>
                <th className="py-2">Encuestas</th>
                <th className="py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.waiter_user_id} className="border-b border-[color:var(--ui-border)] last:border-0">
                  <td className="py-2 pr-2 font-medium">{w.waiter_name}</td>
                  <td className="py-2 font-semibold text-amber-600">
                    {w.count ? `${Number(w.average || 0).toFixed(1)} ★` : '—'}
                  </td>
                  <td className="py-2">{w.count || 0}</td>
                  <td className="py-2 text-xs">
                    {w.is_active === false ? (
                      <span className="text-[var(--ui-muted)]">Inactivo</span>
                    ) : (
                      <span className="text-emerald-600">Activo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WorkTimeAnalyticsPanel({ data, subTab, waiterRatings = [] }) {
  if (!data) return <p className="text-sm text-[var(--ui-muted)]">Cargando analítica…</p>;

  const { dashboard, productivity, areas, rankings, alerts, insights, shifts, hours } = data;

  if (subTab === 'panel') {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Personal en turno" value={dashboard?.operations?.staff_online ?? 0} sub="Jornadas abiertas" />
          <StatCard label="Ventas hoy" value={formatMoney(dashboard?.today?.sales_total)} sub={`${dashboard?.today?.orders_paid ?? 0} cuentas`} accent="emerald" />
          <StatCard
            label="Horas hoy"
            value={formatMinutes(dashboard?.today?.worked_minutes)}
            sub={`${dashboard?.today?.sessions ?? 0} ${dashboard?.jornada_source === 'qr' || data?.jornada_source === 'qr' ? 'marcaciones QR' : 'sesiones'}`}
          />
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

        <WaiterRatingsBlock waiterRatings={waiterRatings} />
      </div>
    );
  }

  if (subTab === 'productividad') {
    const ratingByUser = new Map(
      (Array.isArray(waiterRatings) ? waiterRatings : []).map((w) => [w.waiter_user_id, w]),
    );
    const qrHoursOnly = data?.jornada_source === 'qr';
    return (
      <div className="space-y-4">
        <div className="card overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-[var(--ui-body-text)]">Productividad</h3>
            {qrHoursOnly ? (
              <span className="text-[11px] rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-800">
                Horas = jornada QR (sin tiempo activo de sesión)
              </span>
            ) : null}
          </div>
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
                <th className="py-2 pr-2">Empleado</th>
                <th className="py-2">Rol</th>
                <th className="py-2">Horas</th>
                {qrHoursOnly ? null : <th className="py-2">Activo</th>}
                <th className="py-2">Cuentas</th>
                <th className="py-2">Ventas</th>
                <th className="py-2">Delivery</th>
                <th className="py-2">Prod./h</th>
                <th className="py-2">Calif. clientes</th>
              </tr>
            </thead>
            <tbody>
              {(productivity || []).map((p) => {
                const wr = ratingByUser.get(p.user_id);
                return (
                  <tr key={p.user_id} className="border-b border-[color:var(--ui-border)] last:border-0 hover:bg-[var(--ui-sidebar-hover)]">
                    <td className="py-2 pr-2 font-medium">{p.full_name}</td>
                    <td className="py-2">{ROLE_LABEL[p.role] || p.role}</td>
                    <td className="py-2">{formatMinutes(p.worked_minutes)}</td>
                    {qrHoursOnly ? null : (
                      <td className="py-2">{formatMinutes(p.active_minutes)}</td>
                    )}
                    <td className="py-2">{p.orders_paid}</td>
                    <td className="py-2">{formatMoney(p.sales_total)}</td>
                    <td className="py-2">{p.deliveries || '—'}</td>
                    <td className="py-2 font-semibold text-gold-600">{p.productivity_per_hour}</td>
                    <td className="py-2">
                      {String(p.role || '').toLowerCase() === 'mozo'
                        ? (wr?.count ? `${Number(wr.average).toFixed(1)} ★ (${wr.count})` : 'Sin encuestas')
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <WaiterRatingsBlock waiterRatings={waiterRatings} />
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
          ['Tiempo entrega mesa', `${areas?.mesas?.avg_table_minutes ?? 0} min`],
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
    const topWaiter = [...(Array.isArray(waiterRatings) ? waiterRatings : [])]
      .filter((w) => w.count > 0)
      .sort((a, b) => b.average - a.average || b.count - a.count)[0];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((r) => (
            <div key={r.label} className="card border-gold-500/20 bg-gradient-to-br from-[var(--ui-surface)] to-gold-500/5">
              <p className="text-xs text-[var(--ui-muted)]">{r.label}</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] mt-1">{r.full_name}</p>
              <p className="text-sm text-gold-600 font-medium mt-1">
                {formatRankingValue(r)}
              </p>
            </div>
          ))}
          {topWaiter ? (
            <div className="card border-amber-500/30 bg-gradient-to-br from-[var(--ui-surface)] to-amber-500/5">
              <p className="text-xs text-[var(--ui-muted)]">Mejor calificación de clientes</p>
              <p className="text-lg font-bold text-[var(--ui-body-text)] mt-1">{topWaiter.waiter_name}</p>
              <p className="text-sm text-amber-600 font-medium mt-1">
                {Number(topWaiter.average).toFixed(1)} ★ · {topWaiter.count} encuesta{topWaiter.count === 1 ? '' : 's'}
              </p>
            </div>
          ) : null}
          {items.length === 0 && !topWaiter ? <p className="text-sm text-[var(--ui-muted)] col-span-full">Sin datos suficientes en el período.</p> : null}
        </div>
        <WaiterRatingsBlock waiterRatings={waiterRatings} />
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
    const list = Array.isArray(insights) ? insights : [];
    const staffOnline = data?.dashboard?.operations?.staff_online ?? 0;
    const kitchenAvg = data?.areas?.cocina?.avg_kitchen_minutes;
    const delayed = data?.areas?.cocina?.delayed_now ?? 0;
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <section className="rounded-2xl border border-[color:var(--ui-border)] bg-gradient-to-br from-[#0b1b34] via-[#123056] to-[#1d4ed8] text-white p-4 sm:p-5 flex flex-col sm:flex-row gap-4 items-start">
          <button
            type="button"
            onClick={() => openHrChat()}
            className="w-16 h-16 rounded-full overflow-hidden bg-[#0b1b34] border border-white/20 shrink-0 shadow-lg"
            title="Abrir chat con PIX"
            aria-label="Abrir chat con PIX"
          >
            <img src={getFadeyAiAvatarSrc('asesorando')} alt="" className="w-full h-full object-contain object-bottom" draggable={false} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight m-0">Hola, soy PIX · IA Fadey</h2>
            <p className="text-sm text-sky-100/90 mt-1 mb-3">
              En Recursos humanos te ayudo con productividad, jornadas, cocina, rankings y alertas del equipo.
            </p>
            <ul className="grid gap-1.5 text-sm m-0 p-0 list-none">
              <li className="flex items-center gap-2"><MdCheckCircle className="text-emerald-300 shrink-0" /> Quién está en turno y tiempos de jornada</li>
              <li className="flex items-center gap-2"><MdCheckCircle className="text-emerald-300 shrink-0" /> Productividad por empleado y por área</li>
              <li className="flex items-center gap-2"><MdCheckCircle className="text-emerald-300 shrink-0" /> Demoras de cocina y hora pico operativa</li>
              <li className="flex items-center gap-2"><MdCheckCircle className="text-emerald-300 shrink-0" /> Recomendaciones para reforzar el personal</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {HR_CHAT_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => openHrChat(q)}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="En jornada" value={staffOnline} sub="Personal activo ahora" />
          <StatCard
            label="Cocina promedio"
            value={kitchenAvg != null ? `${kitchenAvg} min` : '—'}
            sub={delayed > 0 ? `${delayed} retraso(s) ahora` : 'Sin retrasos críticos'}
            accent="amber"
          />
          <StatCard
            label="Cuentas hoy"
            value={data?.dashboard?.today?.orders_paid ?? 0}
            sub={formatMoney(data?.dashboard?.today?.sales_total)}
            accent="emerald"
          />
          <StatCard
            label="Horas hoy"
            value={formatMinutes(data?.dashboard?.today?.worked_minutes)}
            sub={`${data?.dashboard?.today?.sessions ?? 0} marcaciones`}
          />
        </div>

        <section className="card">
          <h3 className="font-bold text-[var(--ui-body-text)] mb-3 flex items-center gap-2">
            <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="w-7 h-7 rounded-full object-cover border border-[color:var(--ui-border)]" draggable={false} />
            Insights del equipo
          </h3>
          {list.length === 0 ? (
            <p className="text-sm text-[var(--ui-muted)]">Aún no hay recomendaciones para el período. Ajusta las fechas o espera movimiento operativo.</p>
          ) : (
            <ul className="space-y-2.5">
              {list.map((ins, i) => {
                const priority = String(ins.priority || 'info');
                const mood = priority === 'high' || priority === 'medium' ? 'asesorando' : 'feliz';
                return (
                  <li key={`${priority}-${i}`} className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 flex gap-3 items-start">
                    <img
                      src={getFadeyAiAvatarSrc(mood)}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border border-[color:var(--ui-border)] shrink-0"
                      draggable={false}
                    />
                    <p className="text-sm text-[var(--ui-body-text)] m-0 leading-snug">{ins.message}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return null;
}
