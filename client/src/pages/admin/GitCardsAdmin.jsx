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
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
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
        <GitCardsPromotions canEdit={canConfigRole(user)} onClose={cancelConfig} />
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
          canEnroll={canValidateRole(user)}
          onAddClient={() => { setEnrollForm(EMPTY_ENROLL); setShowEnroll(true); }}
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
              <button type="button" onClick={() => setShowEnroll(false)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
              <button type="submit" disabled={enrolling} className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
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
  onAddClient,
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre, teléfono o DNI"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600"
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
              className="h-9 rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Quitar filtro
            </button>
          ) : null}
        </div>
        {canEnroll ? (
          <button
            type="button"
            onClick={onAddClient}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <MdPersonAdd className="text-base" /> Agregar cliente
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        {loading ? (
          <div className="py-10 text-center text-slate-500">Cargando GIT Cards...</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] table-fixed text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-[20%] py-3 pr-3 align-bottom">
                      <span className="block">Cliente</span>
                      <span className="mt-1 block text-lg font-bold normal-case tabular-nums tracking-normal text-slate-900">{counts.registered}</span>
                    </th>
                    <th className="w-[16%] py-3 pr-3 align-bottom">Contacto</th>
                    <th className="w-[16%] py-3 pr-3 align-bottom">
                      <span className="block">Estado</span>
                      <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold normal-case tracking-normal">
                        <span className="text-emerald-600">Activas <span className="tabular-nums">{counts.active}</span></span>
                        <span className="text-rose-600">Inactivas <span className="tabular-nums">{counts.inactive}</span></span>
                      </span>
                    </th>
                    <th className="w-[12%] py-3 pr-3 align-bottom">
                      <span className="block">Progreso</span>
                      <span className="mt-1 block text-xs font-semibold normal-case tracking-normal text-slate-800">
                        <span className="tabular-nums">{counts.near}</span> próximos
                      </span>
                    </th>
                    <th className="w-[10%] py-3 pr-3 text-center align-bottom">Pendientes</th>
                    <th className="w-[18%] py-3 pr-3 align-bottom">Última actividad</th>
                    <th className="w-[8%] py-3 pr-1 text-right align-bottom">Acciones</th>
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
                      <td colSpan={7} className="py-10 text-center text-slate-500">No hay clientes para mostrar.</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
