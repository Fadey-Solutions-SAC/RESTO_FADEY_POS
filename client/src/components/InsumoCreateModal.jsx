import { useState, useEffect, useId } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { api, parseLocaleNumber } from '../utils/api';
import { formatCatalogNameInput } from '../utils/catalogNameFormat';
import { MdAdd } from 'react-icons/md';

const emptyForm = () => ({
  nombre: '',
  unidad_medida: '',
  precio_compra: '',
  cantidad_inicial: '0',
  minimo_unidades: '0',
  minimo_kg: '0',
  activo: true,
});

/**
 * Mismo flujo de alta que la pestaña Insumos de Inventario y kardex (POST /kardex-inventory/insumos).
 */
export default function InsumoCreateModal({ isOpen, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const datalistId = useId();

  useEffect(() => {
    if (isOpen) setForm(emptyForm());
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const ci = parseLocaleNumber(form.cantidad_inicial);
      const mu = parseLocaleNumber(form.minimo_unidades);
      const mk = parseLocaleNumber(form.minimo_kg);
      const rawPrecio = String(form.precio_compra ?? '').trim();
      const pCompra = rawPrecio === '' ? 0 : parseLocaleNumber(rawPrecio);
      if (rawPrecio !== '' && !Number.isFinite(pCompra)) {
        toast.error('Precio de compra: número no válido (S/ por kg, L, etc.)');
        return;
      }
      if (pCompra < 0) {
        toast.error('El precio de compra no puede ser negativo');
        return;
      }
      const umed = String(form.unidad_medida || '')
        .replace(/[0-9]/g, '')
        .trim();
      const payload = {
        nombre: form.nombre.trim(),
        unidad_medida: umed,
        costo_promedio: pCompra,
        cantidad_inicial: Number.isFinite(ci) && ci >= 0 ? ci : 0,
        minimo_unidades: Number.isFinite(mu) && mu >= 0 ? mu : 0,
        stock_minimo: Number.isFinite(mk) && mk >= 0 ? mk : 0,
        activo: form.activo,
      };
      await api.post('/kardex-inventory/insumos', payload);
      toast.success('Insumo creado');
      onClose();
      onSaved?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo crear el insumo');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo insumo" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4 modal-sheet-body">
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
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">U.M. kg / L</label>
            <input
              className="input-field text-sm py-1.5 w-full"
              list={datalistId}
              autoComplete="off"
              value={form.unidad_medida}
              onChange={(e) => setForm((f) => ({ ...f, unidad_medida: e.target.value.replace(/[0-9]/g, '') }))}
            />
            <datalist id={datalistId}>
              <option value="" />
              <option value="kg" />
              <option value="g" />
              <option value="L" />
              <option value="ml" />
              <option value="t" />
            </datalist>
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
            />
          </div>
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Cant. inicial</label>
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
              className="input-field text-sm py-1.5 w-full"
              value={form.minimo_unidades}
              onChange={(e) => setForm((f) => ({ ...f, minimo_unidades: e.target.value }))}
            />
          </div>
          <div className="w-[5.5rem]">
            <label className="block text-xs text-[#9CA3AF] mb-0.5">Mín. kg / L</label>
            <input
              type="text"
              inputMode="decimal"
              className="input-field text-sm py-1.5 w-full"
              value={form.minimo_kg}
              onChange={(e) => setForm((f) => ({ ...f, minimo_kg: e.target.value }))}
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
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancelar
          </button>
          <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-1">
            <MdAdd /> Agregar
          </button>
        </div>
      </form>
    </Modal>
  );
}
