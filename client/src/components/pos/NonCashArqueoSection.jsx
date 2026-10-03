import {
  MdAccountBalanceWallet,
  MdBalance,
  MdCalculate,
  MdCheckCircle,
  MdCreditCard,
  MdErrorOutline,
  MdHourglassEmpty,
  MdInfoOutline,
  MdLanguage,
  MdVolunteerActivism,
} from 'react-icons/md';
import { formatCurrency } from '../../utils/api';

function MethodBadge({ value }) {
  if (value === 'yape') {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#742284] text-white text-[13px] font-extrabold italic tracking-tight shadow-sm">
        yape
      </span>
    );
  }
  if (value === 'plin') {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00b5e2] to-[#0077c8] text-white text-[13px] font-extrabold tracking-tight shadow-sm">
        plin
      </span>
    );
  }
  const Icon = value === 'tarjeta' ? MdCreditCard : MdLanguage;
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600">
      <Icon className="text-2xl" />
    </span>
  );
}

function statusOf(row) {
  if (!row.verified) return 'pending';
  if (row.difference === 0) return 'ok';
  return row.difference > 0 ? 'over' : 'short';
}

const STATUS_UI = {
  pending: {
    pill: 'bg-[var(--ui-surface-2)] text-[var(--ui-muted)] border-[color:var(--ui-border)]',
    box: 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)]',
    text: 'text-[var(--ui-muted)]',
    icon: MdHourglassEmpty,
    label: 'Sin verificar',
  },
  ok: {
    pill: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
    box: 'bg-emerald-500/10 border-emerald-500/25',
    text: 'text-emerald-700',
    icon: MdCheckCircle,
    label: 'Cuadra',
  },
  over: {
    pill: 'bg-sky-500/15 text-sky-700 border-sky-500/30',
    box: 'bg-sky-500/10 border-sky-500/25',
    text: 'text-sky-700',
    icon: MdErrorOutline,
    label: 'Sobrante',
  },
  short: {
    pill: 'bg-red-500/15 text-red-700 border-red-500/30',
    box: 'bg-red-500/10 border-red-500/25',
    text: 'text-red-700',
    icon: MdErrorOutline,
    label: 'Faltante',
  },
};

function signedCurrency(n) {
  return `${n > 0 ? '+' : ''}${formatCurrency(n)}`;
}

function BreakdownLines({ cash, card, qr, other }) {
  return (
    <div className="mt-2 space-y-0.5 text-xs text-[var(--ui-body-text)] tabular-nums">
      <p>Efectivo: <span className="font-semibold">{formatCurrency(cash)}</span></p>
      <p>POS Tarjetas: <span className="font-semibold">{formatCurrency(card)}</span></p>
      <p>QR (Yape/Plin): <span className="font-semibold">{formatCurrency(qr)}</span></p>
      {other > 0 ? <p>Online: <span className="font-semibold">{formatCurrency(other)}</span></p> : null}
    </div>
  );
}

function sumBy(rows, values, field) {
  return rows
    .filter((r) => values.includes(r.value))
    .reduce((s, r) => s + Number(r[field] || 0), 0);
}

/** Verificación de cobros no efectivo (POS de tarjetas / QR) y totales del arqueo. */
export default function NonCashArqueoSection({
  rows,
  counted,
  onCountedChange,
  registerFieldRef,
  onFieldEnter,
  cashTips = 0,
  cashExpected,
  cashCounted,
  cashCountMissing,
  grandExpected,
  grandCounted,
  grandDifference,
  pendingRows = [],
}) {
  const diffStatus = cashCountMissing ? 'pending' : grandDifference === 0 ? 'ok' : grandDifference > 0 ? 'over' : 'short';
  const diffUi = STATUS_UI[diffStatus];
  const DiffIcon = diffUi.icon;

  return (
    <div className="rounded-2xl p-4 border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-lg text-[var(--ui-body-text)]">Otros medios (POS / QR)</h3>
          <p className="text-xs text-[var(--ui-muted)]">
            Escriba lo que marca el POS de tarjetas y lo recibido por QR (Yape, Plin…) para compararlo con el sistema.
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-700">
          <MdInfoOutline className="text-sm shrink-0" />
          Ingrese los montos contados o verificados físicamente
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => {
          const st = statusOf(r);
          const ui = STATUS_UI[st];
          const StIcon = ui.icon;
          return (
            <div
              key={r.value}
              className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-3 shadow-sm focus-within:border-[color:var(--ui-accent)] focus-within:ring-2 focus-within:ring-[color:var(--ui-accent)]/25"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MethodBadge value={r.value} />
                  <label htmlFor={`nc-input-${r.value}`} className="text-sm font-bold text-[var(--ui-body-text)] truncate">
                    {r.checkLabel}
                  </label>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-[var(--ui-muted)] leading-tight">Sistema</p>
                  <p className="text-sm font-bold tabular-nums text-[var(--ui-body-text)]">{formatCurrency(r.expected)}</p>
                </div>
              </div>
              {r.tip > 0 ? (
                <p className="mb-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 tabular-nums">
                  Venta {formatCurrency(r.amount)} + propina {formatCurrency(r.tip)}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] text-sm">S/</span>
                  <input
                    id={`nc-input-${r.value}`}
                    ref={(el) => registerFieldRef(`nc_${r.value}`, el)}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    enterKeyHint="next"
                    value={counted[r.value] ?? ''}
                    onChange={(e) => onCountedChange(r.value, e.target.value)}
                    onKeyDown={(e) => onFieldEnter(e, `nc_${r.value}`)}
                    onFocus={(e) => e.target.select()}
                    className="input-field py-2 pl-9 text-sm font-semibold"
                    placeholder={r.expected.toFixed(2)}
                  />
                </div>
                <span className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-semibold whitespace-nowrap ${ui.pill}`}>
                  <StIcon className="text-sm" />
                  {ui.label}
                </span>
              </div>
              <div className={`mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 ${ui.box}`}>
                <StIcon className={`text-lg shrink-0 ${ui.text}`} />
                <div className="leading-tight">
                  <p className="text-[11px] text-[var(--ui-muted)]">Diferencia</p>
                  <p className={`text-sm font-bold tabular-nums ${ui.text}`}>
                    {st === 'pending' ? '—' : signedCurrency(r.difference)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {cashTips > 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-700">
                  <MdVolunteerActivism className="text-2xl" />
                </span>
                <p className="text-sm font-bold text-[var(--ui-body-text)]">Propina en efectivo</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-[var(--ui-muted)] leading-tight">Total</p>
                <p className="text-sm font-bold tabular-nums text-amber-700">{formatCurrency(cashTips)}</p>
              </div>
            </div>
            <p className="text-[11px] text-[var(--ui-muted)]">Incluida en el efectivo esperado del conteo.</p>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600">
              <MdCalculate className="text-2xl" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--ui-body-text)]">Total esperado (Sistema)</p>
              <p className="text-xl font-bold tabular-nums text-[var(--ui-body-text)]">{formatCurrency(grandExpected)}</p>
              <BreakdownLines
                cash={cashExpected}
                card={sumBy(rows, ['tarjeta'], 'expected')}
                qr={sumBy(rows, ['yape', 'plin'], 'expected')}
                other={sumBy(rows, ['online'], 'expected')}
              />
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${cashCountMissing ? 'border-[color:var(--ui-border)] bg-[var(--ui-surface)]' : 'border-emerald-500/25 bg-emerald-500/10'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
                <MdAccountBalanceWallet className="text-2xl" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--ui-body-text)]">Total contado (Real)</p>
                <p className="text-xl font-bold tabular-nums text-[var(--ui-body-text)]">{formatCurrency(grandCounted)}</p>
                <BreakdownLines
                  cash={cashCounted}
                  card={sumBy(rows, ['tarjeta'], 'counted')}
                  qr={sumBy(rows, ['yape', 'plin'], 'counted')}
                  other={sumBy(rows, ['online'], 'counted')}
                />
              </div>
            </div>
            {!cashCountMissing ? <MdCheckCircle className="text-2xl text-emerald-600 shrink-0" /> : null}
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${diffUi.box}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface)] ${diffUi.text}`}>
                <MdBalance className="text-2xl" />
              </span>
              <div>
                <p className="text-xs font-semibold text-[var(--ui-body-text)]">Diferencia total</p>
                <p className={`text-xl font-bold tabular-nums ${diffUi.text}`}>
                  {cashCountMissing ? '—' : signedCurrency(grandDifference)}
                </p>
              </div>
            </div>
            <DiffIcon className={`text-2xl shrink-0 ${diffUi.text}`} />
          </div>
          <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 bg-[var(--ui-surface)]/60 ${diffUi.box}`}>
            <DiffIcon className={`text-xl shrink-0 ${diffUi.text}`} />
            <div className="leading-tight">
              <p className={`text-xs font-bold ${diffUi.text}`}>
                {diffStatus === 'pending' ? 'Falta contar el efectivo'
                  : diffStatus === 'ok' ? 'Los montos cuadran correctamente'
                    : diffStatus === 'over' ? 'Hay un sobrante' : 'Hay un faltante'}
              </p>
              <p className="text-[11px] text-[var(--ui-muted)]">
                {diffStatus === 'pending' ? 'Complete el conteo de efectivo arriba'
                  : diffStatus === 'ok' ? 'No se encontraron diferencias'
                    : 'Revise el conteo antes de cerrar'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {pendingRows.length > 0 && (
        <p className="text-[11px] text-[var(--ui-muted)] mt-2">
          Sin verificar: {pendingRows.map((r) => r.checkLabel).join(', ')} — se toma el monto del sistema.
        </p>
      )}
    </div>
  );
}
