import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { formatCatalogNameInput } from '../../utils/catalogNameFormat';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdDelete, MdViewList, MdGridView, MdSearch, MdInventory, MdWarning } from 'react-icons/md';

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('card');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', price: '', stock: 100, category_id: '' });

  const loadData = useCallback(async () => {
    try {
      const [prods, cats] = await Promise.all([
        api.get('/products'),
        api.get('/categories/active'),
      ]);
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

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await api.post('/products', {
        ...form,
        price: parseFloat(form.price),
        stock: parseInt(form.stock),
      });
      toast.success('Producto agregado');
      setShowAddModal(false);
      setForm({ name: '', description: '', price: '', stock: 100, category_id: '' });
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (product) => {
    if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.delete(`/products/${product.id}`);
      toast.success('Producto eliminado');
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const lowStockCount = products.filter(p => p.stock <= 10).length;

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Inventario</h1>
          <p className="text-sm text-gray-500 mt-1">{products.length} productos registrados</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2">
          <MdAdd className="text-xl" /> Agregar Producto
        </button>
      </div>

      {lowStockCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <MdWarning className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800">Stock Bajo</p>
            <p className="text-sm text-amber-600">{lowStockCount} producto(s) con stock menor a 10 unidades</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="relative flex-1 max-w-md">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="input-field pl-10" />
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setView('card')} className={`p-2 rounded-lg transition-colors ${view === 'card' ? 'bg-white shadow text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <MdGridView className="text-xl" />
          </button>
          <button onClick={() => setView('list')} className={`p-2 rounded-lg transition-colors ${view === 'list' ? 'bg-white shadow text-primary-600' : 'text-gray-400 hover:text-gray-600'}`}>
            <MdViewList className="text-xl" />
          </button>
        </div>
      </div>

      {view === 'card' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow group">
              <div className="aspect-square bg-gray-50 flex items-center justify-center text-4xl">
                {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : '🍽️'}
              </div>
              <div className="p-3">
                <p className="font-medium text-sm truncate">{p.name}</p>
                <p className="text-xs text-gray-400 truncate">{p.category_name || 'Sin categoría'}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-primary-600 font-bold text-sm">{formatCurrency(p.price)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.stock <= 5 ? 'bg-red-100 text-red-700' : p.stock <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {p.stock} u.
                  </span>
                </div>
                <button onClick={() => handleDelete(p)} className="mt-2 w-full text-xs py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1">
                  <MdDelete /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Producto</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Categoría</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Precio</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Stock</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-lg flex-shrink-0">
                        {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover rounded-lg" /> : '🍽️'}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{p.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-500">{p.category_name || '—'}</td>
                  <td className="py-3 px-4 text-sm font-bold text-right">{formatCurrency(p.price)}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${p.stock <= 5 ? 'bg-red-100 text-red-700' : p.stock <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {p.stock} unid.
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button onClick={() => handleDelete(p)} className="text-xs px-3 py-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg flex items-center gap-1 mx-auto">
                      <MdDelete /> Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="5" className="text-center py-8 text-gray-400">No se encontraron productos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Agregar Producto" size="md">
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: formatCatalogNameInput(e.target.value) })} className="input-field" required placeholder="Nombre del producto" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input-field" placeholder="Descripción breve" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio (S/)</label>
              <input type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="input-field" required min="0" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
              <input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} className="input-field" required min="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
            <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="input-field">
              <option value="">Sin categoría</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">Agregar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
