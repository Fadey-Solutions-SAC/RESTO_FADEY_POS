import { useMemo, useState } from 'react';
import { MdEdit, MdVisibility } from 'react-icons/md';
import toast from 'react-hot-toast';
import { api, formatCurrency } from '../../utils/api';
import Modal from '../Modal';
import { employeeStatusLabel } from './hrFormat';
import HrEmploymentContractBox from './HrEmploymentContractBox';

const PAY_MODE_LABEL = {
  hora: 'Por horas',
  dia: 'Por días',
  mes: 'Por mes',
};

const fieldClass =
  'w-full min-w-0 h-9 px-2.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm text-[var(--ui-body-text)]';

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

function scheduleKindFromEmployee(e) {
  if (String(e.custom_start_time || '').trim() && String(e.custom_end_time || '').trim()) {
    return 'custom';
  }
  return 'template';
}

function DetailRow({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--ui-muted)]">{label}</div>
      <div className="text-sm text-[var(--ui-body-text)] break-words">{value || '—'}</div>
    </div>
  );
}

export default function HrStaffTab({ employees, branches, onReload }) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [inspect, setInspect] = useState(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => (employees || []).filter((e) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return [e.full_name, e.username, e.document_id, e.position, e.department]
      .join(' ')
      .toLowerCase()
      .includes(s);
  }), [employees, q]);

  const openEdit = (e) => {
    const kind = scheduleKindFromEmployee(e);
    setInspect(null);
    setEdit({
      ...e,
      schedule_kind: kind,
      custom_start_time: e.custom_start_time || '08:00',
      custom_end_time: e.custom_end_time || '17:00',
      payroll_pay_mode: e.payroll_pay_mode || '',
      payroll_amount: e.payroll_amount ?? 0,
      payroll_schedule_note: e.payroll_schedule_note || '',
      payroll_payment_day: e.payroll_payment_day || 0,
    });
  };

  const openInspect = (e) => {
    setEdit(null);
    setInspect(e);
  };

  const save = async () => {
    if (!edit?.id) return;
    const kind = edit.schedule_kind || 'template';
    if (kind === 'custom') {
      if (!edit.custom_start_time || !edit.custom_end_time) {
        toast.error('Indica hora de ingreso y salida');
        return;
      }
    }
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
        schedule_id: kind === 'custom' ? (edit.schedule_id || '') : '',
        employee_code: edit.employee_code,
        photo_url: edit.photo_url,
        custom_start_time: kind === 'custom' ? edit.custom_start_time : '',
        custom_end_time: kind === 'custom' ? edit.custom_end_time : '',
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

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id || '—';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar trabajador…"
          className="h-9 px-3 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm w-full min-w-0 sm:min-w-[14rem] sm:w-auto"
        />
        <button type="button" className="btn-secondary text-sm w-full sm:w-auto" onClick={onReload}>Actualizar</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[36rem]">
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
                <td className="p-3">{branchName(e.branch_id)}</td>
                <td className="p-3 whitespace-nowrap">{e.schedule_label || e.schedule_name || '—'}</td>
                <td className="p-3 text-xs">{formatPaySummary(e) || '—'}</td>
                <td className="p-3">{employeeStatusLabel(e.status)}</td>
                <td className="p-3 whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-secondary text-xs inline-flex items-center gap-1 py-1.5 px-2"
                      onClick={() => openInspect(e)}
                      title="Inspeccionar"
                    >
                      <MdVisibility className="text-base" />
                      Inspeccionar
                    </button>
                    <button
                      type="button"
                      className="btn-secondary p-1.5 inline-flex items-center justify-center"
                      onClick={() => openEdit(e)}
                      title="Editar"
                      aria-label="Editar"
                    >
                      <MdEdit className="text-lg" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-[var(--ui-muted)]">No hay trabajadores. Cree usuarios del sistema y aparecerán aquí.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={!!inspect}
        onClose={() => setInspect(null)}
        title="Detalle del trabajador"
        size="md"
        maxHeightClass="max-h-[min(92vh,720px)]"
        bodyClassName="!overflow-y-auto !px-3 !py-3 sm:!px-4"
      >
        {inspect ? (
          <div className="space-y-3 max-w-full min-w-0">
            <div>
              <div className="text-base font-semibold text-[var(--ui-body-text)]">{inspect.full_name}</div>
              <div className="text-xs text-[var(--ui-muted)]">@{inspect.username} · {inspect.role}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3">
              <DetailRow label="Documento" value={inspect.document_id} />
              <DetailRow label="Código" value={inspect.employee_code} />
              <DetailRow label="Cargo" value={inspect.position} />
              <DetailRow label="Área" value={inspect.department} />
              <DetailRow label="Fecha ingreso" value={inspect.hire_date} />
              <DetailRow label="Contrato" value={inspect.contract_type} />
              <DetailRow label="Sede" value={branchName(inspect.branch_id)} />
              <DetailRow label="Estado" value={employeeStatusLabel(inspect.status)} />
              <DetailRow label="Horario" value={inspect.schedule_label || inspect.schedule_name} />
              <DetailRow label="Pago" value={formatPaySummary(inspect)} />
              <DetailRow
                label="Día de pago"
                value={Number(inspect.payroll_payment_day) > 0 ? String(inspect.payroll_payment_day) : null}
              />
              <DetailRow label="Nota de pago" value={inspect.payroll_schedule_note} />
              <DetailRow
                label="Contrato digital"
                value={inspect.employment_contract?.label || null}
              />
              <DetailRow label="Foto" value={inspect.photo_url} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setInspect(null)}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
                onClick={() => openEdit(inspect)}
              >
                <MdEdit /> Editar
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={!!edit}
        onClose={() => setEdit(null)}
        title="Editar trabajador"
        size="md"
        maxHeightClass="max-h-[min(92vh,720px)]"
        bodyClassName="!overflow-y-auto !px-3 !py-3 sm:!px-4"
      >
        {edit ? (
          <div className="space-y-3 max-w-full min-w-0">
            <p className="text-xs sm:text-sm text-[var(--ui-muted)] leading-snug break-words">
              <strong className="text-[var(--ui-body-text)]">{edit.full_name}</strong>
              {' '}(@{edit.username})
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                ['document_id', 'Documento'],
                ['employee_code', 'Código'],
                ['position', 'Cargo'],
                ['department', 'Área'],
                ['hire_date', 'Fecha ingreso', 'date'],
              ].map(([key, label, type]) => (
                <label key={key} className="text-xs space-y-1 min-w-0">
                  <span className="text-[var(--ui-muted)]">{label}</span>
                  <input
                    type={type || 'text'}
                    value={edit[key] || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, [key]: e.target.value }))}
                    className={fieldClass}
                  />
                </label>
              ))}
              <HrEmploymentContractBox
                employeeId={edit.id}
                employeeName={edit.full_name}
                contractType={edit.contract_type || ''}
                onContractTypeChange={(v) => setEdit((p) => ({ ...p, contract_type: v }))}
                summaryLabel={edit.employment_contract?.label || ''}
              />
              <label className="text-xs space-y-1 min-w-0 sm:col-span-2">
                <span className="text-[var(--ui-muted)]">Foto (URL)</span>
                <input
                  type="text"
                  value={edit.photo_url || ''}
                  onChange={(e) => setEdit((p) => ({ ...p, photo_url: e.target.value }))}
                  className={fieldClass}
                />
              </label>
              <label className="text-xs space-y-1 min-w-0">
                <span className="text-[var(--ui-muted)]">Sede</span>
                <select
                  value={edit.branch_id || ''}
                  onChange={(e) => setEdit((p) => ({ ...p, branch_id: e.target.value }))}
                  className={fieldClass}
                >
                  <option value="">—</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <label className="text-xs space-y-1 min-w-0">
                <span className="text-[var(--ui-muted)]">Estado</span>
                <select
                  value={edit.status || 'active'}
                  onChange={(e) => setEdit((p) => ({ ...p, status: e.target.value }))}
                  className={fieldClass}
                >
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                  <option value="suspended">Suspendido</option>
                </select>
              </label>
            </div>

            <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2.5">
              <h4 className="text-sm font-semibold text-[var(--ui-body-text)]">Horario y datos de pago</h4>
              <label className="text-xs space-y-1 block min-w-0">
                <span className="text-[var(--ui-muted)]">Tipo de horario</span>
                <select
                  value={edit.schedule_kind || 'template'}
                  onChange={(e) => {
                    const kind = e.target.value;
                    setEdit((p) => ({
                      ...p,
                      schedule_kind: kind,
                      ...(kind === 'template' ? { schedule_id: '' } : {}),
                    }));
                  }}
                  className={fieldClass}
                >
                  <option value="template">Plantilla del local</option>
                  <option value="custom">Personalizado (ingreso / salida)</option>
                </select>
              </label>

              {edit.schedule_kind === 'custom' ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="text-xs space-y-1 min-w-0">
                    <span className="text-[var(--ui-muted)]">Ingreso</span>
                    <input
                      type="time"
                      value={edit.custom_start_time || ''}
                      onChange={(e) => setEdit((p) => ({ ...p, custom_start_time: e.target.value }))}
                      className={fieldClass}
                    />
                  </label>
                  <label className="text-xs space-y-1 min-w-0">
                    <span className="text-[var(--ui-muted)]">Salida</span>
                    <input
                      type="time"
                      value={edit.custom_end_time || ''}
                      onChange={(e) => setEdit((p) => ({ ...p, custom_end_time: e.target.value }))}
                      className={fieldClass}
                    />
                  </label>
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="text-xs space-y-1 min-w-0">
                  <span className="text-[var(--ui-muted)]">Formato de pago</span>
                  <select
                    value={edit.payroll_pay_mode || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_pay_mode: e.target.value }))}
                    className={fieldClass}
                  >
                    <option value="">Sin definir</option>
                    <option value="hora">Por horas</option>
                    <option value="dia">Por días</option>
                    <option value="mes">Por mes</option>
                  </select>
                </label>
                <label className="text-xs space-y-1 min-w-0">
                  <span className="text-[var(--ui-muted)]">{payAmountHint(edit.payroll_pay_mode)}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={edit.payroll_amount ?? ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_amount: e.target.value }))}
                    className={fieldClass}
                    placeholder="0.00"
                  />
                </label>
                <label className="text-xs space-y-1 min-w-0">
                  <span className="text-[var(--ui-muted)]">Día de pago (1–31)</span>
                  <input
                    type="number"
                    min="0"
                    max="31"
                    value={edit.payroll_payment_day ?? 0}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_payment_day: e.target.value }))}
                    className={fieldClass}
                  />
                </label>
                <label className="text-xs space-y-1 min-w-0 sm:col-span-2">
                  <span className="text-[var(--ui-muted)]">Nota / detalle del pago</span>
                  <input
                    type="text"
                    value={edit.payroll_schedule_note || ''}
                    onChange={(e) => setEdit((p) => ({ ...p, payroll_schedule_note: e.target.value }))}
                    className={fieldClass}
                    placeholder="Ej. quincenal…"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setEdit(null)}>Cancelar</button>
              <button type="button" className="btn-primary w-full sm:w-auto" disabled={saving} onClick={save}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
