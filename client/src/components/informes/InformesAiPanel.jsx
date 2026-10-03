import { useMemo, useRef, useState } from 'react';
import {
  MdArrowBack,
  MdAttachMoney,
  MdBolt,
  MdCalendarMonth,
  MdChat,
  MdCheckCircle,
  MdCompareArrows,
  MdEmojiEvents,
  MdGroups,
  MdInventory2,
  MdPerson,
  MdPointOfSale,
  MdReceiptLong,
  MdTrendingUp,
  MdWarningAmber,
} from 'react-icons/md';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '../../utils/api';
import { getFadeyAiAvatarSrc } from '../../constants/fadeyAiBranding';
import FadeyAiChatPanel from '../FadeyAiChatPanel';
import '../indicadores/FadeyAiHomePanel.css';

const PIE_COLORS = ['#2563eb', '#38bdf8', '#93c5fd', '#1d4ed8', '#7dd3fc', '#64748b', '#0ea5e9'];

/** Cada acción pide al chat un informe completo (con gráficos y descarga Excel/PDF). */
const REPORT_QUICK_ACTIONS = [
  { id: 'hoy', label: 'Ventas de hoy', icon: MdAttachMoney, prompt: 'Informe de ventas de hoy' },
  { id: 'mes', label: 'Ventas del mes', icon: MdCalendarMonth, prompt: 'Informe de ventas de este mes' },
  { id: 'comparar', label: 'Vs. mes pasado', icon: MdCompareArrows, prompt: 'Informe de ventas del mes pasado' },
  { id: 'productos', label: 'Productos', icon: MdEmojiEvents, prompt: 'Informe de productos de este mes' },
  { id: 'personal', label: 'Personal', icon: MdPerson, prompt: 'Informe de personal de este mes' },
  { id: 'clientes', label: 'Clientes', icon: MdGroups, prompt: 'Informe de clientes de este mes' },
  { id: 'costos', label: 'Costos y márgenes', icon: MdTrendingUp, prompt: 'Informe de costos de este mes' },
  { id: 'inventario', label: 'Inventario', icon: MdInventory2, prompt: 'Informe de inventario' },
];

const REPORT_CHAT_SUGGESTED = [
  'Informe de ventas de esta semana',
  'Informe de productos del mes pasado',
  'Informe de costos de este mes',
  'Informe de inventario',
  'Informe de personal de este mes',
  '¿Qué día vendí más este mes?',
];

function shortDate(key) {
  const [, m, d] = String(key || '').split('-');
  return d ? `${d}/${m}` : String(key || '');
}

/**
 * Panel IA Fadey para Informes: mismo diseño que la IA de Ventas, con KPIs y gráficos
 * de los informes del día, del mes, ranking de productos e inventario.
 */
export default function InformesAiPanel({
  dailyData = null,
  monthlyData = null,
  ranking = [],
  inventoryAlerts = [],
  monthLabel = '',
}) {
  const [heroMode, setHeroMode] = useState('hello');
  const chatRef = useRef(null);
  const heroRef = useRef(null);

  const daySales = Number(dailyData?.sales?.total_sales || 0);
  const dayAccounts = Number(dailyData?.sales?.order_count || 0);
  const monthSales = Number(monthlyData?.totalMonth?.total || 0);
  const monthAccounts = Number(monthlyData?.totalMonth?.orders || 0);
  const closedRegisters = Number(monthlyData?.closedRegistersMonth || 0);
  const lowStock = Array.isArray(inventoryAlerts) ? inventoryAlerts.length : 0;

  const dailyBars = useMemo(
    () => [...(monthlyData?.dailySales || [])]
      .reverse()
      .map((d) => ({ name: shortDate(d.date), ventas: Math.round(Number(d.total || 0) * 100) / 100 })),
    [monthlyData],
  );

  const productPie = useMemo(
    () => (Array.isArray(ranking) ? ranking : [])
      .slice(0, 6)
      .map((p) => ({ name: String(p.product_name || '—'), value: Number(p.total_revenue || 0) }))
      .filter((r) => r.value > 0),
    [ranking],
  );
  const pieTotal = productPie.reduce((s, r) => s + r.value, 0);

  const insights = useMemo(() => {
    const list = [];
    const daysWithSales = dailyBars.filter((d) => d.ventas > 0);
    if (daysWithSales.length) {
      const best = daysWithSales.reduce((a, b) => (b.ventas > a.ventas ? b : a));
      const avg = daysWithSales.reduce((s, d) => s + d.ventas, 0) / daysWithSales.length;
      list.push({ priority: 'ok', message: `Mejor día del mes: ${best.name} con ${formatCurrency(best.ventas)}.` });
      if (daySales > 0) {
        list.push({
          priority: daySales >= avg ? 'ok' : 'warn',
          message: `Hoy vas ${formatCurrency(daySales)}; el promedio diario del mes es ${formatCurrency(avg)}.`,
        });
      }
    }
    if (monthAccounts > 0 && monthSales > 0) {
      list.push({ priority: 'info', message: `Ticket promedio del mes: ${formatCurrency(monthSales / monthAccounts)} (${monthAccounts} cuentas).` });
    }
    if (productPie[0]) {
      list.push({ priority: 'info', message: `Producto con más ingresos: ${productPie[0].name} (${formatCurrency(productPie[0].value)}).` });
    }
    if (lowStock > 0) {
      list.push({ priority: 'warn', message: `${lowStock} producto(s) o insumo(s) en stock mínimo. Pide el informe de inventario.` });
    }
    const discounts = Number(dailyData?.adjustments?.discount_amount_total || 0);
    const courtesies = Number(dailyData?.adjustments?.courtesy_reference_total || 0);
    if (discounts + courtesies > 0) {
      list.push({ priority: 'info', message: `Hoy: descuentos ${formatCurrency(discounts)} y cortesías ${formatCurrency(courtesies)} (referencia).` });
    }
    if (!list.length) list.push({ priority: 'info', message: 'Cuando haya ventas, aquí verás recomendaciones de tus informes.' });
    return list.slice(0, 5);
  }, [dailyBars, daySales, monthSales, monthAccounts, productPie, lowStock, dailyData]);

  const openChat = (prompt = '') => {
    setHeroMode('chat');
    requestAnimationFrame(() => heroRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
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
    'Puedo generar informes de ventas, productos, personal, clientes, costos e inventario, de cualquier período.',
    `Ahora: hoy ${formatCurrency(daySales)} · mes ${formatCurrency(monthSales)} · ${lowStock} alerta(s) de stock.`,
    'Pídeme, por ejemplo, «informe de productos de la semana pasada»; te lo doy con gráficos y en Excel o PDF.',
  ].join(' ');

  return (
    <div className="rf-ai-home animate-in fade-in duration-300">
      <div className="rf-ai-home__main">
        <section ref={heroRef} className={`rf-ai-home__hero ${heroMode === 'chat' ? 'rf-ai-home__hero--chat' : ''}`}>
          {heroMode === 'chat' ? (
            <div className="rf-ai-home__hero-chat">
              <div className="rf-ai-home__hero-chat-bar">
                <button type="button" className="rf-ai-home__hero-clear" onClick={() => setHeroMode('hello')} aria-label="Volver">
                  <MdArrowBack />
                </button>
                <img src={getFadeyAiAvatarSrc('chat')} alt="" className="rf-ai-home__hero-chat-pix" draggable={false} />
                <div className="rf-ai-home__hero-chat-titles">
                  <strong>PIX · Informes</strong>
                  <span>Pídeme cualquier informe del sistema y el período</span>
                </div>
              </div>
              <div className="rf-ai-home__hero-chat-body">
                <FadeyAiChatPanel ref={chatRef} isActive variant="home" introMessage={intro} suggested={REPORT_CHAT_SUGGESTED} />
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
                  <button type="button" className="rf-ai-home__msg-btn" onClick={() => openChat()} title="Abrir chat">
                    <MdChat /> Mensaje
                  </button>
                </div>
                <p>Te ayudo con los informes de todo el sistema: ventas, productos, personal, clientes, costos e inventario.</p>
                <ul>
                  <li><MdCheckCircle /> Genero informes de cualquier período con gráficos</li>
                  <li><MdCheckCircle /> Comparo contra el período anterior</li>
                  <li><MdCheckCircle /> Descargo el informe en Excel o PDF</li>
                  <li><MdCheckCircle /> Te aviso de stock bajo y días flojos</li>
                </ul>
              </div>
            </>
          )}
        </section>

        <section className="rf-ai-home__kpis">
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--blue"><MdAttachMoney /></span>
            <div>
              <p>Ventas del día</p>
              <strong>{formatCurrency(daySales)}</strong>
              <em>{dayAccounts} cuenta(s)</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--sky"><MdReceiptLong /></span>
            <div>
              <p>Ventas del mes</p>
              <strong>{formatCurrency(monthSales)}</strong>
              <em className="capitalize">{monthLabel || `${monthAccounts} cuenta(s)`}</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--navy"><MdPointOfSale /></span>
            <div>
              <p>Cajas cerradas</p>
              <strong>{closedRegisters}</strong>
              <em>En el mes</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--cyan"><MdWarningAmber /></span>
            <div>
              <p>Stock mínimo</p>
              <strong>{lowStock}</strong>
              <em>Alertas activas</em>
            </div>
          </article>
        </section>

        <section className="rf-ai-home__charts">
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('reportes')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Ventas diarias del mes
            </h3>
            {dailyBars.length ? (
              <div className="rf-ai-home__chart-box"><ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyBars} margin={{ top: 2, right: 4, left: -6, bottom: -4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9 }} width={32} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="ventas" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer></div>
            ) : (
              <p className="rf-ai-home__empty">Aún no hay ventas en el mes.</p>
            )}
          </div>
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Productos con más ingresos
            </h3>
            {productPie.length ? (
              <div className="rf-ai-home__pie-wrap">
                <div className="rf-ai-home__chart-box"><ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={productPie} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="80%">
                      {productPie.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer></div>
                <ul>
                  {productPie.map((row, i) => (
                    <li key={row.name}>
                      <i style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span>{row.name}</span>
                      <b>{pieTotal ? Math.round((row.value / pieTotal) * 100) : 0}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rf-ai-home__empty">Sin ranking de productos todavía.</p>
            )}
          </div>
        </section>
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
          <h3><MdBolt /> Informes rápidos</h3>
          <div className="rf-ai-home__action-grid">
            {REPORT_QUICK_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.id} type="button" className="rf-ai-home__action-btn" onClick={() => openChat(a.prompt)}>
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
