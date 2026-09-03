import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import Modal from '../Modal';
import { attendanceStatusLabel, formatMinutes, formatSqlTime } from './hrFormat';

export default function HrHistoryTab({ employees, branches }) {
  const [filters, setFilters] = useState({
    from: '', to: '', employee_id: '', branch_id: '', department: '', position: '', status: '', q: '', page: 1,
  });
  const [data, setData] = useState({ items: [], total: 0, page: 1, limit: 25 });
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(null);
  const [justify, setJustify] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) qs.set(k, v);
      });
      const res = await api.get(`/hr/attendance/history?${qs.toString()}`);
      setData(res || { items: [], total: 0, page: 1, limit: 25 });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const saveManual = async () => {
    try {
      await api.post('/hr/attendance/manual', manual);
      toast.success('Asistencia guardada');
      setManual(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveJustify = async () => {
    try {
      await api.post(`/hr/attendance/${justify.id}/justify`, { justification: justify.justification });
      toast.success('Tardanza justificada');
      setJustify(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.limit || 25)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        {[
          ['from', 'Desde', 'date'],
          ['to', 'Hasta', 'date'],
          ['q', 'Buscar', 'text'],
          ['department', 'Área', 'text'],
          ['position', 'Cargo', 'text'],
        ].map(([key, label, type]) => (
          <label key={key} className="text-xs space-y-1">
            <span className="text-[var(--ui-muted)]">{label}</span>
            <input
              type={type}
              value={filters[key]}
              onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value, page: 1 }))}
              className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm min-w-[8rem]"
            />
          </label>
        ))}
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Trabajador</span>
          <select
            value={filters.employee_id}
            onChange={(e) => setFilters((p) => ({ ...p, employee_id: e.target.value, page: 1 }))}
            className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm min-w-[10rem]"
          >
            <option value="">Todos</option>
            {(employees || []).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Sede</span>
          <select
            value={filters.branch_id}
            onChange={(e) => setFilters((p) => ({ ...p, branch_id: e.target.value, page: 1 }))}
            className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
          >
            <option value="">Todas</option>
            {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Estado</span>
          <select
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value, page: 1 }))}
            className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
          >
            <option value="">Todos</option>
            <option value="on_time">A tiempo</option>
            <option value="late">Tardanza</option>
            <option value="late_justified">Justificada</option>
            <option value="leave">Permiso</option>
          </select>
        </label>
        <button type="button" className="btn-secondary text-sm h-9" onClick={load}>Filtrar</button>
        <button
          type="button"
          className="btn-primary text-sm h-9"
          onClick={() => setManual({
            employee_id: '',
            work_date: new Date().toISOString().slice(0, 10),
            check_in_at: '',
            check_out_at: '',
            reason: '',
          })}
        >
          Alta / corrección
        </button>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="py-12 flex justify-center"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
                <th className="p-3">Trabajador</th>
                <th className="p-3">Fecha</th>
                <th className="p-3">Ingreso</th>
                <th className="p-3">Salida</th>
                <th className="p-3">Horas</th>
                <th className="p-3">Tardanza</th>
                <th className="p-3">Extras</th>
                <th className="p-3">Estado</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {(data.items || []).map((r) => (
                <tr key={r.id} className="border-b border-[color:var(--ui-border)]/50">
                  <td className="p-3">{r.full_name}</td>
                  <td className="p-3">{r.work_date}</td>
                  <td className="p-3">{formatSqlTime(r.check_in_at)}</td>
                  <td className="p-3">{formatSqlTime(r.check_out_at)}</td>
                  <td className="p-3">{formatMinutes(r.worked_minutes)}</td>
                  <td className="p-3">{r.late_minutes ? `${r.late_minutes} min` : '—'}</td>
                  <td className="p-3">{formatMinutes(r.overtime_minutes)}</td>
                  <td className="p-3">{attendanceStatusLabel(r.status)}</td>
                  <td className="p-3">
                    {Number(r.late_minutes) > 0 && r.status !== 'late_justified' ? (
                      <button type="button" className="btn-secondary text-xs" onClick={() => setJustify({ id: r.id, justification: '' })}>
                        Justificar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!data.items?.length ? (
                <tr><td colSpan={9} className="p-8 text-center text-[var(--ui-muted)]">Sin registros</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--ui-muted)]">{data.total || 0} registros</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={filters.page <= 1}
            onClick={() => setFilters((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
          >
            Anterior
          </button>
          <span>Pág. {filters.page} / {pages}</span>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={filters.page >= pages}
            onClick={() => setFilters((p) => ({ ...p, page: p.page + 1 }))}
          >
            Siguiente
          </button>
        </div>
      </div>

      <Modal isOpen={!!manual} onClose={() => setManual(null)} title="Asistencia manual" size="md">
        {manual ? (
          <div className="space-y-3">
            <label className="text-xs block space-y-1">
              <span>Trabajador</span>
              <select
                value={manual.employee_id}
                onChange={(e) => setManual((p) => ({ ...p, employee_id: e.target.value }))}
                className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
              >
                <option value="">Seleccione…</option>
                {(employees || []).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
            <label className="text-xs block space-y-1">
              <span>Fecha</span>
              <input type="date" value={manual.work_date} onChange={(e) => setManual((p) => ({ ...p, work_date: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span>Ingreso (YYYY-MM-DD HH:MM:SS)</span>
                <input value={manual.check_in_at} onChange={(e) => setManual((p) => ({ ...p, check_in_at: e.target.value }))} placeholder="2026-09-02 08:00:00" className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
              </label>
              <label className="text-xs space-y-1">
                <span>Salida</span>
                <input value={manual.check_out_at} onChange={(e) => setManual((p) => ({ ...p, check_out_at: e.target.value }))} placeholder="2026-09-02 17:00:00" className="w-full h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
              </label>
            </div>
            <label className="text-xs block space-y-1">
              <span>Motivo (obligatorio · auditoría)</span>
              <textarea value={manual.reason} onChange={(e) => setManual((p) => ({ ...p, reason: e.target.value }))} rows={3} className="w-full px-2 py-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setManual(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={saveManual}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!justify} onClose={() => setJustify(null)} title="Justificar tardanza" size="sm">
        {justify ? (
          <div className="space-y-3">
            <textarea
              value={justify.justification}
              onChange={(e) => setJustify((p) => ({ ...p, justification: e.target.value }))}
              rows={4}
              placeholder="Motivo…"
              className="w-full px-2 py-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setJustify(null)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={saveJustify}>Guardar</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
