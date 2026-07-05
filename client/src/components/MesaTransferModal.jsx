import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { api, formatCurrency } from '../utils/api';
import { getOrderChargeTotal } from '../utils/mesaOrderLines';
import toast from 'react-hot-toast';
import { MdSwapHoriz, MdCallMerge, MdWarning } from 'react-icons/md';

function tableIsOccupied(table) {
  return Boolean(table?.orders?.length);
}

/**
 * @param {'move_table'|'move_orders'} mode
 * - move_table: mueve toda la cuenta (todos los pedidos activos)
 * - move_orders: mueve solo los pedidos seleccionados
 */
export default function MesaTransferModal({
  open,
  onClose,
  mode,
  tables = [],
  initialSourceId = '',
  onComplete,
}) {
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [occupiedPrompt, setOccupiedPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  const sourceTable = useMemo(
    () => tables.find((t) => t.id === sourceId) || null,
    [tables, sourceId],
  );
  const targetTable = useMemo(
    () => tables.find((t) => t.id === targetId) || null,
    [tables, targetId],
  );
  const sourceOrders = sourceTable?.orders || [];

  useEffect(() => {
    if (!open) return;
    const sid = initialSourceId || '';
    setSourceId(sid);
    setTargetId('');
    setOccupiedPrompt(false);
    setBusy(false);
    if (mode === 'move_orders' && sid) {
      const orders = (tables.find((t) => t.id === sid)?.orders) || [];
      setSelectedOrderIds(orders.map((o) => o.id));
    } else {
      setSelectedOrderIds([]);
    }
  }, [open, initialSourceId, mode, tables]);

  const handleSourceChange = (nextSourceId) => {
    setSourceId(nextSourceId);
    setTargetId('');
    setOccupiedPrompt(false);
    if (mode === 'move_orders' && nextSourceId) {
      const orders = (tables.find((t) => t.id === nextSourceId)?.orders) || [];
      setSelectedOrderIds(orders.map((o) => o.id));
    } else {
      setSelectedOrderIds([]);
    }
  };

  const targetOptions = useMemo(
    () => tables.filter((t) => t.id && t.id !== sourceId),
    [tables, sourceId],
  );

  const toggleOrder = (orderId) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId],
    );
  };

  const runMove = async (confirmMerge) => {
    if (!sourceId) return toast.error('Selecciona la mesa origen');
    if (!targetId) return toast.error('Selecciona la mesa destino');
    if (sourceId === targetId) return toast.error('Origen y destino deben ser diferentes');
    const orderIds =
      mode === 'move_table'
        ? sourceOrders.map((o) => o.id)
        : selectedOrderIds.filter(Boolean);
    if (!orderIds.length) return toast.error('Selecciona al menos un pedido para mover');

    setBusy(true);
    try {
      const body = {
        source_table_id: sourceId,
        target_table_id: targetId,
        confirm_merge: Boolean(confirmMerge),
      };
      if (mode === 'move_orders') body.order_ids = orderIds;
      await api.post('/tables/move-orders', body);
      toast.success(
        confirmMerge
          ? `Cuenta unida en ${targetTable?.name || 'mesa destino'}`
          : mode === 'move_table'
            ? `Mesa movida a ${targetTable?.name || 'destino'}`
            : `${orderIds.length} pedido(s) movido(s)`,
      );
      setOccupiedPrompt(false);
      onClose?.();
      onComplete?.();
    } catch (err) {
      if (err?.code === 'TARGET_OCCUPIED') {
        setOccupiedPrompt(true);
      } else {
        toast.error(err.message || 'No se pudo completar el movimiento');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePrimaryAction = () => {
    if (targetTable && tableIsOccupied(targetTable) && !occupiedPrompt) {
      setOccupiedPrompt(true);
      return;
    }
    void runMove(occupiedPrompt);
  };

  const title = mode === 'move_table' ? 'Mover mesa' : 'Mover pedidos';
  const isMoveTable = mode === 'move_table';

  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--ui-muted)]">
          {isMoveTable
            ? 'Traslada toda la cuenta (todos los pedidos activos) a otra mesa.'
            : 'Selecciona los pedidos cuyos productos deseas enviar a otra mesa.'}
        </p>

        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Mesa origen</label>
          <select
            value={sourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="input-field"
          >
            <option value="">Seleccionar…</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{tableIsOccupied(t) ? ' (ocupada)' : ' (libre)'}
              </option>
            ))}
          </select>
        </div>

        {mode === 'move_orders' && sourceOrders.length > 0 && (
          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2 max-h-52 overflow-y-auto">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)]">
              Pedidos de la cuenta
            </p>
            {sourceOrders.map((order) => {
              const checked = selectedOrderIds.includes(order.id);
              const items = order.items || [];
              return (
                <label
                  key={order.id}
                  className={`flex gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                    checked
                      ? 'border-sky-500/50 bg-sky-500/10'
                      : 'border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOrder(order.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm font-medium text-[var(--ui-body-text)]">
                      <span>Pedido #{order.order_number || '—'}</span>
                      <span className="tabular-nums">{formatCurrency(getOrderChargeTotal(order))}</span>
                    </div>
                    <ul className="mt-1 text-xs text-[var(--ui-muted)] space-y-0.5">
                      {items.length ? (
                        items.map((it) => (
                          <li key={it.id}>
                            {Number(it.quantity || 0)}× {it.product_name}
                          </li>
                        ))
                      ) : (
                        <li>Sin líneas</li>
                      )}
                    </ul>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {isMoveTable && sourceTable && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-[var(--ui-body-text)]">
            Se moverán <strong>{sourceOrders.length}</strong> pedido(s) ·{' '}
            <strong>{formatCurrency(sourceOrders.reduce((s, o) => s + getOrderChargeTotal(o), 0))}</strong>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Mesa destino</label>
          <select
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              setOccupiedPrompt(false);
            }}
            className="input-field"
            disabled={!sourceId}
          >
            <option value="">Seleccionar…</option>
            {targetOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{tableIsOccupied(t) ? ` (ocupada · ${t.orders.length} ped.)` : ' (libre)'}
              </option>
            ))}
          </select>
        </div>

        {occupiedPrompt && targetTable && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
              <MdWarning className="text-xl shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold">La mesa {targetTable.name} está ocupada</p>
                <p className="mt-1 text-[var(--ui-muted)]">
                  Tiene {targetTable.orders?.length || 0} pedido(s) activo(s). Puede unir la cuenta movida con la
                  cuenta existente en esa mesa.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1" disabled={busy}>
            Cancelar
          </button>
          {occupiedPrompt ? (
            <button
              type="button"
              onClick={() => void runMove(true)}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
            >
              <MdCallMerge /> Unir cuentas
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={busy || !sourceId || !targetId}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-50 ${
                isMoveTable
                  ? 'bg-sky-600 hover:bg-sky-700'
                  : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              <MdSwapHoriz />
              {isMoveTable ? 'Mover mesa' : 'Mover seleccionados'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
