import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, formatCurrency, formatDate, formatDateTime, resolveMediaUrl } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import {
  MdCalendarToday,
  MdCalendarMonth,
  MdEmojiEvents,
  MdTrendingUp,
  MdReceipt,
  MdAttachMoney,
  MdVisibility,
  MdRefresh,
  MdPointOfSale,
  MdDownload,
  MdPrint,
  MdShoppingCart,
  MdVolunteerActivism,
  MdAutoGraph,
  MdLocalOffer,
  MdPayments,
  MdWarning,
  MdInventory2,
} from 'react-icons/md';
import Modal from '../../components/Modal';
import CortesiasReportSection from '../../components/admin/CortesiasReportSection';
import toast from 'react-hot-toast';
import { summarizePaidSalesAccounts } from '../../utils/mesaOrderLines';

const FINANCE_LOSS_LABELS = {
  salida_efectivo: 'Salida de efectivo',
  gasto_extra: 'Gasto extra',
  merma: 'Merma',
  danio_propiedad: 'Daño en propiedad',
  reembolso: 'Reembolso',
  otro: 'Otro',
};
const DENOMINATION_LABELS = {
  b200: 'Billete S/200',
  b100: 'Billete S/100',
  b50: 'Billete S/50',
  b20: 'Billete S/20',
  b10: 'Billete S/10',
  m5: 'Moneda S/5',
  m2: 'Moneda S/2',
  m1: 'Moneda S/1',
  c50: 'Moneda S/0.50',
  c20: 'Moneda S/0.20',
  c10: 'Moneda S/0.10',
};

function downloadBlobFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildProductSalesTxt(report, title = 'INFORME DE PRODUCTOS') {
  const lines = [title, '='.repeat(Math.min(title.length, 40)), ''];
  const filters = report?.filters || {};
  if (report?.mode === 'current') {
    lines.push('Periodo: caja actual (turno abierto)');
  } else if (report?.mode === 'date_range') {
    lines.push(`Periodo: ${filters.from || '—'} al ${filters.to || '—'}`);
  } else if (report?.mode === 'registers') {
    lines.push(`Cierres seleccionados: ${(filters.register_ids || []).length}`);
  }
  lines.push('');

  const writeProducts = (products, heading) => {
    if (heading) {
      lines.push(heading);
      lines.push('-'.repeat(40));
    }
    (products || []).forEach((row) => {
      lines.push(
        `${row.product_name}\tCant: ${Number(row.total_qty || 0)}\tP.unit: ${formatCurrency(row.unit_price || 0)}\tTotal: ${formatCurrency(row.total_amount || 0)}`
      );
    });
    if (!(products || []).length) lines.push('(Sin productos)');
    lines.push('');
  };

  if (Array.isArray(report?.by_register) && report.by_register.length > 1) {
    report.by_register.forEach((block, idx) => {
      const label = block.is_open
        ? `Turno abierto · ${block.user_name || '—'} · desde ${formatDateTime(block.opened_at)}`
        : `Cierre ${idx + 1} · ${block.user_name || '—'} · ${formatDateTime(block.closed_at)}`;
      writeProducts(block.sold_products, label);
    });
    lines.push('TOTAL CONSOLIDADO');
    lines.push('-'.repeat(40));
  }

  writeProducts(report?.sold_products || []);
  lines.push(`TOTAL VENTAS (productos): ${formatCurrency(report?.product_sales_total ?? 0)}`);
  return `${lines.join('\n')}\n`;
}

function buildProductSalesCsv(report) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Producto', 'Cantidad', 'Precio unit.', 'Total', 'Cuentas']];
  (report?.sold_products || []).forEach((row) => {
    rows.push([
      row.product_name,
      Number(row.total_qty || 0),
      Number(row.unit_price || 0).toFixed(2),
      Number(row.total_amount || 0).toFixed(2),
      Number(row.order_count || 0),
    ]);
  });
  rows.push(['TOTAL', '', '', Number(report?.product_sales_total || 0).toFixed(2), '']);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

function sumProductSalesQty(products) {
  return (products || []).reduce((s, r) => s + Number(r.total_qty || 0), 0);
}

function sumProductSalesAmount(products) {
  return (products || []).reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
}

function ProductSalesTable({ products, showOrders = false, emptyMessage = 'No hay productos vendidos en el periodo.' }) {
  const rows = products || [];
  if (!rows.length) {
    return <p className="text-sm text-[var(--ui-muted)]">{emptyMessage}</p>;
  }
  const totalQty = sumProductSalesQty(rows);
  const totalAmount = sumProductSalesAmount(rows);
  return (
    <div className="overflow-x-auto rounded-xl border border-[color:var(--ui-border)]">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 bg-[var(--ui-surface-2)] border-b border-[color:var(--ui-border)] text-xs text-[var(--ui-muted)]">
        <span><strong className="text-[var(--ui-body-text)]">{rows.length}</strong> producto(s)</span>
        <span><strong className="text-[var(--ui-body-text)]">{totalQty}</strong> unidades vendidas</span>
        <span>Total ventas: <strong className="text-emerald-600">{formatCurrency(totalAmount)}</strong></span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
            <th className="text-left py-2 px-3 text-xs uppercase text-[var(--ui-muted)]">Producto</th>
            <th className="text-right py-2 px-3 text-xs uppercase text-[var(--ui-muted)]">Cantidad</th>
            <th className="text-right py-2 px-3 text-xs uppercase text-[var(--ui-muted)]">Precio U</th>
            <th className="text-right py-2 px-3 text-xs uppercase text-[var(--ui-muted)]">Precio total</th>
            {showOrders ? (
              <th className="text-right py-2 px-3 text-xs uppercase text-[var(--ui-muted)]">Cuentas</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.product_id}-${row.product_name}`} className="border-b border-[color:var(--ui-border)]">
              <td className="py-2 px-3 font-medium">{row.product_name}</td>
              <td className="py-2 px-3 text-right tabular-nums font-semibold text-[#3B82F6]">{Number(row.total_qty || 0)}</td>
              <td className="py-2 px-3 text-right tabular-nums text-[var(--ui-muted)]">{formatCurrency(row.unit_price || 0)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{formatCurrency(row.total_amount || 0)}</td>
              {showOrders ? (
                <td className="py-2 px-3 text-right tabular-nums text-[var(--ui-muted)]">{Number(row.order_count || 0)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--ui-surface-2)] font-bold border-t border-[color:var(--ui-border)]">
            <td className="py-3 px-3 text-[var(--ui-body-text)]">TOTAL ({rows.length} productos)</td>
            <td className="py-3 px-3 text-right tabular-nums text-[#3B82F6]">{totalQty}</td>
            <td className="py-3 px-3" />
            <td className="py-3 px-3 text-right tabular-nums text-emerald-600">{formatCurrency(totalAmount)}</td>
            {showOrders ? <td className="py-3 px-3" /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const DENOMINATION_VALUES = {
  b200: 200,
  b100: 100,
  b50: 50,
  b20: 20,
  b10: 10,
  m5: 5,
  m2: 2,
  m1: 1,
  c50: 0.5,
  c20: 0.2,
  c10: 0.1,
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const CLOSED_REGISTER_PRINT_STYLES = `
  @page { margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111827; padding: 0; margin: 0; }
  h2 { font-size: 16px; margin: 0 0 4px; text-transform: uppercase; color: #111827; }
  h3 { font-size: 13px; font-weight: 500; margin: 0 0 12px; color: #374151; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 12px 0 6px; color: #374151; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 2px 0; color: #111827; }
  .row span:last-child { text-align: right; }
  .row.bold { font-weight: 700; }
  .total-row { font-weight: 700; }
  .sep { border-top: 1px dashed #9ca3af; margin: 8px 0; }
  .diff-pos { color: #047857; font-weight: 700; }
  .diff-neg { color: #b91c1c; font-weight: 700; }
  .muted { color: #6b7280; font-size: 11px; }
  .products-table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 11px; }
  .products-table th, .products-table td { padding: 3px 4px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .products-table th.num, .products-table td.num { text-align: right; white-space: nowrap; }
  .products-table thead th { font-size: 10px; text-transform: uppercase; color: #6b7280; }
`;

function buildSoldProductsPrintTable(soldProducts = []) {
  if (!Array.isArray(soldProducts) || !soldProducts.length) return '';
  const rows = soldProducts
    .map((item) => {
      const qty = Number(item.total_qty || 0);
      const total = Number(item.total_amount || 0);
      const unit = qty > 0 ? total / qty : Number(item.unit_price || 0);
      return `<tr>
        <td>${escapeHtml(item.product_name || '-')}</td>
        <td class="num">${qty}</td>
        <td class="num">${escapeHtml(formatCurrency(unit))}</td>
        <td class="num">${escapeHtml(formatCurrency(total))}</td>
      </tr>`;
    })
    .join('');
  return `<p class="section-title">Productos vendidos</p>
    <table class="products-table">
      <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildClosedRegisterPrintHtml(register) {
  if (!register) return '';
  const arqueo = register.arqueo || {};
  const diff = Number(arqueo.difference ?? 0);
  const diffClass = diff >= 0 ? 'diff-pos' : 'diff-neg';
  const counted = arqueo.counted_cash ?? register.closing_amount ?? 0;
  const onlineAmt = Number(arqueo.payment_breakdown?.online ?? 0);
  const parts = [];
  const row = (left, right, cls = 'row') =>
    `<div class="${cls}"><span>${escapeHtml(left)}</span><span>${escapeHtml(right)}</span></div>`;

  parts.push('<h2>REPORTE DE CIERRE DE CAJA</h2>');
  parts.push(`<h3>${escapeHtml(register.user_name || '-')} — ${escapeHtml(formatDateTime(register.closed_at))}</h3>`);
  parts.push('<div class="sep"></div>');
  parts.push(row('Apertura', formatDateTime(register.opened_at)));
  parts.push(row('Cierre', formatDateTime(register.closed_at)));
  parts.push('<div class="sep"></div>');
  parts.push(row('MONTO APERTURA', formatCurrency(register.opening_amount || 0), 'row bold'));
  parts.push('<div class="sep"></div>');
  parts.push(row('Ventas (Efectivo)', formatCurrency(register.total_cash || 0)));
  parts.push(row('Ventas (Yape)', formatCurrency(register.total_yape || 0)));
  parts.push(row('Ventas (Plin)', formatCurrency(register.total_plin || 0)));
  parts.push(row('Ventas (Tarjeta)', formatCurrency(register.total_card || 0)));
  if (onlineAmt > 0) parts.push(row('Ventas (Online)', formatCurrency(onlineAmt)));
  parts.push('<div class="sep"></div>');
  parts.push(row('TOTAL VENTAS', formatCurrency(register.total_sales || 0), 'row total-row'));
  parts.push(row('Propinas', formatCurrency(arqueo.total_tips || 0)));
  parts.push(buildSoldProductsPrintTable(register.sold_products));
  parts.push('<div class="sep"></div>');
  parts.push(row('EFECTIVO ESPERADO', formatCurrency(arqueo.expected_cash || 0), 'row bold'));
  parts.push('<div class="sep"></div>');
  parts.push(row('DETALLE ARQUEO', '', 'row bold'));
  Object.entries(DENOMINATION_LABELS).forEach(([key, label]) => {
    const qty = Number(arqueo.denominations?.[key] || 0);
    if (qty > 0) {
      const subtotal = qty * (DENOMINATION_VALUES[key] || 0);
      parts.push(row(`${label} x ${qty}`, formatCurrency(subtotal)));
    }
  });
  parts.push(row('EFECTIVO CONTADO', formatCurrency(counted), 'row bold'));
  parts.push(
    `<div class="row bold ${diffClass}"><span>DIFERENCIA</span><span>${diff > 0 ? '+' : ''}${escapeHtml(formatCurrency(diff))}</span></div>`
  );
  const obs = arqueo.observations || register.notes || '';
  if (obs) parts.push(row('OBS:', obs));

  const incomeMov = (register.movements || []).filter((m) => m.type === 'income');
  const expenseMov = (register.movements || []).filter((m) => m.type === 'expense');
  const notesDebit = (register.notes_list || []).filter((n) => n.note_type === 'debit');
  const notesCredit = (register.notes_list || []).filter((n) => n.note_type === 'credit');

  if (incomeMov.length) {
    parts.push('<p class="section-title">Ingresos</p>');
    incomeMov.forEach((mv) => {
      parts.push(row(`${formatDateTime(mv.created_at)} · ${mv.concept || '-'}`, formatCurrency(mv.amount || 0)));
    });
  }
  if (expenseMov.length) {
    parts.push('<p class="section-title">Egresos</p>');
    expenseMov.forEach((mv) => {
      parts.push(row(`${formatDateTime(mv.created_at)} · ${mv.concept || '-'}`, formatCurrency(mv.amount || 0)));
    });
  }
  if (notesDebit.length) {
    parts.push('<p class="section-title">Notas de débito</p>');
    notesDebit.forEach((note) => {
      parts.push(row(`${formatDateTime(note.created_at)} · ${note.reason || '-'}`, formatCurrency(note.amount || 0)));
    });
  }
  if (notesCredit.length) {
    parts.push('<p class="section-title">Notas de crédito</p>');
    notesCredit.forEach((note) => {
      parts.push(row(`${formatDateTime(note.created_at)} · ${note.reason || '-'}`, formatCurrency(note.amount || 0)));
    });
  }

  return parts.join('');
}

function printClosedRegisterHtml(bodyHtml) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc || !iframe.contentWindow) {
    document.body.removeChild(iframe);
    throw new Error('No se pudo preparar la impresión');
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Cierre de caja</title>
    <style>${CLOSED_REGISTER_PRINT_STYLES}</style>
  </head>
  <body>${bodyHtml}</body>
</html>`);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    }, 700);
  }, 200);
}

function formatPct1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(1)}%`;
}

/** Umbrales del módulo empresarial + lectura frente al resumen del rango (Informes · Finanzas). */
function FinanceBusinessIntelPanel({ overview }) {
  const bi = overview?.business_intel;
  if (!bi || typeof bi !== 'object') return null;

  const sales = Number(overview.sales?.total || 0);
  const gross = Number(overview.approx_gross_margin ?? 0);
  const profit = Number(overview.approx_profit ?? 0);
  const losses = Number(overview.losses_combined_total ?? 0);
  const grossPct = sales > 0 ? (gross / sales) * 100 : null;
  const netPct = sales > 0 ? (profit / sales) * 100 : null;
  const lossRatioPct = sales > 0 ? (losses / sales) * 100 : null;

  const minG = Number(bi.prof_margin_min_pct);
  const idealG = Number(bi.prof_margin_ideal_pct);
  const critG = Number(bi.prof_margin_critical_pct);
  const targetNet = Number(bi.prof_target_net_margin_pct);
  const varTol = Number(bi.var_tolerance_pct);
  const overhead = Number(bi.gen_indirect_overhead_pct);

  let grossLabel = 'Sin ventas en el rango';
  let grossClass = 'ui-bi-status';
  if (grossPct != null && Number.isFinite(grossPct)) {
    if (Number.isFinite(critG) && grossPct < critG) {
      grossLabel = `Por debajo del margen crítico (${formatPct1(critG)})`;
      grossClass = 'ui-bi-status ui-bi-status--bad';
    } else if (Number.isFinite(minG) && grossPct < minG) {
      grossLabel = `Por debajo del mínimo objetivo (${formatPct1(minG)})`;
      grossClass = 'ui-bi-status ui-bi-status--warn';
    } else if (Number.isFinite(idealG) && grossPct >= idealG) {
      grossLabel = `En o por encima del ideal (${formatPct1(idealG)})`;
      grossClass = 'ui-bi-status ui-bi-status--ok';
    } else {
      grossLabel = 'Dentro del rango operativo';
      grossClass = 'ui-bi-status ui-bi-status--neutral';
    }
  }

  let netLabel = 'Sin ventas en el rango';
  let netClass = 'ui-bi-status';
  if (netPct != null && Number.isFinite(netPct)) {
    if (profit < 0) {
      netLabel = 'Resultado neto aproximado negativo';
      netClass = 'ui-bi-status ui-bi-status--bad';
    } else if (Number.isFinite(targetNet) && netPct < targetNet) {
      netLabel = `Por debajo del objetivo de utilidad neta (${formatPct1(targetNet)})`;
      netClass = 'ui-bi-status ui-bi-status--warn';
    } else {
      netLabel = 'En o por encima del objetivo de utilidad neta';
      netClass = 'ui-bi-status ui-bi-status--ok';
    }
  }

  let lossLabel = 'Sin ventas en el rango';
  let lossClass = 'ui-bi-status';
  if (lossRatioPct != null && Number.isFinite(lossRatioPct) && sales > 0) {
    if (Number.isFinite(varTol) && lossRatioPct >= varTol) {
      lossLabel = `Salidas combinadas ≥ umbral de alertas (${formatPct1(varTol)} sobre ventas)`;
      lossClass = 'ui-bi-status ui-bi-status--warn';
    } else {
      lossLabel = 'Por debajo del umbral usado en alertas operativas';
      lossClass = 'ui-bi-status ui-bi-status--neutral';
    }
  }

  const rows = [
    { k: 'Margen bruto mínimo objetivo', v: formatPct1(minG) },
    { k: 'Margen bruto ideal', v: formatPct1(idealG) },
    { k: 'Margen crítico', v: formatPct1(critG) },
    { k: 'Utilidad neta objetivo', v: formatPct1(targetNet) },
    { k: 'Tolerancia teórico vs real (alertas gastos/ventas)', v: formatPct1(varTol) },
    { k: 'Costos indirectos estimados (referencia)', v: formatPct1(overhead) },
  ];

  return (
    <div className="ui-bi-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdAutoGraph className="text-[var(--ui-accent-muted)] text-xl shrink-0" />
            Rentabilidad según módulo empresarial
          </h3>
          <p className="text-xs text-[var(--ui-muted)] mt-1 max-w-3xl">
            Los porcentajes se configuran en Configuración → Módulo empresarial (dominio Rentabilidad y relacionados). Aquí se
            comparan con el resumen del rango de fechas seleccionado.
          </p>
        </div>
        <Link
          to="/admin/configuracion"
          className="text-sm font-semibold text-[var(--ui-accent-muted)] hover:underline whitespace-nowrap"
        >
          Editar umbrales
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {rows.map((r) => (
          <div key={r.k} className="ui-bi-threshold">
            <p className="ui-bi-threshold__label">{r.k}</p>
            <p className="ui-bi-threshold__value">{r.v}</p>
          </div>
        ))}
      </div>
      {sales > 0 && (
        <div className="ui-bi-reading">
          <p className="text-xs font-semibold text-[var(--ui-muted)] uppercase tracking-wide mb-3">Lectura en este rango</p>
          <ul className="space-y-2 text-sm text-[var(--ui-body-text)]">
            <li className="flex flex-wrap justify-between gap-2">
              <span className="text-[var(--ui-muted)]">Margen bruto aprox. / ventas</span>
              <span className="tabular-nums font-semibold">{formatPct1(grossPct)}</span>
            </li>
            <li className={grossClass}>{grossLabel}</li>
            <li className="flex flex-wrap justify-between gap-2 mt-2">
              <span className="text-[var(--ui-muted)]">Utilidad neta aprox. / ventas</span>
              <span className="tabular-nums font-semibold">{formatPct1(netPct)}</span>
            </li>
            <li className={netClass}>{netLabel}</li>
            <li className="flex flex-wrap justify-between gap-2 mt-2">
              <span className="text-[var(--ui-muted)]">Salidas combinadas / ventas</span>
              <span className="tabular-nums font-semibold">{formatPct1(lossRatioPct)}</span>
            </li>
            <li className={lossClass}>{lossLabel}</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function localTodayYmd() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function localMonthYm() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = String(ym).split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
}

function openNativeDatePicker(inputEl) {
  if (!inputEl) return;
  if (typeof inputEl.showPicker === 'function') {
    try {
      inputEl.showPicker();
      return;
    } catch (_) {
      // fallback below
    }
  }
  inputEl.click();
}

export default function Reports() {
  const [searchParams] = useSearchParams();
  const [reportSection, setReportSection] = useState('ventas');
  const [tab, setTab] = useState('daily');
  const [salesDailyDate, setSalesDailyDate] = useState(localTodayYmd);
  const [salesMonth, setSalesMonth] = useState(localMonthYm);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const dailyDateInputRef = useRef(null);
  const monthInputRef = useRef(null);
  const [dailyData, setDailyData] = useState(null);
  const [monthlyData, setMonthlyData] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [rankingPeriod, setRankingPeriod] = useState('month');
  const [purchaseExpenses, setPurchaseExpenses] = useState([]);
  const [inventoryReconciliations, setInventoryReconciliations] = useState([]);
  const [inventoryAlerts, setInventoryAlerts] = useState([]);
  const [inventoryMovementsTab, setInventoryMovementsTab] = useState('stock_minimo');
  const [billingDocuments, setBillingDocuments] = useState([]);
  const [billingStatusFilter, setBillingStatusFilter] = useState('all');
  const [billingTypeFilter, setBillingTypeFilter] = useState('all');
  const [billingSearch, setBillingSearch] = useState('');
  const [retryingDocId, setRetryingDocId] = useState('');
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [billingPdfPreview, setBillingPdfPreview] = useState(null);
  const [selectedClosedRegister, setSelectedClosedRegister] = useState(null);
  const [loadingClosedRegister, setLoadingClosedRegister] = useState(false);
  const [printingClosedRegisterId, setPrintingClosedRegisterId] = useState('');
  const [productoInformeDetail, setProductoInformeDetail] = useState(null);
  const [productoInformeLoading, setProductoInformeLoading] = useState(false);
  const [productoInformeRegisterId, setProductoInformeRegisterId] = useState('');
  const [productoInformeModalOpen, setProductoInformeModalOpen] = useState(false);
  const [productoTotalMode, setProductoTotalMode] = useState('fechas');
  const [productoFrom, setProductoFrom] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 30);
    return t.toISOString().split('T')[0];
  });
  const [productoTo, setProductoTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [productoSelectedIds, setProductoSelectedIds] = useState(() => new Set());
  const [productoTotalReport, setProductoTotalReport] = useState(null);
  const [productoTotalLoading, setProductoTotalLoading] = useState(false);
  const [productoCurrentReport, setProductoCurrentReport] = useState(null);
  const [productoCurrentLoading, setProductoCurrentLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const [financeFrom, setFinanceFrom] = useState(() => {
    const t = new Date();
    t.setDate(t.getDate() - 30);
    return t.toISOString().split('T')[0];
  });
  const [financeTo, setFinanceTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [financeOverview, setFinanceOverview] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [lossEvents, setLossEvents] = useState(null);
  const [lossCategoryFilter, setLossCategoryFilter] = useState('all');
  const [lossForm, setLossForm] = useState({
    category: 'gasto_extra',
    amount: '',
    concept: '',
    itemsText: '',
    occurred_at: '',
  });

  const loadDaily = useCallback((date = salesDailyDate) => {
    setDailyLoading(true);
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return api.get(`/reports/daily${qs}`)
      .then(setDailyData)
      .catch(console.error)
      .finally(() => setDailyLoading(false));
  }, [salesDailyDate]);

  const loadMonthly = useCallback((month = salesMonth) => {
    setMonthlyLoading(true);
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    return api.get(`/reports/monthly${qs}`)
      .then(setMonthlyData)
      .catch(console.error)
      .finally(() => setMonthlyLoading(false));
  }, [salesMonth]);
  const loadRanking = (period) => api.get(`/reports/ranking?period=${period}`).then(setRanking).catch(console.error);
  const loadBillingDocuments = async ({
    status = billingStatusFilter,
    docType = billingTypeFilter,
    search = billingSearch,
  } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', '150');
    if (status && status !== 'all') params.set('status', status);
    if (docType && docType !== 'all') params.set('doc_type', docType);
    if (search.trim()) params.set('search', search.trim());
    const docs = await api.get(`/billing/documents?${params.toString()}`);
    setBillingDocuments(Array.isArray(docs) ? docs : []);
  };

  const loadBillingDocumentsRef = useRef(loadBillingDocuments);
  loadBillingDocumentsRef.current = loadBillingDocuments;
  const reportSectionRef = useRef(reportSection);
  reportSectionRef.current = reportSection;

  useSocket(
    'billing-document-update',
    useCallback(() => {
      if (reportSectionRef.current !== 'facturacion') return;
      loadBillingDocumentsRef.current().catch(() => setBillingDocuments([]));
    }, [])
  );

  useEffect(() => {
    Promise.all([
      loadRanking('month'),
      api.get('/inventory/expenses').then(setPurchaseExpenses).catch(() => setPurchaseExpenses([])),
      api.get('/inventory/reconciliations').then(setInventoryReconciliations).catch(() => setInventoryReconciliations([])),
      api.get('/inventory/alerts').then(setInventoryAlerts).catch(() => setInventoryAlerts([])),
      loadBillingDocuments().catch(() => setBillingDocuments([])),
    ])
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (reportSection !== 'ventas' || tab !== 'daily') return;
    loadDaily(salesDailyDate);
  }, [salesDailyDate, tab, reportSection, loadDaily]);

  useEffect(() => {
    if (reportSection !== 'ventas' || tab !== 'monthly') return;
    loadMonthly(salesMonth);
  }, [salesMonth, tab, reportSection, loadMonthly]);

  useEffect(() => {
    if (searchParams.get('seccion') === 'facturacion') {
      setReportSection('facturacion');
    } else if (searchParams.get('seccion') === 'productos') {
      setReportSection('productos');
    } else if (searchParams.get('seccion') === 'finanzas') {
      setReportSection('finanzas');
    } else if (searchParams.get('seccion') === 'cortesias' || searchParams.get('seccion') === 'descuentos') {
      setReportSection('descuentos');
    }
  }, [searchParams]);

  const inventoryCuadreLines = useMemo(() => (
    inventoryReconciliations.flatMap((rec) =>
      (rec.items || [])
        .filter((item) => Number(item.difference || 0) !== 0)
        .map((item) => ({
          id: `${rec.id}-${item.id}`,
          created_at: rec.created_at,
          warehouse_name: rec.warehouse_name || 'Almacén',
          product_name: item.product_name,
          counted_stock: Number(item.counted_stock || 0),
          difference: Number(item.difference || 0),
        }))
    ).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  ), [inventoryReconciliations]);

  useEffect(() => { loadRanking(rankingPeriod); }, [rankingPeriod]);

  useEffect(() => {
    if (reportSection !== 'productos') return undefined;
    let cancelled = false;
    (async () => {
      setProductoCurrentLoading(true);
      try {
        const current = await api.get('/reports/product-sales?current=1');
        if (!cancelled) setProductoCurrentReport(current);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setProductoCurrentLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reportSection]);

  useEffect(() => {
    setProductoTotalReport(null);
  }, [productoTotalMode]);

  const closedRegistersList = useMemo(
    () => monthlyData?.closedRegisters || [],
    [monthlyData?.closedRegisters],
  );

  useEffect(() => {
    if (productoTotalMode !== 'cierres') return;
    if (!closedRegistersList.length) {
      setProductoSelectedIds(new Set());
      setProductoTotalReport(null);
      return;
    }
    setProductoSelectedIds((prev) => {
      const valid = [...prev].filter((id) => closedRegistersList.some((r) => r.id === id));
      if (valid.length) return new Set(valid);
      return new Set([closedRegistersList[0].id]);
    });
  }, [productoTotalMode, closedRegistersList]);
  useEffect(() => {
    if (reportSection !== 'finanzas') return undefined;
    let cancelled = false;
    setFinanceLoading(true);
    const q1 = new URLSearchParams({ from: financeFrom, to: financeTo });
    const q2 = new URLSearchParams({ from: financeFrom, to: financeTo });
    if (lossCategoryFilter !== 'all') q2.set('category', lossCategoryFilter);
    Promise.all([
      api.get(`/reports/finance-overview?${q1}`),
      api.get(`/reports/finance-loss-events?${q2}`),
    ])
      .then(([ov, ev]) => {
        if (cancelled) return;
        setFinanceOverview(ov);
        setLossEvents(ev);
      })
      .catch(() => {
        if (!cancelled) {
          setFinanceOverview(null);
          setLossEvents(null);
        }
      })
      .finally(() => {
        if (!cancelled) setFinanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportSection, financeFrom, financeTo, lossCategoryFilter]);
  useEffect(() => {
    if (reportSection !== 'facturacion') return;
    loadBillingDocuments().catch(() => setBillingDocuments([]));
  }, [reportSection, billingStatusFilter, billingTypeFilter]);

  const retryDocument = async (docId) => {
    try {
      setRetryingDocId(docId);
      await api.post(`/billing/${docId}/retry`, {});
      toast.success('Comprobante reenviado');
      await loadBillingDocuments();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetryingDocId('');
    }
  };

  const retryFailedDocuments = async () => {
    try {
      setRetryingFailed(true);
      const result = await api.post('/billing/retry-failed', { limit: 30 });
      toast.success(`Reintento completado: ${result.success} exitosos de ${result.processed}`);
      await loadBillingDocuments();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetryingFailed(false);
    }
  };
  const closeProductoInformeModal = () => {
    setProductoInformeModalOpen(false);
    setProductoInformeDetail(null);
    setProductoInformeRegisterId('');
    setProductoInformeLoading(false);
  };

  const openProductoInforme = async (register) => {
    if (!register?.id) return;
    if (productoTotalMode === 'cierres') {
      setProductoSelectedIds(new Set([register.id]));
      return;
    }
    setProductoInformeModalOpen(true);
    setProductoInformeRegisterId(register.id);
    setProductoInformeLoading(true);
    setProductoInformeDetail(null);
    try {
      const d = await api.get(`/reports/closed-registers/${register.id}`);
      setProductoInformeDetail(d);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el informe de productos');
      setProductoInformeDetail(null);
    } finally {
      setProductoInformeLoading(false);
    }
  };

  const downloadProductSalesReport = (report, baseName, format = 'both') => {
    if (!report?.sold_products?.length && !(report?.by_register || []).some((b) => b.sold_products?.length)) {
      toast.error('No hay productos para descargar');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'txt' || format === 'both') {
      downloadBlobFile(`${baseName}-${stamp}.txt`, buildProductSalesTxt(report));
    }
    if (format === 'csv' || format === 'both') {
      downloadBlobFile(`${baseName}-${stamp}.csv`, buildProductSalesCsv(report), 'text/csv;charset=utf-8');
    }
    if (format === 'both') toast.success('Descargados TXT y CSV');
  };

  const productoSelectedKey = useMemo(
    () => [...productoSelectedIds].sort().join(','),
    [productoSelectedIds],
  );

  useEffect(() => {
    if (productoTotalMode !== 'cierres') return undefined;
    const ids = productoSelectedKey ? productoSelectedKey.split(',').filter(Boolean) : [];
    if (!ids.length) {
      setProductoTotalReport(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      setProductoTotalLoading(true);
      try {
        const report = await api.get(`/reports/product-sales?register_ids=${encodeURIComponent(ids.join(','))}`);
        if (!cancelled) setProductoTotalReport(report);
      } catch (err) {
        if (!cancelled) {
          toast.error(err.message || 'No se pudo cargar el informe de cierres');
          setProductoTotalReport(null);
        }
      } finally {
        if (!cancelled) setProductoTotalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productoTotalMode, productoSelectedKey]);

  const loadProductoTotalReport = async () => {
    setProductoTotalLoading(true);
    setProductoTotalReport(null);
    try {
      const params = new URLSearchParams();
      if (productoTotalMode === 'fechas') {
        if (!productoFrom || !productoTo) {
          toast.error('Seleccione fecha desde y hasta');
          return;
        }
        params.set('from', productoFrom);
        params.set('to', productoTo);
      } else {
        toast.error('Seleccione al menos un cierre de caja en la lista');
        return;
      }
      const report = await api.get(`/reports/product-sales?${params.toString()}`);
      setProductoTotalReport(report);
    } catch (err) {
      toast.error(err.message || 'No se pudo generar el informe total');
    } finally {
      setProductoTotalLoading(false);
    }
  };

  const productoDisplayedProducts = useMemo(() => {
    if (!productoTotalReport) return [];
    return productoTotalReport.sold_products || [];
  }, [productoTotalReport]);

  const productoCierresSummary = useMemo(() => {
    if (productoTotalMode !== 'cierres') return '';
    const count = productoSelectedIds.size;
    if (!count) return 'Seleccione uno o más cierres';
    if (count === 1) {
      const reg = closedRegistersList.find((r) => productoSelectedIds.has(r.id));
      if (reg) {
        return `Cierre ${formatDateTime(reg.closed_at)} · ${reg.user_name || '—'}`;
      }
    }
    return `${count} cierres consolidados`;
  }, [productoTotalMode, productoSelectedIds, closedRegistersList]);

  const loadProductoCurrentReport = async ({ silent = false } = {}) => {
    setProductoCurrentLoading(true);
    if (!silent) setProductoCurrentReport(null);
    try {
      const report = await api.get('/reports/product-sales?current=1');
      setProductoCurrentReport(report);
      if (!report?.register_open && !silent) {
        toast.error('No hay caja abierta en este momento');
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar la caja actual');
    } finally {
      setProductoCurrentLoading(false);
    }
  };

  const toggleProductoRegisterSelect = (registerId) => {
    setProductoSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(registerId)) next.delete(registerId);
      else next.add(registerId);
      return next;
    });
  };

  const selectAllProductoRegisters = () => {
    const ids = closedRegistersList.map((r) => r.id).filter(Boolean);
    setProductoSelectedIds(new Set(ids));
  };

  const clearProductoRegisterSelection = () => {
    setProductoSelectedIds(new Set());
  };

  const openClosedRegisterDetail = async (register) => {
    if (!register?.id) return;
    try {
      setLoadingClosedRegister(true);
      const detail = await api.get(`/reports/closed-registers/${register.id}`);
      setSelectedClosedRegister(detail);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el detalle del cierre');
      setSelectedClosedRegister(register);
    } finally {
      setLoadingClosedRegister(false);
    }
  };

  const submitFinanceLoss = async () => {
    const amt = parseFloat(lossForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Monto inválido');
    let items = null;
    const raw = lossForm.itemsText.trim();
    if (raw) {
      try {
        items = JSON.parse(raw);
      } catch {
        return toast.error('Detalle de ítems: JSON inválido (usa un array, p. ej. [{"name":"Producto","qty":2}])');
      }
    }
    try {
      await api.post('/reports/finance-loss-events', {
        category: lossForm.category,
        amount: amt,
        concept: lossForm.concept.trim(),
        items,
        occurred_at: lossForm.occurred_at.trim() || undefined,
      });
      toast.success('Pérdida registrada');
      setLossForm((p) => ({ ...p, amount: '', concept: '', itemsText: '', occurred_at: '' }));
      const q1 = new URLSearchParams({ from: financeFrom, to: financeTo });
      const q2 = new URLSearchParams({ from: financeFrom, to: financeTo });
      if (lossCategoryFilter !== 'all') q2.set('category', lossCategoryFilter);
      const [ov, ev] = await Promise.all([
        api.get(`/reports/finance-overview?${q1}`),
        api.get(`/reports/finance-loss-events?${q2}`),
      ]);
      setFinanceOverview(ov);
      setLossEvents(ev);
    } catch (e) {
      toast.error(e.message || 'No se pudo registrar');
    }
  };
  const buildClosedRegisterReportText = (register) => {
    if (!register) return '';
    const lines = [];
    const diff = Number(register?.arqueo?.difference ?? 0);
    lines.push('REPORTE DE CIERRE DE CAJA');
    lines.push('========================================');
    lines.push(`Caja cerrada: ${register.id}`);
    lines.push(`Cajero: ${register.user_name || '-'}`);
    lines.push(`Apertura: ${formatDateTime(register.opened_at)}`);
    lines.push(`Cierre: ${formatDateTime(register.closed_at)}`);
    lines.push('----------------------------------------');
    lines.push(`Venta total: ${formatCurrency(register.total_sales || 0)}`);
    lines.push(`Propinas: ${formatCurrency(register.arqueo?.total_tips || 0)}`);
    lines.push(`Efectivo: ${formatCurrency(register.total_cash || 0)}`);
    lines.push(`Yape: ${formatCurrency(register.total_yape || 0)}`);
    lines.push(`Plin: ${formatCurrency(register.total_plin || 0)}`);
    lines.push(`Tarjeta: ${formatCurrency(register.total_card || 0)}`);
    const onlineAmt = Number(register.arqueo?.payment_breakdown?.online ?? 0);
    if (onlineAmt > 0) lines.push(`Online: ${formatCurrency(onlineAmt)}`);
    lines.push(`Efectivo esperado: ${formatCurrency(register.arqueo?.expected_cash || 0)}`);
    lines.push(`Efectivo contado: ${formatCurrency(register.arqueo?.counted_cash ?? register.closing_amount ?? 0)}`);
    lines.push(`Diferencia: ${diff >= 0 ? '+' : ''}${formatCurrency(diff)}`);
    lines.push('----------------------------------------');
    lines.push('DENOMINACIONES');
    Object.entries(DENOMINATION_LABELS).forEach(([key, label]) => {
      lines.push(`${label}: ${register.arqueo?.denominations?.[key] || 0}`);
    });
    const incomeMov = (register.movements || []).filter((m) => m.type === 'income');
    const expenseMov = (register.movements || []).filter((m) => m.type === 'expense');
    const notesDebit = (register.notes_list || []).filter((n) => n.note_type === 'debit');
    const notesCredit = (register.notes_list || []).filter((n) => n.note_type === 'credit');
    if (incomeMov.length) {
      lines.push('----------------------------------------');
      lines.push('INGRESOS (CAJA)');
      incomeMov.forEach((mv) => {
        lines.push(`${formatDateTime(mv.created_at)} | ${formatCurrency(mv.amount)} | ${mv.concept || '-'}`);
      });
    }
    if (expenseMov.length) {
      lines.push('----------------------------------------');
      lines.push('EGRESOS (CAJA)');
      expenseMov.forEach((mv) => {
        lines.push(`${formatDateTime(mv.created_at)} | ${formatCurrency(mv.amount)} | ${mv.concept || '-'}`);
      });
    }
    if (notesDebit.length) {
      lines.push('----------------------------------------');
      lines.push('NOTAS DE DÉBITO');
      notesDebit.forEach((note) => {
        lines.push(`${formatDateTime(note.created_at)} | ${formatCurrency(note.amount)} | ${note.reason || '-'}`);
      });
    }
    if (notesCredit.length) {
      lines.push('----------------------------------------');
      lines.push('NOTAS DE CRÉDITO');
      notesCredit.forEach((note) => {
        lines.push(`${formatDateTime(note.created_at)} | ${formatCurrency(note.amount)} | ${note.reason || '-'}`);
      });
    }
    lines.push('----------------------------------------');
    lines.push(`Observaciones: ${register.arqueo?.observations || register.notes || 'Sin observaciones'}`);
    if (Array.isArray(register.sold_products) && register.sold_products.length) {
      lines.push('----------------------------------------');
      lines.push('PRODUCTOS VENDIDOS (DETALLE POR PRODUCTO)');
      register.sold_products.forEach((item) => {
        const qty = Number(item.total_qty || 0);
        const unit = qty > 0 ? Number(item.total_amount || 0) / qty : 0;
        lines.push(
          `${item.product_name} | Cantidad: ${qty} | Precio unit.: ${formatCurrency(unit)} | Total: ${formatCurrency(item.total_amount || 0)}`
        );
      });
    }
    return `${lines.join('\n')}\n`;
  };
  const downloadClosedRegisterReport = (register) => {
    if (!register) return;
    const content = buildClosedRegisterReportText(register);
    const dateStamp = String(register.closed_at || new Date().toISOString()).replace(/[:T]/g, '-').slice(0, 16);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cierre-caja-${dateStamp}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  /** Impresión clásica (diálogo del navegador), no tiketera térmica. */
  const printClosedRegisterManual = async (register) => {
    if (!register?.id || printingClosedRegisterId) return;
    try {
      setPrintingClosedRegisterId(register.id);
      const detail = Array.isArray(register.movements)
        ? register
        : await api.get(`/reports/closed-registers/${register.id}`);
      printClosedRegisterHtml(buildClosedRegisterPrintHtml(detail));
    } catch (err) {
      toast.error(err.message || 'No se pudo imprimir el cierre de caja');
    } finally {
      setPrintingClosedRegisterId('');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  const purchaseGroups = Object.values(
    (purchaseExpenses || []).reduce((acc, expense) => {
      const key = expense.requirement_id || expense.id;
      if (!acc[key]) {
        acc[key] = {
          id: key,
          created_at: expense.created_at,
          purchase_date: expense.purchase_date || String(expense.created_at || '').slice(0, 10),
          total: 0,
          items: [],
        };
      }
      acc[key].items.push(expense);
      acc[key].total += Number(expense.total_cost || 0);
      if (expense.purchase_date) acc[key].purchase_date = expense.purchase_date;
      return acc;
    }, {})
  ).sort((a, b) => new Date(b.purchase_date || b.created_at || 0) - new Date(a.purchase_date || a.created_at || 0));

  const tabs = [
    { id: 'daily', label: 'Informe del Día', icon: MdCalendarToday },
    { id: 'monthly', label: 'Informe del Mes', icon: MdCalendarMonth },
    { id: 'ranking', label: 'Ranking Productos', icon: MdEmojiEvents },
  ];
  const sectionCards = [
    { id: 'ventas', title: 'Informe de Ventas', desc: 'Diversos informes de las ventas realizadas en la empresa.' },
    { id: 'descuentos', title: 'Descuentos y Cortesías', desc: 'Descuentos, cortesías y productos eliminados de mesa. Descuentan inventario al cobrar; los eliminados quedan registrados con motivo (no afectan caja).' },
    { id: 'productos', title: 'Informe de productos', desc: 'Cantidades vendidas por cierre, informe total por fechas o cierres, y descarga CSV/TXT (incluye caja actual).' },
    { id: 'caja', title: 'Informe de Caja', desc: 'Historial de cajas cerradas, detalle del cierre y descarga del reporte.' },
    { id: 'compras', title: 'Informe de Compras', desc: 'Las compras que has realizado.' },
    { id: 'finanzas', title: 'Informe de Finanzas', desc: 'Todo lo concerniente al flujo de dinero en las cajas.' },
    { id: 'facturacion', title: 'Informe de Facturación Electrónica', desc: 'Todo lo concerniente a documentos de facturación electrónica.' },
    { id: 'inventario', title: 'Informe de Inventario', desc: 'Movimientos de stock generados por ventas, compras, merma, etc.' },
  ];
  const activeSectionMeta = sectionCards.find(section => section.id === reportSection);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--ui-body-text)] mb-6 rf-page-title">Informes</h1>
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {sectionCards.map(section => {
            const isActive = reportSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setReportSection(section.id)}
                className={`rf-tab-btn ${isActive ? 'rf-tab-btn--active' : ''}`}
              >
                {section.title}
              </button>
            );
          })}
        </div>
        {activeSectionMeta?.desc && (
          <p className="text-sm text-[var(--ui-muted)] mt-3">{activeSectionMeta.desc}</p>
        )}
      </div>

      {reportSection === 'descuentos' && <CortesiasReportSection />}

      {reportSection === 'ventas' && (
        <>
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <input
          ref={dailyDateInputRef}
          type="date"
          value={salesDailyDate}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            setSalesDailyDate(next);
            setTab('daily');
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <input
          ref={monthInputRef}
          type="month"
          value={salesMonth}
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            setSalesMonth(next);
            setTab('monthly');
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
        <button
          type="button"
          onClick={() => {
            setTab('daily');
            openNativeDatePicker(dailyDateInputRef.current);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${tab === 'daily' ? 'bg-gold-600 text-white border-gold-600' : 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-surface-2)]'}`}
        >
          <MdCalendarToday />
          <span>
            Informe del Día
            <span className={`block text-[10px] font-normal ${tab === 'daily' ? 'text-white/90' : 'text-[var(--ui-muted)]'}`}>
              {formatDate(salesDailyDate)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('monthly');
            openNativeDatePicker(monthInputRef.current);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${tab === 'monthly' ? 'bg-gold-600 text-white border-gold-600' : 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-surface-2)]'}`}
        >
          <MdCalendarMonth />
          <span>
            Informe del Mes
            <span className={`block text-[10px] font-normal capitalize ${tab === 'monthly' ? 'text-white/90' : 'text-[var(--ui-muted)]'}`}>
              {formatMonthLabel(salesMonth)}
            </span>
          </span>
        </button>
        {tabs.filter((t) => t.id === 'ranking').map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${tab === t.id ? 'bg-gold-600 text-white border-gold-600' : 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-surface-2)]'}`}>
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'daily' && dailyLoading && !dailyData && (
        <p className="text-sm text-[var(--ui-muted)] mb-4">Cargando informe del día…</p>
      )}

      {tab === 'daily' && dailyData && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            {dailyData.is_today !== false ? (
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${dailyData.register_open ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-[var(--ui-muted)]'}`}>
                Caja: {dailyData.register_open ? 'Abierta' : 'Cerrada'}
              </span>
            ) : null}
            <span className="text-sm text-[var(--ui-muted)]">Fecha: {formatDate(dailyData.date)}</span>
            {dailyLoading ? <span className="text-xs text-[var(--ui-muted)]">Actualizando…</span> : null}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center"><MdAttachMoney className="text-emerald-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">{dailyData.is_today === false ? 'Ventas del día' : 'Ventas Hoy'}</p>
                  <p className="text-xl font-bold text-emerald-600">{formatCurrency(dailyData.sales?.total_sales)}</p>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-100 rounded-xl flex items-center justify-center"><MdReceipt className="text-sky-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Cuentas cobradas</p>
                  <p className="text-xl font-bold text-sky-600">{dailyData.sales?.order_count || 0}</p>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center"><MdTrendingUp className="text-gold-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">IGV</p>
                  <p className="text-xl font-bold text-gold-600">{formatCurrency(dailyData.sales?.total_tax)}</p>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center"><MdLocalOffer className="text-amber-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Descuentos (ref.)</p>
                  <p className="text-xl font-bold text-amber-600">{formatCurrency(dailyData.adjustments?.discount_amount_total)}</p>
                  <p className="text-[10px] text-[var(--ui-muted)]">Informativo · no suma a ventas</p>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center"><MdVolunteerActivism className="text-violet-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Cortesías (ref.)</p>
                  <p className="text-xl font-bold text-violet-600">{formatCurrency(dailyData.adjustments?.courtesy_reference_total)}</p>
                  <p className="text-[10px] text-[var(--ui-muted)]">Informativo · cobro S/ 0.00</p>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center"><MdPayments className="text-indigo-600 text-xl" /></div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Propinas</p>
                  <p className="text-xl font-bold text-indigo-600">{formatCurrency(dailyData.sales?.total_tips)}</p>
                </div>
              </div>
            </div>
          </div>

          {dailyData.orders?.length > 0 && (
            <div className="card">
              <h3 className="font-bold rf-section-title mb-4">Comandas del día ({dailyData.orders.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Mesa</th>
                      <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Estado</th>
                      <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Pago</th>
                      <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.orders.map(o => (
                      <tr key={o.id} className="border-b border-slate-50">
                        <td className="py-2 px-3 font-medium">#{o.order_number}</td>
                        <td className="py-2 px-3">{o.table_number || '—'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : o.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-gold-100 text-gold-700'}`}>
                            {o.status === 'delivered' ? 'Entregado' : o.status === 'cancelled' ? 'Cancelado' : o.status === 'pending' ? 'Pendiente' : o.status === 'preparing' ? 'Preparando' : 'Listo'}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-xs ${
                            o.payment_status === 'paid'
                              ? 'text-emerald-600'
                              : o.payment_status === 'refunded'
                                ? 'text-red-600'
                                : 'text-gold-600'
                          }`}>
                            {o.payment_status === 'paid' ? 'Pagado' : o.payment_status === 'refunded' ? 'Reembolsado' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-bold">{formatCurrency(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'monthly' && monthlyLoading && !monthlyData && (
        <p className="text-sm text-[var(--ui-muted)] mb-4">Cargando informe del mes…</p>
      )}

      {tab === 'monthly' && monthlyData && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="text-sm text-[var(--ui-muted)] capitalize">Mes: {formatMonthLabel(monthlyData.month || salesMonth)}</span>
            {monthlyLoading ? <span className="text-xs text-[var(--ui-muted)]">Actualizando…</span> : null}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card">
              <p className="text-sm text-[var(--ui-muted)]">Ventas del Mes</p>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(monthlyData.totalMonth?.total)}</p>
              <p className="text-xs text-[var(--ui-muted)]">{monthlyData.totalMonth?.orders || 0} cuentas</p>
            </div>
            <div className="card">
              <p className="text-sm text-[var(--ui-muted)]">IGV del Mes</p>
              <p className="text-2xl font-bold text-gold-600">{formatCurrency(monthlyData.totalMonth?.tax)}</p>
            </div>
            <div className="card">
              <p className="text-sm text-[var(--ui-muted)]">Cajas Cerradas</p>
              <p className="text-2xl font-bold text-sky-600">{monthlyData.closedRegistersMonth || 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="card">
              <h3 className="font-bold rf-section-title mb-4">Ventas diarias del mes</h3>
              {monthlyData.dailySales?.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={[...monthlyData.dailySales].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Line type="monotone" dataKey="total" stroke="#f04438" strokeWidth={2} dot={{ fill: '#f04438', r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-[var(--ui-muted)] text-center py-8">Sin datos</p>}
            </div>

            <div className="card">
              <h3 className="font-bold rf-section-title mb-4">Tendencia mensual (12 meses)</h3>
              {monthlyData.monthlySales?.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={[...monthlyData.monthlySales].reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-[var(--ui-muted)] text-center py-8">Sin datos</p>}
            </div>
          </div>

        </div>
      )}

      {tab === 'ranking' && (
        <div>
          <div className="flex gap-2 mb-4">
            {[
              { id: 'today', label: 'Hoy' },
              { id: 'week', label: 'Semana' },
              { id: 'month', label: 'Mes' },
              { id: 'all', label: 'Todo' },
            ].map(p => (
              <button key={p.id} onClick={() => setRankingPeriod(p.id)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${rankingPeriod === p.id ? 'bg-gold-600 text-white' : 'bg-white text-[var(--ui-muted)] hover:bg-slate-100 border'}`}>
                {p.label}
              </button>
            ))}
          </div>

          {ranking.length > 0 ? (
            <div>
              <div className="card mb-6">
                <h3 className="font-bold rf-section-title mb-4">Top Productos</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={ranking.slice(0, 10)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="product_name" tick={{ fontSize: 11 }} width={140} />
                    <Tooltip formatter={(v, name) => [name === 'total_revenue' ? formatCurrency(v) : v, name === 'total_revenue' ? 'Ingresos' : 'Vendidos']} />
                    <Bar dataKey="total_sold" fill="#f04438" radius={[0, 4, 4, 0]} name="Vendidos" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3 className="font-bold rf-section-title mb-4">Ranking Completo</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-center py-2 px-3 text-xs text-[var(--ui-muted)] uppercase w-12">#</th>
                      <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Producto</th>
                      <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Vendidos</th>
                      <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Ingresos</th>
                      <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Cuentas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((p, i) => (
                      <tr key={p.product_id} className="border-b border-slate-50">
                        <td className="py-2 px-3 text-center">
                          {i < 3 ? (
                            <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold text-white ${i === 0 ? 'bg-gold-400' : i === 1 ? 'bg-slate-400' : 'bg-gold-700'}`}>
                              {i + 1}
                            </span>
                          ) : <span className="text-[var(--ui-muted)]">{i + 1}</span>}
                        </td>
                        <td className="py-2 px-3 font-medium">{p.product_name}</td>
                        <td className="py-2 px-3 text-right font-bold">{p.total_sold}</td>
                        <td className="py-2 px-3 text-right text-emerald-600 font-medium">{formatCurrency(p.total_revenue)}</td>
                        <td className="py-2 px-3 text-right text-[var(--ui-muted)]">{p.order_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card text-center py-12 text-[var(--ui-muted)]">
              <MdEmojiEvents className="text-5xl mx-auto mb-3 opacity-40" />
              <p className="font-medium">Sin datos de ventas</p>
              <p className="text-sm">Los rankings se generan con las ventas realizadas</p>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {reportSection === 'productos' && (
        <div className="space-y-6">
          {/* Caja actual */}
          <div className="card border-l-4 border-l-emerald-500">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-bold rf-section-title flex items-center gap-2">
                  <MdPointOfSale className="text-emerald-600" /> Caja actual
                </h3>
                <p className="text-xs text-[var(--ui-muted)] mt-1">
                  Productos vendidos en el turno abierto (desde la apertura hasta ahora).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void loadProductoCurrentReport()}
                  disabled={productoCurrentLoading}
                  className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <MdRefresh className={productoCurrentLoading ? 'animate-spin' : ''} />
                  {productoCurrentLoading ? 'Cargando…' : 'Ver turno actual'}
                </button>
                {productoCurrentReport?.register_open && (
                  <>
                    <button
                      type="button"
                      onClick={() => downloadProductSalesReport(productoCurrentReport, 'productos-caja-actual', 'csv')}
                      className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                    >
                      <MdDownload /> CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadProductSalesReport(productoCurrentReport, 'productos-caja-actual', 'txt')}
                      className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                    >
                      <MdDownload /> TXT
                    </button>
                  </>
                )}
              </div>
            </div>
            {productoCurrentReport?.register_open ? (
              <div className="space-y-3">
                {(productoCurrentReport.by_register || []).map((block) => (
                  <p key={block.register_id} className="text-sm text-[var(--ui-muted)]">
                    {block.user_name || 'Cajero'} · abierta {formatDateTime(block.opened_at)} ·{' '}
                    <span className="font-semibold text-[var(--ui-body-text)]">
                      {block.sold_products?.length || 0} productos · {block.sold_products?.reduce((s, r) => s + Number(r.total_qty || 0), 0) || 0} unidades
                    </span>
                  </p>
                ))}
                {(productoCurrentReport.sold_products || []).length > 0 ? (
                  <ProductSalesTable
                    products={productoCurrentReport.sold_products}
                    emptyMessage="Aún no hay ventas de productos en este turno."
                  />
                ) : (
                  <p className="text-sm text-[var(--ui-muted)]">Aún no hay ventas de productos en este turno.</p>
                )}
              </div>
            ) : productoCurrentReport && !productoCurrentReport.register_open ? (
              <p className="text-sm text-[var(--ui-muted)]">No hay caja abierta. Use el informe total por fechas o seleccione un cierre abajo.</p>
            ) : productoCurrentLoading ? (
              <p className="text-sm text-[var(--ui-muted)]">Cargando productos vendidos…</p>
            ) : (
              <p className="text-sm text-[var(--ui-muted)]">
                Pulse «Ver turno actual» para actualizar las cantidades del turno en curso.
              </p>
            )}
          </div>

          {/* Informe total */}
          <div className="card border-l-4 border-l-[#3B82F6]">
            <h3 className="font-bold rf-section-title mb-1 flex items-center gap-2">
              <MdAutoGraph className="text-[#3B82F6]" /> Informe total de productos
            </h3>
            <p className="text-xs text-[var(--ui-muted)] mb-4">
              Consolida cantidades vendidas por producto en un rango de fechas o en los cierres que elija.
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => setProductoTotalMode('fechas')}
                className={`text-xs px-3 py-1.5 rounded-lg border ${productoTotalMode === 'fechas' ? 'bg-[#3B82F6] text-white border-transparent' : 'border-[color:var(--ui-border)]'}`}
              >
                Por fechas
              </button>
              <button
                type="button"
                onClick={() => setProductoTotalMode('cierres')}
                className={`text-xs px-3 py-1.5 rounded-lg border ${productoTotalMode === 'cierres' ? 'bg-[#3B82F6] text-white border-transparent' : 'border-[color:var(--ui-border)]'}`}
              >
                Por cierres seleccionados
              </button>
            </div>
            {productoTotalMode === 'fechas' ? (
              <>
                <div className="flex flex-wrap gap-3 items-end mb-4">
                  <div>
                    <label className="text-xs text-[var(--ui-muted)] block mb-1">Desde</label>
                    <input type="date" value={productoFrom} onChange={(e) => setProductoFrom(e.target.value)} className="input-field" />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--ui-muted)] block mb-1">Hasta</label>
                    <input type="date" value={productoTo} onChange={(e) => setProductoTo(e.target.value)} className="input-field" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => void loadProductoTotalReport()}
                    disabled={productoTotalLoading}
                    className="btn-primary text-sm inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <MdRefresh className={productoTotalLoading ? 'animate-spin' : ''} />
                    {productoTotalLoading ? 'Generando…' : 'Generar informe'}
                  </button>
                  {productoTotalReport && (
                    <>
                      <button
                        type="button"
                        onClick={() => downloadProductSalesReport(productoTotalReport, 'informe-productos-total', 'csv')}
                        className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                      >
                        <MdDownload /> Descargar CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadProductSalesReport(productoTotalReport, 'informe-productos-total', 'txt')}
                        className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                      >
                        <MdDownload /> Descargar TXT
                      </button>
                    </>
                  )}
                </div>
                {productoTotalLoading && !productoTotalReport && (
                  <p className="text-sm text-[var(--ui-muted)] mb-3">Generando informe de productos vendidos…</p>
                )}
                {productoTotalReport && (
                  <div className="space-y-4">
                    <p className="text-sm text-[var(--ui-muted)]">
                      Periodo {productoTotalReport.filters?.from} — {productoTotalReport.filters?.to}
                    </p>
                    <ProductSalesTable
                      products={productoDisplayedProducts}
                      showOrders
                      emptyMessage="No hay ventas de productos en el periodo indicado."
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-xs text-[var(--ui-muted)] mb-4">
                  Se muestra el último cierre por defecto. Marque uno o más cierres a la izquierda; los productos se actualizan a la derecha.
                </p>
                {!closedRegistersList.length ? (
                  <p className="text-[var(--ui-muted)]">Aún no hay cierres de caja registrados.</p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_1fr] gap-4 items-start">
                    <div className="rounded-xl border border-[color:var(--ui-border)] overflow-hidden flex flex-col max-h-[min(70vh,640px)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--ui-surface-2)] border-b border-[color:var(--ui-border)]">
                        <p className="text-xs font-semibold text-[var(--ui-body-text)]">
                          Cierres ({productoSelectedIds.size}/{closedRegistersList.length})
                        </p>
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <button type="button" onClick={selectAllProductoRegisters} className="text-[#3B82F6] hover:underline">
                            Todos
                          </button>
                          <button type="button" onClick={clearProductoRegisterSelection} className="text-[var(--ui-muted)] hover:underline">
                            Ninguno
                          </button>
                          <button
                            type="button"
                            onClick={() => loadMonthly().then(setMonthlyData).catch(console.error)}
                            className="text-[var(--ui-muted)] hover:underline inline-flex items-center gap-0.5"
                          >
                            <MdRefresh className="text-sm" /> Actualizar
                          </button>
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1 divide-y divide-[color:var(--ui-border)]">
                        {closedRegistersList.map((r) => {
                          const selected = productoSelectedIds.has(r.id);
                          return (
                            <label
                              key={r.id}
                              className={`flex gap-3 px-3 py-3 cursor-pointer hover:bg-[var(--ui-sidebar-hover)] ${
                                selected ? 'informe-productos-row-selected' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleProductoRegisterSelect(r.id)}
                                className="mt-1 rounded shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-[var(--ui-body-text)] truncate">
                                  {r.user_name || 'Cajero'}
                                </p>
                                <p className="text-xs text-[var(--ui-muted)] mt-0.5">
                                  {formatDateTime(r.closed_at)}
                                </p>
                                <p className="text-[11px] text-[var(--ui-muted)] mt-1">
                                  Apertura {formatDateTime(r.opened_at)}
                                </p>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-xs">
                                  <span className="text-[#3B82F6] font-medium tabular-nums">
                                    {Number(r.sold_units_total ?? 0)} uds.
                                  </span>
                                  <span className="text-emerald-600 font-semibold tabular-nums">
                                    {formatCurrency(r.total_sales || 0)}
                                  </span>
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-[var(--ui-muted)]">
                          {productoCierresSummary}
                          {productoTotalLoading && productoTotalReport ? (
                            <span className="ml-2 inline-flex items-center gap-1 text-[11px]">
                              <MdRefresh className="animate-spin text-sm" /> Actualizando…
                            </span>
                          ) : null}
                        </p>
                        {productoTotalReport && productoSelectedIds.size > 0 && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => downloadProductSalesReport(productoTotalReport, 'informe-productos-total', 'csv')}
                              className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                            >
                              <MdDownload /> CSV
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadProductSalesReport(productoTotalReport, 'informe-productos-total', 'txt')}
                              className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg inline-flex items-center gap-1"
                            >
                              <MdDownload /> TXT
                            </button>
                          </div>
                        )}
                      </div>
                      {productoTotalLoading && !productoTotalReport && productoSelectedIds.size > 0 && (
                        <p className="text-sm text-[var(--ui-muted)]">Cargando productos del cierre…</p>
                      )}
                      {!productoSelectedIds.size && (
                        <p className="text-sm text-[var(--ui-muted)]">Seleccione al menos un cierre para ver los productos.</p>
                      )}
                      {productoSelectedIds.size > 0 && productoTotalReport && (
                        <ProductSalesTable
                          products={productoDisplayedProducts}
                          showOrders
                          emptyMessage="No hay ventas de productos en los cierres seleccionados."
                        />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Por cierre — solo en modo fechas (referencia y modal) */}
          {productoTotalMode === 'fechas' && (
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <MdShoppingCart className="text-[#3B82F6] text-xl" />
                <h3 className="font-bold rf-section-title">Cierres de caja con ventas</h3>
              </div>
              <button
                type="button"
                onClick={() => loadMonthly().then(setMonthlyData).catch(console.error)}
                className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-[var(--ui-muted)] hover:bg-slate-50 inline-flex items-center gap-1"
              >
                <MdRefresh className="text-sm" /> Actualizar lista
              </button>
            </div>
            {!closedRegistersList.length ? (
              <p className="text-[var(--ui-muted)]">Aún no hay cierres de caja. Tras un cierre, aparecerá aquí y podrás abrir el informe.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="informe-productos-table w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--ui-border)]">
                      <th className="text-left py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase">Fecha cierre</th>
                      <th className="text-left py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase">Cajero</th>
                      <th className="text-left py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase">Apertura</th>
                      <th className="text-right py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase">Unidades</th>
                      <th className="text-right py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase">Venta turno</th>
                      <th className="text-right py-2 px-3 text-xs text-[color:var(--ui-muted)] uppercase" />
                    </tr>
                  </thead>
                  <tbody>
                    {closedRegistersList.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] ${
                          productoInformeModalOpen && productoInformeRegisterId === r.id
                            ? 'informe-productos-row-selected'
                            : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-[color:var(--ui-body-text)]">{formatDateTime(r.closed_at)}</td>
                        <td className="py-2 px-3 font-medium text-[color:var(--ui-body-text)]">{r.user_name || '-'}</td>
                        <td className="py-2 px-3 text-[color:var(--ui-muted)] text-xs">{formatDateTime(r.opened_at)}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium text-[#3B82F6]">
                          {Number(r.sold_units_total ?? 0)}
                          <span className="text-[10px] text-[var(--ui-muted)] ml-1">({Number(r.sold_products_count ?? 0)} prod.)</span>
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-emerald-600">{formatCurrency(r.total_sales || 0)}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => openProductoInforme(r)}
                            className="text-xs px-3 py-1.5 bg-[#3B82F6] text-white rounded-lg hover:bg-[#2563EB] inline-flex items-center gap-1"
                          >
                            <MdVisibility /> Ver productos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          <Modal
            isOpen={productoInformeModalOpen}
            onClose={closeProductoInformeModal}
            title="Productos vendidos en este cierre"
            size="lg"
          >
            {productoInformeLoading && (
              <div className="flex items-center justify-center py-12 text-[color:var(--ui-muted)] text-sm">
                Cargando detalle de productos…
              </div>
            )}
            {!productoInformeLoading && !productoInformeDetail && (
              <p className="text-center py-10 text-[color:var(--ui-muted)] text-sm">
                No hay datos para mostrar o hubo un error al cargar.
              </p>
            )}
            {!productoInformeLoading && productoInformeDetail && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm text-[color:var(--ui-muted)]">
                    Cierre: {formatDateTime(productoInformeDetail.closed_at)} · {productoInformeDetail.user_name || '—'}
                  </p>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        downloadProductSalesReport(
                          {
                            mode: 'registers',
                            sold_products: productoInformeDetail.sold_products || [],
                            product_sales_total: productoInformeDetail.product_sales_total,
                            by_register: [
                              {
                                user_name: productoInformeDetail.user_name,
                                opened_at: productoInformeDetail.opened_at,
                                closed_at: productoInformeDetail.closed_at,
                                sold_products: productoInformeDetail.sold_products || [],
                              },
                            ],
                          },
                          `informe-productos-${String(productoInformeDetail.id || 'cierre').slice(0, 8)}`,
                          'csv'
                        )
                      }
                      className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg text-[color:var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1"
                    >
                      <MdDownload /> CSV
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadProductSalesReport(
                          {
                            mode: 'registers',
                            sold_products: productoInformeDetail.sold_products || [],
                            product_sales_total: productoInformeDetail.product_sales_total,
                            by_register: [
                              {
                                user_name: productoInformeDetail.user_name,
                                opened_at: productoInformeDetail.opened_at,
                                closed_at: productoInformeDetail.closed_at,
                                sold_products: productoInformeDetail.sold_products || [],
                              },
                            ],
                          },
                          `informe-productos-${String(productoInformeDetail.id || 'cierre').slice(0, 8)}`,
                          'txt'
                        )
                      }
                      className="text-xs px-3 py-1.5 border border-[color:var(--ui-border)] rounded-lg text-[color:var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1"
                    >
                      <MdDownload /> TXT
                    </button>
                  </div>
                </div>
                {!(productoInformeDetail.sold_products || []).length ? (
                  <p className="text-[color:var(--ui-muted)] py-4">No hay líneas de producto en el periodo de este cierre.</p>
                ) : (
                  <ProductSalesTable products={productoInformeDetail.sold_products} />
                )}
              </div>
            )}
          </Modal>
        </div>
      )}

      {reportSection === 'caja' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MdPointOfSale className="text-[#3B82F6] text-xl" />
              <h3 className="font-bold rf-section-title">Reporte de Caja</h3>
            </div>
            <span className="text-xs text-[var(--ui-muted)]">
              Cierres registrados: {(monthlyData?.closedRegisters || []).length}
            </span>
          </div>
          {(monthlyData?.closedRegisters || []).length === 0 ? (
            <p className="text-[var(--ui-muted)]">No hay cierres de caja registrados todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Caja cerrada</th>
                    <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Cajero</th>
                    <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Inicio de turno</th>
                    <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Hora de cierre</th>
                    <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Venta total</th>
                    <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(monthlyData?.closedRegisters || []).map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="py-2 px-3 font-medium">{r.id.slice(0, 8).toUpperCase()}</td>
                      <td className="py-2 px-3">{r.user_name || '-'}</td>
                      <td className="py-2 px-3 text-[var(--ui-muted)]">{formatDateTime(r.opened_at)}</td>
                      <td className="py-2 px-3 text-[var(--ui-muted)]">{formatDateTime(r.closed_at)}</td>
                      <td className="py-2 px-3 text-right font-bold">{formatCurrency(r.total_sales || 0)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openClosedRegisterDetail(r)}
                            className="text-xs px-3 py-1.5 bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] rounded-lg hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1"
                          >
                            <MdVisibility /> Ver detalle
                          </button>
                          <button
                            type="button"
                            onClick={() => printClosedRegisterManual(r)}
                            disabled={printingClosedRegisterId === r.id}
                            className="text-xs px-3 py-1.5 bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] rounded-lg hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <MdPrint /> {printingClosedRegisterId === r.id ? 'Preparando…' : 'Imprimir'}
                          </button>
                          <button
                            onClick={() => downloadClosedRegisterReport(r)}
                            className="text-xs px-3 py-1.5 bg-[#3B82F6] text-white rounded-lg hover:bg-[#2563EB] inline-flex items-center gap-1"
                          >
                            <MdDownload /> Descargar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {reportSection === 'compras' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Compras recepcionadas</h3>
          {purchaseGroups.length === 0 ? (
            <p className="text-[var(--ui-muted)]">No hay compras registradas.</p>
          ) : (
            <div className="space-y-4">
              {purchaseGroups.map(group => (
                <div key={group.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                    <div>
                      <p className="font-semibold rf-section-title">Compra {group.id.slice(0, 8)}</p>
                      <p className="text-xs text-[var(--ui-muted)] mt-0.5">
                        Fecha de compra: {formatDate(group.purchase_date || group.created_at)}
                      </p>
                    </div>
                    <p className="font-bold text-red-700">{formatCurrency(group.total)}</p>
                  </div>
                  {group.items.map(item => (
                    <div key={item.id} className="text-sm flex justify-between border-b border-slate-100 py-1">
                      <span>{item.product_name || 'Producto'} · {item.quantity} u</span>
                      <span>{formatCurrency(item.unit_cost)} c/u</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {reportSection === 'finanzas' && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="font-bold text-[var(--ui-body-text)] mb-4">Resumen financiero</h3>
            <div className="flex flex-wrap gap-3 mb-4 items-end">
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Desde</label>
                <input
                  type="date"
                  className="input-field"
                  value={financeFrom}
                  onChange={(e) => setFinanceFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Hasta</label>
                <input
                  type="date"
                  className="input-field"
                  value={financeTo}
                  onChange={(e) => setFinanceTo(e.target.value)}
                />
              </div>
            </div>
            {financeLoading ? (
              <p className="text-[var(--ui-muted)]">Cargando…</p>
            ) : !financeOverview ? (
              <p className="text-[var(--ui-muted)]">No se pudo cargar el resumen.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div className="ui-finance-kpi ui-finance-kpi--amber">
                    <p className="ui-finance-kpi__label">Inversión en el período</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.investment?.movements_total ?? financeOverview.investment?.total)}</p>
                    <p className="ui-finance-kpi__sub">Movimientos en el rango (nómina, aportes, etc.)</p>
                  </div>
                  <div className="ui-finance-kpi">
                    <p className="ui-finance-kpi__label">Valor inventario (actual)</p>
                    <p className="ui-finance-kpi__value">
                      {formatCurrency(financeOverview.investment?.inventory_snapshot ?? financeOverview.investment?.inventory_total ?? 0)}
                    </p>
                    <p className="ui-finance-kpi__sub">Foto del stock; no resta en ganancia del rango</p>
                  </div>
                  <div className="ui-finance-kpi ui-finance-kpi--emerald">
                    <p className="ui-finance-kpi__label">Ventas (cuentas cobradas)</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.sales?.total)}</p>
                    <p className="ui-finance-kpi__sub">{financeOverview.sales?.orders || 0} cuentas</p>
                  </div>
                  <div className="ui-finance-kpi ui-finance-kpi--sky">
                    <p className="ui-finance-kpi__label">Ganancia aproximada</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.approx_profit)}</p>
                    <p className="ui-finance-kpi__sub">
                      Ventas − compras − pérdidas registradas − egresos de caja en el rango
                    </p>
                  </div>
                  <div className="ui-finance-kpi">
                    <p className="ui-finance-kpi__label">Compras (inventario)</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.purchases?.total)}</p>
                  </div>
                  <div className="ui-finance-kpi ui-finance-kpi--red">
                    <p className="ui-finance-kpi__label">Pérdidas (eventos + egresos caja)</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.losses_combined_total)}</p>
                    <p className="ui-finance-kpi__sub">
                      Eventos: {formatCurrency(financeOverview.loss_events?.total)} · Egresos caja:{' '}
                      {formatCurrency(financeOverview.cash_expenses?.total)}
                    </p>
                  </div>
                  <div className="ui-finance-kpi ui-finance-kpi--violet">
                    <p className="ui-finance-kpi__label">Margen bruto aprox.</p>
                    <p className="ui-finance-kpi__value">{formatCurrency(financeOverview.approx_gross_margin)}</p>
                    <p className="ui-finance-kpi__sub">Ventas − compras de inventario en el rango</p>
                  </div>
                </div>
                <p className="text-xs text-[var(--ui-muted)]">
                  Rango: {financeOverview.filters?.from} — {financeOverview.filters?.to}. Ganancia = ventas − compras − pérdidas − egresos.
                  El valor de inventario es una foto actual y no entra en esa fórmula.
                </p>
              </>
            )}
          </div>

          {financeOverview && !financeLoading ? <FinanceBusinessIntelPanel overview={financeOverview} /> : null}

          <div className="card">
            <h3 className="font-bold rf-section-title mb-2">Registrar pérdida</h3>
            <p className="text-sm text-[var(--ui-muted)] mb-4">
              Incluye mermas, daños, reembolsos y gastos extra. Opcional: detalle en JSON (productos y cantidades).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Categoría</label>
                <select
                  className="input-field"
                  value={lossForm.category}
                  onChange={(e) => setLossForm((p) => ({ ...p, category: e.target.value }))}
                >
                  {Object.entries(FINANCE_LOSS_LABELS).map(([k, lab]) => (
                    <option key={k} value={k}>{lab}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Monto (S/)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input-field"
                  value={lossForm.amount}
                  onChange={(e) => setLossForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Concepto</label>
                <input
                  className="input-field"
                  value={lossForm.concept}
                  onChange={(e) => setLossForm((p) => ({ ...p, concept: e.target.value }))}
                  placeholder="Descripción breve"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Fecha (opcional, ISO)</label>
                <input
                  className="input-field"
                  value={lossForm.occurred_at}
                  onChange={(e) => setLossForm((p) => ({ ...p, occurred_at: e.target.value }))}
                  placeholder="2026-05-10 o 2026-05-10T12:00"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--ui-muted)] mb-1">Detalle ítems (JSON opcional)</label>
                <textarea
                  className="input-field min-h-[72px] font-mono text-xs"
                  value={lossForm.itemsText}
                  onChange={(e) => setLossForm((p) => ({ ...p, itemsText: e.target.value }))}
                  placeholder='[{"name":"Insumo X","qty":2,"unit":15.5}]'
                />
              </div>
            </div>
            <button type="button" className="btn-primary mt-4" onClick={() => void submitFinanceLoss()}>
              Guardar pérdida
            </button>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h3 className="font-bold rf-section-title">Detalle de pérdidas</h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--ui-muted)]">Filtrar categoría</label>
                <select
                  className="input-field w-auto text-sm"
                  value={lossCategoryFilter}
                  onChange={(e) => setLossCategoryFilter(e.target.value)}
                >
                  <option value="all">Todas</option>
                  {Object.entries(FINANCE_LOSS_LABELS).map(([k, lab]) => (
                    <option key={k} value={k}>{lab}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-sm font-semibold text-[var(--ui-body-text)] mb-3">
              Total pérdidas (eventos en rango): {formatCurrency(lossEvents?.loss_events_total)}
            </p>
            {!lossEvents?.events?.length ? (
              <p className="text-[var(--ui-muted)]">No hay eventos en este rango.</p>
            ) : (
              <div className="ui-data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Categoría</th>
                      <th>Concepto</th>
                      <th className="text-right">Monto</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lossEvents.events.map((ev) => (
                      <tr key={ev.id}>
                        <td className="whitespace-nowrap">{formatDateTime(ev.occurred_at)}</td>
                        <td>{FINANCE_LOSS_LABELS[ev.category] || ev.category}</td>
                        <td className="max-w-[200px] truncate" title={ev.concept}>{ev.concept || '—'}</td>
                        <td className="text-right font-semibold">{formatCurrency(ev.amount)}</td>
                        <td className="text-xs text-[var(--ui-muted)] max-w-xs">
                          {Array.isArray(ev.items_json_parsed)
                            ? ev.items_json_parsed.map((it, i) => (
                              <span key={i} className="inline-block mr-2">
                                {it.name || it.product_name || 'Ítem'}: {it.qty ?? it.quantity ?? '—'}
                              </span>
                            ))
                            : (ev.items_json ? String(ev.items_json).slice(0, 80) : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {reportSection === 'facturacion' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Facturación electrónica</h3>
          <p className="text-[var(--ui-muted)] mb-4">Resumen de comprobantes electrónicos emitidos.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-[var(--ui-muted)]">Cuentas cobradas hoy</p>
              <p className="text-xl font-bold text-[var(--ui-body-text)]">
                {summarizePaidSalesAccounts((dailyData?.orders || []).filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled')).length}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-[var(--ui-muted)]">Monto facturable hoy</p>
              <p className="text-xl font-bold text-[var(--ui-body-text)]">
                {formatCurrency((dailyData?.orders || [])
                  .filter(o => o.payment_status === 'paid' && o.status !== 'cancelled')
                  .reduce((sum, o) => sum + Number(o.total || 0), 0))}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-[var(--ui-muted)]">Comprobantes emitidos</p>
              <p className="text-xl font-bold text-[var(--ui-body-text)]">{billingDocuments.length}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <select
              className="input-field w-auto"
              value={billingStatusFilter}
              onChange={e => setBillingStatusFilter(e.target.value)}
            >
              <option value="all">Todos los estados</option>
              <option value="local">Notas locales</option>
              <option value="accepted">Aceptados</option>
              <option value="sent">Enviados</option>
              <option value="pending">Pendientes</option>
              <option value="error">Con error</option>
            </select>
            <select
              className="input-field w-auto"
              value={billingTypeFilter}
              onChange={e => setBillingTypeFilter(e.target.value)}
            >
              <option value="all">Todos (boletas, facturas y notas)</option>
              <option value="nota_venta">Notas de venta</option>
              <option value="boleta">Boletas</option>
              <option value="factura">Facturas</option>
            </select>
            <input
              className="input-field flex-1 min-w-[220px]"
              placeholder="Buscar por comprobante, cliente o documento"
              value={billingSearch}
              onChange={e => setBillingSearch(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => loadBillingDocuments()}
            >
              Buscar
            </button>
            <button
              type="button"
              onClick={retryFailedDocuments}
              disabled={retryingFailed}
              className="px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2"
            >
              <MdRefresh />
              {retryingFailed ? 'Reintentando...' : 'Reintentar fallidos'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Comprobante</th>
                  <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Cliente</th>
                  <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Total</th>
                  <th className="text-left py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Estado</th>
                  <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">Acciones</th>
                  <th className="text-right py-2 px-3 text-xs text-[var(--ui-muted)] uppercase">PDF</th>
                </tr>
              </thead>
              <tbody>
                {billingDocuments.map(doc => (
                  <tr key={doc.id} className="border-b border-slate-50">
                    <td className="py-2 px-3 font-medium">{doc.full_number}</td>
                    <td className="py-2 px-3">{doc.customer_name || 'CLIENTE VARIOS'}</td>
                    <td className="py-2 px-3 text-right font-semibold">{formatCurrency(doc.total)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        doc.provider_status === 'accepted'
                          ? 'bg-emerald-100 text-emerald-700'
                          : doc.provider_status === 'error'
                            ? 'bg-red-100 text-red-700'
                            : doc.provider_status === 'local'
                              ? 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)]'
                              : 'bg-amber-100 text-amber-700'
                      }`}>
                        {doc.provider_status === 'local' ? 'local (nota)' : doc.provider_status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {doc.provider_status === 'local' ? (
                        <span className="text-xs text-[var(--ui-muted)]">Nota local</span>
                      ) : ['error', 'pending', 'sent'].includes(doc.provider_status) ? (
                        <button
                          type="button"
                          onClick={() => retryDocument(doc.id)}
                          disabled={retryingDocId === doc.id}
                          className="text-xs px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-60 inline-flex items-center gap-1"
                        >
                          <MdRefresh /> {retryingDocId === doc.id ? 'Enviando...' : 'Reintentar'}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--ui-muted)]">OK</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right align-middle">
                      {doc.pdf_url ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setBillingPdfPreview({
                                url: doc.pdf_url,
                                title: doc.full_number ? `PDF — ${doc.full_number}` : 'Vista previa del comprobante',
                              })
                            }
                            className="inline-block h-3 w-3 rounded-full bg-white border border-slate-300 shadow-sm hover:ring-2 hover:ring-[#3B82F6] focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                            title="Ver PDF"
                            aria-label="Ver PDF del comprobante"
                          />
                          <a
                            href={resolveMediaUrl(doc.pdf_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[#3B82F6] hover:underline whitespace-nowrap"
                            title="Abrir en otra pestaña para imprimir"
                          >
                            Abrir / imprimir
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--ui-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {billingDocuments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[var(--ui-muted)]">Sin comprobantes emitidos todavía.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportSection === 'inventario' && (
        <div className="card">
          <h3 className="font-bold rf-section-title mb-4">Movimientos de inventario</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              onClick={() => setInventoryMovementsTab('stock_minimo')}
              className={`rounded-lg px-4 py-3 text-left border transition-colors min-w-[200px] flex-1 sm:flex-none ${
                inventoryMovementsTab === 'stock_minimo'
                  ? 'bg-red-50 border-red-300 ring-2 ring-red-200'
                  : 'bg-white border-slate-200 hover:border-red-200'
              }`}
            >
              <p className="text-xs text-red-600">Stock mínimo</p>
              <p className="text-xl font-bold text-red-700">{inventoryAlerts.length}</p>
              <p className="text-xs text-[var(--ui-muted)] mt-1">Productos bajo el mínimo</p>
            </button>
            <button
              type="button"
              onClick={() => setInventoryMovementsTab('cuadres')}
              className={`rounded-lg px-4 py-3 text-left border transition-colors min-w-[200px] flex-1 sm:flex-none ${
                inventoryMovementsTab === 'cuadres'
                  ? 'bg-sky-50 border-sky-300 ring-2 ring-sky-200'
                  : 'bg-white border-slate-200 hover:border-sky-200'
              }`}
            >
              <p className="text-xs text-sky-600">Cuadres de inventario</p>
              <p className="text-xl font-bold text-sky-700">{inventoryReconciliations.length}</p>
              <p className="text-xs text-[var(--ui-muted)] mt-1">{inventoryCuadreLines.length} ajuste(s) registrado(s)</p>
            </button>
          </div>

          {inventoryMovementsTab === 'stock_minimo' ? (
            inventoryAlerts.length > 0 ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="font-bold text-red-700 flex items-center gap-2 mb-3">
                  <MdWarning /> Productos con stock bajo
                </p>
                <div className="flex flex-wrap gap-2">
                  {inventoryAlerts.map((item) => (
                    <span
                      key={item.id}
                      className="px-3 py-1 bg-white rounded-full text-sm border border-red-200 text-red-700"
                    >
                      {item.name}: <strong>{item.stock}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--ui-muted)] py-6 text-center">
                No hay productos con stock bajo en este momento.
              </p>
            )
          ) : inventoryCuadreLines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--ui-muted)] border-b border-[color:var(--ui-border)]">
                    <th className="py-2 pr-3 font-medium">Fecha y hora</th>
                    <th className="py-2 pr-3 font-medium">Almacén</th>
                    <th className="py-2 pr-3 font-medium">Producto</th>
                    <th className="py-2 pr-3 font-medium text-right">Contado</th>
                    <th className="py-2 font-medium text-right">Cantidad ajustada</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryCuadreLines.map((line) => (
                    <tr key={line.id} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                      <td className="py-2.5 pr-3 whitespace-nowrap">{formatDateTime(line.created_at)}</td>
                      <td className="py-2.5 pr-3">{line.warehouse_name}</td>
                      <td className="py-2.5 pr-3 font-medium">{line.product_name}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{line.counted_stock}</td>
                      <td className={`py-2.5 text-right tabular-nums font-semibold ${
                        line.difference > 0 ? 'text-sky-600' : 'text-red-600'
                      }`}
                      >
                        {line.difference > 0 ? `+${line.difference}` : line.difference}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-[var(--ui-muted)]">
              <MdInventory2 className="mx-auto text-3xl mb-2 opacity-50" />
              <p className="text-sm">No hay cuadres de inventario registrados.</p>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={!!billingPdfPreview}
        onClose={() => setBillingPdfPreview(null)}
        title={billingPdfPreview?.title || 'Vista previa del PDF'}
        size="full"
        variant="light"
      >
        {billingPdfPreview?.url && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <a
                href={resolveMediaUrl(billingPdfPreview.url)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[#3B82F6] hover:underline"
              >
                Abrir en nueva pestaña / imprimir
              </a>
            </div>
            <iframe
              title="PDF del comprobante"
              src={resolveMediaUrl(billingPdfPreview.url)}
              className="w-full h-[min(80vh,720px)] rounded-lg border border-slate-200 bg-slate-100"
            />
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!selectedClosedRegister}
        onClose={() => setSelectedClosedRegister(null)}
        title="Detalle de Cierre de Caja"
        size="lg"
      >
        {loadingClosedRegister && (
          <div className="py-8 text-center text-[var(--ui-muted)]">Cargando detalle...</div>
        )}
        {selectedClosedRegister && !loadingClosedRegister && (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => printClosedRegisterManual(selectedClosedRegister)}
                disabled={printingClosedRegisterId === selectedClosedRegister.id}
                className="text-xs px-3 py-1.5 bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] rounded-lg hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MdPrint /> {printingClosedRegisterId === selectedClosedRegister.id ? 'Preparando…' : 'Imprimir cierre de caja'}
              </button>
              <button
                type="button"
                onClick={() => downloadClosedRegisterReport(selectedClosedRegister)}
                className="text-xs px-3 py-1.5 bg-[#3B82F6] text-white rounded-lg hover:bg-[#2563EB] inline-flex items-center gap-1"
              >
                <MdDownload /> Descargar reporte
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-[var(--ui-muted)]">Cajero</p>
                <p className="font-semibold rf-section-title">{selectedClosedRegister.user_name}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-[var(--ui-muted)]">Apertura / Cierre</p>
                <p className="font-semibold rf-section-title">
                  {formatDateTime(selectedClosedRegister.opened_at)} - {formatDateTime(selectedClosedRegister.closed_at)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-emerald-50 rounded-lg p-3">
                <p className="text-xs text-emerald-600">Venta total</p>
                <p className="font-bold text-emerald-700">{formatCurrency(selectedClosedRegister.total_sales)}</p>
              </div>
              <div className="bg-sky-50 rounded-lg p-3">
                <p className="text-xs text-sky-600">Efectivo</p>
                <p className="font-bold text-sky-700">{formatCurrency(selectedClosedRegister.total_cash)}</p>
              </div>
              <div className="bg-violet-50 rounded-lg p-3">
                <p className="text-xs text-violet-600">Digital (Yape + Plin + Tarjeta + Online)</p>
                <p className="font-bold text-violet-700">
                  {formatCurrency(
                    (selectedClosedRegister.total_yape || 0) +
                      (selectedClosedRegister.total_plin || 0) +
                      (selectedClosedRegister.total_card || 0) +
                      Number(selectedClosedRegister.arqueo?.payment_breakdown?.online || 0)
                  )}
                </p>
              </div>
              <div className="bg-gold-50 rounded-lg p-3">
                <p className="text-xs text-gold-600">Efectivo contado</p>
                <p className="font-bold text-gold-700">
                  {formatCurrency(selectedClosedRegister.arqueo?.counted_cash ?? selectedClosedRegister.closing_amount)}
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-sm font-semibold rf-section-title mb-2">Arqueo</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Efectivo esperado</p>
                  <p className="font-medium">{formatCurrency(selectedClosedRegister.arqueo?.expected_cash)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Efectivo contado</p>
                  <p className="font-medium">{formatCurrency(selectedClosedRegister.arqueo?.counted_cash)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ui-muted)]">Diferencia</p>
                  <p className={`font-bold ${(selectedClosedRegister.arqueo?.difference || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatCurrency(selectedClosedRegister.arqueo?.difference)}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-3">
              <p className="text-sm font-semibold rf-section-title mb-2">Detalle por denominación</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {Object.entries(DENOMINATION_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between border-b border-slate-100 pb-1">
                    <span className="text-[var(--ui-muted)]">{label}</span>
                    <span className="font-medium">{selectedClosedRegister.arqueo?.denominations?.[key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {Array.isArray(selectedClosedRegister.movements) &&
              selectedClosedRegister.movements.filter((m) => m.type === 'income').length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-semibold rf-section-title mb-2">Ingresos</p>
                  <div className="space-y-1">
                    {selectedClosedRegister.movements
                      .filter((mv) => mv.type === 'income')
                      .map((mv) => (
                        <div key={mv.id} className="text-sm flex justify-between border-b border-slate-100 py-1">
                          <span className="text-[var(--ui-muted)]">{formatDateTime(mv.created_at)} · {mv.concept || 'Sin concepto'}</span>
                          <span className="font-medium text-emerald-600">{formatCurrency(mv.amount || 0)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            {Array.isArray(selectedClosedRegister.movements) &&
              selectedClosedRegister.movements.filter((m) => m.type === 'expense').length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-semibold rf-section-title mb-2">Egresos</p>
                  <div className="space-y-1">
                    {selectedClosedRegister.movements
                      .filter((mv) => mv.type === 'expense')
                      .map((mv) => (
                        <div key={mv.id} className="text-sm flex justify-between border-b border-slate-100 py-1">
                          <span className="text-[var(--ui-muted)]">{formatDateTime(mv.created_at)} · {mv.concept || 'Sin concepto'}</span>
                          <span className="font-medium text-red-600">{formatCurrency(mv.amount || 0)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            {Array.isArray(selectedClosedRegister.notes_list) &&
              selectedClosedRegister.notes_list.filter((n) => n.note_type === 'debit').length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-semibold rf-section-title mb-2">Notas de débito</p>
                  <div className="space-y-1">
                    {selectedClosedRegister.notes_list
                      .filter((note) => note.note_type === 'debit')
                      .map((note) => (
                        <div key={note.id} className="text-sm flex justify-between border-b border-slate-100 py-1">
                          <span className="text-[var(--ui-muted)]">{formatDateTime(note.created_at)} · {note.reason || 'Sin motivo'}</span>
                          <span className="font-medium text-[var(--ui-body-text)]">{formatCurrency(note.amount || 0)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            {Array.isArray(selectedClosedRegister.notes_list) &&
              selectedClosedRegister.notes_list.filter((n) => n.note_type === 'credit').length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <p className="text-sm font-semibold rf-section-title mb-2">Notas de crédito</p>
                  <div className="space-y-1">
                    {selectedClosedRegister.notes_list
                      .filter((note) => note.note_type === 'credit')
                      .map((note) => (
                        <div key={note.id} className="text-sm flex justify-between border-b border-slate-100 py-1">
                          <span className="text-[var(--ui-muted)]">{formatDateTime(note.created_at)} · {note.reason || 'Sin motivo'}</span>
                          <span className="font-medium text-[var(--ui-body-text)]">{formatCurrency(note.amount || 0)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-[var(--ui-muted)] mb-1">Observaciones</p>
              <p className="text-sm text-[var(--ui-body-text)]">{selectedClosedRegister.arqueo?.observations || selectedClosedRegister.notes || 'Sin observaciones'}</p>
            </div>
            {Array.isArray(selectedClosedRegister.sold_products) && selectedClosedRegister.sold_products.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <p className="text-sm font-semibold rf-section-title mb-2">Detalle por producto (ventas de la caja)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 px-2 text-xs text-[var(--ui-muted)] uppercase">Producto</th>
                        <th className="text-right py-2 px-2 text-xs text-[var(--ui-muted)] uppercase">Cantidad</th>
                        <th className="text-right py-2 px-2 text-xs text-[var(--ui-muted)] uppercase">Precio</th>
                        <th className="text-right py-2 px-2 text-xs text-[var(--ui-muted)] uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedClosedRegister.sold_products.map((item) => {
                        const qty = Number(item.total_qty || 0);
                        const unit = qty > 0 ? Number(item.total_amount || 0) / qty : 0;
                        return (
                          <tr key={`${item.product_id || item.product_name}`} className="border-b border-slate-50">
                            <td className="py-2 px-2">{item.product_name}</td>
                            <td className="py-2 px-2 text-right font-medium">{qty}</td>
                            <td className="py-2 px-2 text-right font-medium">{formatCurrency(unit)}</td>
                            <td className="py-2 px-2 text-right font-semibold">{formatCurrency(item.total_amount || 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
