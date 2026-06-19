import { useState, useEffect, useMemo } from 'react';
import { groupTableOrderItemsForBill, getStaffOrderStatusUi } from '../utils/mesaOrderLines';

const defaultLabels = {
  add: 'Agregar pedido',
  view: 'Ver pedido',
  listTitle: 'Productos en la mesa',
  empty: 'No hay pedidos en esta mesa.',
  totalMesa: 'Total mesa',
};

/**
 * Pestañas Agregar / Ver pedido: lista por **productos** (líneas iguales agrupadas), no por comanda.
 * Cocina/bar siguen imprimiendo por comanda en sus paneles.
 */
export default function StaffMesaPedidoTabs({
  orders = [],
  formatCurrency,
  children,
  labels: labelsProp,
  /** Identificador de mesa/contexto: al cambiar se carga la preferencia de unión guardada */
  resetKey,
  className = '',
}) {
  const labels = { ...defaultLabels, ...labelsProp };
  const [panel, setPanel] = useState('add');

  useEffect(() => {
    setPanel('add');
  }, [resetKey]);

  const rowsToShow = useMemo(() => groupTableOrderItemsForBill(orders), [orders]);

  /** Total cuenta mesa: suma de totales de pedidos; si no hay total, suma de subtotales por ítem */
  const totalMesa = useMemo(() => {
    const byOrders = (orders || []).reduce((s, o) => s + Number(o.total || 0), 0);
    if (byOrders > 0) return byOrders;
    return rowsToShow.reduce((s, r) => s + Number(r.subtotal || 0), 0);
  }, [orders, rowsToShow]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 overflow-hidden ${className}`}>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setPanel('add')}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
            panel === 'add'
              ? 'bg-[var(--ui-accent)] text-white border-[color:var(--ui-accent)]'
              : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          {labels.add}
        </button>
        <button
          type="button"
          onClick={() => setPanel('view')}
          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
            panel === 'view'
              ? 'bg-[var(--ui-accent)] text-white border-[color:var(--ui-accent)]'
              : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          {labels.view}
        </button>
      </div>

      {panel === 'view' ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-[var(--ui-body-text)]">
          {(orders || []).length === 0 ? (
            <p className="text-sm text-[var(--ui-muted)]">{labels.empty}</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 shrink-0 mb-2">
                <p className="text-xs uppercase tracking-wide text-[var(--ui-accent)] font-semibold">{labels.listTitle}</p>
              </div>
              <div className="flex text-[10px] uppercase tracking-wide text-[var(--ui-muted)] border-b border-[color:var(--ui-border)] pb-1.5 shrink-0 gap-1">
                <span className="flex-1 min-w-0 pr-1">Producto</span>
                <span className="w-[5.5rem] shrink-0 text-center">Estado</span>
                <span className="w-10 text-center shrink-0">Cant.</span>
                <span className="w-[5.25rem] text-right shrink-0">Total</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y" style={{ touchAction: 'pan-y' }} onWheel={(e) => e.stopPropagation()}>
                {rowsToShow.map((row) => {
                  const st = getStaffOrderStatusUi(row.status);
                  return (
                    <div
                      key={row.key}
                      className="flex items-center gap-1 py-1.5 border-b border-[color:var(--ui-border)] text-sm text-[var(--ui-body-text)]"
                    >
                      <span className="flex-1 min-w-0 flex items-center gap-1.5">
                        <span className="min-w-0 break-words leading-snug">{row.name}</span>
                      </span>
                      <span className="w-[5.5rem] shrink-0 flex justify-center px-0.5">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold max-w-full truncate ${st.classes}`}
                          title={st.label}
                        >
                          {st.label}
                        </span>
                      </span>
                      <span className="w-10 text-center tabular-nums text-[var(--ui-body-text)] font-medium shrink-0">{row.quantity}</span>
                      <span className="w-[5.25rem] text-right tabular-nums font-semibold text-[var(--ui-body-text)] shrink-0">
                        {formatCurrency(row.subtotal)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 pt-2 border-t border-[color:var(--ui-border)] shrink-0 flex justify-between items-center gap-3">
                <span className="text-sm font-bold text-[var(--ui-body-text)]">{labels.totalMesa}</span>
                <span className="text-lg font-bold text-[var(--ui-body-text)] tabular-nums">{formatCurrency(totalMesa)}</span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden min-w-0">{children}</div>
      )}
    </div>
  );
}
