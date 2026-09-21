import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MdCheckCircle,
  MdShoppingCart,
  MdReceiptLong,
  MdPeople,
  MdAttachMoney,
  MdBolt,
  MdAssessment,
  MdInventory,
  MdNotificationsActive,
  MdRestaurantMenu,
  MdTrendingUp,
  MdPictureAsPdf,
  MdTableView,
  MdClose,
  MdChat,
  MdArrowBack,
} from 'react-icons/md';
import { Cell, Pie, PieChart, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { formatCurrency } from '../../utils/api';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import FadeyAiChatPanel from '../FadeyAiChatPanel';
import './FadeyAiHomePanel.css';

const PIE_COLORS = ['#2563eb', '#38bdf8', '#93c5fd', '#1d4ed8', '#7dd3fc', '#64748b'];

const QUICK_ACTIONS = [
  { id: 'ventas', label: 'Informe de ventas', icon: MdAssessment, mood: 'reportes', prompt: 'Genera un resumen de ventas del período' },
  { id: 'clientes', label: 'Análisis de clientes', icon: MdPeople, mood: 'analizando', prompt: 'Analiza los clientes del período' },
  { id: 'menu', label: 'Sugerencias de menú', icon: MdRestaurantMenu, mood: 'asesorando', prompt: '¿Qué productos se venden más y qué me sugieres para el menú?' },
  { id: 'almacen', label: 'Estado de almacén', icon: MdInventory, mood: 'analizando', prompt: '¿Cómo está el stock e inventario?' },
  { id: 'alertas', label: 'Alertas de inventario', icon: MdNotificationsActive, mood: 'asesorando', prompt: '¿Hay alertas de inventario o stock bajo?' },
  { id: 'demanda', label: 'Predicción de demanda', icon: MdTrendingUp, mood: 'analizando', prompt: '¿Qué me recomiendas según la demanda y hora pico?' },
];

const HOME_CHAT_SUGGESTED = [
  '¿Qué vendimos hoy?',
  'Genera un resumen de ventas',
  '¿Qué productos se venden más?',
  '¿Qué me recomiendas hoy?',
];
function pctChange(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatShortDate(key) {
  if (!key) return '';
  const [y, m, d] = String(key).split('-');
  if (!d) return key;
  return `${d}/${m}/${y}`;
}

function peakHourLabel(hourRows) {
  if (!Array.isArray(hourRows) || !hourRows.length) return null;
  const best = [...hourRows].sort((a, b) => Number(b.ventas || 0) - Number(a.ventas || 0))[0];
  return best?.name || null;
}

export default function FadeyAiHomePanel({ data }) {
  const [activeAction, setActiveAction] = useState(null);
  const [heroMode, setHeroMode] = useState('hello'); // hello | report | chat
  const chatRef = useRef(null);
  const g = data?.general || {};
  const ch = data?.charts || {};
  const products = data?.products || {};
  const customers = data?.customers || {};
  const inventory = data?.inventory || {};
  const allInsights = Array.isArray(data?.insights) ? data.insights : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const from = data?.filters?.from;
  const to = data?.filters?.to;

  const categoryData = useMemo(
    () => (products.top_sellers || []).slice(0, 5).map((row) => ({
      name: String(row.product_name || 'Producto').slice(0, 22),
      value: Number(row.qty || 0),
    })),
    [products.top_sellers],
  );
  const hourData = (ch.sales_by_hour || []).slice(0, 16);
  const pieTotal = categoryData.reduce((s, r) => s + r.value, 0);
  const topProduct = (products.top_sellers || [])[0];
  const peak = peakHourLabel(ch.sales_by_hour || []);

  const view = useMemo(() => {
    const periodSales = Number(g.period_sales ?? g.sales_today ?? 0);
    const periodOrders = Number(g.period_orders ?? g.orders_today ?? 0);
    if (activeAction === 'ventas') {
      return {
        mood: 'reportes',
        title: 'Informe de ventas',
        subtitle: from && to
          ? `Resumen reunido para ${formatShortDate(from)} — ${formatShortDate(to)}`
          : 'Resumen reunido del período actual',
        bullets: [
          `Ventas del período: ${formatCurrency(periodSales)} en ${periodOrders} pedido(s).`,
          g.avg_ticket != null ? `Ticket promedio: ${formatCurrency(g.avg_ticket)}.` : null,
          topProduct
            ? `Más vendido: ${topProduct.product_name} (${topProduct.qty} uds${topProduct.revenue != null ? `, ${formatCurrency(topProduct.revenue)}` : ''}).`
            : 'Aún no hay ranking de productos en este período.',
          peak ? `Hora pico de facturación: ${peak}.` : null,
          pctChange(g.growth_month_pct) ? `Variación vs mes anterior: ${pctChange(g.growth_month_pct)}.` : null,
        ].filter(Boolean),
        kpis: [
          { label: 'Ventas del período', value: formatCurrency(periodSales), sub: pctChange(g.growth_month_pct), icon: 'blue', Icon: MdShoppingCart },
          { label: 'Pedidos', value: periodOrders, sub: `${g.orders_today ?? 0} hoy`, icon: 'sky', Icon: MdReceiptLong },
          { label: 'Ticket promedio', value: formatCurrency(g.avg_ticket), sub: null, icon: 'navy', Icon: MdAttachMoney },
          { label: 'Clientes', value: g.customers_served_today ?? customers.active_count ?? 0, sub: 'atendidos', icon: 'cyan', Icon: MdPeople },
        ],
        insights: allInsights.filter((ins) => /venta|ticket|producto|hora|pico|margen|delivery/i.test(String(ins.message || ''))).slice(0, 5),
        chartTitleLeft: 'Ventas por producto',
        chartTitleRight: 'Ventas por hora',
      };
    }
    if (activeAction === 'clientes') {
      return {
        mood: 'analizando',
        title: 'Análisis de clientes',
        subtitle: 'Lectura del período con foco en afluencia y recurrencia',
        bullets: [
          `Clientes atendidos hoy: ${g.customers_served_today ?? 0}.`,
          customers.active_count != null ? `Base activa: ${customers.active_count}.` : null,
          customers.new_in_period != null ? `Nuevos en el período: ${customers.new_in_period}.` : null,
          periodOrders ? `Pedidos del período: ${periodOrders}.` : null,
        ].filter(Boolean),
        kpis: [
          { label: 'Clientes hoy', value: g.customers_served_today ?? 0, sub: null, icon: 'cyan', Icon: MdPeople },
          { label: 'Pedidos', value: periodOrders, sub: 'período', icon: 'sky', Icon: MdReceiptLong },
          { label: 'Ticket promedio', value: formatCurrency(g.avg_ticket), sub: null, icon: 'navy', Icon: MdAttachMoney },
          { label: 'Ventas', value: formatCurrency(periodSales), sub: null, icon: 'blue', Icon: MdShoppingCart },
        ],
        insights: allInsights.filter((ins) => /cliente|fidel|encuesta|ticket/i.test(String(ins.message || ''))).slice(0, 5),
        chartTitleLeft: 'Productos preferidos',
        chartTitleRight: 'Actividad por hora',
      };
    }
    if (activeAction === 'menu') {
      return {
        mood: 'asesorando',
        title: 'Sugerencias de menú',
        subtitle: 'Basado en lo que más se vende ahora',
        bullets: [
          topProduct
            ? `Prioriza disponibilidad de «${topProduct.product_name}» (${topProduct.qty} uds).`
            : 'Todavía no hay top de ventas para sugerir menú.',
          ...(products.top_sellers || []).slice(1, 4).map((p) => `Mantén stock de «${p.product_name}» (${p.qty} uds).`),
          peak ? `Refuerza cocina cerca de ${peak}.` : null,
        ].filter(Boolean),
        kpis: [
          { label: 'Top plato', value: topProduct ? String(topProduct.product_name).slice(0, 14) : '—', sub: topProduct ? `${topProduct.qty} uds` : null, icon: 'blue', Icon: MdRestaurantMenu },
          { label: 'Ventas', value: formatCurrency(periodSales), sub: null, icon: 'sky', Icon: MdShoppingCart },
          { label: 'Pedidos', value: periodOrders, sub: null, icon: 'navy', Icon: MdReceiptLong },
          { label: 'Ticket', value: formatCurrency(g.avg_ticket), sub: null, icon: 'cyan', Icon: MdAttachMoney },
        ],
        insights: allInsights.filter((ins) => /producto|vend|menú|menu|plato/i.test(String(ins.message || ''))).slice(0, 5),
        chartTitleLeft: 'Mix de productos',
        chartTitleRight: 'Demanda por hora',
      };
    }
    if (activeAction === 'almacen' || activeAction === 'alertas') {
      const critical = Number(inventory.critical_count || 0);
      const low = Number(inventory.low_count || inventory.warning_count || 0);
      return {
        mood: activeAction === 'alertas' ? 'asesorando' : 'analizando',
        title: activeAction === 'alertas' ? 'Alertas de inventario' : 'Estado de almacén',
        subtitle: 'Revisión de stock crítico y alertas activas',
        bullets: [
          critical ? `${critical} producto(s) en stock crítico.` : 'Sin productos en stock crítico.',
          low ? `${low} producto(s) con stock bajo.` : 'Sin avisos de stock bajo.',
          alerts.length ? `${alerts.length} alerta(s) activas en indicadores.` : 'Sin alertas adicionales en el hub.',
          ...(alerts.slice(0, 2).map((a) => a.message || a.title).filter(Boolean)),
        ].filter(Boolean),
        kpis: [
          { label: 'Críticos', value: critical, sub: 'reponer ya', icon: 'blue', Icon: MdNotificationsActive },
          { label: 'Stock bajo', value: low, sub: null, icon: 'sky', Icon: MdInventory },
          { label: 'Alertas', value: alerts.length, sub: 'activas', icon: 'navy', Icon: MdNotificationsActive },
          { label: 'Ventas hoy', value: formatCurrency(g.sales_today), sub: null, icon: 'cyan', Icon: MdShoppingCart },
        ],
        insights: [
          ...alerts.slice(0, 3).map((a) => ({ priority: a.severity || 'medium', message: a.message || a.title })),
          ...allInsights.filter((ins) => /stock|inventario|reponer|desperdicio/i.test(String(ins.message || ''))),
        ].slice(0, 5),
        chartTitleLeft: 'Productos más movidos',
        chartTitleRight: 'Ventas por hora',
      };
    }
    if (activeAction === 'demanda') {
      return {
        mood: 'analizando',
        title: 'Predicción de demanda',
        subtitle: 'Señal según tendencia reciente del local',
        bullets: [
          peak ? `Pico probable alrededor de ${peak} — refuerza cocina antes.` : 'Sin pico claro en el período.',
          topProduct ? `Demanda fuerte de «${topProduct.product_name}».` : null,
          pctChange(g.growth_month_pct)
            ? `Tendencia mensual: ${pctChange(g.growth_month_pct)}.`
            : 'Aún no hay variación mensual para proyectar.',
          periodOrders ? `Base: ${periodOrders} pedido(s) en el período analizado.` : null,
        ].filter(Boolean),
        kpis: [
          { label: 'Hora pico', value: peak || '—', sub: 'estimada', icon: 'blue', Icon: MdTrendingUp },
          { label: 'Pedidos', value: periodOrders, sub: 'período', icon: 'sky', Icon: MdReceiptLong },
          { label: 'Top producto', value: topProduct ? String(topProduct.product_name).slice(0, 12) : '—', sub: topProduct ? `${topProduct.qty} uds` : null, icon: 'navy', Icon: MdRestaurantMenu },
          { label: 'Ventas', value: formatCurrency(periodSales), sub: pctChange(g.growth_month_pct), icon: 'cyan', Icon: MdShoppingCart },
        ],
        insights: allInsights.filter((ins) => /pico|proyec|demanda|semana|hora/i.test(String(ins.message || ''))).slice(0, 5),
        chartTitleLeft: 'Productos a priorizar',
        chartTitleRight: 'Curva horaria',
      };
    }
    return null;
  }, [activeAction, allInsights, alerts, customers, from, g, inventory, peak, products.top_sellers, to, topProduct]);

  const insights = view?.insights?.length ? view.insights : allInsights.slice(0, 5);
  const kpis = view?.kpis || [
    { label: 'Ventas de hoy', value: formatCurrency(g.sales_today), sub: pctChange(g.growth_month_pct) ? `${pctChange(g.growth_month_pct)} vs mes ant.` : null, icon: 'blue', Icon: MdShoppingCart },
    { label: 'Pedidos', value: g.orders_today ?? 0, sub: `${g.period_orders ?? 0} en el período`, icon: 'sky', Icon: MdReceiptLong },
    { label: 'Ticket promedio', value: formatCurrency(g.avg_ticket), sub: null, icon: 'navy', Icon: MdAttachMoney },
    { label: 'Clientes', value: g.customers_served_today ?? 0, sub: null, icon: 'cyan', Icon: MdPeople },
  ];

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

  const runQuickAction = (actionId) => {
    setActiveAction((prev) => {
      const next = prev === actionId ? null : actionId;
      setHeroMode(next ? 'report' : 'hello');
      return next;
    });
  };

  const intro = [
    'Puedo analizar ventas, clientes, menú, almacén y demanda en esta misma pantalla.',
    `Hoy: ${formatCurrency(g.sales_today)} en ${g.orders_today ?? 0} pedido(s).`,
    'Elige una acción rápida o escríbeme aquí.',
  ].join(' ');

  return (
    <div className="rf-ai-home">
      <div className="rf-ai-home__main">
        <section
          className={`rf-ai-home__hero ${
            heroMode === 'chat'
              ? 'rf-ai-home__hero--chat'
              : heroMode === 'report' || view
                ? 'rf-ai-home__hero--report'
                : ''
          }`}
        >
          {heroMode === 'chat' ? (
            <div className="rf-ai-home__hero-chat">
              <div className="rf-ai-home__hero-chat-bar">
                <button
                  type="button"
                  className="rf-ai-home__hero-clear"
                  onClick={() => setHeroMode(activeAction ? 'report' : 'hello')}
                  aria-label="Volver"
                >
                  <MdArrowBack />
                </button>
                <img src={getFadeyAiAvatarSrc('chat')} alt="" className="rf-ai-home__hero-chat-pix" draggable={false} />
                <div className="rf-ai-home__hero-chat-titles">
                  <strong>PIX · Chat</strong>
                  <span>Pregúntame sobre ventas, menú, stock o el negocio</span>
                </div>
              </div>
              <div className="rf-ai-home__hero-chat-body">
                <FadeyAiChatPanel
                  ref={chatRef}
                  isActive
                  variant="home"
                  introMessage={intro}
                  suggested={HOME_CHAT_SUGGESTED}
                />
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="rf-ai-home__bot rf-ai-home__bot--photo"
                onClick={() => openChat()}
                title="Abrir chat con PIX"
                aria-label="Abrir chat con PIX"
              >
                <img src={getFadeyAiAvatarSrc(view?.mood || 'saludo')} alt="" draggable={false} />
              </button>
              <div className="rf-ai-home__hero-copy">
                {view ? (
                  <>
                    <div className="rf-ai-home__hero-head">
                      <h2>{view.title}</h2>
                      <div className="rf-ai-home__hero-tools">
                        <button
                          type="button"
                          className="rf-ai-home__msg-btn"
                          onClick={() => openChat(QUICK_ACTIONS.find((a) => a.id === activeAction)?.prompt || '')}
                          title="Chatear sobre esto"
                        >
                          <MdChat /> Mensaje
                        </button>
                        <button type="button" className="rf-ai-home__hero-clear" onClick={() => { setActiveAction(null); setHeroMode('hello'); }} aria-label="Volver al saludo">
                          <MdClose />
                        </button>
                      </div>
                    </div>
                    <p>{view.subtitle}</p>
                    <ul>
                      {view.bullets.map((b) => (
                        <li key={b}><MdCheckCircle /> {b}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
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
                    <p>Estoy aquí para ayudarte a analizar, gestionar y hacer crecer tu restaurante.</p>
                    <ul>
                      <li><MdCheckCircle /> Analizo tus datos en tiempo real</li>
                      <li><MdCheckCircle /> Genero reportes e informes</li>
                      <li><MdCheckCircle /> Te doy recomendaciones inteligentes</li>
                      <li><MdCheckCircle /> Te ayudo a tomar mejores decisiones</li>
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <section className="rf-ai-home__kpis">
          {kpis.map((k) => (
            <article key={k.label} className="rf-ai-home__kpi">
              <span className={`rf-ai-home__kpi-icon rf-ai-home__kpi-icon--${k.icon}`}><k.Icon /></span>
              <div>
                <p>{k.label}</p>
                <strong>{k.value}</strong>
                {k.sub ? <em>{k.sub}</em> : null}
              </div>
            </article>
          ))}
        </section>

        <section className="rf-ai-home__charts">
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              {view?.chartTitleLeft || 'Ventas por producto'}
            </h3>
            {categoryData.length ? (
              <div className="rf-ai-home__pie-wrap">
                <ResponsiveContainer width="100%" height={96}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={24} outerRadius={38}>
                      {categoryData.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <ul>
                  {categoryData.map((row, i) => (
                    <li key={row.name}>
                      <i style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span>{row.name}</span>
                      <b>{pieTotal ? Math.round((row.value / pieTotal) * 100) : 0}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rf-ai-home__empty">Aún no hay ventas en este período.</p>
            )}
          </div>
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('reportes')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              {view?.chartTitleRight || 'Ventas por hora'}
            </h3>
            {hourData.length ? (
              <ResponsiveContainer width="100%" height={96}>
                <BarChart data={hourData} margin={{ top: 2, right: 4, left: -6, bottom: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} width={24} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="ventas" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="rf-ai-home__empty">Sin movimiento por hora en este período.</p>
            )}
          </div>
        </section>

        <div className="rf-ai-home__exports">
          <span>{from && to ? `Período ${formatShortDate(from)} — ${formatShortDate(to)}` : 'Período actual'}</span>
          <Link to="/admin/informes" className="rf-ai-home__export">
            <MdPictureAsPdf /> Generar reporte en PDF
          </Link>
          <Link to="/admin/informes" className="rf-ai-home__export">
            <MdTableView /> Exportar a Excel
          </Link>
          <Link to="/admin/indicadores?tab=graficos" className="rf-ai-home__export">
            <MdTrendingUp /> Ver detalle de ventas
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
            {insights.length === 0 ? <li><p>Cuando haya movimiento, aquí verás recomendaciones automáticas.</p></li> : null}
          </ul>
        </section>

        <section className="card rf-ai-home__actions">
          <h3><MdBolt /> Acciones rápidas</h3>
          <div className="rf-ai-home__action-grid">
            {QUICK_ACTIONS.map((a) => {
              const Icon = a.icon;
              const active = activeAction === a.id && heroMode !== 'chat';
              return (
                <button
                  key={a.id}
                  type="button"
                  className={active ? 'rf-ai-home__action-btn is-active' : 'rf-ai-home__action-btn'}
                  onClick={() => runQuickAction(a.id)}
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
