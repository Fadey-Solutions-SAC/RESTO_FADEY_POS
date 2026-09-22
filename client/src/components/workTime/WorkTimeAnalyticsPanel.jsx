import { useRef, useState } from 'react';
import {
  MdDashboard,
  MdNotificationsActive,
  MdCheckCircle,
  MdStars,
  MdChat,
  MdArrowBack,
  MdBolt,
  MdPeople,
  MdRestaurant,
  MdTrendingUp,
  MdEmojiEvents,
  MdHistory,
} from 'react-icons/md';
import { Cell, Pie, PieChart, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Link } from 'react-router-dom';
import { formatMinutes, formatMoney, formatRankingValue, severityBadge, ROLE_LABEL } from './workTimeUtils';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import FadeyAiChatPanel from '../FadeyAiChatPanel';
import '../indicadores/FadeyAiHomePanel.css';

const PIE_COLORS = ['#2563eb', '#38bdf8', '#93c5fd', '#1d4ed8', '#7dd3fc', '#64748b'];

const HR_QUICK_ACTIONS = [
  { id: 'jornada', label: 'Quién en jornada', icon: MdPeople, prompt: '¿Quién está en jornada ahora?' },
  { id: 'prod', label: 'Productividad', icon: MdTrendingUp, prompt: '¿Cómo va la productividad del equipo?' },
  { id: 'cocina', label: 'Demoras cocina', icon: MdRestaurant, prompt: '¿Hay demoras en cocina?' },
  { id: 'recomienda', label: 'Recomendaciones', icon: MdStars, prompt: '¿Qué me recomiendas para el personal?' },
  { id: 'rankings', label: 'Rankings', icon: MdEmojiEvents, prompt: '¿Quiénes lideran el ranking de productividad?' },
  { id: 'jornadas', label: 'Jornadas', icon: MdHistory, prompt: 'Resumen de jornadas y horas del equipo' },
];

const HR_CHAT_SUGGESTED = HR_QUICK_ACTIONS.map((a) => a.prompt);

function formatShortDate(key) {
  if (!key) return '';
  const [y, m, d] = String(key).split('-');
  if (!d) return key;
  return `${d}/${m}/${y}`;
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

export default function WorkTimeAnalyticsPanel({ data, subTab, waiterRatings = [], filters = {}, onExport }) {
  if (!data) return <p className="text-sm text-[var(--ui-muted)]">Cargando analítica…</p>;

  const { dashboard, productivity, areas, rankings, alerts, insights, shifts, hours } = data;

  if (subTab === 'ia') {
    return <HrAiOperativaPanel data={data} filters={filters} onExport={onExport} />;
  }

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

  return null;
}

/** Panel IA Operativa: mismo patrón de chat in-panel que IA analítica (Indicadores). */
function HrAiOperativaPanel({ data, filters = {}, onExport }) {
  const [heroMode, setHeroMode] = useState('hello'); // hello | chat
  const chatRef = useRef(null);
  const insights = Array.isArray(data?.insights) ? data.insights : [];
  const productivity = Array.isArray(data?.productivity) ? data.productivity : [];
  const shifts = Array.isArray(data?.shifts) ? data.shifts : [];
  const staffOnline = data?.dashboard?.operations?.staff_online ?? 0;
  const kitchenAvg = data?.areas?.cocina?.avg_kitchen_minutes;
  const delayed = data?.areas?.cocina?.delayed_now ?? 0;
  const from = filters?.from;
  const to = filters?.to;

  const openChat = (prompt = '') => {
    setHeroMode('chat');
    const msg = String(prompt || '').trim();
    if (!msg) {
      requestAnimationFrame(() => chatRef.current?.focusInput?.());
      return;
    }
    setTimeout(() => {
      chatRef.current?.sendPrompt?.(msg);
      chatRef.current?.focusInput?.();
    }, 120);
  };

  const intro = [
    'Puedo analizar jornadas, productividad, cocina y alertas del equipo en esta misma pantalla.',
    `Ahora: ${staffOnline} en jornada · cocina ${kitchenAvg != null ? `${kitchenAvg} min` : '—'}.`,
    'Elige una acción rápida o escríbeme aquí.',
  ].join(' ');

  const prodPie = productivity
    .filter((p) => Number(p.worked_minutes) > 0)
    .slice(0, 5)
    .map((p) => ({
      name: String(p.full_name || 'Empleado').slice(0, 18),
      value: Number(p.worked_minutes) || 0,
    }));
  const pieTotal = prodPie.reduce((s, r) => s + r.value, 0);
  const shiftBars = shifts.map((sh) => ({
    name: String(sh.shift_label || 'turno').slice(0, 10),
    minutos: Number(sh.total_minutes) || 0,
  }));

  return (
    <div className="rf-ai-home animate-in fade-in duration-300">
      <div className="rf-ai-home__main">
        <section className={`rf-ai-home__hero ${heroMode === 'chat' ? 'rf-ai-home__hero--chat' : ''}`}>
          {heroMode === 'chat' ? (
            <div className="rf-ai-home__hero-chat">
              <div className="rf-ai-home__hero-chat-bar">
                <button
                  type="button"
                  className="rf-ai-home__hero-clear"
                  onClick={() => setHeroMode('hello')}
                  aria-label="Volver"
                >
                  <MdArrowBack />
                </button>
                <img src={getFadeyAiAvatarSrc('chat')} alt="" className="rf-ai-home__hero-chat-pix" draggable={false} />
                <div className="rf-ai-home__hero-chat-titles">
                  <strong>PIX · Chat</strong>
                  <span>Pregúntame sobre jornadas, productividad o el equipo</span>
                </div>
              </div>
              <div className="rf-ai-home__hero-chat-body">
                <FadeyAiChatPanel
                  ref={chatRef}
                  isActive
                  variant="home"
                  introMessage={intro}
                  suggested={HR_CHAT_SUGGESTED}
                />
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => openChat()}
                className="rf-ai-home__bot rf-ai-home__bot--photo"
                title="Abrir chat con PIX"
                aria-label="Abrir chat con PIX"
              >
                <img src={getFadeyAiAvatarSrc('saludo')} alt="" draggable={false} />
              </button>
              <div className="rf-ai-home__hero-copy">
                <div className="rf-ai-home__hero-head">
                  <h2>Hola, soy PIX</h2>
                  <button
                    type="button"
                    className="rf-ai-home__msg-btn"
                    onClick={() => openChat()}
                    title="Abrir chat"
                  >
                    <MdChat /> Mensaje
                  </button>
                </div>
                <p>Estoy aquí para ayudarte con productividad, jornadas y el equipo del restaurante.</p>
                <ul>
                  <li><MdCheckCircle /> Analizo jornadas y personal en tiempo real</li>
                  <li><MdCheckCircle /> Miro productividad por empleado y área</li>
                  <li><MdCheckCircle /> Detecto demoras de cocina y hora pico</li>
                  <li><MdCheckCircle /> Te doy recomendaciones para el personal</li>
                </ul>
              </div>
            </>
          )}
        </section>

        <section className="rf-ai-home__kpis">
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--blue"><MdPeople /></span>
            <div>
              <p>En jornada</p>
              <strong>{staffOnline}</strong>
              <em>Personal activo ahora</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--sky"><MdRestaurant /></span>
            <div>
              <p>Cocina promedio</p>
              <strong>{kitchenAvg != null ? `${kitchenAvg} min` : '—'}</strong>
              <em>{delayed > 0 ? `${delayed} retraso(s) ahora` : 'Sin retrasos críticos'}</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--navy"><MdStars /></span>
            <div>
              <p>Cuentas hoy</p>
              <strong>{data?.dashboard?.today?.orders_paid ?? 0}</strong>
              <em>{formatMoney(data?.dashboard?.today?.sales_total)}</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--cyan"><MdHistory /></span>
            <div>
              <p>Horas hoy</p>
              <strong>{formatMinutes(data?.dashboard?.today?.worked_minutes)}</strong>
              <em>{`${data?.dashboard?.today?.sessions ?? 0} marcaciones`}</em>
            </div>
          </article>
        </section>

        <section className="rf-ai-home__charts">
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Horas por empleado
            </h3>
            {prodPie.length ? (
              <div className="rf-ai-home__pie-wrap">
                <ResponsiveContainer width="100%" height={96}>
                  <PieChart>
                    <Pie data={prodPie} dataKey="value" nameKey="name" innerRadius={24} outerRadius={38}>
                      {prodPie.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatMinutes(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <ul>
                  {prodPie.map((row, i) => (
                    <li key={row.name}>
                      <i style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span>{row.name}</span>
                      <b>{pieTotal ? Math.round((row.value / pieTotal) * 100) : 0}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rf-ai-home__empty">Aún no hay horas registradas en este período.</p>
            )}
          </div>
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('reportes')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Horas por turno
            </h3>
            {shiftBars.length ? (
              <ResponsiveContainer width="100%" height={96}>
                <BarChart data={shiftBars} margin={{ top: 2, right: 4, left: -6, bottom: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={24} />
                  <Tooltip formatter={(v) => formatMinutes(v)} />
                  <Bar dataKey="minutos" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="rf-ai-home__empty">Sin movimiento por turno en este período.</p>
            )}
          </div>
        </section>

        <div className="rf-ai-home__exports">
          <span>{from && to ? `Período ${formatShortDate(from)} — ${formatShortDate(to)}` : 'Período actual'}</span>
          <button type="button" className="rf-ai-home__export" onClick={() => onExport?.()}>
            Exportar productividad
          </button>
          <Link to="/admin/indicadores?tab=ia" className="rf-ai-home__export">
            Ver IA analítica
          </Link>
        </div>
      </div>

      <aside className="rf-ai-home__side">
        <section className="card rf-ai-home__recs">
          <h3>
            <img src={getFadeyAiAvatarSrc('asesorando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
            Recomendaciones de la IA
          </h3>
          <ul>
            {insights.slice(0, 5).map((ins, i) => (
              <li key={`${ins.priority}-${i}`}>
                <span className={`rf-ai-home__dot rf-ai-home__dot--${ins.priority || 'info'}`} />
                <p>{ins.message}</p>
              </li>
            ))}
            {insights.length === 0 ? (
              <li><p>Cuando haya movimiento, aquí verás recomendaciones automáticas del equipo.</p></li>
            ) : null}
          </ul>
        </section>

        <section className="card rf-ai-home__actions">
          <h3><MdBolt /> Acciones rápidas</h3>
          <div className="rf-ai-home__action-grid">
            {HR_QUICK_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="rf-ai-home__action-btn"
                  onClick={() => openChat(a.prompt)}
                >
                  <Icon /> {a.label}
                </button>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}
