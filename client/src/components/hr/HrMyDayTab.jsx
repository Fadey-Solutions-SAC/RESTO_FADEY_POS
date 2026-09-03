import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import { attendanceStatusLabel, formatMinutes, formatSqlTime, leaveStatusLabel, leaveTypeLabel } from './hrFormat';

export default function HrMyDayTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/me');
      setData(res);
    } catch (err) {
      toast.error(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!data) {
    return <div className="card p-8 text-center text-[var(--ui-muted)]">No se pudo cargar su asistencia.</div>;
  }

  const open = data.open;
  const schedule = data.schedule;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="card p-5 space-y-2">
        <h2 className="text-lg font-semibold">{data.employee?.full_name}</h2>
        <p className="text-sm text-[var(--ui-muted)]">
          Horario: {schedule ? `${schedule.name} · ${schedule.start_time} – ${schedule.end_time}` : 'Sin horario asignado'}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          <div>
            <div className="text-xs text-[var(--ui-muted)]">Ingreso hoy</div>
            <div className="font-medium">{formatSqlTime(open?.check_in_at || data.today_records?.[0]?.check_in_at)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--ui-muted)]">Salida</div>
            <div className="font-medium">{formatSqlTime(open?.check_out_at || data.today_records?.[0]?.check_out_at)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--ui-muted)]">Horas</div>
            <div className="font-medium">{formatMinutes(data.today_records?.[0]?.worked_minutes)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--ui-muted)]">Extras</div>
            <div className="font-medium">{formatMinutes(data.today_records?.[0]?.overtime_minutes)}</div>
          </div>
        </div>
        {open && !open.check_out_at ? (
          <p className="text-sm text-emerald-600 pt-1">Jornada abierta · {attendanceStatusLabel(open.status)}</p>
        ) : null}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="p-3 font-semibold text-sm border-b border-[color:var(--ui-border)]">Historial reciente</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--ui-muted)]">
              <th className="p-3">Fecha</th>
              <th className="p-3">Ingreso</th>
              <th className="p-3">Salida</th>
              <th className="p-3">Horas</th>
              <th className="p-3">Tardanza</th>
              <th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {(data.history || []).map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--ui-border)]/50">
                <td className="p-3">{r.work_date}</td>
                <td className="p-3">{formatSqlTime(r.check_in_at)}</td>
                <td className="p-3">{formatSqlTime(r.check_out_at)}</td>
                <td className="p-3">{formatMinutes(r.worked_minutes)}</td>
                <td className="p-3">{r.late_minutes ? `${r.late_minutes} min` : '—'}</td>
                <td className="p-3">{attendanceStatusLabel(r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data.leaves || []).length ? (
        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">Permisos</h3>
          <ul className="text-sm space-y-1">
            {data.leaves.map((l) => (
              <li key={l.id}>{leaveTypeLabel(l.type)} · {l.start_date} → {l.end_date} · {leaveStatusLabel(l.status)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
