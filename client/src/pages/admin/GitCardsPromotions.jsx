import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MdAdd, MdPause, MdPlayArrow, MdStop, MdEdit, MdVisibility, MdDelete,
  MdChevronLeft, MdChevronRight, MdSearch,
} from 'react-icons/md';
import { api, formatCurrency, formatDate } from '../../utils/api';
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
      ? (draft.product_name || 'Producto de cortesía')
      : draft.reward_kind === 'discount'
        ? (draft.discount_type === 'percent' ? `${draft.discount_value || 0} %` : `S/ ${Number(draft.discount_value || 0).toFixed(2)}`)
        : (draft.other_name || 'Beneficio');
    return {
      program_name: draft.name || 'GIT Cards',
      restaurant_name: 'Restaurante',
      logo_url: draft.logo_url || '',
      info_text: draft.info_text || draft.description,
      reward_title: draft.reward_title || benefit,
      card_style: draft.card_style,
      colors: { bg: draft.card_bg || style.bg, text: draft.card_text || style.text, accent: draft.card_accent || style.accent, muted: style.muted },
      customer: { name: 'Cliente de ejemplo', doc_masked: '*****321' },
      progress: { confirmed: 1, pending: 0, goal: Number(draft.goal || 3), remaining: Math.max(0, Number(draft.goal || 3) - 1) },
      status: 'active',
    };
  }, [draft, selectedStyle]);

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
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/git-cards/promotions/products?q=${encodeURIComponent(productQ)}`);
        setProducts(res.rows || []);
      } catch (_) {
        setProducts([]);
      } finally {
        setSearching(false);
      }
    }, productQ.trim() ? 180 : 0);
    return () => clearTimeout(handle);
  }, [mode, draft.reward_kind, productQ]);

  const setField = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const openNew = () => {
    setEditingId('');
    setDraft({
      ...EMPTY_PROMO,
      card_style: 'blue',
      start_at: new Date().toISOString().slice(0, 10),
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--ui-body-text)]">Promociones y recompensas</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ui-muted)]">
            Crea promociones, define sus recompensas y administra las tarjetas de fidelización de tus clientes.
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary px-3 py-2 text-sm">
          Volver a clientes
        </button>
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

function Wizard({
  step, setStep, draft, setField, setDraft, styles, previewCard, products, productQ, setProductQ,
  searching, saving, canEdit, editingId, onCancel, onSaveDraft, onActivate,
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {editingId ? 'Editar promoción' : 'Nueva promoción'} · paso {step} de 5
        </p>
        <h2 className="text-xl font-bold text-slate-900">{STEPS[step - 1].title}</h2>
        <div className="mt-3 flex gap-1">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`h-1.5 flex-1 rounded-full ${s.id <= step ? 'bg-[var(--ui-accent)]' : 'bg-[color:var(--ui-border)]'}`}
              title={s.title}
            />
          ))}
        </div>
      </div>

      {step === 1 ? (
        <Section>
          <Field label="Nombre de la promoción">
            <input value={draft.name} onChange={(e) => setField('name', e.target.value)} className="input" placeholder="Ej. Postre de cortesía" />
          </Field>
          <Field label="Descripción breve para el cliente" wide>
            <textarea value={draft.description} onChange={(e) => setField('description', e.target.value)} className="input min-h-[4.5rem]" placeholder="Completa la tarjeta y recibe un postre." />
          </Field>
          <Field label="Fecha de inicio">
            <input type="date" value={dateInput(draft.start_at)} onChange={(e) => setField('start_at', e.target.value)} className="input" />
          </Field>
          <Field label="Fecha de finalización (opcional)">
            <input type="date" value={dateInput(draft.end_at)} onChange={(e) => setField('end_at', e.target.value)} className="input" />
          </Field>
          <Field label="Estado inicial">
            <select value={draft.status} onChange={(e) => setField('status', e.target.value)} className="input">
              <option value="draft">Borrador</option>
              <option value="scheduled">Programada</option>
              <option value="active">Activa</option>
            </select>
          </Field>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section>
          <p className="sm:col-span-2 text-sm text-slate-600">
            Cada compra que cumpla las condiciones y se cobre correctamente sumará un avance a la tarjeta.
          </p>
          <Field label="Consumo mínimo por compra (S/)">
            <input type="number" min="0" step="0.01" value={draft.min_spend} onChange={(e) => setField('min_spend', e.target.value)} className="input" />
          </Field>
          <Field label="Avances para completar la tarjeta">
            <input type="number" min="1" step="1" value={draft.goal} onChange={(e) => setField('goal', e.target.value)} className="input" />
          </Field>
          <Field label="¿Exigir encuesta?">
            <select value={draft.survey_required ? 'yes' : 'no'} onChange={(e) => setField('survey_required', e.target.value === 'yes')} className="input">
              <option value="no">No</option>
              <option value="yes">Sí</option>
            </select>
          </Field>
          <Field label="Vigencia de la tarjeta (días)">
            <input type="number" min="0" value={draft.cycle_valid_days} onChange={(e) => setField('cycle_valid_days', e.target.value)} className="input" />
          </Field>
          <Field label="Vigencia de la recompensa (días)">
            <input type="number" min="0" value={draft.reward_valid_days} onChange={(e) => setField('reward_valid_days', e.target.value)} className="input" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={!!draft.auto_reset} onChange={(e) => setField('auto_reset', e.target.checked)} />
            Reiniciar el ciclo después de completar la meta
          </label>
        </Section>
      ) : null}

      {step === 3 ? (
        <Section>
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
            {[
              { id: 'product', title: 'Producto de cortesía', hint: 'Se elige del catálogo real' },
              { id: 'discount', title: 'Descuento', hint: 'Porcentaje o importe fijo' },
              { id: 'other', title: 'Otro beneficio', hint: 'Sin inventario ni cobro automático' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setField('reward_kind', opt.id)}
                className={`rounded-2xl border px-3 py-3 text-left ${draft.reward_kind === opt.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent)] text-white' : 'border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)]'}`}
              >
                <p className="font-semibold">{opt.title}</p>
                <p className={`mt-1 text-xs ${draft.reward_kind === opt.id ? 'text-white/80' : 'text-slate-500'}`}>{opt.hint}</p>
              </button>
            ))}
          </div>
          {draft.reward_kind === 'product' ? (
            <>
              <Field label="Buscar producto del catálogo" wide>
                <div className="relative">
                  <MdSearch className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
                  <input value={productQ} onChange={(e) => setProductQ(e.target.value)} className="input pl-9" placeholder="Nombre del producto" />
                </div>
              </Field>
              <div className="sm:col-span-2 max-h-52 overflow-auto rounded-xl border border-slate-100">
                {searching ? <p className="p-3 text-sm text-slate-500">Buscando…</p> : products.map((p) => (
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
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${draft.product_id === p.id ? 'bg-[var(--ui-accent)] text-white' : 'hover:bg-[var(--ui-sidebar-hover)]'}`}
                  >
                    <span>
                      <span className="font-semibold">{p.name}</span>
                      {p.category_name ? <span className="ml-2 opacity-70">{p.category_name}</span> : null}
                    </span>
                    <span>
                      {formatCurrency(p.price)}
                      {p.inventory_controlled ? ` · stock ${p.stock}` : ' · sin inventario controlado'}
                    </span>
                  </button>
                ))}
              </div>
              {draft.product_id ? (
                <>
                  <p className="sm:col-span-2 text-sm text-slate-600">Seleccionado: <strong>{draft.product_name}</strong></p>
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
                  <Field label="Cantidad que recibirá el cliente">
                    <input type="number" min="0.01" step="0.01" value={draft.product_qty} onChange={(e) => setField('product_qty', e.target.value)} className="input" />
                  </Field>
                </>
              ) : (
                <p className="sm:col-span-2 text-sm text-amber-700">Debe elegir un producto existente. No se admite texto libre.</p>
              )}
            </>
          ) : null}
          {draft.reward_kind === 'discount' ? (
            <>
              <Field label="Tipo de descuento">
                <select value={draft.discount_type} onChange={(e) => setField('discount_type', e.target.value)} className="input">
                  <option value="percent">Porcentual</option>
                  <option value="fixed">Importe fijo (S/)</option>
                </select>
              </Field>
              <Field label={draft.discount_type === 'percent' ? 'Porcentaje' : 'Importe en soles'}>
                <input type="number" min="0" step="0.01" value={draft.discount_value} onChange={(e) => setField('discount_value', e.target.value)} className="input" />
              </Field>
              <Field label="Compra mínima para canjear (opcional)">
                <input type="number" min="0" step="0.01" value={draft.discount_min_spend} onChange={(e) => setField('discount_min_spend', e.target.value)} className="input" />
              </Field>
              <Field label="Importe máximo de descuento (opcional)">
                <input type="number" min="0" step="0.01" value={draft.discount_max} onChange={(e) => setField('discount_max', e.target.value)} className="input" />
              </Field>
              <Field label="Condiciones de uso" wide>
                <textarea value={draft.discount_conditions} onChange={(e) => setField('discount_conditions', e.target.value)} className="input min-h-[4rem]" />
              </Field>
            </>
          ) : null}
          {draft.reward_kind === 'other' ? (
            <>
              <Field label="Nombre del beneficio">
                <input value={draft.other_name} onChange={(e) => setField('other_name', e.target.value)} className="input" />
              </Field>
              <Field label="Descripción" wide>
                <textarea value={draft.other_description} onChange={(e) => setField('other_description', e.target.value)} className="input min-h-[4rem]" />
              </Field>
              <Field label="Condiciones de uso" wide>
                <textarea value={draft.other_conditions} onChange={(e) => setField('other_conditions', e.target.value)} className="input min-h-[4rem]" />
              </Field>
              <Field label="Procedimiento de entrega o canje" wide>
                <textarea value={draft.other_delivery} onChange={(e) => setField('other_delivery', e.target.value)} className="input min-h-[4rem]" />
              </Field>
            </>
          ) : null}
        </Section>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.9fr)]">
          <Section>
            <Field label="Color de la tarjeta" wide>
              <div className="flex flex-wrap gap-2">
                {styles.filter((s) => ['blue', 'green', 'wine', 'cream', 'forest'].includes(s.id)).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, card_style: s.id, card_bg: s.bg, card_text: s.text, card_accent: s.accent }))}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold ${draft.card_style === s.id ? 'ring-2 ring-blue-400' : ''}`}
                    style={{ background: s.bg, color: s.text }}
                  >
                    {s.label || s.id}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Nombre visible">
              <input value={draft.name} onChange={(e) => setField('name', e.target.value)} className="input" />
            </Field>
            <Field label="Texto informativo" wide>
              <textarea value={draft.info_text} onChange={(e) => setField('info_text', e.target.value)} className="input min-h-[4rem]" placeholder="Cada compra cobrada suma un avance." />
            </Field>
            <Field label="Descripción de la recompensa" wide>
              <textarea value={draft.reward_description} onChange={(e) => setField('reward_description', e.target.value)} className="input min-h-[4rem]" />
            </Field>
          </Section>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa para el cliente</p>
            <GitCardVisual card={previewCard} compact />
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <Section>
          <ReviewRow label="Nombre" value={draft.name || '—'} />
          <ReviewRow label="Vigencia" value={`${dateInput(draft.start_at) || 'sin inicio'} → ${dateInput(draft.end_at) || 'sin fin'}`} />
          <ReviewRow label="Consumo mínimo" value={formatCurrency(draft.min_spend)} />
          <ReviewRow label="Meta de avances" value={String(draft.goal)} />
          <ReviewRow label="Encuesta" value={draft.survey_required ? 'Sí' : 'No'} />
          <ReviewRow
            label="Recompensa"
            value={
              draft.reward_kind === 'product'
                ? `Producto · ${draft.product_name || 'sin seleccionar'}`
                : draft.reward_kind === 'discount'
                  ? `Descuento · ${draft.discount_type === 'percent' ? `${draft.discount_value} %` : formatCurrency(draft.discount_value)}`
                  : `Otro · ${draft.other_name || '—'}`
            }
          />
          <ReviewRow label="Estilo" value={styles.find((s) => s.id === draft.card_style)?.label || draft.card_style} />
          <div className="sm:col-span-2">
            <GitCardVisual card={previewCard} compact />
          </div>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary px-4 py-2 text-sm">
          Cancelar
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={step <= 1} onClick={() => setStep(step - 1)} className="btn-secondary inline-flex items-center gap-1 px-4 py-2 text-sm disabled:opacity-40">
            <MdChevronLeft /> Atrás
          </button>
          {step < 5 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="btn-primary inline-flex items-center gap-1 px-4 py-2 text-sm">
              Continuar <MdChevronRight />
            </button>
          ) : null}
          <button type="button" disabled={!canEdit || saving} onClick={onSaveDraft} className="btn-secondary px-4 py-2 text-sm">
            Guardar borrador
          </button>
          {step === 5 ? (
            <button type="button" disabled={!canEdit || saving} onClick={onActivate} className="btn-primary px-4 py-2 text-sm">
              Activar
            </button>
          ) : null}
        </div>
      </div>
      <style>{`.input{width:100%;height:2.5rem;border-radius:0.75rem;border:1px solid #e2e8f0;padding:0 0.75rem;font-size:0.875rem}textarea.input{height:auto;padding:0.75rem}select.input{background:#fff}`}</style>
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
  return <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">{children}</section>;
}

function Field({ label, children, wide }) {
  return (
    <label className={`block text-sm text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ReviewCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
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
