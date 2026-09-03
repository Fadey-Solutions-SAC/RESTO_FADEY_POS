import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import Modal from '../Modal';
import { leaveStatusLabel, leaveTypeLabel } from './hrFormat';

export default function HrLeavesTab({ employees }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const data = await api.get(`/hr/leave-requests${qs}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.message);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.post('/hr/leave-requests', { ...form, status: form.auto_approve ? 'approved' : 'pending' });
      toast.success('Permiso registrado');
      setForm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setLeave = async (id, next) => {
    try {
      await api.patch(`/hr/leave-requests/${id}`, { status: next });
      toast.success(next === 'approved' ? 'Aprobado' : 'Rechazado');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
        >
          <option value="">Todos</option>
          <option value="pending">Pendiente</option>
          <option value="approved">Aprobado</option>
          <option value="rejected">Rechazado</option>
        </select>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={() => setForm({
            employee_id: '',
            type: 'personal',
            start_date: '',
            end_date: '',
            reason: '',
            notes: '',
            auto_approve: true,
          })}
        >
          Nuevo permiso
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="p-3">Trabajador</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Desde</th>
              <th className="p-3">Hasta</th>
              <th className="p-3">Motivo</th>
              <th className="p-3">Estado</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[color:var(--ui-border)]/50">
                <td className="p-3">{r.full_name}</td>
                <td className="p-3">{leaveTypeLabel(r.type)}</td>
                <td className="p-3">{r.start_date}</td>
                <td className="p-3">{r.end_date}</td>
                <td className="p-3">{r.reason || '—'}</td>
                <td className="p-3">{leaveStatusLabel(r.status)}</td>
                <td className="p-3 whitespace-nowrap">
                  {r.status === 'pending' ? (
                    <>
                      <button type="button" className="btn-primary text-xs mr-1" onClick={() => setLeave(r.id, 'approved')}>Aprobar</button>
                      <button type="button" className="btn-secondary text-xs" onClick={() => setLeave(r.id, 'rejected')}>Rechazar</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr><td colSpan={7} className="p-8 text-center text-[var(--ui-muted)]">Sin permisos</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!form} onClose={() => setForm(null)} title="Registrar permiso" size="md">
        {form ? (
          <div className="space-y-3">
            <label className="text-xs block space-y-1">
              <span>Trabajador</span>
              <select value={form.employee_id} onChange={(e) => setForm((p) => ({ ...p, employee_id: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm">
                <option value="">Seleccione…</option>
                {(employees || []).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
            <label className="text-xs block space-y-1">
              <span>Tipo</span>
              <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm">
                <option value="personal">Personal</option>
                <option value="medico">Médico</option>
                <option value="comision">Comisión</option>
                <option value="vacaciones">Vacaciones</option>
                <option value="descanso">Descanso</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span>Inicio</span>
                <input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
              </label>
              <label className="text-xs space-y-1">
                <span>Fin</span>
                <input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
              </label>
            </div>
            <label className="text-xs block space-y-1">
              <span>Motivo</span>
              <input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
            </label>
            <label className="text-xs block space-y-1">
              <span>Observación</span>
              <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className="w-full px-2 py-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.auto_approve} onChange={(e) => setForm((p) => ({ ...p, auto_approve: e.target.checked }))} />
              Aprobar al guardar
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={save}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
