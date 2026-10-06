import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { api, formatCurrency } from '../utils/api';
import toast from 'react-hot-toast';
import { MdSwapHoriz, MdCallMerge, MdWarning, MdAdd, MdRemove } from 'react-icons/md';
import { billLineKey, billLineDisplayName } from '../utils/mesaOrderLines';

function tableIsOccupied(table) {
  return Boolean(table?.orders?.length);
}

function itemLineSubtotal(item) {
  const qty = Number(item.quantity || 0);
  const unit = Number(item.unit_price ?? 0);
  return Number(item.subtotal != null ? item.subtotal : unit * qty);
}

/** La mesa es una cuenta: la misma línea de producto de varias comandas se lista una sola vez. */
function groupSourceLines(orders) {
  const m = new Map();
  for (const order of orders || []) {
    for (const item of order.items || []) {
      if (!item?.id) continue;
      const qty = Math.max(0, Math.floor(Number(item.quantity || 0)));
      if (qty <= 0) continue;
      const key = billLineKey(item);
      if (!m.has(key)) {
        m.set(key, { key, name: billLineDisplayName(item), quantity: 0, subtotal: 0, items: [] });
      }
      const row = m.get(key);
      row.quantity += qty;
      row.subtotal += itemLineSubtotal(item);
      row.items.push({ id: item.id, quantity: qty });
    }
  }
  return [...m.values()];
}

/** Convierte unidades elegidas por fila en ids de ítem + cantidades parciales para el servidor. */
function buildItemMovePayload(lines, qtyByKey) {
  const ids = [];
  const quantities = {};
  for (const line of lines) {
    let remaining = Number(qtyByKey[line.key] || 0);
    for (const it of line.items) {
      if (remaining <= 0) break;
      const take = Math.min(it.quantity, remaining);
      ids.push(it.id);
      if (take < it.quantity) quantities[it.id] = take;
      remaining -= take;
    }
  }
  return { ids, quantities };
}

/**
 * @param {'move_table'|'move_orders'} mode
 * - move_table: mueve toda la cuenta (todos los pedidos activos)
 * - move_orders: mueve solo los productos seleccionados (línea por línea)
 */
export default function MesaTransferModal({
  open,
  onClose,
  mode,
  tables = [],
  initialSourceId = '',
  /** En Mesas: siempre elegir origen y destino (sin prellenar). */
  pickSourceAndTarget = false,
  onComplete,
}) {
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [selectedQtyByKey, setSelectedQtyByKey] = useState({});
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

  const sourceLines = useMemo(() => groupSourceLines(sourceOrders), [sourceOrders]);
  const selectedUnits = useMemo(
    () => sourceLines.reduce((n, line) => n + Number(selectedQtyByKey[line.key] || 0), 0),
    [sourceLines, selectedQtyByKey],
  );

  const sourceOptions = useMemo(() => {
    if (pickSourceAndTarget) {
      return tables.filter((t) => t.id && tableIsOccupied(t));
    }
    return tables.filter((t) => t.id);
  }, [tables, pickSourceAndTarget]);

  const initKeyRef = useRef('');

  useEffect(() => {
    if (!open) {
      initKeyRef.current = '';
      return;
    }
    const initKey = `${mode}|${initialSourceId}|${pickSourceAndTarget}`;
    if (initKeyRef.current === initKey) return;
    initKeyRef.current = initKey;

    const sid = pickSourceAndTarget ? '' : (initialSourceId || '');
    setSourceId(sid);
    setTargetId('');
    setOccupiedPrompt(false);
    setBusy(false);
    setSelectedQtyByKey({});
  }, [open, initialSourceId, mode, pickSourceAndTarget]);

  const handleSourceChange = (nextSourceId) => {
    setSourceId(nextSourceId);
    setTargetId('');
    setOccupiedPrompt(false);
    setSelectedQtyByKey({});
  };

  const targetOptions = useMemo(
    () => tables.filter((t) => t.id && t.id !== sourceId),
    [tables, sourceId],
  );

  const setLineQty = (line, nextQty) => {
    const qty = Math.max(0, Math.min(line.quantity, Math.floor(Number(nextQty) || 0)));
    setSelectedQtyByKey((prev) => {
      const next = { ...prev };
      if (qty > 0) next[line.key] = qty;
      else delete next[line.key];
      return next;
    });
  };

  const toggleLine = (line) => {
    setLineQty(line, selectedQtyByKey[line.key] ? 0 : line.quantity);
  };

  const runMove = async (confirmMerge) => {
    if (!sourceId) return toast.error('Selecciona la mesa origen');
    if (!targetId) return toast.error('Selecciona la mesa destino');
    if (sourceId === targetId) return toast.error('Origen y destino deben ser diferentes');

    if (mode === 'move_orders') {
      if (!selectedUnits) return toast.error('Selecciona al menos un producto para mover');
    }

    setBusy(true);
    try {
      const body = {
        source_table_id: sourceId,
        target_table_id: targetId,
        confirm_merge: Boolean(confirmMerge),
      };
      if (mode === 'move_orders') {
        const { ids, quantities } = buildItemMovePayload(sourceLines, selectedQtyByKey);
        body.order_item_ids = ids;
        if (Object.keys(quantities).length) body.order_item_quantities = quantities;
      }
      await api.post('/tables/move-orders', body);
      toast.success(
        confirmMerge
          ? `Cuenta unida en ${targetTable?.name || 'mesa destino'}`
          : mode === 'move_table'
            ? `Mesa movida a ${targetTable?.name || 'destino'}`
            : `${selectedUnits} producto(s) movido(s)`,
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
          {pickSourceAndTarget
            ? 'Seleccione la mesa origen y la mesa destino antes de confirmar la acción.'
            : isMoveTable
              ? 'Traslada toda la cuenta (todos los productos activos) a otra mesa.'
              : 'Selecciona los productos de la cuenta que deseas enviar a otra mesa.'}
        </p>

        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Mesa origen</label>
          <select
            value={sourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="input-field"
          >
            <option value="">Seleccionar mesa origen…</option>
            {sourceOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {pickSourceAndTarget
                  ? ` · ${(t.orders || []).reduce(
                    (n, o) => n + (o.items || []).reduce((s, it) => s + Number(it.quantity || 0), 0),
                    0,
                  )} producto(s)`
                  : tableIsOccupied(t)
                    ? ' (ocupada)'
                    : ' (libre)'}
              </option>
            ))}
          </select>
          {pickSourceAndTarget && sourceOptions.length === 0 && (
            <p className="mt-1 text-xs text-[var(--ui-muted)]">No hay mesas con productos activos.</p>
          )}
        </div>

        {mode === 'move_orders' && sourceLines.length > 0 && (
          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2 max-h-52 overflow-y-auto">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)]">
              Productos de la cuenta
            </p>
            {sourceLines.map((line) => {
              const picked = Number(selectedQtyByKey[line.key] || 0);
              const checked = picked > 0;
              return (
                <div
                  key={line.key}
                  className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${
                    checked
                      ? 'border-sky-500/50 bg-sky-500/10'
                      : 'border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
                  }`}
                >
                  <label className="min-w-0 flex-1 flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLine(line)}
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 flex justify-between gap-2 text-sm text-[var(--ui-body-text)]">
                      <span className="min-w-0 break-words">
                        {line.quantity}× {line.name}
                      </span>
                      <span className="tabular-nums shrink-0">{formatCurrency(line.subtotal)}</span>
                    </span>
                  </label>
                  {checked && line.quantity > 1 ? (
                    <div className="flex shrink-0 items-center gap-1" aria-label="Cantidad a mover">
                      <button
                        type="button"
                        onClick={() => setLineQty(line, picked - 1)}
                        className="rounded-md border border-[color:var(--ui-border)] p-1 text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                        aria-label="Mover una unidad menos"
                      >
                        <MdRemove />
                      </button>
                      <span className="w-10 text-center text-sm font-semibold tabular-nums text-[var(--ui-body-text)]">
                        {picked}/{line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLineQty(line, picked + 1)}
                        disabled={picked >= line.quantity}
                        className="rounded-md border border-[color:var(--ui-border)] p-1 text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] disabled:opacity-40"
                        aria-label="Mover una unidad más"
                      >
                        <MdAdd />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {mode === 'move_orders' && sourceId && sourceLines.length === 0 && (
          <p className="text-sm text-[var(--ui-muted)]">La mesa no tiene productos activos.</p>
        )}

        {isMoveTable && sourceTable && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-[var(--ui-body-text)]">
            Se moverán todos los productos de la cuenta (
            <strong>{sourceLines.length}</strong> línea(s)).
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
            <option value="">Seleccionar mesa destino…</option>
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
              disabled={
                busy ||
                !sourceId ||
                !targetId ||
                (mode === 'move_orders' && selectedUnits === 0)
              }
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
