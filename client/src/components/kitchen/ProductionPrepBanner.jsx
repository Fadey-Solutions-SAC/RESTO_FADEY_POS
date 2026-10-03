import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdAutoAwesome, MdWarning, MdExpandMore } from 'react-icons/md';
import { api } from '../../utils/api';
import { useActiveInterval } from '../../hooks/useActiveInterval';

const REFRESH_MS = 30 * 60 * 1000;

const ACCENT_BORDER = 'border-[color:color-mix(in_srgb,var(--ui-accent-muted)_60%,transparent)]';
const ACCENT_SOFT_BG = 'bg-[color:color-mix(in_srgb,var(--ui-accent-muted)_16%,transparent)]';
/** Mezcla con el color de texto del tema para que rojo/ámbar tengan contraste en claros y oscuros. */
const DANGER_TEXT = 'text-[color:color-mix(in_srgb,var(--ui-danger)_70%,var(--ui-body-text))]';
const WARNING_TEXT = 'text-[color:color-mix(in_srgb,var(--ui-warning)_55%,var(--ui-body-text))]';

function collapseKey(areaId, date) {
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

/** Estado compartido entre el botón de la barra y el panel desplegado. */
export function useProductionPrep(areaId) {
  const [plan, setPlan] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

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
      setCollapsed(localStorage.getItem(collapseKey(areaId, first.date)) === '1');
    } catch (_) {
      setCollapsed(false);
    }
  }, [areaId, first?.date]);

  const toggle = useCallback(() => {
    if (!first) return;
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(collapseKey(areaId, first.date), '1');
        else localStorage.removeItem(collapseKey(areaId, first.date));
      } catch (_) { /* almacenamiento no disponible */ }
      return next;
    });
  }, [areaId, first]);

  return { plan, first, collapsed, toggle, available: Boolean(plan?.enough_data && first) };
}

function useDayLabels() {
  const { t } = useTranslation('kitchen');
  const days = t('prep.days', { returnObjects: true });
  const dayName = (dow) => (Array.isArray(days) ? days[dow] : '') || '';
  const whenLabel = (target) => {
    const day = `${dayName(target.dow)} ${shortDate(target.date)}`;
    if (target.offset === 0) return t('prep.today', { day });
    if (target.offset === 1) return t('prep.tomorrow', { day });
    return t('prep.onDay', { day });
  };
  return { t, dayName, whenLabel };
}

/** Botón de la barra del área que despliega/pliega la preparación sugerida. */
export function ProductionPrepButton({ prep, className = '' }) {
  const { t, whenLabel } = useDayLabels();
  if (!prep?.available) return null;
  const open = !prep.collapsed;
  return (
    <button
      type="button"
      onClick={prep.toggle}
      aria-expanded={open}
      title={t('prep.collapsedSummary', { when: whenLabel(prep.first), count: prep.first.products.length })}
      className={`${className} shrink-0 px-3 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ui-body-text)] ${
        open ? `${ACCENT_BORDER} ${ACCENT_SOFT_BG}` : 'bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)]'
      }`}
    >
      <MdAutoAwesome className="text-lg shrink-0 text-[var(--ui-accent-muted)]" />
      <span className="whitespace-nowrap">{t('prep.title')}</span>
      <MdExpandMore className={`text-xl shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

/** Panel desplegado: lo que más sale los próximos días e insumos que faltan. */
export default function ProductionPrepBanner({ prep }) {
  const { t, dayName, whenLabel } = useDayLabels();
  if (!prep?.available || prep.collapsed) return null;
  const { plan } = prep;
  const closedDays = (plan.closed_days || []).map((c) => dayName(c.dow)).filter(Boolean);

  return (
    <div className="px-3 pt-3 sm:px-4 sm:pt-4 lg:px-6 lg:pt-6">
      <section className={`rounded-xl overflow-hidden border-2 ${ACCENT_BORDER} bg-[var(--ui-surface)] text-[var(--ui-body-text)]`}>
        <div className={`px-4 py-2.5 ${ACCENT_SOFT_BG}`}>
          <p className="text-sm font-bold inline-flex items-center gap-1.5 text-[var(--ui-body-text)]">
            <MdAutoAwesome className="shrink-0 text-[var(--ui-accent-muted)]" />
            {t('prep.title')}
          </p>
          <p className="text-xs text-[var(--ui-muted)]">{t('prep.subtitle')}</p>
        </div>
        {(
          <>
            <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2">
              {plan.targets.map((target) => {
                const onlyNoRecipe = target.no_recipe?.length && target.no_recipe.length === target.products.length;
                return (
                  <div key={target.date} className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 min-w-0">
                    <p className="text-sm font-semibold text-[var(--ui-body-text)]">{t('prep.comesDay', { when: whenLabel(target) })}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--ui-muted)]">{t('prep.usuallySells')}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {target.products.map((p) => (
                        <span
                          key={p.name}
                          className={`text-xs px-2 py-0.5 rounded-full border break-words max-w-full text-[var(--ui-body-text)] ${p.hot ? `${ACCENT_BORDER} ${ACCENT_SOFT_BG} font-semibold` : 'border-[color:var(--ui-border)] bg-[var(--ui-surface)]'}`}
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
                            className={`text-xs flex items-start gap-1.5 ${i.status === 'falta' ? DANGER_TEXT : WARNING_TEXT}`}
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
                        {onlyNoRecipe && !target.uses_insumo_store ? (
                          t('prep.prepareAll')
                        ) : (
                          <>
                            <span className="font-medium text-[var(--ui-body-text)]">{t('prep.prepareFor')}:</span>{' '}
                            {target.no_recipe.map((p) => `${p.name} (~${p.qty})`).join(', ')}.
                            {target.uses_insumo_store ? ` ${t('prep.noRecipeHint')}` : ''}
                          </>
                        )}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {closedDays.length ? (
              <p className="px-4 pb-3 text-[11px] text-[var(--ui-muted)]">
                {t('prep.closedDays', { days: closedDays.join(', ') })}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
