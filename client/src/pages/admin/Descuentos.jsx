import { useEffect, useState, useCallback } from 'react';
import { api } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { MdAdd, MdEdit, MdDelete, MdDiscount } from 'react-icons/md';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

export default function Descuentos() {
  const [descuentos, setDescuentos] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'percentage', value: '', appliesTo: 'all', conditions: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/admin-modules/discounts');
      setDescuentos(rows || []);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'discounts') void load();
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin-modules/discounts', {
        name: form.name,
        type: form.type,
        value: parseFloat(form.value),
        applies_to: form.appliesTo,
        conditions: form.conditions,
        active: 1,
      });
      setShowModal(false);
      setForm({ name: '', type: 'percentage', value: '', appliesTo: 'all', conditions: '' });
      toast.success('Descuento creado');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleActive = async (id) => {
    const current = descuentos.find(d => d.id === id);
    if (!current) return;
    try {
      await api.put(`/admin-modules/discounts/${id}`, { active: current.active ? 0 : 1 });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };
  const deleteDesc = (id) => {
    const current = descuentos.find((d) => d.id === id);
    if (!current) return;
    setDeleteTarget(current);
    setAdminPassword('');
  };

  const confirmDeleteDesc = async () => {
    if (!deleteTarget) return;
    const pwd = String(adminPassword || '').trim();
    if (!pwd) return toast.error('Ingrese la contraseña de administrador');
    setDeleteBusy(true);
    try {
      await api.delete(`/admin-modules/discounts/${deleteTarget.id}`, { admin_password: pwd });
      toast.success('Eliminado');
      setDeleteTarget(null);
      setAdminPassword('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-5">
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><MdAdd /> Nuevo Descuento</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="card flex items-center gap-3"><div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center"><MdDiscount className="text-emerald-600" /></div><div><p className="text-xs ui-text-muted">Descuentos Activos</p><p className="text-xl font-bold">{descuentos.filter(d => d.active).length}</p></div></div>
        <div className="card flex items-center gap-3"><div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center"><MdDiscount className="ui-text-muted" /></div><div><p className="text-xs ui-text-muted">Total</p><p className="text-xl font-bold">{descuentos.length}</p></div></div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="space-y-3">
          {descuentos.map(d => (
            <div key={d.id} className={`flex items-center justify-between p-4 rounded-lg border ${d.active ? 'border-slate-100' : 'border-slate-100 opacity-50'}`}>
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${d.active ? 'bg-gold-100' : 'bg-slate-100'}`}>
                  <span className={`text-lg font-bold ${d.active ? 'text-gold-700' : 'ui-text-muted'}`}>
                    {d.type === 'percentage' ? `${d.value}%` : `S/${d.value}`}
                  </span>
                </div>
                <div>
                  <p className="font-bold rf-section-title">{d.name}</p>
                  <p className="text-sm ui-text-muted">{d.conditions}</p>
                  <p className="text-xs text-[var(--ui-muted)]">Aplica a: {d.applies_to === 'all' ? 'Todos los productos' : 'Total de la cuenta'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleActive(d.id)} className={`text-xs px-3 py-1.5 rounded-lg ${d.active ? 'bg-slate-100 text-[var(--ui-muted)] hover:bg-slate-200' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>{d.active ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => deleteDesc(d.id)} className="p-2 hover:bg-red-50 rounded-lg text-[var(--ui-muted)] hover:text-red-600"><MdDelete /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nuevo Descuento" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Tipo</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-field"><option value="percentage">Porcentaje (%)</option><option value="fixed">Monto Fijo (S/)</option></select></div>
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Valor</label><input type="number" step="0.01" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} className="input-field" required /></div>
          </div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Aplica a</label><select value={form.appliesTo} onChange={e => setForm({ ...form, appliesTo: e.target.value })} className="input-field"><option value="all">Todos los productos</option><option value="total">Total de la cuenta</option></select></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Condiciones</label><textarea value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} className="input-field" rows="2" placeholder="Condiciones para aplicar el descuento" /></div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">Crear</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => { if (!deleteBusy) { setDeleteTarget(null); setAdminPassword(''); } }} title="Eliminar descuento" size="sm">
        <div className="space-y-4">
          <p className="text-sm ui-text-muted">
            Se eliminará permanentemente «<span className="font-semibold text-[var(--ui-body-text)]">{deleteTarget?.name}</span>».
            Ingrese la contraseña de un administrador para confirmar.
          </p>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Contraseña admin</label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="input-field"
              autoFocus
              disabled={deleteBusy}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setDeleteTarget(null); setAdminPassword(''); }} className="btn-secondary flex-1" disabled={deleteBusy}>Cancelar</button>
            <button type="button" onClick={() => void confirmDeleteDesc()} className="btn-primary flex-1 bg-red-600 hover:bg-red-700" disabled={deleteBusy}>
              {deleteBusy ? 'Eliminando…' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
