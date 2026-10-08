import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MdAdd, MdClose, MdDelete } from 'react-icons/md';
import { api, formatCurrency, formatInsumoQty, formatInsumoWithUnit, parseLocaleNumber } from '../utils/api';
import {
  isUnidadUm,
  kardexRecipeInputUnit,
  normalizeInsumoUm,
  insumoStockEnUnidades,
} from '../utils/insumoUnidadMedida';

const BASE = '/kardex-inventory';

const emptyLine = () => ({ insumo_id: '', qty: '' });

/** La receta guarda la cantidad en la U.M. de stock; en kg/L se escribe en g/ml. */
function inputFactor(um) {
  const u = normalizeInsumoUm(um);
  return u === 'kg' || u === 'L' ? 1000 : 1;
}

function toInputQty(cantidad, um) {
  const n = Number(cantidad) * inputFactor(um);
  return Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : '';
}

function areaOf(value) {
  return String(value || 'cocina').toLowerCase() === 'bar' ? 'bar' : 'cocina';
}

function insumoOptionLabel(i) {
  const um = normalizeInsumoUm(i.unidad_medida);
  if (isUnidadUm(um)) return `${i.nombre} (U) — ${formatInsumoQty(insumoStockEnUnidades(i))} U`;
  return `${i.nombre} (${um}) — ${formatInsumoWithUnit(i.stock_actual, um)}`;
}

/**
 * Formulario único de receta (Almacén → Recetas y ficha del producto).
 * Con `productId` queda vinculada a ese producto y toma su nombre; sin él, se elige el producto.
 */
export default function RecetaEditor({
  productId = '',
  productName = '',
  productPrice = null,
  productionArea = '',
  products = [],
  recetaId = '',
  insumos: insumosProp = null,
  modoFijo = '',
  onSaved,
  onCancel,
}) {
  const locked = Boolean(productId);
  const modoBloqueado = modoFijo === 'produccion' || modoFijo === 'venta' ? modoFijo : '';
  const [insumos, setInsumos] = useState(Array.isArray(insumosProp) ? insumosProp : []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentId, setCurrentId] = useState(recetaId || '');
  const [form, setForm] = useState({
    nombre_plato: String(productName || '').toUpperCase(),
    product_id: productId || '',
    activo: true,
    lines: [emptyLine()],
    modo: modoBloqueado || 'venta',
    insumo_resultado_id: '',
    rendimiento: '',
  });

  useEffect(() => {
    if (Array.isArray(insumosProp)) setInsumos(insumosProp);
  }, [insumosProp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const insList = Array.isArray(insumosProp) ? insumosProp : await api.get(`${BASE}/insumos`).catch(() => []);
        if (!cancelled && !Array.isArray(insumosProp)) setInsumos(Array.isArray(insList) ? insList : []);
        let id = recetaId;
        if (!id && productId) {
          const list = await api.get(`${BASE}/recetas?product_id=${encodeURIComponent(productId)}`);
          id = Array.isArray(list) && list[0] ? list[0].id : '';
        }
        if (!id) {
          if (!cancelled) {
            setCurrentId('');
            setForm({
              nombre_plato: String(productName || '').toUpperCase(),
              product_id: productId || '',
              activo: true,
              lines: [emptyLine()],
              modo: modoBloqueado || 'venta',
              insumo_resultado_id: '',
              rendimiento: '',
            });
          }
          return;
        }
        const r = await api.get(`${BASE}/recetas/${id}`);
        if (cancelled) return;
        setCurrentId(id);
        const catalogo = Array.isArray(insList) ? insList : [];
        const resultado = catalogo.find((i) => String(i.id) === String(r.insumo_resultado_id || ''));
        const esProduccion = Boolean(String(r.insumo_resultado_id || '').trim());
        setForm({
          nombre_plato: String(locked ? (productName || r.nombre_plato || '') : (r.nombre_plato || '')).toUpperCase(),
          product_id: locked ? productId : (r.product_id || ''),
          activo: Number(r.activo) === 1,
          lines: r.detalles?.length
            ? r.detalles.map((d) => ({ insumo_id: d.insumo_id, qty: toInputQty(d.cantidad_usada, d.unidad_medida) }))
            : [emptyLine()],
          modo: modoBloqueado || (esProduccion ? 'produccion' : 'venta'),
          insumo_resultado_id: esProduccion ? String(r.insumo_resultado_id) : '',
          rendimiento: esProduccion ? toInputQty(r.rendimiento, resultado?.unidad_medida) : '',
        });
      } catch (e) {
        if (!cancelled) toast.error(e.message || 'No se pudo cargar la receta');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recetaId, productId, productName, locked, insumosProp, modoBloqueado]);

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === String(form.product_id)),
    [products, form.product_id],
  );
  const insumoById = useMemo(() => new Map(insumos.map((i) => [String(i.id), i])), [insumos]);
  const resultadoSel = insumoById.get(String(form.insumo_resultado_id));
  const area = areaOf(
    form.modo === 'produccion' && !locked
      ? resultadoSel?.insumo_area
      : (locked ? productionArea : selectedProduct?.production_area),
  );
  const price = productPrice != null ? Number(productPrice) : Number(selectedProduct?.price || 0);

  const costRows = form.lines.map((line) => {
    const ins = insumoById.get(String(line.insumo_id));
    const q = parseLocaleNumber(line.qty);
    if (!ins || !Number.isFinite(q) || q <= 0) return 0;
    return (q / inputFactor(ins.unidad_medida)) * Number(ins.costo_promedio || 0);
  });
  const totalCost = costRows.reduce((s, v) => s + v, 0);
  const hasCost = totalCost > 0;

  const setLine = (idx, patch) => {
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  };

  const save = async (e) => {
    e.preventDefault();
    const nombre = form.nombre_plato.trim().toUpperCase();
    const esProduccion = (modoBloqueado === 'produccion' || form.modo === 'produccion') && !locked;
    if (!nombre || (!esProduccion && !form.product_id)) {
      toast.error('Nombre de la receta y producto del menú son obligatorios');
      return;
    }
    let rendimientoBase = 0;
    if (esProduccion) {
      const resultado = insumoById.get(String(form.insumo_resultado_id));
      const rendInput = parseLocaleNumber(form.rendimiento);
      const esDoble = String(resultado?.insumo_clase || '') === 'doble' || String(resultado?.tipo || '') === 'transformable';
      if (!resultado || !esDoble) {
        toast.error('Elige el insumo doble que se fabrica, por ejemplo salsa de tomate');
        return;
      }
      if (!Number.isFinite(rendInput) || rendInput <= 0) {
        toast.error('Indica cuánto rinde un lote');
        return;
      }
      rendimientoBase = rendInput / inputFactor(resultado.unidad_medida);
    }
    const detalles = [];
    for (const line of form.lines) {
      if (!line.insumo_id) continue;
      const ins = insumoById.get(String(line.insumo_id));
      const q = parseLocaleNumber(line.qty);
      if (!Number.isFinite(q) || q <= 0) {
        toast.error(`Indica la cantidad de «${ins?.nombre || 'insumo'}» (mayor a 0).`);
        return;
      }
      if (esProduccion && String(ins?.insumo_clase || 'directo') === 'doble') {
        toast.error(`«${ins.nombre}» es doble. La fabricación usa insumos directos, como el tomate.`);
        return;
      }
      detalles.push({ insumo_id: line.insumo_id, cantidad_usada: q / inputFactor(ins?.unidad_medida) });
    }
    if (!detalles.length) {
      toast.error('Agrega al menos un insumo a la receta.');
      return;
    }
    const body = {
      nombre_plato: nombre,
      product_id: esProduccion ? '' : form.product_id,
      activo: form.activo,
      detalles,
      insumo_resultado_id: esProduccion ? form.insumo_resultado_id : '',
      rendimiento: esProduccion ? rendimientoBase : 0,
    };
    setSaving(true);
    try {
      const saved = currentId
        ? await api.put(`${BASE}/recetas/${currentId}`, body)
        : await api.post(`${BASE}/recetas`, body);
      toast.success(currentId ? 'Receta actualizada' : 'Receta creada');
      setCurrentId(saved?.id || currentId);
      onSaved?.(saved, { detalles, cost: totalCost });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!currentId) return;
    if (!confirm('¿Eliminar esta receta? El producto dejará de descontar insumos al venderse.')) return;
    try {
      await api.delete(`${BASE}/recetas/${currentId}`);
      toast.success('Receta eliminada');
      setCurrentId('');
      onSaved?.(null, { detalles: [], cost: 0 });
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <p className="text-sm ui-text-muted py-4">Cargando receta…</p>;

  return (
    <form onSubmit={save} className="space-y-4">
      {!locked && !modoBloqueado && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, modo: 'venta', insumo_resultado_id: '', rendimiento: '' }))}
            className={`px-3 py-1.5 rounded-lg text-sm border ${form.modo !== 'produccion' ? 'bg-amber-500/20 border-amber-500/50 text-amber-200' : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'}`}
          >
            Descuenta al vender
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, modo: 'produccion', product_id: '' }))}
            className={`px-3 py-1.5 rounded-lg text-sm border ${form.modo === 'produccion' ? 'bg-teal-500/20 border-teal-500/50 text-teal-200' : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'}`}
          >
            Fabrica un insumo doble
          </button>
        </div>
      )}
      <p className="text-xs ui-text-muted">
        {form.modo === 'produccion' && !locked
          ? 'Ejemplo: 1000 g de tomate (directo) fabrican 500 ml de salsa (doble). Al vender un plato que usa 100 ml, solo baja la salsa. La salsa también se puede comprar ya hecha.'
          : 'Insumos que se descuentan al vender el plato. Si el plato usa una salsa doble, pon esa salsa: no vuelvas a poner el tomate.'}
        {' '}En insumos por kg o L escribe gramos o mililitros.
        {' '}Solo se listan insumos de <strong>{area}</strong>.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre de la receta</label>
          <input
            className="input-field uppercase"
            value={form.nombre_plato}
            onChange={(e) => setForm((f) => ({ ...f, nombre_plato: e.target.value.toUpperCase() }))}
            autoCapitalize="characters"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">
            {form.modo === 'produccion' && !locked ? 'Transformable que produce' : 'Producto vinculado'}
          </label>
          {form.modo === 'produccion' && !locked ? (
            <select
              className="input-field"
              value={form.insumo_resultado_id}
              onChange={(e) => setForm((f) => ({ ...f, insumo_resultado_id: e.target.value, product_id: '' }))}
            >
              <option value="">— Insumo doble —</option>
              {insumos.filter((i) => String(i.insumo_clase || '') === 'doble' || String(i.tipo || '') === 'transformable' || String(i.id) === String(form.insumo_resultado_id)).map((i) => (
                <option key={i.id} value={i.id}>{insumoOptionLabel(i)}</option>
              ))}
            </select>
          ) : locked ? (
            <input className="input-field bg-[var(--ui-surface-2)]" value={productName} readOnly />
          ) : (
            <select
              className="input-field"
              value={form.product_id}
              onChange={(e) => {
                const p = products.find((x) => String(x.id) === e.target.value);
                setForm((f) => ({
                  ...f,
                  product_id: e.target.value,
                  nombre_plato: f.nombre_plato.trim() ? f.nombre_plato : String(p?.name || '').toUpperCase(),
                }));
              }}
            >
              <option value="">— Seleccionar —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
        {form.modo === 'produccion' && !locked ? (
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">
              Rinde un lote ({resultadoSel ? (normalizeInsumoUm(resultadoSel.unidad_medida) === 'kg' ? 'g' : normalizeInsumoUm(resultadoSel.unidad_medida) === 'L' ? 'ml' : resultadoSel.unidad_medida) : 'U.M.'})
            </label>
            <input
              className="input-field"
              inputMode="decimal"
              value={form.rendimiento}
              onChange={(e) => setForm((f) => ({ ...f, rendimiento: e.target.value }))}
              placeholder={normalizeInsumoUm(resultadoSel?.unidad_medida) === 'kg' ? '10000' : '1'}
            />
          </div>
        ) : null}
        {currentId ? (
          <label className="flex items-center gap-2 text-sm pb-2">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
            />
            Activa
          </label>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--ui-body-text)]">
          {form.modo === 'produccion' && !locked ? 'Ingredientes de un lote' : 'Insumos por plato (1 servicio)'}
        </p>
        {form.lines.map((line, idx) => {
          const ins = insumoById.get(String(line.insumo_id));
          const unit = ins ? kardexRecipeInputUnit(ins.unidad_medida) : '';
          const taken = new Set(form.lines.map((l, i) => (i === idx ? '' : String(l.insumo_id))).filter(Boolean));
          const fabricaDoble = form.modo === 'produccion' && !locked;
          const options = insumos.filter((i) => {
            if (String(i.id) === String(line.insumo_id)) return true;
            if (Number(i.activo) === 0 || areaOf(i.insumo_area) !== area || taken.has(String(i.id))) return false;
            if (!fabricaDoble) return true;
            if (String(i.id) === String(form.insumo_resultado_id)) return false;
            return String(i.insumo_clase || 'directo') !== 'doble';
          });
          return (
            <div key={idx} className="space-y-1">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2 items-center">
              <select
                className="input-field text-sm"
                value={line.insumo_id}
                onChange={(e) => setLine(idx, { insumo_id: e.target.value })}
              >
                <option value="">— Insumo —</option>
                {options.map((i) => (
                  <option key={i.id} value={i.id}>{insumoOptionLabel(i)}</option>
                ))}
              </select>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm pr-9"
                  placeholder={unit === 'g' ? '250' : unit === 'ml' ? '50' : '1'}
                  value={line.qty}
                  onChange={(e) => setLine(idx, { qty: e.target.value })}
                />
                {unit ? (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs ui-text-muted">
                    {unit === 'unidad' ? 'U' : unit}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                onClick={() => setForm((f) => {
                  const next = f.lines.filter((_, i) => i !== idx);
                  return { ...f, lines: next.length ? next : [emptyLine()] };
                })}
                aria-label="Quitar insumo"
              >
                <MdClose className="text-lg" />
              </button>
            </div>
            {form.modo !== 'produccion' && String(ins?.insumo_clase || '') === 'doble' ? (
              <p className="text-[11px] text-teal-700">Al vender el plato solo se descuenta {ins.nombre}. Los directos ya salieron al fabricarla.</p>
            ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))}
        >
          <MdAdd className="text-base" />
          Agregar insumo
        </button>
      </div>

      {hasCost && (
        <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
          <span>Costo por plato: <strong>{formatCurrency(totalCost)}</strong></span>
          {price > 0 && (
            <>
              <span>Precio: <strong>{formatCurrency(price)}</strong></span>
              <span>
                Margen: <strong>{formatCurrency(price - totalCost)}</strong> ({(((price - totalCost) / price) * 100).toFixed(1)}%)
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {currentId && (
          <button
            type="button"
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50"
            onClick={remove}
          >
            <MdDelete /> Eliminar receta
          </button>
        )}
        <div className="flex-1" />
        {onCancel && (
          <button type="button" className="px-4 py-2 rounded-lg border border-[color:var(--ui-border)] text-sm" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : currentId ? 'Guardar receta' : 'Crear receta'}
        </button>
      </div>
    </form>
  );
}
