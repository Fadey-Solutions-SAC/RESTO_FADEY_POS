import {
  MdAdd,
  MdCalculate,
  MdCheckCircle,
  MdErrorOutline,
  MdHourglassEmpty,
  MdListAlt,
  MdPayments,
  MdRemove,
  MdSavings,
  MdSwapHoriz,
} from 'react-icons/md';
import { formatCurrency } from '../../utils/api';

/** Colores de referencia de cada denominación (tarjeta + ilustración). */
const DENOM_STYLE = {
  b200: { tint: '#f6efe3', ink: '#5b6b4f', paper: ['#d9e4cf', '#9fb48f'] },
  b100: { tint: '#e6f0fb', ink: '#1d4f91', paper: ['#cfe0f5', '#7ea6d8'] },
  b50: { tint: '#fbe7ea', ink: '#9b2335', paper: ['#f4cdd3', '#d98292'] },
  b20: { tint: '#fdeedd', ink: '#a14d12', paper: ['#f8d9b8', '#e3995a'] },
  b10: { tint: '#efe9fa', ink: '#4b3a8c', paper: ['#ddd3f3', '#9f8ad8'] },
  m5: { tint: '#fbf3e0', ink: '#7a5a12', coin: 'bimetal' },
  m2: { tint: '#e8f2fb', ink: '#1d4f91', coin: 'bimetal' },
  m1: { tint: '#eef0f3', ink: '#3f4752', coin: 'silver' },
  c50: { tint: '#e5f5ee', ink: '#1f6b4a', coin: 'silver' },
  c20: { tint: '#fbe7ea', ink: '#9b2335', coin: 'brass' },
  c10: { tint: '#efe9fa', ink: '#4b3a8c', coin: 'brass' },
};

function denomShortLabel(value) {
  return value >= 1 ? `S/ ${value}` : `S/ ${value.toFixed(2)}`;
}

function BillArt({ denomKey, value }) {
  const st = DENOM_STYLE[denomKey] || DENOM_STYLE.b10;
  const gid = `bill-${denomKey}`;
  return (
    <svg viewBox="0 0 120 58" className="w-full max-w-[8.5rem] h-auto drop-shadow-sm" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={st.paper[0]} />
          <stop offset="100%" stopColor={st.paper[1]} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="118" height="56" rx="4" fill={`url(#${gid})`} stroke={st.ink} strokeOpacity="0.35" />
      <rect x="5" y="5" width="110" height="48" rx="2.5" fill="none" stroke={st.ink} strokeOpacity="0.25" strokeDasharray="2 2" />
      {[14, 20, 26, 32, 38, 44].map((y) => (
        <path key={y} d={`M10 ${y} Q 26 ${y - 4}, 42 ${y}`} fill="none" stroke={st.ink} strokeOpacity="0.18" strokeWidth="1" />
      ))}
      <circle cx="78" cy="27" r="14" fill="#ffffff" fillOpacity="0.35" stroke={st.ink} strokeOpacity="0.3" />
      <circle cx="78" cy="23" r="5.2" fill={st.ink} fillOpacity="0.55" />
      <path d="M68 38 Q 78 28, 88 38 Z" fill={st.ink} fillOpacity="0.55" />
      <circle cx="18" cy="44" r="5" fill="#d4a017" fillOpacity="0.8" />
      <text x="112" y="51" textAnchor="end" fontSize="13" fontWeight="800" fill={st.ink} fillOpacity="0.85" fontFamily="system-ui, sans-serif">
        {value}
      </text>
      <text x="10" y="13" fontSize="5" fontWeight="700" fill={st.ink} fillOpacity="0.7" fontFamily="system-ui, sans-serif">
        SOLES
      </text>
    </svg>
  );
}

const COIN_METAL = {
  silver: { outer: ['#f4f6f8', '#9aa3ad'], inner: ['#e9edf1', '#a7b0ba'], ink: '#4a525c' },
  brass: { outer: ['#f7e3a1', '#b8892b'], inner: ['#f3d987', '#b07f22'], ink: '#6b4c10' },
  bimetal: { outer: ['#eef1f4', '#9aa3ad'], inner: ['#f7e3a1', '#b8892b'], ink: '#5c4510' },
};

function CoinArt({ denomKey, value }) {
  const st = DENOM_STYLE[denomKey] || DENOM_STYLE.m1;
  const metal = COIN_METAL[st.coin] || COIN_METAL.silver;
  const gOuter = `coin-o-${denomKey}`;
  const gInner = `coin-i-${denomKey}`;
  const label = value >= 1 ? String(value) : String(Math.round(value * 100));
  return (
    <svg viewBox="0 0 60 60" className="h-14 w-14 drop-shadow" aria-hidden="true">
      <defs>
        <radialGradient id={gOuter} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={metal.outer[0]} />
          <stop offset="100%" stopColor={metal.outer[1]} />
        </radialGradient>
        <radialGradient id={gInner} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={metal.inner[0]} />
          <stop offset="100%" stopColor={metal.inner[1]} />
        </radialGradient>
      </defs>
      <circle cx="30" cy="30" r="28" fill={`url(#${gOuter})`} stroke={metal.ink} strokeOpacity="0.35" />
      <circle cx="30" cy="30" r="25" fill="none" stroke={metal.ink} strokeOpacity="0.25" strokeDasharray="1.2 1.6" />
      <circle cx="30" cy="30" r={st.coin === 'bimetal' ? 18 : 22} fill={`url(#${gInner})`} stroke={metal.ink} strokeOpacity="0.2" />
      <text
        x="30"
        y="36"
        textAnchor="middle"
        fontSize={label.length > 1 ? 16 : 19}
        fontWeight="800"
        fill={metal.ink}
        fillOpacity="0.85"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}

function DenomCard({ def, count, onInput, onStep, registerFieldRef, onFieldEnter, isCoin }) {
  const st = DENOM_STYLE[def.key] || {};
  const qty = parseFloat(count) || 0;
  return (
    <div
      className="rounded-xl border border-[color:var(--ui-border)] p-3 flex flex-col items-center gap-2 focus-within:ring-2 focus-within:ring-[color:var(--ui-accent)]/30 focus-within:border-[color:var(--ui-accent)]"
      style={{ backgroundColor: `color-mix(in srgb, ${st.tint || '#f3f4f6'} 75%, var(--ui-surface))` }}
    >
      <p className="text-sm font-bold" style={{ color: st.ink }}>{denomShortLabel(def.value)}</p>
      <div className="flex h-16 items-center justify-center w-full">
        {isCoin ? <CoinArt denomKey={def.key} value={def.value} /> : <BillArt denomKey={def.key} value={def.value} />}
      </div>
      <div className="flex items-center w-full max-w-[9.5rem] rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] overflow-hidden">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onStep(def.key, -1)}
          disabled={qty <= 0}
          className="h-9 w-9 shrink-0 flex items-center justify-center text-[var(--ui-body-text)] hover:bg-[var(--ui-surface-2)] disabled:opacity-40"
          aria-label={`Quitar ${def.label}`}
        >
          <MdRemove />
        </button>
        <input
          ref={(el) => registerFieldRef(def.key, el)}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          enterKeyHint="next"
          value={count}
          onChange={(e) => onInput(def.key, e.target.value)}
          onKeyDown={(e) => onFieldEnter(e, def.key)}
          onFocus={(e) => e.target.select()}
          className="h-9 w-full min-w-0 border-x border-[color:var(--ui-border)] bg-transparent text-center text-sm font-semibold tabular-nums text-[var(--ui-body-text)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          placeholder="0"
          aria-label={def.label}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onStep(def.key, 1)}
          className="h-9 w-9 shrink-0 flex items-center justify-center text-[var(--ui-body-text)] hover:bg-[var(--ui-surface-2)]"
          aria-label={`Agregar ${def.label}`}
        >
          <MdAdd />
        </button>
      </div>
      <p className="text-xs text-[var(--ui-muted)] tabular-nums">
        Subtotal: <span className="font-bold text-[var(--ui-body-text)]">{formatCurrency(qty * def.value)}</span>
      </p>
    </div>
  );
}

function GroupHeader({ icon: Icon, title, subtitle, totalLabel, total, totalIcon: TotalIcon }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-500/15 text-blue-600">
          <Icon className="text-2xl" />
        </span>
        <div>
          <p className="font-bold text-[var(--ui-body-text)]">{title}</p>
          <p className="text-xs text-[var(--ui-muted)]">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700">
          <TotalIcon className="text-xl" />
        </span>
        <div className="leading-tight">
          <p className="text-[11px] text-[var(--ui-muted)]">{totalLabel}</p>
          <p className="text-lg font-bold tabular-nums text-[var(--ui-body-text)]">{formatCurrency(total)}</p>
        </div>
      </div>
    </div>
  );
}

function sumDenoms(defs, denominations) {
  return Math.round(defs.reduce((s, d) => s + (parseFloat(denominations[d.key]) || 0) * d.value, 0) * 100) / 100;
}

/** Conteo de efectivo por billetes y monedas, con efectivo esperado y diferencia. */
export default function CashCountSection({
  denomDefs,
  denominations,
  onInput,
  onStep,
  registerFieldRef,
  onFieldEnter,
  closingAmount,
  onClosingAmountChange,
  cashExpected,
  expectedHint,
  difference,
  denominationMismatch,
  denomTotal,
}) {
  const bills = denomDefs.filter((d) => d.value >= 10);
  const coins = denomDefs.filter((d) => d.value < 10);
  const billsTotal = sumDenoms(bills, denominations);
  const coinsTotal = sumDenoms(coins, denominations);
  const missing = closingAmount === '';
  const status = missing ? 'pending' : difference === 0 ? 'ok' : difference > 0 ? 'over' : 'short';
  const statusUi = {
    pending: { box: 'border-[color:var(--ui-border)] bg-[var(--ui-surface)]', text: 'text-[var(--ui-muted)]', icon: MdHourglassEmpty, title: 'Falta contar el efectivo', sub: 'Ingrese billetes y monedas' },
    ok: { box: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-700', icon: MdCheckCircle, title: 'Los montos cuadran correctamente', sub: 'No se encontraron diferencias' },
    over: { box: 'border-sky-500/30 bg-sky-500/10', text: 'text-sky-700', icon: MdErrorOutline, title: 'Sobrante en caja', sub: 'Hay más efectivo del esperado' },
    short: { box: 'border-red-500/30 bg-red-500/10', text: 'text-red-700', icon: MdErrorOutline, title: 'Faltante en caja', sub: 'Hay menos efectivo del esperado' },
  }[status];
  const StatusIcon = statusUi.icon;
  const cardProps = { onInput, onStep, registerFieldRef, onFieldEnter };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[var(--ui-muted)] px-1">
        Conteo de efectivo — escriba la cantidad y pasa sola a la siguiente (o presione Enter); también puede usar − / +.
      </p>

      <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4">
        <GroupHeader
          icon={MdPayments}
          title="Billetes"
          subtitle="Ingresa la cantidad de billetes por denominación"
          totalLabel="Total en billetes"
          total={billsTotal}
          totalIcon={MdPayments}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {bills.map((d) => (
            <DenomCard key={d.key} def={d} count={denominations[d.key]} {...cardProps} />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4">
        <GroupHeader
          icon={MdSavings}
          title="Monedas"
          subtitle="Ingresa la cantidad de monedas por denominación"
          totalLabel="Total en monedas"
          total={coinsTotal}
          totalIcon={MdSavings}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {coins.map((d) => (
            <DenomCard key={d.key} def={d} count={denominations[d.key]} isCoin {...cardProps} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600">
              <MdCalculate className="text-2xl" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--ui-body-text)]">Total por arqueo</p>
              <div className="relative mt-0.5">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-lg font-bold text-[var(--ui-body-text)]">S/</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={closingAmount}
                  onChange={(e) => onClosingAmountChange(e.target.value)}
                  placeholder="0.00"
                  title="Se llena solo con el conteo; puede corregirlo a mano"
                  className="w-full bg-transparent pl-7 text-xl font-bold tabular-nums text-[var(--ui-body-text)] outline-none border-b border-transparent focus:border-[color:var(--ui-accent)]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600">
              <MdListAlt className="text-2xl" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--ui-body-text)]">Efectivo en sistema</p>
              <p className="text-xl font-bold tabular-nums text-[var(--ui-body-text)]">{formatCurrency(cashExpected)}</p>
              {expectedHint ? <p className="text-[10px] text-[var(--ui-muted)] leading-snug mt-0.5">{expectedHint}</p> : null}
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-3 ${statusUi.box}`}>
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ui-surface)] ${statusUi.text}`}>
              <MdSwapHoriz className="text-2xl" />
            </span>
            <div>
              <p className="text-xs font-semibold text-[var(--ui-body-text)]">Diferencia</p>
              <p className={`text-xl font-bold tabular-nums ${statusUi.text}`}>
                {missing ? '—' : `${difference > 0 ? '+' : ''}${formatCurrency(difference)}`}
              </p>
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-3 flex items-center gap-3 ${statusUi.box}`}>
          <StatusIcon className={`text-3xl shrink-0 ${statusUi.text}`} />
          <div className="leading-tight">
            <p className={`text-sm font-bold ${statusUi.text}`}>{statusUi.title}</p>
            <p className="text-[11px] text-[var(--ui-muted)]">{statusUi.sub}</p>
          </div>
        </div>
      </div>

      {denominationMismatch ? (
        <p className="text-sm text-amber-700 px-3 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2">
          El total por denominación ({formatCurrency(denomTotal)}) no coincide con el efectivo contado ingresado ({formatCurrency(closingAmount === '' ? 0 : Number(closingAmount))}). La diferencia se calcula con el importe que escribió.
        </p>
      ) : null}
    </div>
  );
}
