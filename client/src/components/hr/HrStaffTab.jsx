import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import Modal from '../Modal';
import { MdQrCode2, MdPrint, MdDownload, MdRefresh } from 'react-icons/md';
import { employeeStatusLabel } from './hrFormat';

export default function HrStaffTab({ employees, schedules, branches, onReload }) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [qr, setQr] = useState(null);
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

  const openQr = async (emp) => {
    try {
      const data = await api.get(`/hr/employees/${emp.id}/qr`);
      setQr({ ...data, employee: emp });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const regenerate = async () => {
    if (!qr?.employee?.id) return;
    if (!window.confirm('¿Regenerar el QR? El código anterior dejará de funcionar.')) return;
    try {
      const data = await api.post(`/hr/employees/${qr.employee.id}/qr/regenerate`, {});
      setQr({
        ...qr,
        ...data,
        active: true,
        has_credential: true,
        png_base64: data.png_base64,
        payload: data.payload,
      });
      toast.success('QR regenerado');
      onReload?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deactivate = async () => {
    if (!qr?.employee?.id) return;
    try {
      await api.post(`/hr/employees/${qr.employee.id}/qr/deactivate`, {});
      toast.success('QR desactivado');
      setQr(null);
      onReload?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const downloadQr = () => {
    if (!qr?.png_base64) return;
    const a = document.createElement('a');
    a.href = `data:image/png;base64,${qr.png_base64}`;
    a.download = `qr-${(qr.employee?.full_name || 'trabajador').replace(/\s+/g, '-')}.png`;
    a.click();
  };

  const printQr = () => {
    if (!qr?.png_base64) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>QR ${qr.employee?.full_name || ''}</title>
      <style>body{font-family:system-ui;text-align:center;padding:24px} img{width:280px;height:280px}</style></head>
      <body><h2>${qr.employee?.full_name || ''}</h2><p>${qr.employee?.position || ''}</p>
      <img src="data:image/png;base64,${qr.png_base64}" alt="QR" />
      <p style="font-size:12px;color:#666">Resto-FADEY · Asistencia</p>
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  useEffect(() => {
    if (qr?.needs_regenerate) toast('El QR activo no se puede visualizar: regenerelo.', { icon: 'ℹ️' });
  }, [qr?.needs_regenerate]);

  return (
    <div className="space-y-3">
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
              <th className="p-3">Estado</th>
              <th className="p-3">QR</th>
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
                <td className="p-3">{employeeStatusLabel(e.status)}</td>
                <td className="p-3">{e.qr_active ? 'Activo' : '—'}</td>
                <td className="p-3 whitespace-nowrap">
                  <button type="button" className="btn-secondary text-xs mr-1" onClick={() => setEdit({ ...e })}>Editar</button>
                  <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => openQr(e)}>
                    <MdQrCode2 /> QR
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
          <div className="space-y-3">
            <p className="text-sm text-[var(--ui-muted)]">Usuario vinculado: <strong>{edit.full_name}</strong> (@{edit.username}). Los datos de cuenta se gestionan en Configuración → Usuarios.</p>
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
                <span className="text-[var(--ui-muted)]">Horario</span>
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
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!qr} onClose={() => setQr(null)} title={`QR · ${qr?.employee?.full_name || ''}`} size="md">
        {qr ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-[var(--ui-muted)]">
              Estado: {qr.active ? 'Activo' : 'Inactivo'}
              {qr.created_at ? ` · creado ${qr.created_at}` : ''}
            </p>
            {qr.png_base64 ? (
              <img
                src={`data:image/png;base64,${qr.png_base64}`}
                alt="Código QR"
                className="mx-auto w-56 h-56 rounded-xl border border-[color:var(--ui-border)] bg-white p-2"
              />
            ) : (
              <p className="text-sm py-8">No hay imagen QR. Genere o regenere el código.</p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary text-sm inline-flex items-center gap-1" onClick={regenerate}>
                <MdRefresh /> Generar / Regenerar
              </button>
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={downloadQr} disabled={!qr.png_base64}>
                <MdDownload /> Descargar
              </button>
              <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={printQr} disabled={!qr.png_base64}>
                <MdPrint /> Imprimir
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={deactivate} disabled={!qr.active}>Desactivar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
