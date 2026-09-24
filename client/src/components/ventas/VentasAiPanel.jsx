import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MdCheckCircle,
  MdShoppingCart,
  MdPayments,
  MdPendingActions,
  MdReceiptLong,
  MdBolt,
  MdChat,
  MdArrowBack,
  MdPerson,
  MdCancel,
  MdTrendingUp,
  MdAccountBalanceWallet,
} from 'react-icons/md';
import { Cell, Pie, PieChart, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { formatCurrency } from '../../utils/api';
import { isCourtesyOrder } from '../../utils/mesaOrderLines';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import FadeyAiChatPanel from '../FadeyAiChatPanel';
import '../indicadores/FadeyAiHomePanel.css';

const PIE_COLORS = ['#2563eb', '#38bdf8', '#93c5fd', '#1d4ed8', '#7dd3fc', '#64748b', '#0ea5e9'];

const PAY_LABEL = {
  efectivo: 'Efectivo',
  yape: 'Yape',
  plin: 'Plin',
  tarjeta: 'Tarjeta',
  online: 'Online',
  transferencia: 'Transferencia',
  cortesia: 'Cortesía',
};

const SALES_QUICK_ACTIONS = [
  { id: 'hoy', label: 'Ventas de hoy', icon: MdShoppingCart, prompt: '¿Cuánto vendí hoy?' },
  { id: 'semana', label: 'Última semana', icon: MdTrendingUp, prompt: '¿Cuánto vendí la última semana?' },
  { id: 'pendiente', label: 'Pendiente', icon: MdPendingActions, prompt: '¿Cuánto hay pendiente de cobro?' },
  { id: 'pagos', label: 'Formas de pago', icon: MdPayments, prompt: '¿Cómo se repartieron los pagos (Yape, efectivo, tarjeta)?' },
  { id: 'meseros', label: 'Top meseros', icon: MdPerson, prompt: '¿Qué mesero vendió más?' },
  { id: 'resumen', label: 'Resumen', icon: MdReceiptLong, prompt: 'Genera un resumen de ventas del período' },
];

const SALES_CHAT_SUGGESTED = [
  '¿Cuánto vendí hoy?',
  '¿Cuánto vendí la última semana?',
  '¿Cuánto hay pendiente de cobro?',
  '¿Qué mesero vendió más?',
  '¿Cómo se repartieron los pagos?',
  'Genera un resumen de ventas',
  '¿Hay stock bajo?',
];

function formatShortDate(key) {
  if (!key) return '';
  const [y, m, d] = String(key).split('-');
  if (!d) return key;
  return `${d}/${m}/${y}`;
}

function payLabel(method) {
  const key = String(method || '').toLowerCase();
  return PAY_LABEL[key] || (method ? String(method) : 'Otro');
}

/**
 * Panel IA Fadey para el módulo Ventas — mismo layout que Indicadores / RRHH,
 * con KPIs y gráficos derivados de las ventas cargadas en pantalla.
 */
export default function VentasAiPanel({
  orders = [],
  filtered = [],
  totals = {},
  fromDate = '',
  toDate = '',
  onExport,
}) {
  const [heroMode, setHeroMode] = useState('hello'); // hello | chat
  const chatRef = useRef(null);

  const activeOrders = useMemo(
    () => (Array.isArray(filtered) && filtered.length ? filtered : orders)
      .filter((o) => o && o.status !== 'cancelled' && !isCourtesyOrder(o)),
    [filtered, orders],
  );

  const paidOrders = useMemo(
    () => activeOrders.filter((o) => o.payment_status === 'paid'),
    [activeOrders],
  );

  const pendingOrders = useMemo(
    () => activeOrders.filter((o) => o.payment_status === 'pending'),
    [activeOrders],
  );

  const voidedCount = useMemo(
    () => (orders || []).filter((o) => o.status === 'cancelled').length,
    [orders],
  );

  const paymentPie = useMemo(() => {
    const map = new Map();
    for (const o of paidOrders) {
      const key = String(o.payment_method || 'efectivo').toLowerCase();
      const prev = map.get(key) || 0;
      map.set(key, prev + Number(o.total || 0));
    }
    return [...map.entries()]
      .map(([method, value]) => ({ name: payLabel(method), value: Number(value) || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [paidOrders]);

  const pieTotal = paymentPie.reduce((s, r) => s + r.value, 0);

  const waiterBars = useMemo(() => {
    const map = new Map();
    for (const o of paidOrders) {
      const name = String(o.created_by_user_name || o.customer_name || 'Sin mesero').trim() || 'Sin mesero';
      const prev = map.get(name) || { name, ventas: 0, cuentas: 0 };
      prev.ventas += Number(o.total || 0);
      prev.cuentas += 1;
      map.set(name, prev);
    }
    return [...map.values()]
      .sort((a, b) => b.ventas - a.ventas)
      .slice(0, 6)
      .map((r) => ({
        name: String(r.name).slice(0, 12),
        ventas: Math.round(r.ventas * 100) / 100,
        cuentas: r.cuentas,
      }));
  }, [paidOrders]);

  const topWaiter = waiterBars[0] || null;
  const topPay = paymentPie[0] || null;

  const totalSales = Number(totals.total ?? activeOrders.reduce((s, o) => s + Number(o.total || 0), 0));
  const paidSales = Number(totals.paid ?? paidOrders.reduce((s, o) => s + Number(o.total || 0), 0));
  const pendingSales = Number(totals.pending ?? pendingOrders.reduce((s, o) => s + Number(o.total || 0), 0));
  const accountsPaid = Number(totals.count ?? paidOrders.length);

  const insights = useMemo(() => {
    const list = [];
    if (pendingSales > 0) {
      list.push({
        priority: pendingSales > paidSales * 0.15 ? 'warn' : 'info',
        message: `Hay ${formatCurrency(pendingSales)} pendiente de cobro en ${pendingOrders.length} cuenta(s).`,
      });
    } else {
      list.push({
        priority: 'ok',
        message: 'No hay montos pendientes de cobro en el filtro actual.',
      });
    }
    if (topWaiter) {
      list.push({
        priority: 'info',
        message: `Mesero con más ventas: ${topWaiter.name} (${formatCurrency(topWaiter.ventas)}).`,
      });
    }
    if (topPay) {
      list.push({
        priority: 'info',
        message: `Forma de pago principal: ${topPay.name} (${formatCurrency(topPay.value)}).`,
      });
    }
    if (voidedCount > 0) {
      list.push({
        priority: voidedCount > 10 ? 'warn' : 'info',
        message: `Hay ${voidedCount} venta(s) anulada(s) en el historial cargado.`,
      });
    }
    if (accountsPaid > 0 && paidSales > 0) {
      const ticket = paidSales / accountsPaid;
      list.push({
        priority: 'ok',
        message: `Ticket promedio cobrado: ${formatCurrency(ticket)} (${accountsPaid} cuenta(s)).`,
      });
    }
    if (!list.length) {
      list.push({ priority: 'info', message: 'Cuando haya movimiento, aquí verás recomendaciones de ventas.' });
    }
    return list.slice(0, 5);
  }, [pendingSales, paidSales, pendingOrders.length, topWaiter, topPay, voidedCount, accountsPaid]);

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

  const periodLabel = fromDate || toDate
    ? `${fromDate ? formatShortDate(fromDate) : '…'} — ${toDate ? formatShortDate(toDate) : '…'}`
    : 'todas las ventas cargadas';

  const intro = [
    'Puedo analizar cobros, pendientes, formas de pago y meseros con los datos de este módulo.',
    `Ahora: cobrado ${formatCurrency(paidSales)} · pendiente ${formatCurrency(pendingSales)} · ${accountsPaid} cuenta(s).`,
    'Elige una acción rápida o escríbeme aquí.',
  ].join(' ');

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
                  <span>Pregúntame sobre ventas, cobros, meseros o pagos</span>
                </div>
              </div>
              <div className="rf-ai-home__hero-chat-body">
                <FadeyAiChatPanel
                  ref={chatRef}
                  isActive
                  variant="home"
                  introMessage={intro}
                  suggested={SALES_CHAT_SUGGESTED}
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
                <p>Estoy aquí para ayudarte con el módulo de ventas: cobros, pendientes, meseros y formas de pago.</p>
                <ul>
                  <li><MdCheckCircle /> Miro total, cobrado y pendiente en vivo</li>
                  <li><MdCheckCircle /> Analizo pagos (Yape, efectivo, tarjeta…)</li>
                  <li><MdCheckCircle /> Comparo meseros y cuentas cobradas</li>
                  <li><MdCheckCircle /> Te doy recomendaciones sobre la caja</li>
                </ul>
              </div>
            </>
          )}
        </section>

        <section className="rf-ai-home__kpis">
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--blue"><MdShoppingCart /></span>
            <div>
              <p>Total ventas</p>
              <strong>{formatCurrency(totalSales)}</strong>
              <em>{periodLabel}</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--sky"><MdAccountBalanceWallet /></span>
            <div>
              <p>Cobrado</p>
              <strong>{formatCurrency(paidSales)}</strong>
              <em>{accountsPaid} cuenta(s)</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--navy"><MdPendingActions /></span>
            <div>
              <p>Pendiente</p>
              <strong>{formatCurrency(pendingSales)}</strong>
              <em>{pendingOrders.length} cuenta(s)</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--cyan"><MdCancel /></span>
            <div>
              <p>Anuladas</p>
              <strong>{voidedCount}</strong>
              <em>En historial cargado</em>
            </div>
          </article>
        </section>

        <section className="rf-ai-home__charts">
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Formas de pago
            </h3>
            {paymentPie.length ? (
              <div className="rf-ai-home__pie-wrap">
                <ResponsiveContainer width="100%" height={96}>
                  <PieChart>
                    <Pie data={paymentPie} dataKey="value" nameKey="name" innerRadius={24} outerRadius={38}>
                      {paymentPie.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <ul>
                  {paymentPie.map((row, i) => (
                    <li key={row.name}>
                      <i style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span>{row.name}</span>
                      <b>{pieTotal ? Math.round((row.value / pieTotal) * 100) : 0}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rf-ai-home__empty">Aún no hay pagos cobrados en el filtro actual.</p>
            )}
          </div>
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('reportes')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Ventas por mesero
            </h3>
            {waiterBars.length ? (
              <ResponsiveContainer width="100%" height={96}>
                <BarChart data={waiterBars} margin={{ top: 2, right: 4, left: -6, bottom: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={28} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="ventas" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="rf-ai-home__empty">Sin ventas por mesero en el filtro actual.</p>
            )}
          </div>
        </section>

        <div className="rf-ai-home__exports">
          <span>{fromDate || toDate ? `Período ${periodLabel}` : 'Todas las ventas cargadas'}</span>
          {typeof onExport === 'function' ? (
            <button type="button" className="rf-ai-home__export" onClick={() => onExport()}>
              Exportar detalle Excel
            </button>
          ) : null}
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
            {insights.map((ins, i) => (
              <li key={`${ins.priority}-${i}`}>
                <span className={`rf-ai-home__dot rf-ai-home__dot--${ins.priority || 'info'}`} />
                <p>{ins.message}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="card rf-ai-home__actions">
          <h3><MdBolt /> Acciones rápidas</h3>
          <div className="rf-ai-home__action-grid">
            {SALES_QUICK_ACTIONS.map((a) => {
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
