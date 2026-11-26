import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MdAdd, MdPause, MdPlayArrow, MdStop, MdEdit, MdVisibility, MdDelete,
  MdArrowBack, MdChevronLeft, MdChevronRight, MdSearch, MdCheck, MdCheckCircle,
} from 'react-icons/md';
import { api, formatCurrency, formatDate, toLocalDateKey } from '../../utils/api';
import GitCardVisual from '../../components/GitCardVisual';

const STEPS = [
  { id: 1, title: 'Información general' },
  { id: 2, title: 'Reglas de avance' },
  { id: 3, title: 'Recompensa' },
  { id: 4, title: 'Diseño' },
  { id: 5, title: 'Revisión' },
];

const STATUS_LABEL = {
  draft: 'Borrador',
  scheduled: 'Programada',
  active: 'Activa',
  paused: 'Pausada',
  ended: 'Finalizada',
};

const STATUS_CLASS = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-sky-50 text-sky-700',
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-amber-50 text-amber-800',
  ended: 'bg-rose-50 text-rose-700',
};

const RETIRED_CARD_STYLES = new Set(['vinyl', 'brew', 'ink', 'sakura', 'gauge', 'copper']);

const EMPTY_PROMO = {
  name: '',
  description: '',
  start_at: '',
  end_at: '',
  status: 'draft',
  min_spend: 250,
  goal: 3,
  survey_required: false,
  cycle_valid_days: 90,
  reward_valid_days: 30,
  auto_reset: true,
  reward_kind: 'product',
  product_id: '',
  product_name: '',
  product_qty: 1,
  variant_id: '',
  variant_name: '',
  discount_type: 'percent',
  discount_value: 10,
  discount_min_spend: 0,
  discount_max: 0,
  discount_conditions: '',
  other_name: '',
  other_description: '',
  other_conditions: '',
  other_delivery: '',
  card_style: 'blue',
  card_bg: '',
  card_text: '',
  card_accent: '',
  reward_title: '',
  reward_description: '',
  info_text: '',
};

function dateInput(value) {
  return String(value || '').slice(0, 10);
}

function toIsoDate(value) {
  const raw = String(value || '').trim();
  return raw ? `${raw}T00:00:00.000Z` : '';
}

function payloadFromDraft(draft) {
  const kind = draft.reward_kind;
  return {
    ...draft,
    start_at: toIsoDate(dateInput(draft.start_at)),
    end_at: toIsoDate(dateInput(draft.end_at)),
    min_spend: Number(draft.min_spend || 0),
    goal: Number(draft.goal || 0),
    product_qty: Number(draft.product_qty || 1),
    discount_value: Number(draft.discount_value || 0),
    discount_min_spend: Number(draft.discount_min_spend || 0),
    discount_max: Number(draft.discount_max || 0),
    reward_title: draft.reward_title
      || (kind === 'product' ? draft.product_name : kind === 'other' ? draft.other_name : 'Descuento GIT Cards'),
    info_text: draft.info_text || draft.description,
  };
}

function draftFromPromotion(promo) {
  return {
    ...EMPTY_PROMO,
    ...promo,
    start_at: dateInput(promo.start_at),
    end_at: dateInput(promo.end_at),
    survey_required: !!promo.survey_required,
    auto_reset: promo.auto_reset !== false,
  };
}

export default function GitCardsPromotions({ canEdit, onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState({ promotions: [], active_promotions: 0, available_rewards: 0, styles: [] });
  const [mode, setMode] = useState('list');
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(EMPTY_PROMO);
  const [editingId, setEditingId] = useState('');
  const [detail, setDetail] = useState(null);
  const [productQ, setProductQ] = useState('');
  const [products, setProducts] = useState([]);
  const [searching, setSearching] = useState(false);

  const styles = data.styles || [];
  const selectedStyle = styles.find((s) => s.id === draft.card_style) || styles[0];
  const previewCard = useMemo(() => {
    const style = selectedStyle || { bg: '#1e4b8e', text: '#f8fafc', accent: '#93c5fd', muted: '#bfdbfe' };
    const benefit = draft.reward_kind === 'product'
      ? [draft.product_name, draft.variant_name].filter(Boolean).join(' · ')
      : draft.reward_kind === 'discount'
        ? (Number(draft.discount_value) > 0
          ? (draft.discount_type === 'percent' ? `${draft.discount_value} %` : `S/ ${Number(draft.discount_value).toFixed(2)}`)
          : '')
        : (draft.other_name || '');
    const goal = Math.max(0, Number(draft.goal || 0));
    return {
      program_name: draft.name || '',
      restaurant_name: data.restaurant_name || '',
      logo_url: data.logo_url || draft.logo_url || '',
      info_text: draft.info_text || '',
      description: draft.description || '',
      reward_title: draft.reward_kind === 'product' ? (benefit || draft.reward_title) : (draft.reward_title || benefit),
      reward_description: draft.reward_description || draft.other_description || '',
      card_style: draft.card_style,
      colors: { bg: draft.card_bg || style.bg, text: draft.card_text || style.text, accent: draft.card_accent || style.accent, muted: style.muted },
      progress: { confirmed: 0, pending: 0, goal, remaining: goal },
      status: '',
      terms: [
        Number(draft.min_spend) > 0 ? { label: 'Consumo mínimo', value: `S/ ${Number(draft.min_spend).toFixed(2)}` } : null,
        goal > 0 ? { label: 'Avances para completar', value: String(goal) } : null,
        { label: 'Encuesta', value: draft.survey_required ? 'Obligatoria' : 'No exigida' },
        Number(draft.cycle_valid_days) > 0 ? { label: 'Vigencia de la tarjeta', value: `${draft.cycle_valid_days} días` } : null,
        Number(draft.reward_valid_days) > 0 ? { label: 'Vigencia de la recompensa', value: `${draft.reward_valid_days} días` } : null,
        (draft.reward_kind === 'product' ? (benefit || draft.reward_title) : (draft.reward_title || benefit))
          ? { label: 'Recompensa', value: draft.reward_kind === 'product' ? (benefit || draft.reward_title) : (draft.reward_title || benefit) }
          : null,
        (draft.reward_description || draft.other_description) ? { label: 'Detalle', value: draft.reward_description || draft.other_description } : null,
        (draft.discount_conditions || draft.other_conditions) ? { label: 'Condiciones', value: draft.discount_conditions || draft.other_conditions } : null,
        { label: 'Al completar la meta', value: draft.auto_reset === false ? 'El ciclo no se reinicia' : 'El ciclo se reinicia' },
      ].filter(Boolean),
    };
  }, [draft, selectedStyle, data.restaurant_name, data.logo_url]);

  const load = useCallback(async () => {
    const next = await api.get('/git-cards/promotions');
    setData(next);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        await load();
      } catch (err) {
        toast.error(err.message || 'No se pudieron cargar las promociones');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [load]);

  useEffect(() => {
    if (mode !== 'wizard' || draft.reward_kind !== 'product') return undefined;
    let alive = true;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/git-cards/promotions/products?q=${encodeURIComponent(productQ)}`);
        if (alive) setProducts(res.rows || []);
      } catch (_) {
        if (alive) setProducts([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, productQ.trim() ? 180 : 0);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [mode, draft.reward_kind, productQ]);

  const setField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!RETIRED_CARD_STYLES.has(draft.card_style)) return;
    const pick = (data.styles || []).find((s) => s.family && s.family !== 'classic' && !RETIRED_CARD_STYLES.has(s.id));
    if (!pick) return;
    setDraft((prev) => (
      RETIRED_CARD_STYLES.has(prev.card_style)
        ? { ...prev, card_style: pick.id, card_bg: pick.bg, card_text: pick.text, card_accent: pick.accent }
        : prev
    ));
  }, [draft.card_style, data.styles]);

  const openNew = () => {
    const pool = (data.styles || []).filter((s) => s.family && s.family !== 'classic' && !RETIRED_CARD_STYLES.has(s.id));
    const pick = pool[Math.floor(Math.random() * pool.length)] || null;
    setEditingId('');
    setDraft({
      ...EMPTY_PROMO,
      card_style: pick?.id || 'gourmet',
      card_bg: pick?.bg || '',
      card_text: pick?.text || '',
      card_accent: pick?.accent || '',
      // Fecha del restaurante (Lima), no la UTC: de noche toISOString ya da el día siguiente.
      start_at: toLocalDateKey(new Date()),
    });
    setStep(1);
    setMode('wizard');
  };

  const openEdit = async (id) => {
    try {
      const res = await api.get(`/git-cards/promotions/${encodeURIComponent(id)}`);
      setEditingId(id);
      setDraft(draftFromPromotion(res.promotion));
      setStep(1);
      setMode('wizard');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openDetail = async (id) => {
    try {
      const res = await api.get(`/git-cards/promotions/${encodeURIComponent(id)}`);
      setDetail(res.promotion);
      setMode('detail');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const persist = async ({ activate = false, asDraft = false } = {}) => {
    if (!canEdit) {
      toast.error('Solo el administrador puede guardar promociones');
      return;
    }
    setSaving(true);
    try {
      const body = { ...payloadFromDraft(draft), confirm_affects_active: true };
      if (asDraft) body.status = 'draft';
      let saved;
      if (editingId) {
        saved = (await api.put(`/git-cards/promotions/${encodeURIComponent(editingId)}`, body)).promotion;
      } else {
        saved = (await api.post('/git-cards/promotions', { ...body, activate })).promotion;
        setEditingId(saved.id);
      }
      if (activate && saved.status !== 'active' && saved.status !== 'scheduled') {
        saved = (await api.post(`/git-cards/promotions/${encodeURIComponent(saved.id)}/activate`, {})).promotion;
      }
      toast.success(activate ? 'Promoción activada' : 'Borrador guardado');
      setDraft(draftFromPromotion(saved));
      await load();
      if (activate) {
        setMode('list');
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const runStatus = async (id, action, okMsg) => {
    if (!canEdit) return toast.error('Solo el administrador puede cambiar el estado');
    try {
      await api.post(`/git-cards/promotions/${encodeURIComponent(id)}/${action}`, {});
      toast.success(okMsg);
      await load();
      if (detail?.id === id) {
        const res = await api.get(`/git-cards/promotions/${encodeURIComponent(id)}`);
        setDetail(res.promotion);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removePromo = async (promo) => {
    if (!canEdit) return;
    if (!promo.can_delete) {
      toast.error('Esta promoción tiene historial. Finalícela para conservarlo.');
      return;
    }
    try {
      await api.delete(`/git-cards/promotions/${encodeURIComponent(promo.id)}`);
      toast.success('Promoción eliminada');
      setMode('list');
      setDetail(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (mode === 'wizard') {
    return (
      <Wizard
        step={step}
        setStep={setStep}
        draft={draft}
        setField={setField}
        setDraft={setDraft}
        styles={styles}
        previewCard={previewCard}
        products={products}
        productQ={productQ}
        setProductQ={setProductQ}
        searching={searching}
        saving={saving}
        canEdit={canEdit}
        editingId={editingId}
        onCancel={() => setMode('list')}
        onSaveDraft={() => persist({ asDraft: true })}
        onActivate={() => persist({ activate: true })}
      />
    );
  }

  if (mode === 'detail' && detail) {
    return (
      <DetailView
        promo={detail}
        canEdit={canEdit}
        onBack={() => { setDetail(null); setMode('list'); }}
        onEdit={() => openEdit(detail.id)}
        onActivate={() => runStatus(detail.id, 'activate', 'Promoción activada')}
        onPause={() => runStatus(detail.id, 'pause', 'Promoción pausada')}
        onEnd={() => runStatus(detail.id, 'end', 'Promoción finalizada')}
        onDelete={() => removePromo(detail)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          aria-label="Volver a GIT Cards"
        >
          <MdArrowBack className="text-xl" />
        </button>
        <h2 className="min-w-0 truncate text-xl font-bold tracking-tight text-[var(--ui-body-text)]">Promociones y recompensas</h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi label="Promociones activas" value={loading ? '—' : data.active_promotions} />
        <Kpi label="Recompensas disponibles para canje" value={loading ? '—' : data.available_rewards} />
      </div>

      {canEdit ? (
        <button
          type="button"
          onClick={openNew}
          className="btn-primary inline-flex h-11 items-center gap-2 px-4 text-sm"
        >
          <MdAdd /> Nueva promoción
        </button>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500">Cargando promociones…</p>
        ) : data.promotions.length ? (
          <ul className="divide-y divide-slate-100">
            {data.promotions.map((promo) => (
              <li key={promo.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 h-9 w-9 shrink-0 rounded-xl" style={{ background: promo.style?.bg || '#1e4b8e' }} title={promo.style?.label} />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate font-semibold text-[var(--ui-body-text)]" title={promo.name}>{promo.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[promo.status] || STATUS_CLASS.draft}`}>
                      {STATUS_LABEL[promo.status] || promo.status}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--ui-muted)]" title={`${promo.reward_label} · ${promo.benefit_label}`}>
                    {promo.reward_label} · {promo.benefit_label} · meta {promo.goal} · mín. {formatCurrency(promo.min_spend)}
                    {promo.start_at || promo.end_at ? ` · ${promo.start_at ? formatDate(promo.start_at) : '—'} a ${promo.end_at ? formatDate(promo.end_at) : 'sin fin'}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <IconBtn title="Ver detalles" onClick={() => openDetail(promo.id)}><MdVisibility /></IconBtn>
                  {canEdit && promo.status !== 'ended' ? <IconBtn title="Editar" onClick={() => openEdit(promo.id)}><MdEdit /></IconBtn> : null}
                  {canEdit && ['draft', 'scheduled', 'paused'].includes(promo.status) ? (
                    <IconBtn title="Activar" onClick={() => runStatus(promo.id, 'activate', 'Promoción activada')}><MdPlayArrow /></IconBtn>
                  ) : null}
                  {canEdit && promo.status === 'active' ? (
                    <IconBtn title="Pausar" onClick={() => runStatus(promo.id, 'pause', 'Promoción pausada')}><MdPause /></IconBtn>
                  ) : null}
                  {canEdit && ['active', 'paused', 'scheduled', 'draft'].includes(promo.status) ? (
                    <IconBtn title="Finalizar" onClick={() => runStatus(promo.id, 'end', 'Promoción finalizada')}><MdStop /></IconBtn>
                  ) : null}
                  {canEdit && promo.can_delete ? (
                    <IconBtn title="Eliminar" onClick={() => removePromo(promo)}><MdDelete /></IconBtn>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-8 text-center text-sm text-slate-500">Aún no hay promociones. Cree la primera para empezar.</p>
        )}
      </div>
    </div>
  );
}

const STEP_HINTS = {
  1: 'Ponle un nombre y una frase corta. Así aparecerán en el frente de la tarjeta.',
  2: 'Define qué compra cuenta como avance y cuántos avances necesita el cliente.',
  3: 'Elige lo que gana el cliente al completar la tarjeta.',
  4: 'Elige el fondo de la tarjeta y los textos que verá el cliente.',
  5: 'Revisa todo. Puedes volver a cualquier paso tocándolo arriba.',
};

/** Avisos por paso: lo que falta para poder activar la promoción. */
function stepIssues(draft) {
  const out = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  if (!String(draft.name || '').trim()) out[1].push('Escribe el nombre de la promoción.');
  const start = dateInput(draft.start_at);
  const end = dateInput(draft.end_at);
  if (start && end && end < start) out[1].push('La fecha de fin es anterior a la de inicio.');
  if (!(Number(draft.goal) >= 1)) out[2].push('La meta debe ser de al menos 1 avance.');
  if (Number(draft.min_spend) < 0) out[2].push('El consumo mínimo no puede ser negativo.');
  if (draft.reward_kind === 'product' && !draft.product_id) out[3].push('Elige el producto de cortesía.');
  if (draft.reward_kind === 'discount' && !(Number(draft.discount_value) > 0)) out[3].push('Indica el valor del descuento.');
  if (draft.reward_kind === 'other' && !String(draft.other_name || '').trim()) out[3].push('Escribe el nombre del beneficio.');
  return out;
}

function rewardSummary(draft) {
  if (draft.reward_kind === 'product') {
    return draft.product_name
      ? `${Number(draft.product_qty || 1) !== 1 ? `${draft.product_qty} × ` : ''}${[draft.product_name, draft.variant_name].filter(Boolean).join(' · ')}`
      : 'producto sin elegir';
  }
  if (draft.reward_kind === 'discount') {
    return draft.discount_type === 'percent' ? `${draft.discount_value || 0} % de descuento` : `${formatCurrency(draft.discount_value)} de descuento`;
  }
  return draft.other_name || 'beneficio sin nombre';
}

function Wizard({
  step, setStep, draft, setField, setDraft, styles, previewCard, products, productQ, setProductQ,
  searching, saving, canEdit, editingId, onCancel, onSaveDraft, onActivate,
}) {
  const issues = stepIssues(draft);
  const allIssues = [1, 2, 3, 4].flatMap((id) => issues[id]);
  const previewSide = step === 2 || step === 3 ? 'back' : 'front';
  const goal = Number(draft.goal || 0);
  const optionsRef = useRef(null);
  const optionsHeight = useFitOptionsHeight(optionsRef, step);

  return (
    <div className="space-y-5">
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"
          aria-label="Volver a promociones"
        >
          <MdArrowBack className="text-xl" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {editingId ? 'Editar promoción' : 'Nueva promoción'} · paso {step} de 5
          </p>
          <h2 className="text-xl font-bold text-slate-900">{STEPS[step - 1].title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{STEP_HINTS[step]}</p>
        </div>
      </div>

      <Stepper step={step} setStep={setStep} issues={issues} />

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_19rem]">
        {/* Opciones a la izquierda; tarjeta abajo a la derecha (en celular, debajo de las opciones). */}
        <aside className="order-last space-y-2 md:col-start-2 md:row-start-1 md:self-end">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa en vivo</p>
            <span className="text-[11px] text-slate-400">{previewSide === 'back' ? 'Reverso: condiciones' : 'Frente'}</span>
          </div>
          <div className="mx-auto w-[19rem] max-w-full">
            <GitCardVisual card={previewCard} compact side={previewSide} />
          </div>
          <p className="text-center text-[11px] text-slate-400 md:[@media(max-height:780px)]:hidden">Toca la tarjeta para voltearla.</p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 md:[@media(max-height:780px)]:hidden">
            El cliente suma <strong>1 avance</strong> por cada compra
            {Number(draft.min_spend) > 0 ? <> de al menos <strong>{formatCurrency(draft.min_spend)}</strong></> : null}
            {draft.survey_required ? <> y encuesta respondida</> : null}.
            {' '}Con <strong>{goal || '—'} avance{goal === 1 ? '' : 's'}</strong> gana <strong>{rewardSummary(draft)}</strong>.
          </div>
        </aside>

        {/* Solo las opciones tienen scroll; la tarjeta y los botones quedan fijos. */}
        <div
          ref={optionsRef}
          style={optionsHeight ? { height: optionsHeight } : undefined}
          className="min-w-0 space-y-3 md:col-start-1 md:row-start-1 md:overflow-y-auto md:overscroll-contain md:pr-2"
        >

          {step === 1 ? (
            <Section>
              <Field label="Nombre de la promoción" wide hint="Sale en grande">
                <input value={draft.name} onChange={(e) => setField('name', e.target.value)} className="input" placeholder="Ej. Postre de cortesía" maxLength={60} />
              </Field>
              <Field label="Descripción breve para el cliente" wide hint="Una frase corta">
                <textarea value={draft.description} onChange={(e) => setField('description', e.target.value)} className="input min-h-[3rem]" rows={2} placeholder="Completa la tarjeta y recibe un postre." maxLength={140} />
              </Field>
              <Field label="Fecha de inicio">
                <input type="date" value={dateInput(draft.start_at)} onChange={(e) => setField('start_at', e.target.value)} className="input" />
              </Field>
              <Field label="Fecha de fin" hint="Opcional">
                <input type="date" value={dateInput(draft.end_at)} min={dateInput(draft.start_at) || undefined} onChange={(e) => setField('end_at', e.target.value)} className="input" />
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-1 text-sm font-medium text-slate-700">Estado al guardar</p>
                <Segmented
                  value={draft.status}
                  onChange={(v) => setField('status', v)}
                  options={[
                    { id: 'draft', title: 'Borrador', hint: 'No la ven los clientes' },
                    { id: 'scheduled', title: 'Programada', hint: 'Empieza en la fecha de inicio' },
                    { id: 'active', title: 'Activa', hint: 'Empieza ya' },
                  ]}
                />
              </div>
              <StepIssues list={issues[1]} />
            </Section>
          ) : null}

          {step === 2 ? (
            <Section>
              <Field label="Compras para ganar" wide hint="Avances de la tarjeta">
                <div className="flex flex-wrap items-center gap-2">
                  {[3, 5, 8, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setField('goal', n)}
                      className={`h-9 min-w-[2.75rem] rounded-lg border px-3 text-sm font-semibold ${goal === n ? 'border-[var(--ui-accent)] bg-[var(--ui-accent)] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      {n}
                    </button>
                  ))}
                  <input type="number" min="1" step="1" value={draft.goal} onChange={(e) => setField('goal', e.target.value)} className="input !w-24" aria-label="Otra cantidad de avances" />
                </div>
              </Field>
              <Field label="Consumo mínimo por compra" hint="0 = cualquiera">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400">S/</span>
                  <input type="number" min="0" step="0.01" value={draft.min_spend} onChange={(e) => setField('min_spend', e.target.value)} className="input !pl-9" />
                </div>
              </Field>
              <Field label="Vigencia de la tarjeta" hint="0 = sin límite">
                <DaysInput value={draft.cycle_valid_days} onChange={(v) => setField('cycle_valid_days', v)} />
              </Field>
              <Field label="Vigencia del premio" hint="0 = sin límite">
                <DaysInput value={draft.reward_valid_days} onChange={(v) => setField('reward_valid_days', v)} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Toggle
                  checked={!!draft.survey_required}
                  onChange={(v) => setField('survey_required', v)}
                  title="Exigir encuesta"
                  hint="El avance solo cuenta si el cliente responde la encuesta."
                />
                <Toggle
                  checked={!!draft.auto_reset}
                  onChange={(v) => setField('auto_reset', v)}
                  title="Reiniciar al completar"
                  hint="Al ganar, la tarjeta vuelve a cero y el cliente puede empezar otra."
                />
              </div>
              <StepIssues list={issues[2]} />
            </Section>
          ) : null}

          {step === 3 ? (
            <Section>
              <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
                {[
                  { id: 'product', title: 'Producto gratis', hint: 'Un plato o bebida del catálogo', icon: '🎁' },
                  { id: 'discount', title: 'Descuento', hint: 'Porcentaje o monto fijo', icon: '🏷️' },
                  { id: 'other', title: 'Otro beneficio', hint: 'Lo entregas tú (sin cobro automático)', icon: '⭐' },
                ].map((opt) => {
                  const on = draft.reward_kind === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setField('reward_kind', opt.id)}
                      className={`flex items-start gap-2 rounded-xl border-2 px-3 py-2 text-left transition ${on ? 'border-[var(--ui-accent)] bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                    >
                      <span className="text-xl leading-none" aria-hidden>{opt.icon}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                          {opt.title}
                          {on ? <MdCheckCircle className="text-[var(--ui-accent)]" /> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">{opt.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {draft.reward_kind === 'product' ? (
                <>
                  <Field label="Busca el producto" wide>
                    <div className="relative">
                      <MdSearch className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
                      <input
                        value={productQ}
                        onChange={(e) => setProductQ(e.target.value)}
                        className="input search-input"
                        placeholder="Nombre, categoría o presentación"
                        spellCheck={false}
                        autoComplete="off"
                        autoCorrect="off"
                      />
                    </div>
                  </Field>
                  <div className="sm:col-span-2 max-h-40 overflow-auto rounded-xl border border-slate-200">
                    {searching ? <p className="p-3 text-sm text-slate-500">Buscando…</p> : !products.length ? (
                      <p className="p-3 text-sm text-slate-500">
                        {productQ.trim() ? 'Ningún producto coincide con la búsqueda.' : 'No hay productos activos en el catálogo.'}
                      </p>
                    ) : products.map((p) => {
                      const on = draft.product_id === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setDraft((prev) => ({
                            ...prev,
                            product_id: p.id,
                            product_name: p.name,
                            variant_id: '',
                            variant_name: '',
                            reward_title: p.name,
                          }))}
                          className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 text-left text-sm last:border-b-0 ${on ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {on ? <MdCheckCircle className="shrink-0 text-emerald-600" /> : <span className="h-4 w-4 shrink-0 rounded-full border border-slate-300" />}
                            <span className="min-w-0 truncate">
                              <span className="font-semibold text-slate-900">{p.name}</span>
                              {p.category_name ? <span className="ml-2 text-xs text-slate-500">{p.category_name}</span> : null}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {formatCurrency(p.price)}
                            {p.inventory_controlled ? ` · stock ${p.stock}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {draft.product_id ? (
                    <>
                      {products.find((p) => p.id === draft.product_id)?.variants?.length ? (
                        <Field label="Presentación">
                          <select
                            value={draft.variant_id}
                            onChange={(e) => {
                              const variant = products.find((p) => p.id === draft.product_id)?.variants?.find((v) => v.id === e.target.value);
                              setDraft((prev) => ({ ...prev, variant_id: e.target.value, variant_name: variant?.name || '' }));
                            }}
                            className="input"
                          >
                            <option value="">Sin variante</option>
                            {products.find((p) => p.id === draft.product_id).variants.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        </Field>
                      ) : null}
                      <Field label="Cantidad que recibe el cliente">
                        <input type="number" min="0.01" step="0.01" value={draft.product_qty} onChange={(e) => setField('product_qty', e.target.value)} className="input" />
                      </Field>
                    </>
                  ) : null}
                </>
              ) : null}
              {draft.reward_kind === 'discount' ? (
                <>
                  <div className="sm:col-span-2">
                    <p className="mb-1 text-sm font-medium text-slate-700">Tipo de descuento</p>
                    <Segmented
                      value={draft.discount_type}
                      onChange={(v) => setField('discount_type', v)}
                      options={[
                        { id: 'percent', title: 'Porcentaje (%)', hint: 'Ej. 10 % de la cuenta' },
                        { id: 'fixed', title: 'Monto fijo (S/)', hint: 'Ej. S/ 15 menos' },
                      ]}
                    />
                  </div>
                  <Field label={draft.discount_type === 'percent' ? 'Porcentaje' : 'Monto en soles'}>
                    <input type="number" min="0" step="0.01" value={draft.discount_value} onChange={(e) => setField('discount_value', e.target.value)} className="input" />
                  </Field>
                  <Field label="Compra mínima para canjear" hint="0 = sin mínimo">
                    <input type="number" min="0" step="0.01" value={draft.discount_min_spend} onChange={(e) => setField('discount_min_spend', e.target.value)} className="input" />
                  </Field>
                  <Field label="Descuento máximo" hint="0 = sin tope">
                    <input type="number" min="0" step="0.01" value={draft.discount_max} onChange={(e) => setField('discount_max', e.target.value)} className="input" />
                  </Field>
                  <Field label="Condiciones de uso" wide hint="Van al reverso">
                    <textarea value={draft.discount_conditions} onChange={(e) => setField('discount_conditions', e.target.value)} className="input min-h-[3rem]" rows={2} />
                  </Field>
                </>
              ) : null}
              {draft.reward_kind === 'other' ? (
                <>
                  <Field label="Nombre del beneficio" wide>
                    <input value={draft.other_name} onChange={(e) => setField('other_name', e.target.value)} className="input" placeholder="Ej. Lavado de auto gratis" />
                  </Field>
                  <Field label="Descripción" wide>
                    <textarea value={draft.other_description} onChange={(e) => setField('other_description', e.target.value)} className="input min-h-[3rem]" rows={2} />
                  </Field>
                  <Field label="Condiciones de uso" wide hint="Van al reverso">
                    <textarea value={draft.other_conditions} onChange={(e) => setField('other_conditions', e.target.value)} className="input min-h-[3rem]" rows={2} />
                  </Field>
                  <Field label="Cómo se entrega o canjea" wide>
                    <textarea value={draft.other_delivery} onChange={(e) => setField('other_delivery', e.target.value)} className="input min-h-[3rem]" rows={2} />
                  </Field>
                </>
              ) : null}
              <StepIssues list={issues[3]} />
            </Section>
          ) : null}

          {step === 4 ? (
            <Section>
              <Field label="Fondo de la tarjeta" wide>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-4">
                  {styles.filter((s) => !RETIRED_CARD_STYLES.has(s.id) && (s.family !== 'classic' || s.id === draft.card_style)).map((s) => {
                    const on = draft.card_style === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, card_style: s.id, card_bg: s.bg, card_text: s.text, card_accent: s.accent }))}
                        className={`relative rounded-xl p-1 text-left transition ${on ? 'ring-2 ring-[var(--ui-accent)]' : 'ring-1 ring-slate-200 hover:ring-slate-300'}`}
                      >
                        <GitCardVisual backgroundOnly compact card={{ card_style: s.id, colors: { bg: s.bg, text: s.text, accent: s.accent } }} />
                        <span className="mt-1 flex items-center gap-1 px-1 text-[11px] font-semibold text-slate-700">
                          {on ? <MdCheckCircle className="text-[var(--ui-accent)]" /> : null}
                          {s.label || s.id}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Texto informativo" wide hint="Vacío = usa la descripción">
                <textarea value={draft.info_text} onChange={(e) => setField('info_text', e.target.value)} className="input min-h-[3rem]" rows={2} placeholder="Cada compra cobrada suma un avance." />
              </Field>
              <Field label="Detalle de la recompensa" wide hint="Va al reverso">
                <textarea value={draft.reward_description} onChange={(e) => setField('reward_description', e.target.value)} className="input min-h-[3rem]" rows={2} />
              </Field>
            </Section>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3">
              {allIssues.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Antes de activar, completa:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {allIssues.map((msg) => <li key={msg}>{msg}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  <MdCheckCircle className="text-lg" /> Todo listo. Puedes guardarla como borrador o activarla.
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <ReviewCard label="Nombre" value={draft.name || '—'} onEdit={() => setStep(1)} />
                <ReviewCard label="Vigencia" value={`${dateInput(draft.start_at) ? formatDate(dateInput(draft.start_at)) : 'Desde hoy'} → ${dateInput(draft.end_at) ? formatDate(dateInput(draft.end_at)) : 'sin fin'}`} onEdit={() => setStep(1)} />
                <ReviewCard label="Meta" value={`${goal || '—'} avance${goal === 1 ? '' : 's'} · mínimo ${formatCurrency(draft.min_spend)}`} onEdit={() => setStep(2)} />
                <ReviewCard label="Encuesta" value={draft.survey_required ? 'Obligatoria' : 'No exigida'} onEdit={() => setStep(2)} />
                <ReviewCard label="Recompensa" value={rewardSummary(draft)} onEdit={() => setStep(3)} />
                <ReviewCard label="Diseño" value={styles.find((s) => s.id === draft.card_style)?.label || draft.card_style} onEdit={() => setStep(4)} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur">
        <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2 text-sm">
          Cancelar
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={step <= 1} onClick={() => setStep(step - 1)} className="btn-secondary inline-flex items-center gap-1 px-4 py-2 text-sm disabled:opacity-40">
            <MdChevronLeft /> Atrás
          </button>
          <button type="button" disabled={!canEdit || saving} onClick={onSaveDraft} className="btn-secondary px-4 py-2 text-sm">
            {saving ? 'Guardando…' : 'Guardar borrador'}
          </button>
          {step < 5 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="btn-primary inline-flex items-center gap-1 px-4 py-2 text-sm">
              Continuar <MdChevronRight />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canEdit || saving || allIssues.length > 0}
              title={allIssues.length ? 'Completa los avisos de arriba para activar' : undefined}
              onClick={onActivate}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              Activar promoción
            </button>
          )}
        </div>
      </div>
      <style>{`.input{width:100%;height:2.25rem;border-radius:0.75rem;border:1px solid #e2e8f0;padding:0 0.75rem;font-size:0.875rem;background:#fff}textarea.input{height:auto;padding:0.5rem 0.75rem}select.input{background:#fff}.input.search-input{padding-left:2.25rem}.input:focus{outline:none;border-color:var(--ui-accent);box-shadow:0 0 0 3px rgba(100,116,139,.15)}`}</style>
    </div>
  );
}

/** Ancestro más cercano con scroll vertical (el área principal de contenido). */
function scrollParentOf(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY)) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Alto para la columna de opciones: llena el espacio libre para que la página no tenga scroll.
 * Solo en pantallas md o más anchas; en celular la página se desplaza normal.
 */
function useFitOptionsHeight(ref, step) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const fit = () => {
      if (window.innerWidth < 768) {
        setHeight(0);
        return;
      }
      const parent = scrollParentOf(el);
      const top = el.getBoundingClientRect().top;
      const bottom = parent === document.scrollingElement || parent === document.documentElement
        ? window.innerHeight
        : parent.getBoundingClientRect().bottom;
      let next = Math.max(160, Math.floor(bottom - top - 96));
      // Se prueba el alto y se descuenta lo que aún sobre en la página (barras, paddings).
      for (let i = 0; i < 3; i += 1) {
        el.style.height = `${next}px`;
        const doc = document.documentElement;
        const extra = Math.max(parent.scrollHeight - parent.clientHeight, doc.scrollHeight - doc.clientHeight);
        if (extra <= 0) break;
        next = Math.max(160, next - extra - 1);
      }
      setHeight(next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    schedule(); // segunda medición cuando el paso ya terminó de dibujarse
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, step]);
  return height;
}

function Stepper({ step, setStep, issues }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const current = s.id === step;
        const done = s.id < step;
        const warn = done && issues[s.id]?.length > 0;
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => setStep(s.id)}
              className={`flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition ${current ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  warn ? 'bg-amber-100 text-amber-800' : current ? 'bg-[var(--ui-accent)] text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {warn ? '!' : done ? <MdCheck /> : s.id}
              </span>
              <span className={`whitespace-nowrap text-xs font-semibold ${current ? 'text-slate-900' : 'hidden text-slate-500 lg:inline'}`}>{s.title}</span>
            </button>
            {i < STEPS.length - 1 ? <span className={`h-0.5 min-w-[0.75rem] flex-1 rounded-full ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-xl border-2 px-3 py-1.5 text-left transition ${on ? 'border-[var(--ui-accent)] bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              {on ? <MdCheckCircle className="text-[var(--ui-accent)]" /> : null}
              {opt.title}
            </span>
            {opt.hint ? <span className="mt-0.5 block text-xs text-slate-500">{opt.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, title, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <span className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

function DaysInput({ value, onChange }) {
  return (
    <div className="relative">
      <input type="number" min="0" step="1" value={value} onChange={(e) => onChange(e.target.value)} className="input !pr-14" />
      <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">días</span>
    </div>
  );
}

function StepIssues({ list }) {
  if (!list?.length) return null;
  return (
    <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {list.map((msg) => <p key={msg}>• {msg}</p>)}
    </div>
  );
}

function DetailView({ promo, canEdit, onBack, onEdit, onActivate, onPause, onEnd, onDelete }) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        <MdChevronLeft /> Volver al listado
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{promo.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{promo.description || 'Sin descripción'}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[promo.status]}`}>
          {STATUS_LABEL[promo.status]}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewCard label="Tipo de recompensa" value={promo.reward_label} />
        <ReviewCard label="Producto o beneficio" value={promo.benefit_label} />
        <ReviewCard label="Meta de avances" value={String(promo.goal)} />
        <ReviewCard label="Consumo mínimo" value={formatCurrency(promo.min_spend)} />
        <ReviewCard label="Encuesta" value={promo.survey_required ? 'Sí' : 'No'} />
        <ReviewCard label="Estilo" value={promo.style?.label || promo.card_style} />
      </div>
      {promo.history?.total > 0 ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Esta promoción ya tiene historial ({promo.history.cycles} tarjetas, {promo.history.rewards} recompensas). Los cambios no reescriben avances ni canjes anteriores.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEdit && promo.status !== 'ended' ? <button type="button" onClick={onEdit} className="btn-primary px-4 py-2 text-sm">Editar</button> : null}
        {canEdit && ['draft', 'scheduled', 'paused'].includes(promo.status) ? <button type="button" onClick={onActivate} className="btn-primary px-4 py-2 text-sm">Activar</button> : null}
        {canEdit && promo.status === 'active' ? <button type="button" onClick={onPause} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Pausar</button> : null}
        {canEdit && promo.status !== 'ended' ? <button type="button" onClick={onEnd} className="btn-secondary px-4 py-2 text-sm">Finalizar</button> : null}
        {canEdit && promo.can_delete ? <button type="button" onClick={onDelete} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700">Eliminar</button> : null}
      </div>
    </div>
  );
}

function Section({ children }) {
  return <section className="grid gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">{children}</section>;
}

function Field({ label, children, wide, hint }) {
  return (
    <label className={`block text-sm text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        {hint ? <span className="truncate text-[11px] text-slate-400" title={hint}>{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function ReviewCard({ label, value, onEdit }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        {onEdit ? (
          <button type="button" onClick={onEdit} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
            Cambiar
          </button>
        ) : null}
      </div>
      <p className="mt-1 font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--ui-body-text)]">{value}</p>
    </div>
  );
}

function IconBtn({ title, onClick, children }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
      {children}
    </button>
  );
}
