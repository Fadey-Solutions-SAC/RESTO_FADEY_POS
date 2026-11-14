import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import {
  MdAccessTime,
  MdDateRange,
  MdHowToReg,
  MdMoreTime,
  MdPeople,
  MdPersonOff,
  MdSchedule,
  MdWork,
} from 'react-icons/md';
import ModuleKpiCard, { KPI_TONE_CYCLE } from '../ModuleKpiCard';
import { formatMinutes } from './hrFormat';

const CHART_COLORS = ['#10b981', '#2563eb', '#f59e0b', '#8b5cf6', '#0ea5e9', '#f97316'];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{
        background: 'var(--ui-surface-2)',
        borderColor: 'var(--ui-border)',
        color: 'var(--ui-body-text)',
      }}
    >
      {label ? <p className="mb-1 font-semibold">{label}</p> : null}
      {payload.map((entry) => (
        <p key={entry.name} className="tabular-nums" style={{ color: entry.color || 'var(--ui-body-text)' }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export default function HrDashboardTab({ data, loading }) {
  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[color:var(--ui-accent)] border-t-transparent" />
      </div>
    );
  }
  const cards = data?.cards || {};
  const byDay = (data?.charts?.by_day || []).map((r) => ({
    ...r,
    label: String(r.date || '').slice(5),
    hours: Math.round((Number(r.worked_minutes) || 0) / 60 * 10) / 10,
  }));
  const byArea = data?.charts?.by_area || [];

  const tiles = [
    { label: 'Personal registrado', value: cards.registered ?? 0, icon: MdPeople },
    { label: 'Presentes (trabajando)', value: cards.working ?? 0, icon: MdWork },
    { label: 'Marcaron hoy', value: cards.checked_today ?? 0, icon: MdHowToReg },
    { label: 'Ausentes hoy', value: cards.absent ?? 0, icon: MdPersonOff },
    { label: 'Tardanzas hoy', value: cards.late_today ?? 0, icon: MdSchedule },
    { label: 'Horas hoy', value: formatMinutes(cards.worked_minutes_today), icon: MdAccessTime },
    { label: 'Extras hoy', value: formatMinutes(cards.overtime_minutes_today), icon: MdMoreTime },
    { label: 'Horas del mes', value: formatMinutes(cards.worked_minutes_month), icon: MdDateRange },
  ];
  const hasDayData = byDay.some((row) => Number(row.attendance) || Number(row.late) || Number(row.hours));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t, index) => (
          <ModuleKpiCard
            key={t.label}
            icon={t.icon}
            title={t.label}
            value={t.value}
            tone={KPI_TONE_CYCLE[index % KPI_TONE_CYCLE.length]}
          />
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[color:var(--ui-card-border,var(--ui-border))] bg-[var(--ui-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--ui-body-text)]">Asistencia e horas (14 días)</h3>
          {hasDayData ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ui-border)" strokeOpacity={0.55} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} axisLine={false} tickLine={false} width={32} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--ui-accent) 8%, transparent)' }} />
                  <Bar dataKey="attendance" name="Asistencias" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="late" name="Tardanzas" fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-56 items-center justify-center text-sm text-[var(--ui-muted)]">
              Sin registros en estos 14 días
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-[color:var(--ui-card-border,var(--ui-border))] bg-[var(--ui-surface)] p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--ui-body-text)]">Distribución por área</h3>
          {byArea.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--ui-muted)]">Sin datos de áreas aún. Asigne departamentos en Personal.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byArea} dataKey="c" nameKey="area" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="var(--ui-surface)">
                    {byArea.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
