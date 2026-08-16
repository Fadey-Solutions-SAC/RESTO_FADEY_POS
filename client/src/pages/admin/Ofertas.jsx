import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { MdAdd, MdDelete, MdLocalOffer, MdCalendarToday, MdSearch } from 'react-icons/md';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

function parseOfferProductIds(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const t = raw.trim();
  if (t.startsWith('[')) {
    try {
      const a = JSON.parse(t);
      return Array.isArray(a) ? a.map(String) : [];
    } catch {
      return [];
    }
  }
  return t.split(',').map((s) => s.trim()).filter(Boolean);
}

export default function Ofertas() {
  const [ofertas, setOfertas] = useState([]);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: 'promo',
    discount: '',
    startDate: '',
    endDate: '',
    productIds: [],
  });

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/admin-modules/offers');
      setOfertas(rows || []);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const rows = await api.get('/products?active_only=true');
      setCatalogProducts(Array.isArray(rows) ? rows : []);
    } catch {
      toast.error('No se pudo cargar el catálogo de productos');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'offers') void load();
    if (p?.domain === 'catalog') void loadCatalog();
  });
  useSocket('inventory-update', () => {
    void loadCatalog();
  });

  useEffect(() => {
    if (showModal) loadCatalog();
  }, [showModal, loadCatalog]);

  const productNameById = useMemo(() => {
    const m = {};
    catalogProducts.forEach((p) => {
      m[p.id] = p.name || p.id;
    });
    return m;
  }, [catalogProducts]);

  const filteredCatalog = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return catalogProducts;
    return catalogProducts.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q)
    );
  }, [catalogProducts, productSearch]);

  const toggleProductId = (id) => {
    setForm((prev) => {
      const set = new Set(prev.productIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, productIds: [...set] };
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin-modules/offers', {
        name: form.name,
        description: form.description,
        type: form.type,
        discount: parseFloat(form.discount),
        start_date: form.startDate,
        end_date: form.endDate,
        product_ids: form.productIds,
        active: 1,
      });
      setShowModal(false);
      setProductSearch('');
      setForm({
        name: '',
        description: '',
        type: 'promo',
        discount: '',
        startDate: '',
        endDate: '',
        productIds: [],
      });
      toast.success('Oferta creada');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (id) => {
    const current = ofertas.find((o) => o.id === id);
    if (!current) return;
    try {
      await api.put(`/admin-modules/offers/${id}`, { active: current.active ? 0 : 1 });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteOferta = async (id) => {
    if (!confirm('¿Eliminar oferta?')) return;
    try {
      await api.delete(`/admin-modules/offers/${id}`);
      toast.success('Eliminada');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const formatOfferProductsLine = (o) => {
    const ids = parseOfferProductIds(o.products);
    if (!ids.length) return 'Ninguno (o todos, según política de la oferta)';
    return ids
      .map((id) => productNameById[id] || `ID…${String(id).slice(0, 8)}`)
      .join(' · ');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold rf-page-title rf-module-page-title">Ofertas</h1>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <MdAdd /> Nueva Oferta
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <MdLocalOffer className="text-emerald-600" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Ofertas Activas</p>
            <p className="text-xl font-bold">{ofertas.filter((o) => o.active).length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
            <MdLocalOffer className="ui-text-muted" />
          </div>
          <div>
            <p className="text-xs ui-text-muted">Total Ofertas</p>
            <p className="text-xl font-bold">{ofertas.length}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {ofertas.map((o) => (
          <div
            key={o.id}
            className={`bg-white rounded-xl shadow-sm border p-5 ${o.active ? 'border-emerald-200' : 'border-slate-200 opacity-60'}`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-bold rf-section-title">{o.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${o.type === 'promo' ? 'bg-sky-100 text-sky-700' : 'bg-sky-100 text-sky-700'}`}
                  >
                    {o.type === 'promo' ? 'Promoción' : 'Combo'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${o.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 ui-text-muted'}`}
                  >
                    {o.active ? 'Activa' : 'Inactiva'}
                  </span>
                </div>
                <p className="text-sm ui-text-muted mb-2">{o.description}</p>
                <p className="text-xs text-[var(--ui-muted)]">
                  <MdCalendarToday className="inline mr-1" />
                  {o.start_date} al {o.end_date}
                </p>
                <p className="text-xs ui-text-muted mt-2 break-words">
                  <span className="font-medium text-[var(--ui-muted)]">Productos vinculados: </span>
                  {formatOfferProductsLine(o)}
                </p>
                <p className="text-[11px] text-[var(--ui-muted)] mt-1">
                  Mismos IDs que en el menú y caja: al venderse, el kardex aplica recetas/insumos de esos platos.
                </p>
              </div>
              <div className="text-right ml-4 flex-shrink-0">
                <p className="text-2xl font-bold text-gold-600">{o.discount}%</p>
                <p className="text-xs text-[var(--ui-muted)]">descuento</p>
                <div className="flex gap-2 mt-3 justify-end">
                  <button
                    type="button"
                    onClick={() => toggleActive(o.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg ${o.active ? 'bg-slate-100 text-[var(--ui-muted)]' : 'bg-emerald-50 text-emerald-600'}`}
                  >
                    {o.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteOferta(o.id)}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-[var(--ui-muted)] hover:text-red-600"
                    aria-label="Eliminar oferta"
                  >
                    <MdDelete />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setProductSearch('');
        }}
        title="Nueva Oferta"
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descripción</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field"
              rows="2"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="input-field"
              >
                <option value="promo">Promoción</option>
                <option value="combo">Combo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descuento (%)</label>
              <input
                type="number"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className="input-field"
                required
                min="0"
                max="100"
                step="0.01"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Inicio</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Fin</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="input-field"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">
              Productos aplicables (vinculados al menú / caja e inventario)
            </label>
            <p className="text-xs ui-text-muted mb-2">
              Selecciona los platos del catálogo. Al cobrarlos, se descontarán insumos vía receta como en una venta normal.
            </p>
            <div className="relative mb-2">
              <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
              <input
                type="search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="input-field pl-9"
                placeholder="Buscar por nombre o categoría…"
                autoComplete="off"
              />
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 p-2 space-y-1.5">
              {filteredCatalog.length === 0 && (
                <p className="text-sm ui-text-muted py-3 text-center">No hay productos que mostrar.</p>
              )}
              {filteredCatalog.map((p) => {
                const checked = form.productIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm ${
                      checked ? 'bg-sky-100/80 text-slate-800' : 'hover:bg-white text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProductId(p.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="font-medium truncate flex-1">{p.name}</span>
                    {p.category_name && (
                      <span className="text-xs ui-text-muted truncate max-w-[120px]">{p.category_name}</span>
                    )}
                  </label>
                );
              })}
            </div>
            <p className="text-xs ui-text-muted mt-1.5">
              Seleccionados: <strong>{form.productIds.length}</strong>
              {form.productIds.length === 0 && ' (opcional: puedes guardar sin productos)'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setShowModal(false);
                setProductSearch('');
              }}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary flex-1">
              Crear Oferta
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
