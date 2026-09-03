import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { useChartTheme } from '../../theme/useChartTheme';
import { formatMinutes } from './hrFormat';

const PIE_COLORS = ['#2563EB', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export default function HrDashboardTab({ data, loading }) {
  const chart = useChartTheme();
  if (loading && !data) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
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
    { label: 'Personal registrado', value: cards.registered ?? 0 },
    { label: 'Presentes (trabajando)', value: cards.working ?? 0 },
    { label: 'Marcaron hoy', value: cards.checked_today ?? 0 },
    { label: 'Ausentes hoy', value: cards.absent ?? 0 },
    { label: 'Tardanzas hoy', value: cards.late_today ?? 0 },
    { label: 'Horas hoy', value: formatMinutes(cards.worked_minutes_today) },
    { label: 'Extras hoy', value: formatMinutes(cards.overtime_minutes_today) },
    { label: 'Horas del mes', value: formatMinutes(cards.worked_minutes_month) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className="text-xs text-[var(--ui-muted)] mb-1">{t.label}</div>
            <div className="text-2xl font-semibold text-[var(--ui-body-text)]">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">Asistencia e horas (14 días)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
                <XAxis dataKey="label" stroke={chart.axis} fontSize={11} />
                <YAxis stroke={chart.axis} fontSize={11} />
                <Tooltip />
                <Bar dataKey="attendance" name="Asistencias" fill={chart.primary || '#2563EB'} radius={[4, 4, 0, 0]} />
                <Bar dataKey="late" name="Tardanzas" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">Distribución por área</h3>
          {byArea.length === 0 ? (
            <p className="text-sm text-[var(--ui-muted)] py-10 text-center">Sin datos de áreas aún. Asigne departamentos en Personal.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byArea} dataKey="c" nameKey="area" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {byArea.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
