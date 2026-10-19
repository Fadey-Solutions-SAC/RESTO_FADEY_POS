import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatCurrency, formatDate } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import GitCardVisual from '../../components/GitCardVisual';
import GitCardsPromotions from './GitCardsPromotions';
import toast from 'react-hot-toast';
import {
  MdArrowBack, MdSettings, MdSearch, MdVisibility, MdCheck, MdClose,
  MdContentCopy, MdRedeem, MdChevronLeft, MdChevronRight,
  MdPersonAdd,
} from 'react-icons/md';

const PAGE_SIZE = 10;
const LIST_COLS = 'minmax(14rem,2.2fr) minmax(9rem,1fr) minmax(10.5rem,1.1fr) 6rem 6rem minmax(8rem,1fr) 3.25rem';

const STATUS_LABEL = {
  none: 'Sin tarjeta activa',
  active: 'Activa',
  inactive: 'Inactiva',
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
  inactive: 'bg-rose-50 text-rose-700',
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

const EMPTY_ENROLL = {
  name: '',
  phone: '',
  email: '',
  address: '',
  password: '',
  doc_type: '1',
  doc_number: '',
};

function normalizeCustomerEmail(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === '@gmail.com') return '';
  if (raw.includes('@')) return raw;
  return `${raw}@gmail.com`;
}

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
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollForm, setEnrollForm] = useState(EMPTY_ENROLL);
  const [enrolling, setEnrolling] = useState(false);

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
        inactive_cards: Number(data.inactive_cards ?? 0),
        near_complete: Number(data.near_complete ?? 0),
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

  const submitEnroll = async (event) => {
    event.preventDefault();
    if (!canValidateRole(user)) {
      toast.error('No tiene permiso para registrar clientes');
      return;
    }
    setEnrolling(true);
    try {
      const result = await api.post('/git-cards/members/enroll', {
        ...enrollForm,
        email: normalizeCustomerEmail(enrollForm.email),
      });
      if (result.already_enrolled) {
        toast('Este cliente ya tiene una GIT Card');
      } else if (result.created_customer) {
        toast.success('Cliente registrado en GIT Cards');
      } else {
        toast.success('Cliente existente vinculado a GIT Cards');
      }
      setShowEnroll(false);
      setEnrollForm(EMPTY_ENROLL);
      setPage(1);
      await Promise.all([loadMembers(), loadSummary()]);
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar el cliente');
    } finally {
      setEnrolling(false);
    }
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
      {view === 'config' && !customerId ? (
        <GitCardsPromotions canEdit={canConfigRole(user)} onClose={cancelConfig} />
      ) : (
        <>
      <div className="mb-4 flex min-w-0 items-start gap-3">
        <button
          type="button"
          onClick={() => {
            if (customerId) navigate('/admin/clientes/git-cards');
            else navigate('/admin/clientes');
          }}
          className="btn-secondary mt-0.5 inline-flex h-10 shrink-0 items-center gap-1 px-3 text-sm"
        >
          <MdArrowBack /> {customerId ? 'Lista GIT Cards' : 'Clientes'}
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-[var(--ui-body-text)]">GIT Cards</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--ui-muted)]">
            Fidelización por compras elegibles. Cada cobro que cumpla las reglas suma un avance a la tarjeta del cliente.
          </p>
        </div>
      </div>

      {customerId ? (
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
          canEnroll={canValidateRole(user)}
          canConfig={canConfigRole(user)}
          onAddClient={() => { setEnrollForm(EMPTY_ENROLL); setShowEnroll(true); }}
          onOpenConfig={() => setView('config')}
          onPreview={openPreview}
          onOpen={(id) => navigate(`/admin/clientes/git-cards/${id}`)}
        />
      )}

      {showEnroll ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/40 p-4">
          <form onSubmit={submitEnroll} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl" autoComplete="off">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Agregar cliente</h3>
                <p className="text-xs text-slate-500">Usa el registro de Clientes. No otorga avances ni recompensas.</p>
              </div>
              <button type="button" onClick={() => setShowEnroll(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
                <MdClose />
              </button>
            </div>
            <input type="text" name="fake-username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden="true" />
            <input type="password" name="fake-password" autoComplete="current-password" className="hidden" tabIndex={-1} aria-hidden="true" />
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Nombre completo</span>
              <input value={enrollForm.name} onChange={(e) => setEnrollForm((prev) => ({ ...prev, name: e.target.value }))} className="input-field" required />
            </label>
            <div className="grid grid-cols-[7.5rem_1fr] gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Documento</span>
                <select value={enrollForm.doc_type} onChange={(e) => setEnrollForm((prev) => ({ ...prev, doc_type: e.target.value }))} className="input-field">
                  <option value="1">DNI</option>
                  <option value="6">RUC</option>
                  <option value="0">Otro</option>
                </select>
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Número</span>
                <input
                  name="git-enroll-doc"
                  autoComplete="off"
                  inputMode="numeric"
                  value={enrollForm.doc_number}
                  onChange={(e) => setEnrollForm((prev) => ({ ...prev, doc_number: e.target.value.trim() }))}
                  className="input-field"
                  placeholder={enrollForm.doc_type === '6' ? '11 dígitos' : enrollForm.doc_type === '1' ? '8 dígitos' : ''}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Teléfono</span>
                <input name="git-enroll-phone" autoComplete="off" value={enrollForm.phone} onChange={(e) => setEnrollForm((prev) => ({ ...prev, phone: e.target.value }))} className="input-field" />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Email</span>
                <input
                  type="text"
                  name="git-enroll-email"
                  autoComplete="off"
                  value={enrollForm.email}
                  onChange={(e) => setEnrollForm((prev) => ({ ...prev, email: e.target.value }))}
                  onBlur={(e) => setEnrollForm((prev) => ({ ...prev, email: normalizeCustomerEmail(e.target.value) }))}
                  className="input-field"
                  placeholder="@gmail.com"
                />
              </label>
            </div>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Dirección</span>
              <input name="git-enroll-address" autoComplete="off" value={enrollForm.address} onChange={(e) => setEnrollForm((prev) => ({ ...prev, address: e.target.value }))} className="input-field" />
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowEnroll(false)} className="btn-secondary flex-1 px-3 py-2 text-sm">Cancelar</button>
              <button type="submit" disabled={enrolling} className="btn-primary flex-1 px-3 py-2 text-sm">
                {enrolling ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

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
                  className="btn-secondary w-full px-3 py-2 text-sm"
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
        </>
      )}
    </div>
  );
}

function statusDotClass(status) {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'pending') return 'bg-amber-500';
  if (status === 'reward_available') return 'bg-violet-500';
  if (status === 'expired' || status === 'inactive') return 'bg-rose-500';
  if (status === 'none') return 'bg-slate-300';
  return 'bg-slate-400';
}

function summaryValues(summary) {
  return {
    registered: summary ? summary.registered : '—',
    active: summary ? summary.active_cards : '—',
    inactive: summary ? summary.inactive_cards : '—',
    near: summary ? summary.near_complete : '—',
  };
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
  canEnroll,
  canConfig,
  onAddClient,
  onOpenConfig,
  onPreview,
  onOpen,
}) {
  const counts = summaryValues(summary);
  return (
    <div className="space-y-3">
      {summaryError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          No se pudo cargar el resumen: {summaryError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-[var(--ui-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre, teléfono o DNI"
            className="input-field h-10 w-full pl-8 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field h-10 w-auto min-w-[10rem] text-sm"
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
            className="btn-secondary h-10 px-3 text-xs"
          >
            Quitar filtro
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEnroll ? (
            <button type="button" onClick={onAddClient} className="btn-primary inline-flex h-10 items-center gap-1.5 px-3 text-sm">
              <MdPersonAdd className="text-base" /> Agregar cliente
            </button>
          ) : null}
          {canConfig ? (
            <button type="button" onClick={onOpenConfig} className="btn-primary inline-flex h-10 items-center gap-1.5 px-3 text-sm">
              <MdSettings className="text-base" /> Configuración
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-sm sm:p-5">
        {loading ? (
          <div className="py-10 text-center text-[var(--ui-muted)]">Cargando GIT Cards...</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <div className="min-w-[64rem]">
                <div
                  className="grid items-end gap-x-4 border-b border-[color:var(--ui-border)] pb-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--ui-muted)]"
                  style={{ gridTemplateColumns: LIST_COLS }}
                >
                  <div className="min-w-0">
                    <span className="block">Cliente</span>
                    <span className="mt-1 block text-lg font-bold normal-case tabular-nums tracking-normal text-[var(--ui-body-text)]">{counts.registered}</span>
                  </div>
                  <div className="min-w-0">Contacto</div>
                  <div className="min-w-0">
                    <span className="block">Estado</span>
                    <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold normal-case tracking-normal">
                      <span className="text-emerald-600">Activas <span className="tabular-nums">{counts.active}</span></span>
                      <span className="text-rose-600">Inactivas <span className="tabular-nums">{counts.inactive}</span></span>
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="block">Progreso</span>
                    <span className="mt-1 block text-xs font-semibold normal-case tracking-normal text-[var(--ui-body-text)]">
                      <span className="tabular-nums">{counts.near}</span> próximos
                    </span>
                  </div>
                  <div className="min-w-0 text-center">Pendientes</div>
                  <div className="min-w-0">Última actividad</div>
                  <div className="min-w-0 text-right">Acciones</div>
                </div>
                {members.length ? members.map((row) => (
                  <div
                    key={row.customer_id}
                    className="grid items-center gap-x-4 border-b border-[color:var(--ui-border)] py-3 text-sm last:border-b-0 hover:bg-[var(--ui-sidebar-hover)]"
                    style={{ gridTemplateColumns: LIST_COLS }}
                  >
                    <div className="min-w-0">
                      <button type="button" onClick={() => onOpen(row.customer_id)} className="flex w-full min-w-0 items-center gap-2 text-left">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(row.status)}`} aria-hidden="true" />
                        <span className="block min-w-0 truncate font-semibold text-[var(--ui-body-text)]" title={row.name}>{row.name}</span>
                      </button>
                    </div>
                    <div className="min-w-0 text-[var(--ui-muted)]">
                      <span className="block truncate">{row.phone || '—'}</span>
                      {row.doc_masked ? <span className="block truncate text-xs opacity-80">DNI {row.doc_masked}</span> : null}
                    </div>
                    <div className="min-w-0">
                      <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[row.status] || STATUS_CLASS.none}`}>
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                    </div>
                    <div className="min-w-0 tabular-nums text-[var(--ui-body-text)]">{row.progress?.confirmed || 0} / {row.progress?.goal || 0}</div>
                    <div className="min-w-0 text-center tabular-nums">
                      <span className={row.pending_count ? 'font-semibold text-amber-700' : 'text-[var(--ui-muted)]'}>
                        {row.pending_count || 0}
                      </span>
                    </div>
                    <div className="min-w-0 truncate text-[var(--ui-muted)]">{row.last_activity ? formatDate(row.last_activity) : '—'}</div>
                    <div className="min-w-0 text-right">
                      <button
                        type="button"
                        onClick={() => onPreview(row.customer_id)}
                        className="rounded-lg p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] hover:text-[var(--ui-accent)]"
                        title="Ver tarjeta digital"
                      >
                        <MdVisibility />
                      </button>
                    </div>
                  </div>
                )) : (
                  <p className="py-10 text-center text-[var(--ui-muted)]">No hay clientes para mostrar.</p>
                )}
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{counts.registered}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estado</p>
                  <p className="mt-0.5 text-xs font-semibold">
                    <span className="text-emerald-600">Activas {counts.active}</span>
                    <span className="ml-2 text-rose-600">Inactivas {counts.inactive}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Progreso</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-800">{counts.near} próximos</p>
                </div>
              </div>
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
