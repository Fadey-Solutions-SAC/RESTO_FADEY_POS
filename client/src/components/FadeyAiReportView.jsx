import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { MdTableChart, MdPictureAsPdf } from 'react-icons/md';
import { REPORT_PALETTE, formatReportValue } from '../utils/fadeyReportCharts';

function shortTick(v, format) {
  const n = Number(v || 0);
  if (format === 'pct') return `${n.toFixed(0)}%`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function ReportChart({ chart }) {
  const fmt = (v) => formatReportValue(v, chart.format);
  const data = chart.data || [];
  if (chart.type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={78} paddingAngle={1}>
            {data.map((_, i) => <Cell key={i} fill={REPORT_PALETTE[i % REPORT_PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === 'hbar') {
    return (
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 26 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => shortTick(v, chart.format)} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => <Cell key={i} fill={REPORT_PALETTE[i % REPORT_PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => shortTick(v, chart.format)} width={44} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Line type="monotone" dataKey="value" stroke={REPORT_PALETTE[0]} strokeWidth={2.5} dot={data.length <= 31} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  const hasSecond = data.some((d) => d.value2 != null);
  const labels = chart.series || [];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => shortTick(v, chart.format)} width={44} />
        <Tooltip formatter={(v) => fmt(v)} />
        {hasSecond ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        <Bar dataKey="value" name={labels[0]?.label || chart.title} fill={REPORT_PALETTE[0]} radius={[4, 4, 0, 0]} />
        {hasSecond ? <Bar dataKey="value2" name={labels[1]?.label || 'Referencia'} fill={REPORT_PALETTE[3]} radius={[4, 4, 0, 0]} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ReportTable({ table, en }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? table.rows : table.rows.slice(0, 8);
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <p className="px-3 py-2 text-xs font-semibold text-[#0f172a] bg-slate-50 border-b border-slate-200">
        {table.title} <span className="font-normal text-[#64748b]">({table.rows.length})</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#1e3a8a] text-white">
              {table.columns.map((c) => (
                <th key={c.key} className={`px-2 py-1.5 font-semibold whitespace-nowrap ${c.format ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                {table.columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1 border-b border-slate-100 ${c.format ? 'text-right tabular-nums whitespace-nowrap' : ''}`}>
                    {c.format ? formatReportValue(r[c.key], c.format) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {expanded && table.totals ? (
              <tr className="bg-indigo-50 font-semibold">
                {table.columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1 ${c.format ? 'text-right tabular-nums' : ''}`}>
                    {table.totals[c.key] == null ? '' : c.format ? formatReportValue(table.totals[c.key], c.format) : table.totals[c.key]}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {table.rows.length > 8 ? (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full py-1.5 text-[11px] font-medium text-[#2563eb] hover:bg-slate-50">
          {en
            ? (expanded ? 'Show less' : `Show all ${table.rows.length} records`)
            : (expanded ? 'Ver menos' : `Ver los ${table.rows.length} registros`)}
        </button>
      ) : null}
    </div>
  );
}

export default function FadeyAiReportView({ report, onExport, exporting = '' }) {
  if (!report) return null;
  const en = report.lang === 'en';
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {report.kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
            <p className="text-[10px] text-[#64748b] leading-tight">{k.label}</p>
            <p className="text-sm font-bold text-[#0f172a] tabular-nums">{formatReportValue(k.value, k.format)}</p>
            {k.delta != null ? (
              <p className={`text-[10px] ${k.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {k.delta >= 0 ? '▲ +' : '▼ '}{Number(k.delta).toFixed(1)}%
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {report.charts.map((c) => (
        <div key={c.id} className="rounded-lg border border-slate-200 p-2">
          <p className="text-xs font-semibold text-[#0f172a] mb-1">{c.title}</p>
          <ReportChart chart={c} />
        </div>
      ))}
      {report.tables.map((t) => <ReportTable key={t.title} table={t} en={en} />)}
      {onExport ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => onExport('excel')}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            <MdTableChart className="text-base" /> {exporting === 'excel' ? (en ? 'Generating…' : 'Generando…') : (en ? 'Download Excel' : 'Descargar Excel')}
          </button>
          <button
            type="button"
            onClick={() => onExport('pdf')}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            <MdPictureAsPdf className="text-base" /> {en ? 'Download PDF' : 'Descargar PDF'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
