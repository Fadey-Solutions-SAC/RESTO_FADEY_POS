import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdAutoAwesome, MdClose, MdWarning, MdExpandMore } from 'react-icons/md';
import { api } from '../../utils/api';
import { useActiveInterval } from '../../hooks/useActiveInterval';

const REFRESH_MS = 30 * 60 * 1000;

function hideKey(areaId, date) {
  return `rf-prep-banner-hidden:${areaId}:${date}`;
}

function shortDate(key) {
  const [, m, d] = String(key || '').split('-');
  return d && m ? `${d}/${m}` : '';
}

function fmtQty(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Aviso en el panel de producción: lo que más sale los próximos días e insumos que faltan. */
export default function ProductionPrepBanner({ areaId }) {
  const { t } = useTranslation('kitchen');
  const [plan, setPlan] = useState(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/fadey-ai/production-forecast?area=${encodeURIComponent(areaId)}`);
      setPlan(data?.ok ? data : null);
    } catch (_) {
      setPlan(null);
    }
  }, [areaId]);

  useEffect(() => {
    void load();
  }, [load]);
  useActiveInterval(load, REFRESH_MS);

  const first = plan?.targets?.[0];
  useEffect(() => {
    if (!first) return;
    try {
      setHidden(localStorage.getItem(hideKey(areaId, first.date)) === '1');
    } catch (_) {
      setHidden(false);
    }
  }, [areaId, first?.date]);

  if (!plan?.enough_data || !first) return null;

  const days = t('prep.days', { returnObjects: true });
  const dayName = (dow) => (Array.isArray(days) ? days[dow] : '') || '';
  const whenLabel = (target) => {
    const day = `${dayName(target.dow)} ${shortDate(target.date)}`;
    if (target.offset === 0) return t('prep.today', { day });
    if (target.offset === 1) return t('prep.tomorrow', { day });
    return t('prep.onDay', { day });
  };

  const setHide = (value) => {
    setHidden(value);
    try {
      if (value) localStorage.setItem(hideKey(areaId, first.date), '1');
      else localStorage.removeItem(hideKey(areaId, first.date));
    } catch (_) { /* almacenamiento no disponible */ }
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHide(false)}
        className="w-full px-3 py-1.5 sm:px-6 text-left text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 bg-violet-500/10 text-violet-800 dark:text-violet-200 border-b border-violet-500/20 hover:bg-violet-500/20"
      >
        <MdAutoAwesome className="shrink-0" />
        {t('prep.show')}
        <MdExpandMore className="shrink-0" />
      </button>
    );
  }

  const closedDays = (plan.closed_days || []).map((c) => dayName(c.dow)).filter(Boolean);

  return (
    <section className="mx-3 mt-3 sm:mx-6 rounded-xl border border-violet-500/30 bg-violet-500/10 text-[var(--ui-body-text)]">
      <div className="flex items-start justify-between gap-2 px-3 pt-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold inline-flex items-center gap-1.5">
            <MdAutoAwesome className="text-violet-500 shrink-0" />
            {t('prep.title')}
          </h2>
          <p className="text-[11px] sm:text-xs text-[var(--ui-muted)]">{t('prep.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setHide(true)}
          className="shrink-0 p-1 rounded-md text-[var(--ui-muted)] hover:text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          title={t('prep.hide')}
          aria-label={t('prep.hide')}
        >
          <MdClose className="text-lg" />
        </button>
      </div>
      <div className="grid gap-3 p-3 sm:px-4 md:grid-cols-2">
        {plan.targets.map((target) => (
          <div key={target.date} className="rounded-lg bg-[var(--ui-surface)] border border-[color:var(--ui-border)] p-3 min-w-0">
            <p className="text-sm font-semibold">{t('prep.comesDay', { when: whenLabel(target) })}</p>
            <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--ui-muted)]">{t('prep.usuallySells')}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {target.products.map((p) => (
                <span
                  key={p.name}
                  className={`text-xs px-2 py-0.5 rounded-full border break-words max-w-full ${p.hot ? 'border-violet-500/50 bg-violet-500/15 font-semibold' : 'border-[color:var(--ui-border)]'}`}
                  title={p.hot ? t('prep.hot') : undefined}
                >
                  {p.name} ~{p.qty}{p.hot ? ' ↑' : ''}
                </span>
              ))}
            </div>
            {target.insumos?.length ? (
              <ul className="mt-2 space-y-1">
                {target.insumos.map((i) => (
                  <li
                    key={i.name}
                    className={`text-xs flex items-start gap-1.5 ${i.status === 'falta' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}
                  >
                    <MdWarning className="shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">
                      <strong>{i.name}</strong>:{' '}
                      {t(i.status === 'falta' ? 'prep.notEnough' : 'prep.runningLow', {
                        stock: fmtQty(i.stock),
                        need: fmtQty(i.need),
                        unit: i.unit || '',
                      })}
                      {i.products?.length ? ` (${i.products.join(', ')})` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {target.no_recipe?.length ? (
              <p className="mt-2 text-xs text-[var(--ui-muted)]">
                <span className="font-medium text-[var(--ui-body-text)]">{t('prep.prepareFor')}:</span>{' '}
                {target.no_recipe.map((p) => `${p.name} (~${p.qty})`).join(', ')}.
                {target.uses_insumo_store ? ` ${t('prep.noRecipeHint')}` : ''}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {closedDays.length ? (
        <p className="px-3 pb-3 sm:px-4 text-[11px] text-[var(--ui-muted)]">{t('prep.closedDays', { days: closedDays.join(', ') })}</p>
      ) : null}
    </section>
  );
}
