import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, formatCurrency } from '../../utils/api';
import Modal from '../Modal';
import { employeeStatusLabel } from './hrFormat';

const PAY_MODE_LABEL = {
  hora: 'Por horas',
  dia: 'Por días',
  mes: 'Por mes',
};

function payAmountHint(mode) {
  if (mode === 'hora') return 'Monto por hora (S/)';
  if (mode === 'dia') return 'Monto por día (S/)';
  if (mode === 'mes') return 'Monto mensual (S/)';
  return 'Monto (S/)';
}

function formatPaySummary(e) {
  const mode = String(e.payroll_pay_mode || '').toLowerCase();
  const amount = Number(e.payroll_amount || 0);
  if (!mode || !Number.isFinite(amount) || amount <= 0) return null;
  const label = PAY_MODE_LABEL[mode] || mode;
  return `${label} · ${formatCurrency(amount)}`;
}

export default function HrStaffTab({ employees, schedules, branches, onReload }) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = (employees || []).filter((e) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [e.full_name, e.username, e.document_id, e.position, e.department]
      .join(' ')
      .toLowerCase()
      .includes(s);
  });

  const save = async () => {
    if (!edit?.id) return;
    setSaving(true);
    try {
      await api.patch(`/hr/employees/${edit.id}`, {
        document_id: edit.document_id,
        position: edit.position,
        department: edit.department,
        branch_id: edit.branch_id,
        hire_date: edit.hire_date,
        contract_type: edit.contract_type,
        status: edit.status,
        schedule_id: edit.schedule_id,
        employee_code: edit.employee_code,
        photo_url: edit.photo_url,
        payroll_pay_mode: edit.payroll_pay_mode || '',
        payroll_amount: Number(edit.payroll_amount || 0),
        payroll_schedule_note: edit.payroll_schedule_note || '',
        payroll_payment_day: Number(edit.payroll_payment_day || 0),
      });
      toast.success('Trabajador actualizado');
      setEdit(null);
      onReload?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ui-muted)] rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2">
        La marcación usa un <strong>único QR del local</strong> (botón «QR del local» arriba). Cada trabajador escanea
        ese mismo código con su sesión iniciada en Control de asistencia.
      </p>
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar trabajador…"
          className="h-9 px-3 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm min-w-[14rem]"
        />
        <button type="button" className="btn-secondary text-sm" onClick={onReload}>Actualizar</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
              <th className="p-3">Trabajador</th>
              <th className="p-3">Cargo / Área</th>
              <th className="p-3">Sede</th>
              <th className="p-3">Horario</th>
              <th className="p-3">Pago</th>
              <th className="p-3">Estado</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-[color:var(--ui-border)]/60">
                <td className="p-3">
                  <div className="font-medium">{e.full_name}</div>
                  <div className="text-xs text-[var(--ui-muted)]">@{e.username} · {e.role}</div>
                </td>
                <td className="p-3">{e.position || '—'}{e.department ? ` / ${e.department}` : ''}</td>
                <td className="p-3">{branches.find((b) => b.id === e.branch_id)?.name || e.branch_id || '—'}</td>
                <td className="p-3">{e.schedule_name || '—'}</td>
                <td className="p-3 text-xs">{formatPaySummary(e) || '—'}</td>
                <td className="p-3">{employeeStatusLabel(e.status)}</td>
                <td className="p-3 whitespace-nowrap">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setEdit({
                      ...e,
                      payroll_pay_mode: e.payroll_pay_mode || '',
                      payroll_amount: e.payroll_amount ?? 0,
                      payroll_schedule_note: e.payroll_schedule_note || '',
                      payroll_payment_day: e.payroll_payment_day || 0,
                    })}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-[var(--ui-muted)]">No hay trabajadores. Cree usuarios del sistema y aparecerán aquí.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!edit} onClose={() => setEdit(null)} title="Editar trabajador" size="lg">
        {edit ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--ui-muted)]">
              Usuario vinculado: <strong>{edit.full_name}</strong> (@{edit.username}). Los datos de cuenta se gestionan en Configuración → Usuarios.
            </p>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                ['document_id', 'Documento'],
                ['employee_code', 'Código'],
                ['position', 'Cargo'],
                ['department', 'Área'],
                ['hire_date', 'Fecha ingreso', 'date'],
                ['contract_type', 'Contrato'],
                ['photo_url', 'Foto (URL)'],
              ].map(([key, label, type]) => (
                <label key={key} className="text-xs space-y-1">
                  <span className="text-[var(--ui-muted)]">{label}</span>
                  <input
                    type={type || 'text'}
                    value={edit[key] || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, [key]: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  />
                </label>
              ))}
              <label className="text-xs space-y-1">
                <span className="text-[var(--ui-muted)]">Sede</span>
                <select
                  value={edit.branch_id || ''}
                  onChange={(e) => setEdit((p) => ({ ...p, branch_id: e.target.value }))}
                  className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                >
                  <option value="">—</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--ui-muted)]">Estado</span>
                <select
                  value={edit.status || 'active'}
                  onChange={(e) => setEdit((p) => ({ ...p, status: e.target.value }))}
                  className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-3">
              <h4 className="text-sm font-semibold text-[var(--ui-body-text)]">Horario y datos de pago</h4>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-xs space-y-1 md:col-span-2">
                  <span className="text-[var(--ui-muted)]">Horario de trabajo</span>
                  <select
                    value={edit.schedule_id || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, schedule_id: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  >
                    <option value="">—</option>
                    {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[var(--ui-muted)]">Formato de pago</span>
                  <select
                    value={edit.payroll_pay_mode || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_pay_mode: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  >
                    <option value="">Sin definir</option>
                    <option value="hora">Por horas</option>
                    <option value="dia">Por días</option>
                    <option value="mes">Por mes</option>
                  </select>
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[var(--ui-muted)]">{payAmountHint(edit.payroll_pay_mode)}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={edit.payroll_amount ?? ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_amount: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                    placeholder="0.00"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[var(--ui-muted)]">Día de pago (1–31, opcional)</span>
                  <input
                    type="number"
                    min="0"
                    max="31"
                    value={edit.payroll_payment_day ?? 0}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_payment_day: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                  />
                </label>
                <label className="text-xs space-y-1 md:col-span-2">
                  <span className="text-[var(--ui-muted)]">Nota / detalle del pago</span>
                  <input
                    type="text"
                    value={edit.payroll_schedule_note || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_schedule_note: e.target.value }))}
                    className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
                    placeholder="Ej. quincenal, incluye refrigerio…"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
