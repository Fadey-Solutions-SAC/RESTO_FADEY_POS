import { useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  MdSchedule, MdDateRange, MdCalendarMonth, MdHistory, MdDescription, MdDownload, MdTrendingUp,
} from 'react-icons/md';
import { formatCurrency } from '../../utils/api';
import { formatMinutes } from './hrFormat';

export const ROLE_LABELS = {
  admin: 'Administrador',
  master_admin: 'Administrador maestro',
  cajero: 'Caja',
  mozo: 'Mozo',
  cocina: 'Cocina',
  bar: 'Bar',
  produccion: 'Producción',
  delivery: 'Delivery',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '—';
}

const KIND_TEXT = {
  mozo: 'Según las mesas y cuentas que abre cada día.',
  caja: 'Según las cuentas que abre y las que cobra cada día.',
  produccion: 'Según las comandas que despacha y el tiempo que tardan en salir.',
  admin: 'Cuentas abiertas, cobradas y comandas despachadas.',
  general: 'Según las cuentas que abre cada día.',
};

const KIND_TEXT_SELF = {
  mozo: 'Según las mesas y cuentas que abres cada día.',
  caja: 'Según las cuentas que abres y las que cobras cada día.',
  produccion: 'Según las comandas que despachas y el tiempo que tardan en salir.',
  admin: 'Cuentas abiertas, cobradas y comandas despachadas por ti.',
  general: 'Según las cuentas que abres cada día.',
};

function shortDay(key) {
  const [, m, d] = String(key || '').split('-');
  return d && m ? `${d}/${m}` : key;
}

function StatCard({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="flex-auto rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm flex items-center gap-2.5">
      <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${tones[tone] || tones.blue}`}>
        <Icon className="text-xl" />
      </span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight whitespace-nowrap">{label}</p>
        <p className="text-lg font-bold mt-1 whitespace-nowrap tabular-nums leading-none text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function chartConfig(kind) {
  if (kind === 'mozo' || kind === 'general') {
    return {
      bars: [{ key: 'cuentas', name: 'Cuentas / mesas abiertas', color: '#2563eb' }],
      line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
    };
  }
  if (kind === 'caja') {
    return {
      bars: [
        { key: 'cuentas', name: 'Cuentas abiertas', color: '#93c5fd' },
        { key: 'cobradas', name: 'Cuentas cobradas', color: '#2563eb' },
      ],
      line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
    };
  }
  if (kind === 'produccion') {
    return {
      bars: [{ key: 'despachadas', name: 'Comandas despachadas', color: '#2563eb' }],
      line: { key: 'minutos_promedio', name: 'Minutos promedio de salida', color: '#f59e0b' },
    };
  }
  return {
    bars: [
      { key: 'cuentas', name: 'Cuentas abiertas', color: '#93c5fd' },
      { key: 'cobradas', name: 'Cuentas cobradas', color: '#2563eb' },
      { key: 'despachadas', name: 'Comandas despachadas', color: '#8b5cf6' },
    ],
    line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
  };
}

function summaryChips(kind, s, selfView = false) {
  if (!s) return [];
  const perHour = s.por_hora != null ? s.por_hora.toFixed(2) : '—';
  if (kind === 'mozo' || kind === 'general') {
    return [
      ['Cuentas abiertas', s.cuentas],
      ['Comandas enviadas', s.comandas],
      ['Ventas cobradas', formatCurrency(s.ventas)],
      ['Cuentas por hora', perHour],
    ];
  }
  if (kind === 'caja') {
    return [
      ['Cuentas abiertas', s.cuentas],
      ['Cuentas cobradas', s.cobradas],
      [selfView ? 'Ventas de tus cuentas' : 'Ventas de sus cuentas', formatCurrency(s.ventas)],
      ['Cuentas por hora', perHour],
    ];
  }
  if (kind === 'produccion') {
    return [
      ['Comandas despachadas', s.despachadas],
      ['Tiempo promedio de salida', s.minutos_promedio != null ? `${s.minutos_promedio} min` : '—'],
      ['Horas trabajadas', `${s.horas} h`],
      ['Comandas por hora', perHour],
    ];
  }
  return [
    ['Cuentas abiertas', s.cuentas],
    ['Cuentas cobradas', s.cobradas],
    ['Comandas despachadas', s.despachadas],
    ['Acciones por hora', perHour],
  ];
}

export function StaffHoursCards({ hours, period }) {
  if (!hours) return null;
  return (
    <div className="flex flex-wrap gap-3">
      <StatCard icon={MdSchedule} label="Esta semana" value={formatMinutes(hours.weekly_minutes)} />
      <StatCard icon={MdCalendarMonth} label="Este mes" value={formatMinutes(hours.monthly_minutes)} tone="green" />
      <StatCard icon={MdDateRange} label={`Últimos ${period?.days || 30} días`} value={formatMinutes(hours.period_minutes)} tone="violet" />
      <StatCard icon={MdHistory} label="Horas acumuladas" value={hours.total_minutes != null ? formatMinutes(hours.total_minutes) : '—'} tone="amber" />
    </div>
  );
}

export function StaffContractCard({ contract, title = 'Contrato de trabajo' }) {
  const [showContract, setShowContract] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-slate-800 flex items-center gap-2"><MdDescription className="text-violet-600" /> {title}</p>
          {contract?.available ? (
            <p className="text-sm text-slate-500 mt-1">
              {[contract.position, contract.contract_type, contract.hire_date ? `ingreso ${contract.hire_date}` : ''].filter(Boolean).join(' · ') || 'Contrato registrado'}
            </p>
          ) : (
            <p className="text-sm text-slate-500 mt-1">{contract?.reason || 'Sin contrato registrado.'}</p>
          )}
        </div>
        {contract?.available && (
          <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${contract.fully_signed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {contract.status || (contract.fully_signed ? 'Firmado' : 'Pendiente de firma')}
          </span>
        )}
      </div>
      {contract?.available && (
        <div className="flex flex-wrap gap-2">
          {contract.text && (
            <button type="button" onClick={() => setShowContract((v) => !v)} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700">
              {showContract ? 'Ocultar contrato' : 'Ver contrato'}
            </button>
          )}
          {contract.pdf_url && (
            <a href={contract.pdf_url} target="_blank" rel="noreferrer" className="text-sm font-medium px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-1.5">
              <MdDownload /> Descargar PDF
            </a>
          )}
        </div>
      )}
      {showContract && contract?.text && (
        <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100 font-sans">
          {contract.text}
        </pre>
      )}
    </div>
  );
}

export function StaffProductivityCard({
  kind, productivity, period, title = 'Productividad', chartHeightClass = 'h-72', selfView = false,
}) {
  if (!productivity) return null;
  const cfg = chartConfig(kind);
  const series = (productivity.series || []).map((r) => ({ ...r, label: shortDay(r.day) }));
  const hasActivity = series.some((r) => cfg.bars.some((b) => Number(r[b.key] || 0) > 0));
  const chips = summaryChips(kind, productivity.summary, selfView);
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="font-semibold text-slate-800 flex items-center gap-2"><MdTrendingUp className="text-blue-600" /> {title} (últimos {period?.days || 30} días)</p>
        <p className="text-sm text-slate-500 mt-1">
          {selfView ? (KIND_TEXT_SELF[kind] || KIND_TEXT_SELF.general) : (KIND_TEXT[kind] || KIND_TEXT.general)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {chips.map(([label, value]) => (
          <div key={label} className="flex-auto rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{label}</p>
            <p className="text-base font-bold text-slate-900 tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {hasActivity ? (
        <div className={chartHeightClass}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {cfg.bars.map((b) => (
                <Bar key={b.key} yAxisId="left" dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
              ))}
              <Line yAxisId="right" type="monotone" dataKey={cfg.line.key} name={cfg.line.name} stroke={cfg.line.color} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-sm text-slate-500 py-10 text-center">
          Aún no hay actividad registrada en este período.
          {kind === 'produccion'
            ? (selfView
              ? ' Las comandas que marques como listas desde ahora aparecerán aquí.'
              : ' Las comandas marcadas como listas desde ahora aparecerán aquí.')
            : ''}
        </p>
      )}
    </div>
  );
}
