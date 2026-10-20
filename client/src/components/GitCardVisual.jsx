import { useState } from 'react';
import { resolveMediaUrl } from '../utils/api';

const STATUS_LABEL = {
  none: 'Sin tarjeta',
  active: 'Activa',
  pending: 'Pendiente',
  completed: 'Completa',
  reward_available: 'Recompensa',
  reward_used: 'Canjeada',
  expired: 'Vencida',
};

function cardModel(card) {
  const progress = card?.progress || { confirmed: 0, pending: 0, goal: 0, remaining: 0 };
  const goal = Math.max(0, Number(progress.goal || 0));
  const confirmed = Number(progress.confirmed || 0);
  const pending = Number(progress.pending || 0);
  const slots = Array.from({ length: Math.max(goal, 1) }, (_, i) => {
    if (i < confirmed) return 'confirmed';
    if (i < confirmed + pending) return 'pending';
    return 'empty';
  });
  const remaining = Math.max(0, Number(progress.remaining ?? Math.max(0, goal - confirmed - pending)));
  return {
    restaurant: card?.restaurant_name || '',
    program: card?.program_name || '',
    name: card?.customer?.name || '',
    doc: card?.customer?.doc_masked || '',
    reward: card?.reward_title || '',
    detail: card?.reward_description || '',
    info: card?.info_text || '',
    terms: Array.isArray(card?.terms) ? card.terms.filter((row) => row?.label && row?.value) : [],
    logo: card?.logo_url ? resolveMediaUrl(card.logo_url) : '',
    status: STATUS_LABEL[card?.status] || card?.status || 'GIT Card',
    goal: Math.max(goal, 1),
    confirmed,
    pending,
    remaining,
    slots,
    ratio: goal > 0 ? Math.min(1, confirmed / goal) : 0,
  };
}

function MiniMark({ seed = 'git', ink = '#111', paper = '#fff' }) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const cells = [];
  for (let i = 0; i < 49; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const x = i % 7;
    const y = Math.floor(i / 7);
    const finder = (x < 2 && y < 2) || (x > 4 && y < 2) || (x < 2 && y > 4);
    cells.push(finder || (h & 3) !== 0);
  }
  return (
    <svg viewBox="0 0 7 7" className="h-full w-full" aria-hidden>
      <rect width="7" height="7" fill={paper} />
      {cells.map((on, i) => (on ? (
        <rect key={i} x={(i % 7) + 0.12} y={Math.floor(i / 7) + 0.12} width="0.76" height="0.76" fill={ink} />
      ) : null))}
    </svg>
  );
}

function ClassicCard({ card, compact, model }) {
  const colors = card.colors || {};
  const slotClass = (kind) => {
    if (kind === 'confirmed') return 'bg-emerald-400 text-emerald-950';
    if (kind === 'pending') return 'bg-amber-300/90 text-amber-950 ring-2 ring-amber-100/80';
    return 'bg-white/15 text-white/70';
  };
  return (
    <article
      className={`relative overflow-hidden rounded-2xl shadow-lg ${compact ? 'p-4' : 'p-5 sm:p-6'}`}
      style={{ background: colors.bg || '#111827', color: colors.text || '#f8fafc' }}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20" style={{ background: colors.accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {model.logo ? (
            <img src={model.logo} alt="" className="h-10 w-10 rounded-full bg-white object-cover" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold" style={{ background: colors.accent, color: colors.bg }}>
              {model.restaurant.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs uppercase tracking-wider opacity-80">{model.program}</p>
            <p className="truncate text-lg font-semibold">{model.restaurant}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: colors.accent, color: colors.bg || '#111' }}>
          {model.status}
        </span>
      </div>
      {model.name ? (
        <div className="mt-4">
          <p className="text-base font-semibold">{model.name}</p>
          {model.doc ? <p className="text-xs opacity-70">Doc. {model.doc}</p> : null}
        </div>
      ) : null}
      <div className={`mt-4 flex flex-wrap ${compact ? 'gap-1.5' : 'gap-2'}`}>
        {model.slots.map((kind, i) => (
          <span
            key={`${kind}-${i}`}
            className={`grid ${compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'} place-items-center rounded-full font-bold ${slotClass(kind)}`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 text-sm">
        <div>
          <p className="opacity-70">Progreso</p>
          <p className="font-semibold">{model.confirmed} / {model.goal}</p>
        </div>
        <div className="text-right">
          <p className="opacity-70">Recompensa</p>
          <p className="font-semibold">{model.reward}</p>
        </div>
      </div>
    </article>
  );
}

function Frame({ children, className = '', style }) {
  return (
    <article
      className={`git-card relative aspect-[1.7/1] w-full overflow-hidden rounded-[1.15rem] shadow-xl ${className}`}
      style={style}
    >
      {children}
    </article>
  );
}

function VinylCard({ model }) {
  return (
    <Frame className="text-[#f6ead2]" style={{ background: '#070707' }}>
      <div
        className="absolute inset-0"
        style={{
          background: 'repeating-radial-gradient(circle at 58% 46%, #1c1c1c 0 2px, #0a0a0a 3px 7px)',
        }}
      />
      <svg className="absolute left-[8%] top-[6%] w-[42%] text-zinc-300" viewBox="0 0 220 70" aria-hidden>
        <circle cx="28" cy="28" r="10" fill="#9ca3af" />
        <circle cx="28" cy="28" r="4" fill="#111" />
        <path d="M38 28 C90 26 140 18 196 34" fill="none" stroke="#d4d4d8" strokeWidth="3" />
        <rect x="188" y="28" width="22" height="10" rx="2" fill="#a1a1aa" transform="rotate(18 188 28)" />
      </svg>
      <div className="absolute left-1/2 top-[22%] grid h-[30%] w-[30%] -translate-x-1/2 place-items-center rounded-full bg-[#f3e6cf] text-center text-[#2b2118] shadow-inner">
        <div>
          <p className="text-[9px] tracking-[0.28em]">GIT</p>
          <p className="px-2 text-[11px] font-black leading-tight tracking-wide sm:text-sm">{model.restaurant}</p>
          <p className="text-[8px] tracking-[0.18em]">GIT CARD</p>
        </div>
      </div>
      <div className="absolute bottom-[22%] left-[6%] right-[6%] flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {model.slots.slice(0, 10).map((kind, i) => (
            <span
              key={i}
              className="text-lg leading-none sm:text-xl"
              style={{
                color: kind === 'confirmed' ? '#f5b942' : kind === 'pending' ? '#38bdf8' : '#3f3f46',
                textShadow: kind === 'confirmed' ? '0 0 8px #f5b942' : kind === 'pending' ? '0 0 8px #38bdf8' : 'none',
              }}
            >
              ♪
            </span>
          ))}
        </div>
        <div className="text-right">
          <p className="text-[9px] tracking-[0.2em] text-[#f5b942]">AVANCE {model.confirmed}</p>
          <div className="ml-auto mt-1 aspect-square w-[18%] min-w-[1.6rem] overflow-hidden rounded-sm bg-white">
            <MiniMark seed={`${model.name}-${model.goal}`} />
          </div>
        </div>
      </div>
      <div className="absolute bottom-[4%] left-[6%] right-[6%] flex items-end justify-between border-t border-white/10 pt-1 text-[10px]">
        <div>
          <p className="tracking-[0.16em] text-white/50">TITULAR</p>
          <p className="font-semibold uppercase tracking-wide">{model.name}</p>
          {model.doc ? <p className="tracking-[0.14em] text-white/70">{model.doc}</p> : null}
        </div>
        <p className="max-w-[40%] truncate text-right text-[10px] text-[#f5b942]">{model.reward}</p>
      </div>
    </Frame>
  );
}

function BrewCard({ model }) {
  return (
    <Frame className="text-[#f6e7c8]" style={{ background: '#24160e' }}>
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background: 'repeating-linear-gradient(90deg, #3a2616 0 18px, #2a1a10 18px 22px), radial-gradient(circle at 20% 80%, #5a3a22 0 1px, transparent 2px)',
        }}
      />
      <div className="relative flex h-full flex-col px-4 py-3">
        <div className="text-center">
          <p className="text-sm font-black tracking-[0.18em] sm:text-base">{model.restaurant}</p>
          <p className="text-[9px] tracking-[0.28em] text-[#e7c27a]">GIT CARD</p>
        </div>
        <div className="flex flex-1 items-center gap-3">
          <svg viewBox="0 0 40 80" className="h-16 w-8 shrink-0 text-[#c4a574] opacity-80" aria-hidden>
            <path d="M8 20c2-8 4-10 6-14M16 18c2-6 3-8 4-12M24 22c1-6 2-8 2-12" fill="none" stroke="currentColor" strokeWidth="1" />
            <ellipse cx="16" cy="28" rx="7" ry="10" fill="#d8f27a" opacity="0.5" />
          </svg>
          <div className="flex flex-1 flex-col items-center">
            <svg viewBox="0 0 70 90" className="h-20 w-14" aria-hidden>
              <path d="M18 28h34v40c0 12-8 18-17 18s-17-6-17-18V28z" fill="#f8fafc" stroke="#e7c27a" />
              <path d="M20 40h30v26c0 9-6 14-15 14s-15-5-15-14V40z" fill="#f5b942" />
              <ellipse cx="35" cy="30" rx="18" ry="8" fill="#fff7d6" />
              <circle cx="28" cy="52" r="1.2" fill="#fff" opacity="0.7" />
              <circle cx="36" cy="60" r="1" fill="#fff" opacity="0.7" />
              <circle cx="42" cy="48" r="1.1" fill="#fff" opacity="0.7" />
            </svg>
            <p className="mt-1 text-[11px] font-semibold">{model.confirmed} / {model.goal} avances</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-gradient-to-r from-[#f5d78a] to-[#f5b942]" style={{ width: `${Math.round(model.ratio * 100)}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-[#f5d78a]">
              {model.remaining > 0 ? `Faltan ${model.remaining} para ${model.reward}` : model.reward}
            </p>
          </div>
          <div className="flex w-14 flex-col items-center gap-1">
            <p className="text-lg font-black text-[#f5d78a]">{model.confirmed}<span className="text-xs">★</span></p>
            <div className="h-10 w-10 overflow-hidden rounded bg-white p-0.5">
              <MiniMark seed={model.name} />
            </div>
          </div>
        </div>
        <div className="flex items-end justify-between text-[10px]">
          <div>
            <p className="tracking-[0.16em] text-[#e7c27a]">MIEMBRO</p>
            <p className="font-bold uppercase">{model.name}</p>
            {model.doc ? <p className="opacity-80">{model.doc}</p> : null}
          </div>
          <p className="max-w-[45%] truncate text-right">{model.status}</p>
        </div>
      </div>
    </Frame>
  );
}

function InkCard({ model }) {
  return (
    <Frame className="text-[#3a2a22]" style={{ background: '#f7f1e6' }}>
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(#d6cbb8 0.6px, transparent 0.6px)', backgroundSize: '7px 7px' }} />
      <svg className="absolute -right-2 top-0 h-full w-[48%]" viewBox="0 0 200 140" aria-hidden>
        <path d="M40 0c20 30 10 40 28 70" fill="none" stroke="#1e3a5f" strokeWidth="8" opacity="0.85" />
        <path d="M90 0c8 24 4 36 16 58" fill="none" stroke="#2a211c" strokeWidth="6" />
        <circle cx="78" cy="78" r="26" fill="#1e3a5f" />
        <circle cx="122" cy="36" r="16" fill="#2a211c" />
        <circle cx="150" cy="96" r="18" fill="#f4efe6" stroke="#8a7355" />
      </svg>
      <div className="relative flex h-full flex-col justify-between p-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em]">{model.restaurant}</p>
          <p className="text-lg font-black leading-none tracking-wide">GIT CARD</p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="h-12 w-12 overflow-hidden rounded bg-[#efe6d6] p-1">
              <MiniMark seed={`${model.restaurant}-${model.name}`} ink="#3a2a22" paper="#f7f1e6" />
            </div>
            <p className="mt-2 text-[10px] tracking-[0.2em]">MIEMBRO</p>
            <p className="text-sm font-bold uppercase">{model.name}</p>
          </div>
          <div className="flex max-w-[50%] flex-wrap justify-end gap-1">
            {model.slots.slice(0, 8).map((kind, i) => (
              <span
                key={i}
                className="grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold"
                style={{
                  background: kind === 'confirmed' ? '#1e3a5f' : kind === 'pending' ? '#8a6232' : 'transparent',
                  color: kind === 'empty' ? '#8a7355' : '#f7f1e6',
                  borderColor: '#8a7355',
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>
        <p className="truncate text-[11px]">{model.reward}</p>
      </div>
    </Frame>
  );
}

function SakuraCard({ model }) {
  return (
    <Frame className="text-[#3f2a1c]" style={{ background: 'linear-gradient(160deg, #f0ddb4, #d7b98a)' }}>
      <svg className="absolute left-0 top-0 h-full w-[58%]" viewBox="0 0 240 160" aria-hidden>
        <path d="M10 130 C70 90 90 70 200 20" fill="none" stroke="#2b2118" strokeWidth="3" />
        <path d="M70 100 C90 80 110 90 130 70" fill="none" stroke="#2b2118" strokeWidth="2" />
        <circle cx="48" cy="112" r="7" fill="#f3b4c4" />
        <circle cx="96" cy="86" r="6" fill="#f7c2cf" />
        <circle cx="140" cy="64" r="7" fill="#f3b4c4" />
        <circle cx="178" cy="36" r="5" fill="#f7c2cf" />
      </svg>
      <div className="relative flex h-full flex-col justify-between p-3 sm:p-4">
        <div className="flex items-start justify-between">
          <p className="text-[10px] tracking-[0.2em]">GIT</p>
          <p className="text-xs font-semibold tracking-[0.22em]">GIT CARD</p>
        </div>
        <div className="ml-auto grid w-[58%] grid-cols-5 gap-1.5">
          {model.slots.slice(0, 10).map((kind, i) => (
            <span
              key={i}
              className="grid aspect-square place-items-center rounded-full border border-[#8a6a4a]/50 text-[10px]"
              style={{
                background: kind === 'empty' ? 'rgba(255,255,255,0.25)' : kind === 'pending' ? '#e7c27a' : '#f4b7c6',
                boxShadow: kind === 'confirmed' ? 'inset 0 0 0 2px #fff' : 'none',
              }}
            >
              {kind === 'confirmed' ? '✿' : ''}
            </span>
          ))}
        </div>
        <div className="flex items-end justify-between">
          <div className="h-11 w-11 overflow-hidden rounded bg-white/70 p-1">
            <MiniMark seed={model.name} ink="#3f2a1c" paper="#f6efe2" />
          </div>
          <div className="text-right">
            <p className="text-sm font-bold tracking-wide">{model.restaurant}</p>
            <p className="text-[10px] tracking-[0.12em]">MIEMBRO {model.doc || model.name}</p>
            <p className="text-[10px]">{model.confirmed}/{model.goal} · {model.reward}</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function GaugeCard({ model }) {
  const arc = Math.PI * 38;
  const dash = Math.max(0.01, model.ratio) * arc;
  return (
    <Frame className="text-[#fecaca]" style={{ background: '#12080b' }}>
      <div className="absolute inset-1 rounded-[0.9rem] border border-red-500/70 shadow-[0_0_18px_rgba(255,40,40,0.35)]" />
      <div className="relative grid h-full grid-cols-[1.1fr_0.9fr] gap-2 p-4">
        <div className="flex flex-col justify-between">
          <div>
            <p className="text-sm font-black tracking-wide">{model.restaurant}</p>
            <p className="text-[10px] tracking-[0.22em] text-red-300">GIT CARD</p>
          </div>
          <div>
            <p className="text-[10px] tracking-[0.16em] text-red-300">MIEMBRO</p>
            <p className="text-sm font-semibold uppercase">{model.name}</p>
            {model.doc ? <p className="text-[10px] tracking-widest">{model.doc}</p> : null}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center">
          <svg viewBox="0 0 100 62" className="w-full">
            <path d="M12 54 A38 38 0 0 1 88 54" fill="none" stroke="#3f1115" strokeWidth="8" />
            <path d="M12 54 A38 38 0 0 1 88 54" fill="none" stroke="#ff2d2d" strokeWidth="8" strokeDasharray={`${dash} ${arc}`} strokeLinecap="round" />
          </svg>
          <p className="text-xs font-black tracking-widest text-red-200">NIVEL {model.confirmed}</p>
          <p className="text-[10px] text-red-300">{model.confirmed}/{model.goal} · {model.reward}</p>
        </div>
      </div>
    </Frame>
  );
}

function CopperCard({ model }) {
  return (
    <Frame style={{ background: 'linear-gradient(145deg, #2a1c12, #120c09 45%, #3a281c)', color: '#f6d7c2' }}>
      <div className="absolute inset-[3px] rounded-[0.95rem] border border-[#c9845a]/80" />
      <div
        className="absolute inset-0 opacity-50"
        style={{ background: 'repeating-linear-gradient(100deg, transparent 0 10px, rgba(255,255,255,0.04) 10px 11px)' }}
      />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-[#c9845a] text-xs font-black">
            {model.restaurant.slice(0, 1)}
          </span>
          <span className="rounded border border-[#c9845a]/70 px-2 py-0.5 text-[9px] tracking-[0.18em]">
            {model.status.toUpperCase()}
          </span>
        </div>
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em]">{model.name}</p>
          <p className="mt-1 text-xs tracking-[0.22em] text-[#e7b899]">{model.doc || 'GIT CARD'}</p>
        </div>
        <div className="flex items-end justify-between text-[10px]">
          <p>{model.confirmed}/{model.goal} avances</p>
          <p className="max-w-[55%] truncate text-right">{model.reward}</p>
        </div>
      </div>
    </Frame>
  );
}

const BACKGROUNDS = {
  prestige: {
    bg: '#d7dde6',
    text: '#1f2937',
    panel: 'rgba(255,255,255,0.78)',
    art: { background: 'linear-gradient(120deg, #9aa3b2, #f8fafc 35%, #6b7280 52%, #e5e7eb 70%, #94a3b8)' },
  },
  neon: {
    bg: '#070814',
    text: '#e0f2fe',
    panel: 'rgba(7,8,20,0.55)',
    art: { background: 'radial-gradient(circle at 80% 20%, rgba(244,114,182,0.45), transparent 32%), radial-gradient(circle at 12% 84%, rgba(34,211,238,0.4), transparent 34%), linear-gradient(115deg, transparent 30%, rgba(34,211,238,0.35) 48%, transparent 52%), #070814' },
  },
  pearl: {
    bg: '#f4f1f6',
    text: '#4b5563',
    panel: 'rgba(255,255,255,0.62)',
    art: { background: 'radial-gradient(circle at 30% 20%, #fff 0, #f3e8ff 28%, #dbeafe 55%, #fce7f3 100%)' },
  },
  steel: {
    bg: '#c5c9d1',
    text: '#1f2937',
    panel: 'rgba(255,255,255,0.72)',
    art: { background: 'linear-gradient(118deg, #4b5563 0 28%, #d1d5db 28.4% 34%, #e5e7eb 34% 100%)' },
  },
  plata: {
    bg: '#d5d8de',
    text: '#111827',
    panel: 'rgba(255,255,255,0.7)',
    art: { background: 'linear-gradient(128deg, #e5e7eb 0 58%, #9ca3af 58% 70%, #4b5563 70% 100%)' },
  },
  marfil: {
    bg: '#f7f7f8',
    text: '#374151',
    panel: 'rgba(255,255,255,0.55)',
    art: { background: 'linear-gradient(128deg, #ffffff 0 62%, #f3f4f6 62% 78%, #e5e7eb 78% 100%)' },
  },
  botanica: {
    bg: '#0f7a4a',
    text: '#ecfdf5',
    panel: 'rgba(6,78,59,0.45)',
    art: { background: 'radial-gradient(circle at 70% 30%, #34d399 0, transparent 32%), repeating-linear-gradient(160deg, transparent 0 16px, rgba(255,255,255,0.08) 16px 18px), #0f7a4a' },
  },
  gourmet: {
    bg: '#0c0c0c',
    text: '#f8f1e3',
    panel: 'rgba(0,0,0,0.45)',
    art: { background: 'radial-gradient(circle at 0 0, rgba(228,194,122,0.35), transparent 28%), radial-gradient(circle at 100% 100%, rgba(228,194,122,0.25), transparent 30%), #111' },
  },
  oro: {
    bg: '#f6f1e7',
    text: '#3f3428',
    panel: 'rgba(255,255,255,0.62)',
    art: { background: 'linear-gradient(128deg, #c4923a 0 30%, #f6f1e7 30.4% 100%)' },
  },
  olas: {
    bg: '#1578d4',
    text: '#f0f9ff',
    panel: 'rgba(7,89,133,0.4)',
    art: { background: 'repeating-linear-gradient(165deg, rgba(255,255,255,0.14) 0 12px, transparent 12px 26px), linear-gradient(160deg, #38bdf8, #0369a1)' },
  },
};

function slotTone(kind, accent) {
  if (kind === 'confirmed') return { background: '#34d399', color: '#064e3b' };
  if (kind === 'pending') return { background: '#fcd34d', color: '#78350f' };
  return { background: 'transparent', color: accent, boxShadow: `inset 0 0 0 1.5px ${accent}` };
}

function CardFront({ theme, model, compact }) {
  const title = model.program || model.reward;
  return (
    <Frame style={{ background: theme.bg, color: theme.text }}>
      <div className="absolute inset-0" style={theme.art} />
      <div className={`relative flex h-full min-h-0 flex-col ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold uppercase tracking-[0.16em] opacity-90">
            {model.restaurant || 'GIT Card'}
          </p>
          {model.logo ? (
            <img src={model.logo} alt="" className="h-16 w-16 shrink-0 rounded-full bg-black object-cover shadow-md" />
          ) : null}
        </div>
        <div className="mt-3 min-w-0">
          {title ? <p className="line-clamp-2 text-2xl font-black uppercase leading-none tracking-wide">{title}</p> : null}
          {model.info ? <p className="mt-2 line-clamp-2 text-sm opacity-90">{model.info}</p> : null}
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {model.slots.map((kind, i) => (
              <span
                key={`${kind}-${i}`}
                className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold"
                style={slotTone(kind, theme.text)}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-70">Progreso</p>
            <p className="text-lg font-black leading-none">{model.confirmed} DE {model.goal}</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function CardBack({ theme, model }) {
  return (
    <Frame style={{ background: theme.bg, color: theme.text }}>
      <div className="absolute inset-0" style={theme.art} />
      <div className="relative flex h-full min-h-0 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">Condiciones</p>
          {model.logo ? <img src={model.logo} alt="" className="h-8 w-8 rounded-full bg-black object-cover" /> : null}
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 text-xs">
          {model.terms.length ? model.terms.map((row) => (
            <p key={row.label} className="leading-snug">
              <span className="opacity-70">{row.label}: </span>
              <span className="font-semibold">{row.value}</span>
            </p>
          )) : (
            <p className="opacity-80">{model.detail || model.reward || 'Sin condiciones adicionales.'}</p>
          )}
          {model.name ? (
            <p className="pt-1 leading-snug">
              <span className="opacity-70">Titular: </span>
              <span className="font-semibold">{model.name}{model.doc ? ` · ${model.doc}` : ''}</span>
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-[0.14em] opacity-60">Toca para volver</p>
      </div>
    </Frame>
  );
}

function FlipCard({ front, back }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setFlipped((value) => !value);
      }}
      className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
      aria-pressed={flipped}
      aria-label={flipped ? 'Ver el frente de la GIT Card' : 'Ver las condiciones de la GIT Card'}
    >
      <div className="relative w-full">
        <div className={flipped ? 'invisible' : undefined} aria-hidden={flipped}>{front}</div>
        <div className={`absolute inset-0 ${flipped ? '' : 'invisible'}`} aria-hidden={!flipped}>{back}</div>
      </div>
    </button>
  );
}

function themeFor(card) {
  const styleId = String(card?.card_style || '');
  const background = BACKGROUNDS[styleId];
  if (background) return background;
  const bg = card?.colors?.bg || '#111827';
  const accent = card?.colors?.accent || 'rgba(255,255,255,0.22)';
  return {
    bg,
    text: card?.colors?.text || '#f8fafc',
    art: { background: `radial-gradient(circle at 82% 18%, ${accent} 0, transparent 34%), ${bg}` },
  };
}

export default function GitCardVisual({ card, compact = false, backgroundOnly = false }) {
  if (!card) return null;
  const model = cardModel(card);
  const theme = themeFor(card);
  if (backgroundOnly) {
    return (
      <Frame style={{ background: theme.bg, color: theme.text }}>
        <div className="absolute inset-0" style={theme.art} />
      </Frame>
    );
  }
  return (
    <FlipCard
      front={<CardFront theme={theme} model={model} compact={compact} />}
      back={<CardBack theme={theme} model={model} />}
    />
  );
}
