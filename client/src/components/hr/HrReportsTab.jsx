import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, getApiBase } from '../../utils/api';
import { attendanceStatusLabel, formatMinutes } from './hrFormat';

async function downloadReport(params) {
  const token = localStorage.getItem('token');
  const qs = new URLSearchParams(params);
  const res = await fetch(`${getApiBase()}/hr/reports?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = 'No se pudo exportar';
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch (_) { /* noop */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const ext = params.format === 'pdf' ? 'pdf' : params.format === 'xlsx' ? 'xls' : 'csv';
  a.download = `asistencia-${params.from || 'hoy'}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function HrReportsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState('daily');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ kind, from, to, format: 'json' });
      const data = await api.get(`/hr/reports?${qs.toString()}`);
      setReport(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportFmt = async (format) => {
    try {
      await downloadReport({ kind, from, to, format });
      toast.success('Descarga lista');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm">
            <option value="daily">Diario</option>
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
          </select>
        </label>
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Desde</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-[var(--ui-muted)]">Hasta</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block h-9 px-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm" />
        </label>
        <button type="button" className="btn-primary text-sm h-9" onClick={load} disabled={loading}>Generar</button>
        <button type="button" className="btn-secondary text-sm h-9" onClick={() => exportFmt('csv')}>CSV</button>
        <button type="button" className="btn-secondary text-sm h-9" onClick={() => exportFmt('xlsx')}>Excel</button>
        <button type="button" className="btn-secondary text-sm h-9" onClick={() => exportFmt('pdf')}>PDF</button>
      </div>

      {report ? (
        <div className="space-y-4">
          <div className="card overflow-x-auto">
            <h3 className="p-3 font-semibold text-sm border-b border-[color:var(--ui-border)]">Resumen por trabajador</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--ui-muted)]">
                  <th className="p-3">Trabajador</th>
                  <th className="p-3">Días</th>
                  <th className="p-3">Horas</th>
                  <th className="p-3">Extras</th>
                  <th className="p-3">Tardanzas</th>
                </tr>
              </thead>
              <tbody>
                {(report.by_employee || []).map((g) => (
                  <tr key={g.employee_id} className="border-t border-[color:var(--ui-border)]/50">
                    <td className="p-3">{g.full_name}</td>
                    <td className="p-3">{g.days}</td>
                    <td className="p-3">{formatMinutes(g.worked_minutes)}</td>
                    <td className="p-3">{formatMinutes(g.overtime_minutes)}</td>
                    <td className="p-3">{g.late_count} ({formatMinutes(g.late_minutes)})</td>
                  </tr>
                ))}
                {!report.by_employee?.length ? (
                  <tr><td colSpan={5} className="p-6 text-center text-[var(--ui-muted)]">Sin datos en el período</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {(report.absences || []).length ? (
            <div className="card p-4">
              <h3 className="font-semibold text-sm mb-2">Inasistencias (día fin del período)</h3>
              <ul className="text-sm space-y-1">
                {report.absences.map((a) => (
                  <li key={`${a.employee_id}-${a.date}`}>{a.full_name} · {a.date} · {attendanceStatusLabel(a.status)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card p-10 text-center text-[var(--ui-muted)] text-sm">Elija un período y pulse Generar.</div>
      )}
    </div>
  );
}
