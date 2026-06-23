import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { isProductLowStock } from '../../utils/productStockDisplay';
import { formatCatalogNameInput } from '../../utils/catalogNameFormat';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdEdit, MdDelete, MdSearch, MdToggleOn, MdToggleOff } from 'react-icons/md';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [form, setForm] = useState({ name: '', description: '', price: '', category_id: '', stock: '', image: '', variants: [] });

  const loadData = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([api.get('/products'), api.get('/categories')]);
      setProducts(prods);
      setCategories(cats);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'catalog') void loadData();
  });
  useSocket('inventory-update', () => {
    void loadData();
  });

  const openCreate = () => {
    setEditingProduct(null);
    setForm({ name: '', description: '', price: '', category_id: categories[0]?.id || '', stock: '100', image: '', variants: [] });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditingProduct(p);
    setForm({ name: p.name, description: p.description, price: String(p.price), category_id: p.category_id, stock: String(p.stock), image: p.image, variants: p.variants || [] });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form, price: parseFloat(form.price), stock: parseInt(form.stock) };
      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, payload);
        toast.success('Producto actualizado');
      } else {
        await api.post('/products', payload);
        toast.success('Producto creado');
      }
      setShowModal(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (p) => {
    await api.put(`/products/${p.id}`, { is_active: p.is_active ? 0 : 1 });
    toast.success(p.is_active ? 'Producto desactivado' : 'Producto activado');
    loadData();
  };

  const deleteProduct = async (p) => {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return;
    await api.delete(`/products/${p.id}`);
    toast.success('Producto eliminado');
    loadData();
  };

  const addVariant = () => setForm(f => ({ ...f, variants: [...f.variants, { name: '', price_modifier: 0 }] }));
  const removeVariant = (i) => setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }));
  const updateVariant = (i, field, value) => {
    setForm(f => ({ ...f, variants: f.variants.map((v, idx) => idx === i ? { ...v, [field]: value } : v) }));
  };

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat && p.category_id !== filterCat) return false;
    return true;
  });

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Productos</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><MdAdd /> Nuevo Producto</button>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar productos..." className="input-field pl-10" />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input-field w-auto">
            <option value="">Todas las categorías</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(p => (
          <div key={p.id} className={`card hover:shadow-md transition-shadow ${!p.is_active ? 'opacity-50' : ''}`}>
            <div className="aspect-video bg-gray-100 rounded-lg mb-3 flex items-center justify-center overflow-hidden">
              {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-4xl">🍽️</span>}
            </div>
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-bold text-gray-800 text-sm flex-1">{p.name}</h3>
              <span className="text-primary-600 font-bold text-sm ml-2">{formatCurrency(p.price)}</span>
            </div>
            <p className="text-xs text-gray-400 mb-2 line-clamp-2">{p.description}</p>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
              <span className="badge bg-gray-100 text-gray-600">{p.category_name}</span>
              <span className={isProductLowStock(p.stock, p.min_stock) ? 'text-red-500 font-bold' : ''}>Stock: {p.stock}</span>
            </div>
            <div className="flex gap-1">
              <button onClick={() => openEdit(p)} className="flex-1 text-xs py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"><MdEdit /> Editar</button>
              <button onClick={() => toggleActive(p)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" title={p.is_active ? 'Desactivar' : 'Activar'}>
                {p.is_active ? <MdToggleOn className="text-xl text-emerald-500" /> : <MdToggleOff className="text-xl text-gray-400" />}
              </button>
              <button onClick={() => deleteProduct(p)} className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-red-400 hover:text-red-600"><MdDelete className="text-lg" /></button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && <div className="text-center py-12 text-gray-400">No se encontraron productos</div>}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingProduct ? 'Editar Producto' : 'Nuevo Producto'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: formatCatalogNameInput(e.target.value) }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
              <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className="input-field">
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio *</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
              <input type="number" value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} className="input-field" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL de Imagen</label>
            <input value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} className="input-field" placeholder="https://..." />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Variantes</label>
              <button type="button" onClick={addVariant} className="text-xs text-primary-600 hover:text-primary-700 font-medium">+ Agregar variante</button>
            </div>
            {form.variants.map((v, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={v.name} onChange={e => updateVariant(i, 'name', e.target.value)} placeholder="Ej: Grande" className="input-field flex-1" />
                <input type="number" step="0.01" value={v.price_modifier} onChange={e => updateVariant(i, 'price_modifier', parseFloat(e.target.value) || 0)} placeholder="+Precio" className="input-field w-28" />
                <button type="button" onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600 px-2"><MdDelete /></button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editingProduct ? 'Guardar Cambios' : 'Crear Producto'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
