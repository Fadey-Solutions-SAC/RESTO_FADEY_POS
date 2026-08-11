import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { api, parseLocaleNumber } from '../utils/api';
import { formatCatalogNameInput } from '../utils/catalogNameFormat';
import {
  INSUMO_UM_OPTIONS,
  isMasaOrLitrajeUm,
  isUnidadUm,
  normalizeInsumoUm,
} from '../utils/insumoUnidadMedida';
import { MdAdd, MdSave } from 'react-icons/md';

const emptyForm = () => ({
  nombre: '',
  unidad_medida: 'unidad',
  precio_compra: '',
  cantidad_inicial: '0',
  minimo_unidades: '0',
  minimo_kg: '0',
  activo: true,
  insumo_area: 'cocina',
});

function formFromInsumo(row) {
  if (!row) return emptyForm();
  const um = normalizeInsumoUm(row.unidad_medida);
  const masa = isMasaOrLitrajeUm(um);
  const und = isUnidadUm(um);
  return {
    nombre: String(row.nombre || ''),
    unidad_medida: um,
    precio_compra: String(Number(row.costo_promedio || 0)),
    cantidad_inicial: String(Number(row.stock_actual || 0)),
    minimo_unidades: masa ? '0' : String(Number(row.minimo_unidades || 0)),
    minimo_kg: und ? '0' : String(Number(row.stock_minimo || 0)),
    activo: Number(row.activo) !== 0,
    insumo_area: String(row.insumo_area || 'cocina').toLowerCase() === 'bar' ? 'bar' : 'cocina',
  };
}

/**
 * Alta/edición de insumo (mismo API que Inventario y kardex).
 * POST/PUT /kardex-inventory/insumos
 */
export default function InsumoCreateModal({ isOpen, onClose, onSaved, insumo = null }) {
  const [form, setForm] = useState(emptyForm);
  const editingId = insumo?.id ? String(insumo.id) : '';
  const isEdit = Boolean(editingId);
  const minUnidadesBloqueado = isMasaOrLitrajeUm(form.unidad_medida);
  const minCantidadBloqueado = isUnidadUm(form.unidad_medida);

  useEffect(() => {
    if (!isOpen) return;
    setForm(insumo ? formFromInsumo(insumo) : emptyForm());
  }, [isOpen, insumo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const ci = parseLocaleNumber(form.cantidad_inicial);
      const mu = parseLocaleNumber(form.minimo_unidades);
      const mk = parseLocaleNumber(form.minimo_kg);
      const rawPrecio = String(form.precio_compra ?? '').trim();
      const pCompra = rawPrecio === '' ? 0 : parseLocaleNumber(rawPrecio);
      if (rawPrecio !== '' && !Number.isFinite(pCompra)) {
        toast.error('Precio de compra: número no válido');
        return;
      }
      if (pCompra < 0) {
        toast.error('El precio de compra no puede ser negativo');
        return;
      }
      const umed = normalizeInsumoUm(form.unidad_medida);
      const masa = isMasaOrLitrajeUm(umed);
      const und = isUnidadUm(umed);
      const payload = {
        nombre: form.nombre.trim(),
        unidad_medida: umed,
        costo_promedio: pCompra,
        cantidad_inicial: Number.isFinite(ci) && ci >= 0 ? ci : 0,
        minimo_unidades: masa ? 0 : (Number.isFinite(mu) && mu >= 0 ? mu : 0),
        stock_minimo: und ? 0 : (Number.isFinite(mk) && mk >= 0 ? mk : 0),
        activo: form.activo,
        insumo_area: form.insumo_area === 'bar' ? 'bar' : 'cocina',
      };
      if (isEdit) {
        await api.put(`/kardex-inventory/insumos/${editingId}`, payload);
        toast.success('Insumo actualizado');
      } else {
        await api.post('/kardex-inventory/insumos', payload);
        toast.success('Insumo creado');
      }
      onClose();
      onSaved?.();
    } catch (err) {
      toast.error(err.message || (isEdit ? 'No se pudo actualizar el insumo' : 'No se pudo crear el insumo'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar insumo' : 'Nuevo insumo'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4 modal-sheet-body">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, insumo_area: 'cocina' }))}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
              form.insumo_area === 'cocina'
                ? 'bg-sky-600/90 text-white border-sky-500'
                : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)]'
            }`}
          >
            Cocina
          </button>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, insumo_area: 'bar' }))}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
              form.insumo_area === 'bar'
                ? 'bg-indigo-600/90 text-white border-indigo-500'
                : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)]'
            }`}
          >
            Bar
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[10rem] flex-1">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Insumo</label>
            <input
              className="input-field text-sm py-1.5 w-full"
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: formatCatalogNameInput(e.target.value) }))}
              required
            />
          </div>
          <div className="w-[8.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">U.M.</label>
            <select
              className="input-field text-sm py-1.5 w-full"
              value={normalizeInsumoUm(form.unidad_medida)}
              onChange={(e) => {
                const um = normalizeInsumoUm(e.target.value);
                setForm((f) => ({
                  ...f,
                  unidad_medida: um,
                  minimo_unidades: isMasaOrLitrajeUm(um) ? '0' : f.minimo_unidades,
                  minimo_kg: isUnidadUm(um) ? '0' : f.minimo_kg,
                }));
              }}
            >
              {INSUMO_UM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[6.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Precio compra</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field text-sm py-1.5 w-full"
              value={form.precio_compra}
              onChange={(e) => setForm((f) => ({ ...f, precio_compra: e.target.value }))}
              placeholder="0,00"
              title="Costo por unidad de medida (ej. por cada alita)"
            />
          </div>
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">{isEdit ? 'Cant. actual' : 'Cant. inicial'}</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field text-sm py-1.5 w-full"
              value={form.cantidad_inicial}
              onChange={(e) => setForm((f) => ({ ...f, cantidad_inicial: e.target.value }))}
            />
          </div>
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Mín. (U)</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field text-sm py-1.5 w-full disabled:opacity-50 disabled:cursor-not-allowed"
              value={minUnidadesBloqueado ? '0' : form.minimo_unidades}
              onChange={(e) => setForm((f) => ({ ...f, minimo_unidades: e.target.value }))}
              disabled={minUnidadesBloqueado}
              title={
                minUnidadesBloqueado
                  ? 'Con U.M. de peso o litraje, use solo Mín. cantidad'
                  : 'Mínimo en unidades (ej. alitas)'
              }
            />
          </div>
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Mín. cantidad</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field text-sm py-1.5 w-full disabled:opacity-50 disabled:cursor-not-allowed"
              value={minCantidadBloqueado ? '0' : form.minimo_kg}
              onChange={(e) => setForm((f) => ({ ...f, minimo_kg: e.target.value }))}
              disabled={minCantidadBloqueado}
              title={
                minCantidadBloqueado
                  ? 'Con U.M. Unidad, use solo Mín. (U)'
                  : 'Mínimo en la U.M. de peso o litraje'
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#E5E7EB] pb-0.5 whitespace-nowrap">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
            />
            Activo
          </label>
        </div>
        <p className="text-xs text-[var(--ui-muted)]">
          Precio = costo por 1 U.M. Si el plato usa 3 unidades a S/ 3 c/u, el costo del plato es S/ 9 (inversión / gasto operativo al vender).
        </p>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancelar
          </button>
          <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-1">
            {isEdit ? (
              <>
                <MdSave /> Guardar
              </>
            ) : (
              <>
                <MdAdd /> Agregar
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
