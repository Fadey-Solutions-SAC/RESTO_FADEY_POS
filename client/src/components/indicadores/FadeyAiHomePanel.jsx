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
} from 'react-icons/md';
import { Cell, Pie, PieChart, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { formatCurrency } from '../../utils/api';
import { getFadeyAiAvatarSrc, OPEN_FADEY_AI_EVENT } from '../../constants/fadeyAiBranding';
import './FadeyAiHomePanel.css';

const PIE_COLORS = ['#2563eb', '#38bdf8', '#93c5fd', '#1d4ed8', '#7dd3fc', '#64748b'];

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

export default function FadeyAiHomePanel({ data }) {
  const g = data?.general || {};
  const ch = data?.charts || {};
  const products = data?.products || {};
  const insights = Array.isArray(data?.insights) ? data.insights : [];
  const from = data?.filters?.from;
  const to = data?.filters?.to;

  const categoryData = (products.top_sellers || []).slice(0, 5).map((row) => ({
    name: String(row.product_name || 'Producto').slice(0, 22),
    value: Number(row.qty || 0),
  }));
  const hourData = (ch.sales_by_hour || []).slice(0, 16);
  const pieTotal = categoryData.reduce((s, r) => s + r.value, 0);

  const openChat = () => {
    try {
      window.dispatchEvent(new CustomEvent(OPEN_FADEY_AI_EVENT));
    } catch (_) {
      /* noop */
    }
  };

  return (
    <div className="rf-ai-home">
      <div className="rf-ai-home__main">
        <section className="rf-ai-home__hero">
          <button
            type="button"
            className="rf-ai-home__bot rf-ai-home__bot--photo"
            onClick={openChat}
            title="Abrir chat con PIX"
            aria-label="Abrir chat con PIX"
          >
            <img src={getFadeyAiAvatarSrc('saludo')} alt="" draggable={false} />
          </button>
          <div className="rf-ai-home__hero-copy">
            <h2>Hola, soy PIX</h2>
            <p>Estoy aquí para ayudarte a analizar, gestionar y hacer crecer tu restaurante.</p>
            <ul>
              <li><MdCheckCircle /> Analizo tus datos en tiempo real</li>
              <li><MdCheckCircle /> Genero reportes e informes</li>
              <li><MdCheckCircle /> Te doy recomendaciones inteligentes</li>
              <li><MdCheckCircle /> Te ayudo a tomar mejores decisiones</li>
            </ul>
          </div>
        </section>

        <section className="rf-ai-home__kpis">
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--blue"><MdShoppingCart /></span>
            <div>
              <p>Ventas de hoy</p>
              <strong>{formatCurrency(g.sales_today)}</strong>
              {pctChange(g.growth_month_pct) ? <em>{pctChange(g.growth_month_pct)} vs mes ant.</em> : null}
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--sky"><MdReceiptLong /></span>
            <div>
              <p>Pedidos</p>
              <strong>{g.orders_today ?? 0}</strong>
              <em>{g.period_orders ?? 0} en el período</em>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--navy"><MdAttachMoney /></span>
            <div>
              <p>Ticket promedio</p>
              <strong>{formatCurrency(g.avg_ticket)}</strong>
            </div>
          </article>
          <article className="rf-ai-home__kpi">
            <span className="rf-ai-home__kpi-icon rf-ai-home__kpi-icon--cyan"><MdPeople /></span>
            <div>
              <p>Clientes</p>
              <strong>{g.customers_served_today ?? 0}</strong>
            </div>
          </article>
        </section>

        <section className="rf-ai-home__charts">
          <div className="card rf-ai-home__chart">
            <h3>
              <img src={getFadeyAiAvatarSrc('analizando')} alt="" className="rf-ai-home__inline-pix" draggable={false} />
              Ventas por producto
            </h3>
            {categoryData.length ? (
              <div className="rf-ai-home__pie-wrap">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={74}>
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
              Ventas por hora
            </h3>
            {hourData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="ventas" fill="#2563eb" radius={[4, 4, 0, 0]} />
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
            <Link to="/admin/informes"><MdAssessment /> Informe de ventas</Link>
            <Link to="/admin/clientes"><MdPeople /> Análisis de clientes</Link>
            <Link to="/admin/productos"><MdRestaurantMenu /> Sugerencias de menú</Link>
            <Link to="/admin/almacen"><MdInventory /> Estado de almacén</Link>
            <Link to="/admin/indicadores?tab=alertas"><MdNotificationsActive /> Alertas de inventario</Link>
            <Link to="/admin/indicadores?tab=productos"><MdTrendingUp /> Predicción de demanda</Link>
          </div>
        </section>
      </aside>
    </div>
  );
}
