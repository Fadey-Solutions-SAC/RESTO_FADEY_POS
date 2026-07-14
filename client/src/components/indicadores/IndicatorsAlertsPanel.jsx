import { formatCurrency } from '../../utils/api';

export default function IndicatorsAlertsPanel({ data }) {
  const alerts = data?.alerts || [];
  const g = data?.general || {};
  const f = data?.financial || {};

  if (!alerts.length) {
    return (
      <div className="space-y-4">
        <div className="card p-5 border border-[color:var(--ui-border)]">
          <p className="font-semibold text-[var(--ui-body-text)] mb-1">Sin alertas críticas</p>
          <p className="text-sm text-[var(--ui-muted)]">
            No hay incidencias operativas urgentes. Las ventas y el estado del local se muestran abajo.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card p-3">
            <p className="text-[10px] uppercase text-[var(--ui-muted)]">Ventas período</p>
            <p className="text-lg font-bold text-[var(--ui-body-text)]">{formatCurrency(f.total_sales)}</p>
            <p className="text-xs text-[var(--ui-muted)]">{f.orders_count ?? 0} cuentas cobradas</p>
          </div>
          <div className="card p-3">
            <p className="text-[10px] uppercase text-[var(--ui-muted)]">Ventas hoy</p>
            <p className="text-lg font-bold text-[var(--ui-body-text)]">{formatCurrency(g.sales_today)}</p>
            <p className="text-xs text-[var(--ui-muted)]">{g.orders_today ?? 0} cuentas</p>
          </div>
          <div className="card p-3">
            <p className="text-[10px] uppercase text-[var(--ui-muted)]">Pedidos activos</p>
            <p className="text-lg font-bold text-[var(--ui-body-text)]">{g.active_orders ?? 0}</p>
          </div>
          <div className="card p-3">
            <p className="text-[10px] uppercase text-[var(--ui-muted)]">En cocina</p>
            <p className="text-lg font-bold text-[var(--ui-body-text)]">{g.kitchen_preparing ?? 0}</p>
          </div>
        </div>
        <p className="text-xs text-[var(--ui-muted)]">
          Solo aparecen en «Alertas» los avisos automáticos (stock, demoras, caja, etc.). Para ver todas las ventas use la pestaña{' '}
          <strong className="text-[var(--ui-body-text)]">Panel</strong> o <strong className="text-[var(--ui-body-text)]">Financiero</strong>.
          Las ventas deben estar <strong className="text-[var(--ui-body-text)]">cobradas</strong> en Caja.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li
          key={a.id}
          className={`rounded-lg px-3 py-2.5 text-sm ${
            a.severity === 'warning' ? 'ui-live-alert-warning' : 'ui-live-alert-info'
          }`}
        >
          <div className="flex justify-between gap-2 flex-wrap">
            <p className="font-semibold">{a.title}</p>
            <span className="text-[10px] uppercase opacity-80">{a.severity}</span>
          </div>
          <p className="text-xs mt-1 opacity-95">{a.message}</p>
        </li>
      ))}
    </ul>
  );
}
