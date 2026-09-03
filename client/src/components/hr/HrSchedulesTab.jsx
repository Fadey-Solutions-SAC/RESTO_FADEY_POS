import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import Modal from '../Modal';
import { WEEKDAY_LABELS, parseWorkDays } from './hrFormat';

const emptyForm = {
  name: '',
  start_time: '08:00',
  end_time: '17:00',
  tolerance_in_minutes: 10,
  tolerance_out_minutes: 10,
  break_minutes: 60,
  max_hours: 8,
  work_days: [0, 1, 2, 3, 4, 5],
};

export default function HrSchedulesTab({ schedules, employees, onReload }) {
  const [form, setForm] = useState(null);
  const [assign, setAssign] = useState(null);
  const [selected, setSelected] = useState([]);
  const [department, setDepartment] = useState('');

  const openNew = () => setForm({ ...emptyForm });
  const openEdit = (s) => setForm({
    ...emptyForm,
    ...s,
    work_days: parseWorkDays(s.work_days),
  });

  const save = async () => {
    try {
      if (form.id) await api.put(`/hr/schedules/${form.id}`, form);
      else await api.post('/hr/schedules', form);
      toast.success('Horario guardado');
      setForm(null);
      onReload?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doAssign = async () => {
    try {
      await api.post(`/hr/schedules/${assign.id}/assign`, {
        employee_ids: selected,
        department: department.trim(),
      });
      toast.success('Horario asignado');
      setAssign(null);
      setSelected([]);
      setDepartment('');
      onReload?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleDay = (v) => {
    setForm((p) => {
      const set = new Set(p.work_days || []);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      return { ...p, work_days: [...set].sort((a, b) => a - b) };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <p className="text-sm text-[var(--ui-muted)]">Configure jornadas, tolerancia, descanso y horas máximas. Los cálculos se validan en el servidor.</p>
        <button type="button" className="btn-primary text-sm" onClick={openNew}>Nuevo horario</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {(schedules || []).map((s) => (
          <div key={s.id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{s.name}</h3>
                <p className="text-sm text-[var(--ui-muted)]">
                  {s.start_time} — {s.end_time} · tol. {s.tolerance_in_minutes} min · descanso {s.break_minutes} min · máx. {s.max_hours}h
                </p>
                <p className="text-xs text-[var(--ui-muted)]">
                  Días: {parseWorkDays(s.work_days).map((d) => WEEKDAY_LABELS.find((x) => x.v === d)?.label || d).join(', ')}
                </p>
              </div>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary text-xs" onClick={() => openEdit(s)}>Editar</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => { setAssign(s); setSelected([]); }}>Asignar</button>
              </div>
            </div>
          </div>
        ))}
        {!schedules?.length ? (
          <div className="card p-8 text-center text-[var(--ui-muted)] md:col-span-2">Aún no hay horarios.</div>
        ) : null}
      </div>

      <Modal isOpen={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar horario' : 'Nuevo horario'} size="lg">
        {form ? (
          <div className="space-y-3">
            <label className="text-xs block space-y-1">
              <span>Nombre</span>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
              />
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                ['start_time', 'Entrada', 'time'],
                ['end_time', 'Salida', 'time'],
                ['tolerance_in_minutes', 'Tolerancia entrada (min)', 'number'],
                ['tolerance_out_minutes', 'Tolerancia salida (min)', 'number'],
                ['break_minutes', 'Descanso (min)', 'number'],
                ['max_hours', 'Horas máximas', 'number'],
              ].map(([key, label, type]) => (
                <label key={key} className="text-xs space-y-1">
                  <span>{label}</span>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm((p) => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  />
                </label>
              ))}
            </div>
            <div>
              <div className="text-xs mb-1">Días laborales</div>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((d) => (
                  <button
                    key={d.v}
                    type="button"
                    onClick={() => toggleDay(d.v)}
                    className={`px-2.5 py-1 rounded-lg text-xs border ${
                      (form.work_days || []).includes(d.v)
                        ? 'bg-gold-600 text-white border-gold-600'
                        : 'border-[color:var(--ui-border)]'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={save}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!assign} onClose={() => setAssign(null)} title={`Asignar · ${assign?.name || ''}`} size="lg">
        {assign ? (
          <div className="space-y-3">
            <label className="text-xs block space-y-1">
              <span>Asignar a todo un área (opcional)</span>
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Ej. Cocina"
                className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
              />
            </label>
            <div className="max-h-64 overflow-y-auto border border-[color:var(--ui-border)] rounded-xl divide-y divide-[color:var(--ui-border)]">
              {(employees || []).map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(e.id)}
                    onChange={(ev) => {
                      setSelected((prev) => (ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id)));
                    }}
                  />
                  <span>{e.full_name}</span>
                  <span className="text-[var(--ui-muted)] text-xs">{e.department || e.position}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setAssign(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={doAssign}>Asignar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
