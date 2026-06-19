import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { formatCatalogNameInput } from '../../utils/catalogNameFormat';
import { useSocket } from '../../hooks/useSocket';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdEdit, MdDelete, MdToggleOn, MdToggleOff } from 'react-icons/md';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', image: '' });

  const loadData = useCallback(async () => {
    try { setCategories(await api.get('/categories')); }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'catalog') void loadData();
  });

  const openCreate = () => { setEditing(null); setForm({ name: '', description: '', image: '' }); setShowModal(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, description: c.description, image: c.image }); setShowModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/categories/${editing.id}`, form); toast.success('Categoría actualizada'); }
      else { await api.post('/categories', form); toast.success('Categoría creada'); }
      setShowModal(false);
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (c) => {
    await api.put(`/categories/${c.id}`, { is_active: c.is_active ? 0 : 1 });
    toast.success(c.is_active ? 'Categoría desactivada' : 'Categoría activada');
    loadData();
  };

  const deleteCategory = async (c) => {
    if (!confirm(`¿Eliminar "${c.name}"?`)) return;
    await api.delete(`/categories/${c.id}`);
    toast.success('Categoría eliminada');
    loadData();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Categorías</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><MdAdd /> Nueva Categoría</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map(c => (
          <div key={c.id} className={`card hover:shadow-md transition-shadow ${!c.is_active ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
                {c.image ? <img src={c.image} alt={c.name} className="w-full h-full object-cover rounded-xl" /> : <span className="text-2xl">📋</span>}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800">{c.name}</h3>
                <p className="text-sm text-gray-400 truncate">{c.description}</p>
                <p className="text-xs text-gray-400 mt-1">{c.product_count} productos</p>
              </div>
            </div>
            <div className="flex gap-1 mt-4 pt-4 border-t border-gray-50">
              <button onClick={() => openEdit(c)} className="flex-1 text-xs py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center justify-center gap-1"><MdEdit /> Editar</button>
              <button onClick={() => toggleActive(c)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                {c.is_active ? <MdToggleOn className="text-xl text-emerald-500" /> : <MdToggleOff className="text-xl text-gray-400" />}
              </button>
              <button onClick={() => deleteCategory(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"><MdDelete className="text-lg" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Categoría' : 'Nueva Categoría'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: formatCatalogNameInput(e.target.value) }))} className="input-field" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL de Imagen</label>
            <input value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} className="input-field" placeholder="https://..." />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editing ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
