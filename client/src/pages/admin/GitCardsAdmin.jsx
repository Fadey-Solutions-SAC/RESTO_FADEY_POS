import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatCurrency, formatDate } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import GitCardVisual from '../../components/GitCardVisual';
import toast from 'react-hot-toast';
import {
  MdArrowBack, MdSettings, MdSearch, MdVisibility, MdCheck, MdClose,
  MdContentCopy, MdRedeem, MdChevronLeft, MdChevronRight,
  MdPeople, MdStyle, MdHourglassEmpty, MdCardGiftcard,
} from 'react-icons/md';

const PAGE_SIZE = 10;

const STATUS_LABEL = {
  none: 'Sin tarjeta activa',
  active: 'Activo',
  pending: 'Con compra pendiente',
  completed: 'Tarjeta completada',
  reward_available: 'Recompensa disponible',
  reward_used: 'Recompensa utilizada',
  expired: 'Tarjeta vencida',
};

const STATUS_CLASS = {
  none: 'bg-slate-100 text-slate-600',
  active: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-blue-50 text-blue-700',
  reward_available: 'bg-violet-50 text-violet-700',
  reward_used: 'bg-slate-100 text-slate-600',
  expired: 'bg-rose-50 text-rose-700',
};

const EMPTY_CONFIG = {
  enabled: true,
  program_name: 'GIT Cards',
  restaurant_name: '',
  logo_url: '',
  card_style: 'night',
  card_bg: '',
  card_text: '',
  card_accent: '',
  reward_title: '',
  reward_description: '',
  info_text: '',
  min_spend: 250,
  goal: 3,
  survey_required: false,
  notify_push: false,
  program_expires_at: '',
  reward_valid_days: 30,
  cycle_valid_days: 90,
  auto_reset: true,
};

function canValidateRole(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'cajero' || role === 'master_admin';
}

function canConfigRole(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'master_admin';
}

export default function GitCardsAdmin() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { user } = useAuth();
  const [view, setView] = useState('lista');
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [draft, setDraft] = useState(EMPTY_CONFIG);
  const [styles, setStyles] = useState([]);
  const [members, setMembers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);
  const [rejectId, setRejectId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  const loadConfig = useCallback(async () => {
    const data = await api.get('/git-cards/config');
    setConfig(data.config);
    setDraft(data.config);
    setStyles(data.styles || []);
  }, []);

  const loadMembers = useCallback(async () => {
    const data = await api.get(`/git-cards/members?q=${encodeURIComponent(search)}&status=${encodeURIComponent(statusFilter)}&page=${page}&page_size=${PAGE_SIZE}`);
    setMembers(data.rows || []);
    setTotal(Number(data.total || 0));
  }, [search, statusFilter, page]);

  const loadSummary = useCallback(async () => {
    try {
      const data = await api.get('/git-cards/summary');
      setSummary({
        registered: Number(data.registered ?? data.enrolled ?? 0),
        active_cards: Number(data.active_cards ?? 0),
        pending_purchases: Number(data.pending_purchases ?? 0),
        available_rewards: Number(data.available_rewards ?? 0),
      });
      setSummaryError('');
    } catch (err) {
      setSummary(null);
      setSummaryError(err.message || 'No se pudieron cargar los indicadores');
    }
  }, []);

  const loadProfile = useCallback(async () => {
    if (!customerId) {
      setProfile(null);
      return;
    }
    const data = await api.get(`/git-cards/members/${encodeURIComponent(customerId)}`);
    setProfile(data);
  }, [customerId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadConfig();
      if (customerId) await loadProfile();
      else {
        await Promise.all([loadMembers(), loadSummary()]);
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar GIT Cards');
    } finally {
      setLoading(false);
    }
  }, [customerId, loadConfig, loadMembers, loadProfile, loadSummary]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const data = await api.put('/git-cards/config', draft);
      setConfig(data.config);
      setDraft(data.config);
      toast.success('Configuración guardada');
      setView('lista');
      await Promise.all([loadMembers(), loadSummary()]);
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const cancelConfig = () => {
    setDraft(config);
    setView('lista');
  };

  const approve = async (id) => {
    try {
      const result = await api.post(`/git-cards/advances/${id}/approve`, {});
      if (result.already) toast('La solicitud ya estaba resuelta');
      else toast.success('Avance aprobado');
      await refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const reject = async () => {
    try {
      await api.post(`/git-cards/advances/${rejectId}/reject`, { reason: rejectReason });
      toast.success('Solicitud rechazada');
      setRejectId('');
      setRejectReason('');
      await refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const redeem = async (id) => {
    try {
      await api.post(`/git-cards/rewards/${id}/redeem`, {});
      toast.success('Recompensa canjeada');
      await refresh();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const applyKpiFilter = (nextStatus) => {
    setStatusFilter(nextStatus);
    setPage(1);
  };

  const openPreview = async (customerIdToPreview) => {
    setPreviewLoading(true);
    setPreview({ customerId: customerIdToPreview });
    try {
      const data = await api.get(`/git-cards/caja/clients/${encodeURIComponent(customerIdToPreview)}/preview`);
      setPreview({ customerId: customerIdToPreview, ...data });
    } catch (err) {
      setPreview({ customerId: customerIdToPreview, error: err.message || 'No se pudo consultar la tarjeta' });
    } finally {
      setPreviewLoading(false);
    }
  };

  const copyLink = async (path) => {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch (_) {
      toast.error('No se pudo copiar');
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => {
              if (customerId) navigate('/admin/clientes/git-cards');
              else if (view === 'config') cancelConfig();
              else navigate('/admin/clientes');
            }}
            className="mt-0.5 inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <MdArrowBack /> {customerId || view === 'config' ? 'Lista GIT Cards' : 'Clientes'}
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-slate-900">GIT Cards</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-500">
              Fidelización por compras elegibles. Cada cobro que cumpla las reglas suma un avance a la tarjeta del cliente.
            </p>
          </div>
        </div>
        {!customerId && view === 'lista' ? (
          <button
            type="button"
            onClick={() => setView('config')}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <MdSettings /> Configuración
          </button>
        ) : null}
      </div>

      {view === 'config' && !customerId ? (
        <ConfigView
          draft={draft}
          setDraft={setDraft}
          styles={styles}
          dirty={dirty}
          saving={saving}
          canSave={canConfigRole(user)}
          onSave={saveConfig}
          onCancel={cancelConfig}
        />
      ) : customerId ? (
        <ProfileView
          loading={loading}
          profile={profile}
          canValidate={canValidateRole(user)}
          onApprove={approve}
          onRejectStart={(id) => { setRejectId(id); setRejectReason(''); }}
          onRedeem={redeem}
          onCopyLink={copyLink}
        />
      ) : (
        <ListView
          loading={loading}
          members={members}
          search={search}
          setSearch={(v) => { setSearch(v); setPage(1); }}
          statusFilter={statusFilter}
          setStatusFilter={(v) => { setStatusFilter(v); setPage(1); }}
          page={page}
          pages={pages}
          setPage={setPage}
          total={total}
          summary={summary}
          summaryError={summaryError}
          onKpiFilter={applyKpiFilter}
          onPreview={openPreview}
          onOpen={(id) => navigate(`/admin/clientes/git-cards/${id}`)}
        />
      )}

      {preview ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Tarjeta digital</h3>
                <p className="text-xs text-slate-500">Consulta de solo lectura. No modifica avances ni recompensas.</p>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
                <MdClose />
              </button>
            </div>
            {previewLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Consultando tarjeta…</p>
            ) : preview.error ? (
              <p className="py-6 text-center text-sm text-rose-600">{preview.error}</p>
            ) : preview.card ? (
              <div className="space-y-3">
                <GitCardVisual card={preview.card} compact />
                <p className="text-xs text-slate-500">
                  {preview.card.cycle?.expires_at
                    ? `Vigencia: ${formatDate(preview.card.cycle.expires_at)}`
                    : 'Vigencia: sin fecha de vencimiento'}
                  {preview.card.progress?.pending ? ` · ${preview.card.progress.pending} pendiente(s)` : ''}
                  {preview.card.status === 'reward_available' ? ' · Recompensa disponible' : ''}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const id = preview.customerId;
                    setPreview(null);
                    if (id) navigate(`/admin/clientes/git-cards/${id}`);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Abrir perfil
                </button>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">Sin datos de tarjeta.</p>
            )}
          </div>
        </div>
      ) : null}

      {rejectId ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-slate-900">Rechazar solicitud</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Motivo del rechazo"
              className="mt-3 w-full rounded-xl border border-slate-200 p-3 text-sm"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectId('')} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
              <button type="button" onClick={reject} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Rechazar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const KPI_CARDS = [
  {
    key: 'registered',
    title: 'Clientes registrados',
    desc: 'Personas vinculadas al programa, sin duplicar.',
    filter: 'all',
    Icon: MdPeople,
    bubble: 'bg-blue-100 text-blue-600',
    bg: 'from-blue-50/80 to-white',
  },
  {
    key: 'active_cards',
    title: 'Tarjetas activas',
    desc: 'Ciclos vigentes en curso.',
    filter: 'active',
    Icon: MdStyle,
    bubble: 'bg-emerald-100 text-emerald-600',
    bg: 'from-emerald-50/80 to-white',
  },
  {
    key: 'pending_purchases',
    title: 'Compras pendientes',
    desc: 'Operaciones aún sin procesar.',
    filter: 'pending',
    Icon: MdHourglassEmpty,
    bubble: 'bg-amber-100 text-amber-700',
    bg: 'from-amber-50/80 to-white',
  },
  {
    key: 'available_rewards',
    title: 'Recompensas disponibles',
    desc: 'Premios listos para canjear.',
    filter: 'reward_available',
    Icon: MdCardGiftcard,
    bubble: 'bg-violet-100 text-violet-600',
    bg: 'from-violet-50/80 to-white',
  },
];

function statusDotClass(status) {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'pending') return 'bg-amber-500';
  if (status === 'reward_available') return 'bg-violet-500';
  if (status === 'expired') return 'bg-rose-500';
  if (status === 'none') return 'bg-slate-300';
  return 'bg-slate-400';
}

function ListView({
  loading,
  members,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  page,
  pages,
  setPage,
  total,
  summary,
  summaryError,
  onKpiFilter,
  onPreview,
  onOpen,
}) {
  return (
    <div className="space-y-4">
      {summaryError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No se pudieron cargar los indicadores: {summaryError}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {KPI_CARDS.map((k) => {
            const selected = statusFilter === k.filter;
            const value = summary ? summary[k.key] : '—';
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => onKpiFilter(k.filter)}
                className={`group flex min-h-0 flex-col gap-2 rounded-2xl border bg-gradient-to-br p-4 text-left shadow-sm transition hover:shadow-md ${k.bg} ${
                  selected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className={`grid h-10 w-10 place-items-center rounded-full ${k.bubble}`}>
                  <k.Icon className="text-xl" />
                </span>
                <span className="text-3xl font-bold leading-none tabular-nums text-slate-900">
                  {summary ? value : '—'}
                </span>
                <span className="text-sm font-semibold text-slate-800">{k.title}</span>
                <span className="text-xs leading-snug text-slate-500">{k.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[14rem] flex-1">
            <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o DNI"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          >
            <option value="all">Todos los estados</option>
            {Object.entries(STATUS_LABEL).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          {statusFilter !== 'all' ? (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Quitar filtro
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="py-10 text-center text-slate-500">Cargando GIT Cards...</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] table-fixed text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-[18%] py-3 pr-3">Cliente</th>
                    <th className="w-[14%] py-3 pr-3">Contacto</th>
                    <th className="w-[16%] py-3 pr-3">Estado</th>
                    <th className="w-[10%] py-3 pr-3">Progreso</th>
                    <th className="w-[9%] py-3 pr-3 text-center">Pendientes</th>
                    <th className="w-[10%] py-3 pr-3 text-center">Recompensas</th>
                    <th className="w-[15%] py-3 pr-3">Última actividad</th>
                    <th className="w-[8%] py-3 pr-1 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {members.length ? members.map((row) => (
                    <tr key={row.customer_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => onOpen(row.customer_id)} className="flex min-w-0 items-center gap-2 text-left">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.status)}`} aria-hidden="true" />
                          <span className="truncate font-semibold text-slate-900">{row.name}</span>
                        </button>
                      </td>
                      <td className="truncate py-3 pr-3 text-slate-600">
                        <span className="block truncate">{row.phone || '—'}</span>
                        {row.doc_masked ? <span className="block truncate text-xs text-slate-400">DNI {row.doc_masked}</span> : null}
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[row.status] || STATUS_CLASS.none}`}>
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                      </td>
                      <td className="py-3 pr-3 tabular-nums text-slate-800">{row.progress?.confirmed || 0} / {row.progress?.goal || 0}</td>
                      <td className="py-3 pr-3 text-center tabular-nums">
                        <span className={row.pending_count ? 'font-semibold text-amber-700' : 'text-slate-500'}>
                          {row.pending_count || 0}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-center tabular-nums">
                        <span className={row.rewards_available ? 'font-semibold text-violet-700' : 'text-slate-500'}>
                          {row.rewards_available || 0}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-slate-600">{row.last_activity ? formatDate(row.last_activity) : '—'}</td>
                      <td className="py-3 pr-1 text-right">
                        <button
                          type="button"
                          onClick={() => onPreview(row.customer_id)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600"
                          title="Ver tarjeta digital"
                        >
                          <MdVisibility />
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">No hay clientes para mostrar.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {members.length ? members.map((row) => (
                <article key={row.customer_id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpen(row.customer_id)} className="min-w-0 text-left">
                      <p className="flex items-center gap-2 font-semibold text-slate-900">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.status)}`} aria-hidden="true" />
                        <span className="truncate">{row.name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{row.phone || 'Sin teléfono'}{row.doc_masked ? ` · DNI ${row.doc_masked}` : ''}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onPreview(row.customer_id)}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                      title="Ver tarjeta digital"
                    >
                      <MdVisibility />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2.5 py-1 font-semibold ${STATUS_CLASS[row.status] || STATUS_CLASS.none}`}>
                      {STATUS_LABEL[row.status] || row.status}
                    </span>
                    <span className="text-slate-600">Progreso {row.progress?.confirmed || 0}/{row.progress?.goal || 0}</span>
                    <span className={row.pending_count ? 'font-semibold text-amber-700' : 'text-slate-500'}>Pend. {row.pending_count || 0}</span>
                    <span className={row.rewards_available ? 'font-semibold text-violet-700' : 'text-slate-500'}>Recomp. {row.rewards_available || 0}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Última actividad: {row.last_activity ? formatDate(row.last_activity) : '—'}
                  </p>
                </article>
              )) : (
                <p className="py-8 text-center text-sm text-slate-500">No hay clientes para mostrar.</p>
              )}
            </div>
          </>
        )}
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>{total} cliente(s)</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40"><MdChevronLeft /></button>
            <span>{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40"><MdChevronRight /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigView({ draft, setDraft, styles, dirty, saving, canSave, onSave, onCancel }) {
  const set = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  return (
    <div className="space-y-4">
      <Section title="Identidad visual">
        <Field label="Nombre del programa">
          <input value={draft.program_name} onChange={(e) => set('program_name', e.target.value)} className="input" />
        </Field>
        <Field label="Nombre comercial">
          <input value={draft.restaurant_name} onChange={(e) => set('restaurant_name', e.target.value)} className="input" />
        </Field>
        <Field label="Logotipo (URL)">
          <input value={draft.logo_url} onChange={(e) => set('logo_url', e.target.value)} className="input" />
        </Field>
        <Field label="Estilo de tarjeta">
          <div className="flex flex-wrap gap-2">
            {styles.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, card_style: s.id, card_bg: s.bg, card_text: s.text, card_accent: s.accent }))}
                className={`rounded-xl px-3 py-2 text-sm font-semibold ${draft.card_style === s.id ? 'ring-2 ring-blue-400' : ''}`}
                style={{ background: s.bg, color: s.text }}
              >
                {s.id}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Texto informativo">
          <textarea value={draft.info_text} onChange={(e) => set('info_text', e.target.value)} className="input min-h-[4.5rem]" />
        </Field>
        <Field label="Descripción de la recompensa">
          <textarea value={draft.reward_description} onChange={(e) => set('reward_description', e.target.value)} className="input min-h-[4.5rem]" />
        </Field>
      </Section>
      <Section title="Reglas de avance">
        <Field label="Consumo mínimo por compra">
          <input type="number" min="0" step="0.01" value={draft.min_spend} onChange={(e) => set('min_spend', Number(e.target.value))} className="input" />
        </Field>
        <Field label="Avances para completar">
          <input type="number" min="1" step="1" value={draft.goal} onChange={(e) => set('goal', Number(e.target.value))} className="input" />
        </Field>
        <Field label="Recompensa">
          <input value={draft.reward_title} onChange={(e) => set('reward_title', e.target.value)} className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Programa activo
        </label>
      </Section>
      <Section title="Encuesta, canales y notificaciones">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!draft.survey_required} onChange={(e) => set('survey_required', e.target.checked)} />
          Exigir encuesta para considerar elegible una compra
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!draft.notify_push} onChange={(e) => set('notify_push', e.target.checked)} />
          Notificaciones push (si el dispositivo las admite)
        </label>
        <p className="text-sm text-slate-500">Cada cliente tiene un QR y un enlace personal desde su perfil. El DNI no se incluye en esos canales.</p>
      </Section>
      <Section title="Vigencia y reinicio">
        <Field label="Vigencia del programa (opcional)">
          <input type="date" value={String(draft.program_expires_at || '').slice(0, 10)} onChange={(e) => set('program_expires_at', e.target.value)} className="input" />
        </Field>
        <Field label="Días de vigencia de la tarjeta">
          <input type="number" min="0" value={draft.cycle_valid_days} onChange={(e) => set('cycle_valid_days', Number(e.target.value))} className="input" />
        </Field>
        <Field label="Días de vigencia de la recompensa">
          <input type="number" min="0" value={draft.reward_valid_days} onChange={(e) => set('reward_valid_days', Number(e.target.value))} className="input" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={!!draft.auto_reset} onChange={(e) => set('auto_reset', e.target.checked)} />
          Reiniciar automáticamente el ciclo al completar o vencer
        </label>
      </Section>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
        <button
          type="button"
          disabled={!canSave || saving || !dirty}
          onClick={onSave}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Guardar
        </button>
      </div>
      <style>{`.input{width:100%;height:2.5rem;border-radius:0.75rem;border:1px solid #e2e8f0;padding:0 0.75rem;font-size:0.875rem}textarea.input{height:auto;padding:0.75rem}`}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block text-sm text-slate-700">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}

function ProfileView({ loading, profile, canValidate, onApprove, onRejectStart, onRedeem, onCopyLink }) {
  if (loading || !profile) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">Cargando perfil...</div>;
  }
  const card = profile.card;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${window.location.origin}${profile.access.path}`)}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <GitCardVisual card={card} />
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">{profile.customer.name}</h2>
          <p className="mt-1 text-sm text-slate-500">Doc. {profile.customer.doc_masked || '—'}</p>
          <p className="text-sm text-slate-500">{profile.customer.phone || 'Sin teléfono'}</p>
          <p className="mt-3 text-sm text-slate-600">Ingreso: {profile.cycles?.[0]?.started_at ? formatDate(profile.cycles[0].started_at) : 'Aún no participa'}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => onCopyLink(profile.access.path)} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <MdContentCopy /> Copiar enlace
            </button>
          </div>
          <img src={qrSrc} alt="QR GIT Cards" className="mt-4 h-36 w-36 rounded-xl border border-slate-100" />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Progreso</h3>
        <p className="text-sm text-slate-600">
          Confirmados {card.progress.confirmed} · pendientes {card.progress.pending} · restantes {card.progress.remaining} · meta {card.progress.goal}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-2">Fecha</th>
                <th className="py-2">Compra</th>
                <th className="py-2">Importe</th>
                <th className="py-2">Estado</th>
                <th className="py-2">Responsable</th>
                <th className="py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {profile.advances.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="py-2">{formatDate(a.created_at)}</td>
                  <td className="py-2">{a.order_number ? `#${a.order_number}` : a.order_id.slice(0, 8)}</td>
                  <td className="py-2">{formatCurrency(a.amount)}</td>
                  <td className="py-2">{a.status}{a.reject_reason ? ` · ${a.reject_reason}` : ''}</td>
                  <td className="py-2">{a.decided_by_name || '—'}</td>
                  <td className="py-2 text-right">
                    {a.status === 'pending' && canValidate ? (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => onApprove(a.id)} className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50" title="Aprobar"><MdCheck /></button>
                        <button type="button" onClick={() => onRejectStart(a.id)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" title="Rechazar"><MdClose /></button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Recompensas</h3>
        <div className="space-y-2">
          {profile.rewards.length ? profile.rewards.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3">
              <div>
                <p className="font-semibold text-slate-900">{r.title}</p>
                <p className="text-xs text-slate-500">
                  {r.status} · obtenida {formatDate(r.issued_at)}
                  {r.expires_at ? ` · vence ${formatDate(r.expires_at)}` : ''}
                  {r.redeemed_at ? ` · canje ${formatDate(r.redeemed_at)}` : ''}
                </p>
              </div>
              {r.status === 'available' && canValidate ? (
                <button type="button" onClick={() => onRedeem(r.id)} className="inline-flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700">
                  <MdRedeem /> Canjear
                </button>
              ) : null}
            </div>
          )) : <p className="text-sm text-slate-500">Sin recompensas todavía.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Encuestas de fidelización vinculadas</h3>
        {profile.surveys?.length ? (
          <ul className="space-y-2 text-sm text-slate-600">
            {profile.surveys.map((s) => (
              <li key={s.id}>
                {formatDate(s.created_at)} · {s.customer_name || '—'} · nota {s.rating || '—'}
                {s.visit_area ? ` · ${s.visit_area}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Aún no hay encuestas vinculadas a este cliente.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Historial de ciclos</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          {profile.cycles.map((c) => (
            <li key={c.id}>
              {c.status} · {c.progress.confirmed}/{c.progress.goal} · inicio {formatDate(c.started_at)}
              {c.completed_at ? ` · cierre ${formatDate(c.completed_at)}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-900">Movimientos</h3>
        <ul className="space-y-2 text-sm text-slate-600">
          {profile.events.map((e) => (
            <li key={e.id}>
              {formatDate(e.created_at)} · {e.kind} · {e.detail}
              {e.amount ? ` · ${formatCurrency(e.amount)}` : ''}
              {e.actor_name ? ` · ${e.actor_name}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
