import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { api } from '../../utils/api';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdEdit, MdDelete, MdToggleOn, MdToggleOff } from 'react-icons/md';

import { UI_BADGE } from '../../utils/uiBadges';

const ROLES = { admin: 'Administrador', cajero: 'Cajero', mozo: 'Mozo', cocina: 'Cocina', bar: 'Bar', delivery: 'Delivery' };
const ROLE_COLORS = {
  admin: UI_BADGE.purple,
  cajero: UI_BADGE.blue,
  mozo: UI_BADGE.sky,
  cocina: UI_BADGE.amber,
  bar: UI_BADGE.indigo,
  delivery: UI_BADGE.emerald,
};
const EMPTY_FORM = { username: '', email: '', password: '', full_name: '', role: 'mozo', phone: '', caja_station_id: '' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    try {
      const [usersData, cfg] = await Promise.all([
        api.get('/users'),
        api.get('/admin-modules/config/app').catch(() => ({})),
      ]);
      setUsers(usersData || []);
      const s = cfg?.settings || cfg || {};
      setCajas(Array.isArray(s.cajas) ? s.cajas : []);
    }
    catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'app_config') void loadData();
  });

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (u) => {
    setEditing(u);
    setForm({
      username: u.username,
      email: u.email,
      password: '',
      full_name: u.full_name,
      role: u.role,
      phone: u.phone || '',
      caja_station_id: String(u.caja_station_id || '').trim(),
    });
    setShowModal(true);
  };

  const cajaOptionsForForm = (() => {
    const assigned = new Map();
    (users || []).forEach((u) => {
      if (String(u.role || '').toLowerCase() !== 'cajero') return;
      const cid = String(u.caja_station_id || '').trim();
      if (!cid) return;
      assigned.set(cid, u.id);
    });
    return (cajas || [])
      .filter((c) => Number(c?.active || 0) === 1 && String(c?.id || '').trim())
      .filter((c) => {
        const uid = assigned.get(String(c.id).trim());
        return !uid || uid === editing?.id;
      })
      .map((c) => ({ id: String(c.id).trim(), name: String(c.name || '').trim() || 'Caja' }));
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        caja_station_id:
          String(form.role || '').toLowerCase() === 'cajero' ? String(form.caja_station_id || '').trim() : '',
      };
      if (!payload.password) delete payload.password;
      if (editing) {
        await api.put(`/users/${editing.id}`, payload);
        toast.success('Usuario actualizado');
      } else {
        await api.post('/users', payload);
        toast.success('Usuario creado');
      }
      closeModal();
      loadData();
    } catch (err) { toast.error(err.message); }
  };

  const toggleActive = async (u) => {
    await api.put(`/users/${u.id}`, { is_active: u.is_active ? 0 : 1 });
    toast.success(u.is_active ? 'Usuario desactivado' : 'Usuario activado');
    loadData();
  };

  const deleteUser = async (u) => {
    if (!confirm(`¿Eliminar "${u.full_name}"?`)) return;
    try { await api.delete(`/users/${u.id}`); toast.success('Usuario eliminado'); loadData(); }
    catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Usuarios</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><MdAdd /> Nuevo Usuario</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Usuario</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Nombre</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Email</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Rol</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Estado</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                      <span className="text-primary-700 font-bold text-sm">{u.full_name[0]}</span>
                    </div>
                    <span className="font-medium text-sm">{u.username}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm">{u.full_name}</td>
                <td className="py-3 px-4 text-sm text-gray-500">{u.email}</td>
                <td className="py-3 px-4"><span className={ROLE_COLORS[u.role] || UI_BADGE.slate}>{ROLES[u.role]}</span></td>
                <td className="py-3 px-4">
                  <span className={u.is_active ? UI_BADGE.emerald : UI_BADGE.slate}>
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-500"><MdEdit /></button>
                    <button onClick={() => toggleActive(u)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                      {u.is_active ? <MdToggleOn className="text-xl text-emerald-500" /> : <MdToggleOff className="text-xl text-gray-400" />}
                    </button>
                    <button onClick={() => deleteUser(u)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><MdDelete /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Editar Usuario' : 'Nuevo Usuario'}>
        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Usuario *</label><input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="input-field" required autoComplete="off" name="new-username" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo *</label><input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="input-field" required autoComplete="off" name="new-full-name" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input-field" required autoComplete="off" name="new-email" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">{editing ? 'Nueva Contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label><input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input-field" required={!editing} autoComplete="new-password" name="new-password" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Rol *</label>
              <select
                value={form.role}
                onChange={(e) => {
                  const role = e.target.value;
                  setForm((f) => ({
                    ...f,
                    role,
                    caja_station_id: String(role || '').toLowerCase() === 'cajero' ? f.caja_station_id : '',
                  }));
                }}
                className="input-field"
              >
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input-field" autoComplete="off" name="new-phone" /></div>
          </div>
          {String(form.role || '').toLowerCase() === 'cajero' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Caja asignada *</label>
              <select
                value={String(form.caja_station_id || '')}
                onChange={(e) => setForm((f) => ({ ...f, caja_station_id: e.target.value }))}
                className="input-field"
              >
                <option value="">— Seleccione —</option>
                {cajaOptionsForForm.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {cajaOptionsForForm.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Cree cajas activas en Configuración → Cajas.</p>
              )}
              {cajaOptionsForForm.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Primer cajero: puede dejar «Seleccione» y se asignará la Caja Principal automáticamente.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editing ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
