import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { MdHotel, MdRefresh } from 'react-icons/md';
import toast from 'react-hot-toast';
import { api, formatCurrency, formatDateKey, formatDateTime } from '../../utils/api';
import { downloadBlobFile, downloadExcelFile } from '../../utils/inventoryCuadreExport';
import { buildStyledInformeExcelHtml, formatSolesExcel } from '../../utils/informeExcelHtml';
import DownloadExcelTxtButtons from './DownloadExcelTxtButtons';
import { useAuth } from '../../context/AuthContext';

function monthStart() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayKey() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function cellText(column, row) {
  const value = row[column.key];
  if (column.money) return formatCurrency(value);
  if (column.key === 'check_in' || column.key === 'check_out') return value ? formatDateKey(value) : '';
  if (column.key === 'paid_at') return value ? formatDateTime(value) : '';
  return value == null || value === '' ? '' : String(value);
}

export default function HotelReportSection() {
  const { user } = useAuth();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKey);
  const [status, setStatus] = useState('all');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (status) q.set('status', status);
    api.get(`/reports/hoteleria?${q.toString()}`)
      .then((data) => {
        setReport(data);
        setError('');
      })
      .catch((err) => {
        setReport(null);
        setError(err.message || 'No se pudo cargar el informe de hotelería');
      })
      .finally(() => setLoading(false));
  }, [from, to, status]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = report?.columns || [];
  const tableColumns = useMemo(
    () => columns.filter((col) => col.key !== 'products_summary'),
    [columns],
  );
  const rows = report?.rows || [];
  const summary = report?.summary || {};

  const downloadExcel = () => {
    if (!rows.length) return toast.error('No hay estadías en este periodo');
    const html = buildStyledInformeExcelHtml({
      title: report?.title || 'Informe de Hotelería',
      sheetName: 'Hotelería',
      periodLabel: `${formatDateKey(from)} al ${formatDateKey(to)}`,
      usuario: user?.full_name || user?.username || '',
      headers: columns.map((col) => ({ label: col.label, width: col.money ? 90 : 120 })),
      rows: rows.map((row) => columns.map((col) => ({
        text: col.money ? formatSolesExcel(row[col.key]) : cellText(col, row),
        align: col.align || 'left',
      }))),
      totalCells: columns.map((col, index) => {
        if (index === 0) return { text: 'TOTAL', align: 'left' };
        if (col.key === 'nights') return { text: String(summary.nights || 0), align: 'right' };
        if (col.key === 'lodging_total') return { text: formatSolesExcel(summary.lodging_total), align: 'right' };
        if (col.key === 'products_total') return { text: formatSolesExcel(summary.products_total), align: 'right' };
        if (col.key === 'total') return { text: formatSolesExcel(summary.total), align: 'right' };
        return { text: '' };
      }),
    });
    downloadExcelFile(`informe-hoteleria-${from}-${to}`, html);
  };

  const downloadTxt = () => {
    if (!rows.length) return toast.error('No hay estadías en este periodo');
    const header = columns.map((col) => col.label).join('\t');
    const body = rows.map((row) => columns.map((col) => cellText(col, row)).join('\t')).join('\n');
    const totals = [
      `Estadías: ${summary.stays || 0}`,
      `Abiertas: ${summary.open || 0}`,
      `Cobradas: ${summary.closed || 0}`,
      `Noches: ${summary.nights || 0}`,
      `Hospedaje: ${formatCurrency(summary.lodging_total)}`,
      `Productos: ${formatCurrency(summary.products_total)}`,
      `Total: ${formatCurrency(summary.total)}`,
    ].join('\n');
    downloadBlobFile(
      `informe-hoteleria-${from}-${to}.txt`,
      `${report?.title || 'Informe de Hotelería'}\n${from} al ${to}\n\n${header}\n${body}\n\n${totals}\n`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-bold rf-section-title flex items-center gap-2">
            <MdHotel className="text-[var(--ui-accent)]" /> {report?.title || 'Informe de Hotelería'}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <DownloadExcelTxtButtons onExcel={downloadExcel} onTxt={downloadTxt} disabled={!rows.length} />
            <button type="button" className="btn-secondary text-xs" onClick={load}>
              <MdRefresh className="inline" /> Actualizar
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-sm text-[var(--ui-body-text)]">Desde
            <input type="date" className="input-field mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-sm text-[var(--ui-body-text)]">Hasta
            <input type="date" className="input-field mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-sm text-[var(--ui-body-text)]">Estado
            <select className="input-field mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todas</option>
              <option value="open">Abiertas</option>
              <option value="paid">Cobradas</option>
              <option value="courtesy">Cortesía</option>
              <option value="cancelled">Anuladas</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--ui-muted)] mt-2">Incluye las estadías con ingreso o cobro en el periodo. Las cuentas abiertas se muestran siempre.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Estadías</p><p className="text-2xl font-bold text-[var(--ui-body-text)]">{summary.stays || 0}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Abiertas</p><p className="text-2xl font-bold text-[var(--ui-accent)]">{summary.open || 0}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Hospedaje</p><p className="text-2xl font-bold text-[var(--ui-body-text)]">{formatCurrency(summary.lodging_total)}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Total</p><p className="text-2xl font-bold text-[var(--ui-body-text)]">{formatCurrency(summary.total)}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Promedio por noche</p><p className="text-2xl font-bold text-[var(--ui-body-text)]">{summary.nights > 0 ? formatCurrency(summary.lodging_total / summary.nights) : formatCurrency(0)}</p></div>
        <div className="card"><p className="text-xs text-[var(--ui-muted)]">Noches por estadía</p><p className="text-2xl font-bold text-[var(--ui-body-text)]">{summary.stays > 0 ? (summary.nights / summary.stays).toFixed(1) : '0'}</p></div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? <p className="text-[var(--ui-muted)]">Cargando informe…</p> : null}
        {!loading && error ? <p className="text-sm text-red-500">{error}</p> : null}
        {!loading && !error && !rows.length ? <p className="text-[var(--ui-muted)]">No hay estadías en este periodo.</p> : null}
        {!loading && !error && rows.length ? (
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-[color:var(--ui-border)]">
                {tableColumns.map((col) => (
                  <th key={col.key} className={`py-2 px-2 text-xs uppercase text-[var(--ui-muted)] ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className="border-b border-[color:var(--ui-border)] cursor-pointer hover:bg-[var(--ui-sidebar-hover)]"
                    onClick={() => setOpenId((prev) => (prev === row.id ? '' : row.id))}
                  >
                    {tableColumns.map((col) => (
                      <td key={col.key} className={`py-2 px-2 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.key === 'total' ? 'font-bold text-[var(--ui-accent)]' : ''}`}>
                        {cellText(col, row) || '—'}
                      </td>
                    ))}
                  </tr>
                  {openId === row.id ? (
                    <tr className="border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                      <td colSpan={tableColumns.length} className="px-3 py-3">
                        <p className="text-xs font-semibold mb-2 text-[var(--ui-body-text)]">Cuenta de la habitación</p>
                        <ul className="space-y-1">
                          {(row.lines || []).map((line, index) => (
                            <li key={`${row.id}-${index}`} className="flex justify-between gap-3 text-sm">
                              <span>{line.quantity} × {line.name}{line.kind === 'hospedaje' ? ' (hospedaje)' : ''}</span>
                              <span>{formatCurrency(line.subtotal)}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
