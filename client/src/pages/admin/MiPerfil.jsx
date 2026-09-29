import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import {
  MdPerson, MdLock, MdSave, MdSchedule, MdDateRange, MdCalendarMonth, MdHistory,
  MdDescription, MdDownload, MdTrendingUp, MdArrowBack, MdVisibility, MdVisibilityOff,
} from 'react-icons/md';
import { api, formatCurrency } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { formatMinutes } from '../../components/hr/hrFormat';
import { getProductionStaffPath } from '../../utils/staffModuleAccess';

const ROLE_LABELS = {
  admin: 'Administrador',
  master_admin: 'Administrador maestro',
  cajero: 'Caja',
  mozo: 'Mozo',
  cocina: 'Cocina',
  bar: 'Bar',
  produccion: 'Producción',
  delivery: 'Delivery',
};

const KIND_TEXT = {
  mozo: 'Según las mesas y cuentas que abres cada día.',
  caja: 'Según las cuentas que abres y las que cobras cada día.',
  produccion: 'Según las comandas que despachas y el tiempo que tardan en salir.',
  admin: 'Cuentas abiertas, cobradas y comandas despachadas por ti.',
  general: 'Según las cuentas que abres cada día.',
};

function shortDay(key) {
  const [, m, d] = String(key || '').split('-');
  return d && m ? `${d}/${m}` : key;
}

function StatCard({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="flex-auto rounded-2xl border border-slate-100 bg-white px-3 py-3 shadow-sm flex items-center gap-2.5">
      <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${tones[tone] || tones.blue}`}>
        <Icon className="text-xl" />
      </span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight whitespace-nowrap">{label}</p>
        <p className="text-lg font-bold mt-1 whitespace-nowrap tabular-nums leading-none text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="input-field pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {show ? <MdVisibilityOff /> : <MdVisibility />}
      </button>
    </div>
  );
}

function chartConfig(kind) {
  if (kind === 'mozo' || kind === 'general') {
    return {
      bars: [{ key: 'cuentas', name: 'Cuentas / mesas abiertas', color: '#2563eb' }],
      line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
    };
  }
  if (kind === 'caja') {
    return {
      bars: [
        { key: 'cuentas', name: 'Cuentas abiertas', color: '#93c5fd' },
        { key: 'cobradas', name: 'Cuentas cobradas', color: '#2563eb' },
      ],
      line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
    };
  }
  if (kind === 'produccion') {
    return {
      bars: [{ key: 'despachadas', name: 'Comandas despachadas', color: '#2563eb' }],
      line: { key: 'minutos_promedio', name: 'Minutos promedio de salida', color: '#f59e0b' },
    };
  }
  return {
    bars: [
      { key: 'cuentas', name: 'Cuentas abiertas', color: '#93c5fd' },
      { key: 'cobradas', name: 'Cuentas cobradas', color: '#2563eb' },
      { key: 'despachadas', name: 'Comandas despachadas', color: '#8b5cf6' },
    ],
    line: { key: 'horas', name: 'Horas trabajadas', color: '#10b981' },
  };
}

function summaryChips(kind, s) {
  if (!s) return [];
  const perHour = s.por_hora != null ? s.por_hora.toFixed(2) : '—';
  if (kind === 'mozo' || kind === 'general') {
    return [
      ['Cuentas abiertas', s.cuentas],
      ['Comandas enviadas', s.comandas],
      ['Ventas cobradas', formatCurrency(s.ventas)],
      ['Cuentas por hora', perHour],
    ];
  }
  if (kind === 'caja') {
    return [
      ['Cuentas abiertas', s.cuentas],
      ['Cuentas cobradas', s.cobradas],
      ['Ventas de tus cuentas', formatCurrency(s.ventas)],
      ['Cuentas por hora', perHour],
    ];
  }
  if (kind === 'produccion') {
    return [
      ['Comandas despachadas', s.despachadas],
      ['Tiempo promedio de salida', s.minutos_promedio != null ? `${s.minutos_promedio} min` : '—'],
      ['Horas trabajadas', `${s.horas} h`],
      ['Comandas por hora', perHour],
    ];
  }
  return [
    ['Cuentas abiertas', s.cuentas],
    ['Cuentas cobradas', s.cobradas],
    ['Comandas despachadas', s.despachadas],
    ['Acciones por hora', perHour],
  ];
}

export default function MiPerfil() {
  const { user, refreshStaffProfile } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [form, setForm] = useState({ full_name: '', username: '', current_password: '', new_password: '', confirm_password: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/profile');
      setData(res);
      setForm((f) => ({ ...f, full_name: res?.user?.full_name || '', username: res?.user?.username || '' }));
    } catch (err) {
      toast.error(err?.message || 'No se pudo cargar tu perfil');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const productionPath = useMemo(() => {
    const role = String(user?.role || '').toLowerCase();
    return ['produccion', 'cocina', 'bar'].includes(role) ? getProductionStaffPath(user) : null;
  }, [user]);

  const usernameChanged = data?.user && form.username.trim().toLowerCase() !== String(data.user.username || '').trim().toLowerCase();
  const needsCurrentPassword = Boolean(usernameChanged || form.new_password);

  const save = async (e) => {
    e.preventDefault();
    if (form.new_password && form.new_password !== form.confirm_password) {
      toast.error('La nueva contraseña y su confirmación no coinciden');
      return;
    }
    if (needsCurrentPassword && !form.current_password) {
      toast.error('Escribe tu contraseña actual para cambiar usuario o contraseña');
      return;
    }
    setSaving(true);
    try {
      const res = await api.put('/profile', {
        full_name: form.full_name,
        username: form.username,
        current_password: form.current_password,
        new_password: form.new_password,
      });
      toast.success(res?.password_changed ? 'Perfil y contraseña actualizados' : 'Perfil actualizado');
      setForm((f) => ({ ...f, current_password: '', new_password: '', confirm_password: '' }));
      if (typeof refreshStaffProfile === 'function') await refreshStaffProfile();
      await load();
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center py-20"><div className="rf-loader rf-loader--md" /></div>;
  }
  if (!data) return null;

  const { kind, hours, contract, productivity, period } = data;
  const cfg = chartConfig(kind);
  const series = (productivity?.series || []).map((r) => ({ ...r, label: shortDay(r.day) }));
  const hasActivity = series.some((r) => cfg.bars.some((b) => Number(r[b.key] || 0) > 0));
  const chips = summaryChips(kind, productivity?.summary);
  const initial = (data.user?.full_name || data.user?.username || 'U').trim()[0]?.toUpperCase() || 'U';

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {productionPath && (
        <Link to={productionPath} className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
          <MdArrowBack /> Volver a mi área
        </Link>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <form onSubmit={save} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-4">
            <span className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-2xl font-bold shrink-0">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 truncate">{data.user?.full_name}</p>
              <p className="text-sm text-slate-500 truncate">@{data.user?.username} · {ROLE_LABELS[data.user?.role] || data.user?.role}</p>
            </div>
          </div>

          {data.editable ? (
            <>
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><MdPerson className="text-blue-600" /> Datos de acceso</p>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Nombre completo</span>
                  <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="input-field mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Nombre de usuario</span>
                  <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="input-field mt-1" autoComplete="username" />
                </label>
              </div>

              <div className="space-y-3 pt-1">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><MdLock className="text-blue-600" /> Cambiar contraseña</p>
                <PasswordInput value={form.new_password} onChange={(v) => setForm({ ...form, new_password: v })} placeholder="Nueva contraseña (mínimo 6 caracteres)" autoComplete="new-password" />
                <PasswordInput value={form.confirm_password} onChange={(v) => setForm({ ...form, confirm_password: v })} placeholder="Repite la nueva contraseña" autoComplete="new-password" />
                {needsCurrentPassword && (
                  <PasswordInput value={form.current_password} onChange={(v) => setForm({ ...form, current_password: v })} placeholder="Contraseña actual (para confirmar)" autoComplete="current-password" />
                )}
              </div>

              <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60">
                <MdSave className="text-lg" /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">Las credenciales de este usuario se administran desde el panel maestro.</p>
          )}
        </form>

        <div className="space-y-5 min-w-0">
          {hours && (
            <div className="flex flex-wrap gap-3">
              <StatCard icon={MdSchedule} label="Esta semana" value={formatMinutes(hours.weekly_minutes)} />
              <StatCard icon={MdCalendarMonth} label="Este mes" value={formatMinutes(hours.monthly_minutes)} tone="green" />
              <StatCard icon={MdDateRange} label={`Últimos ${period?.days || 30} días`} value={formatMinutes(hours.period_minutes)} tone="violet" />
              <StatCard icon={MdHistory} label="Horas acumuladas" value={hours.total_minutes != null ? formatMinutes(hours.total_minutes) : '—'} tone="amber" />
            </div>
          )}

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="font-semibold text-slate-800 flex items-center gap-2"><MdDescription className="text-violet-600" /> Mi contrato de trabajo</p>
                {contract?.available ? (
                  <p className="text-sm text-slate-500 mt-1">
                    {[contract.position, contract.contract_type, contract.hire_date ? `ingreso ${contract.hire_date}` : ''].filter(Boolean).join(' · ') || 'Contrato registrado'}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500 mt-1">{contract?.reason || 'Sin contrato registrado.'}</p>
                )}
              </div>
              {contract?.available && (
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${contract.fully_signed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {contract.status || (contract.fully_signed ? 'Firmado' : 'Pendiente de firma')}
                </span>
              )}
            </div>
            {contract?.available && (
              <div className="flex flex-wrap gap-2">
                {contract.text && (
                  <button type="button" onClick={() => setShowContract((v) => !v)} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700">
                    {showContract ? 'Ocultar contrato' : 'Ver contrato'}
                  </button>
                )}
                {contract.pdf_url && (
                  <a href={contract.pdf_url} target="_blank" rel="noreferrer" className="text-sm font-medium px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 inline-flex items-center gap-1.5">
                    <MdDownload /> Descargar PDF
                  </a>
                )}
              </div>
            )}
            {showContract && contract?.text && (
              <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-700 bg-slate-50 rounded-xl p-4 border border-slate-100 font-sans">
                {contract.text}
              </pre>
            )}
          </div>
        </div>
      </div>

      {productivity && (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="font-semibold text-slate-800 flex items-center gap-2"><MdTrendingUp className="text-blue-600" /> Mi productividad (últimos {period?.days || 30} días)</p>
            <p className="text-sm text-slate-500 mt-1">{KIND_TEXT[kind] || KIND_TEXT.general}</p>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {chips.map(([label, value]) => (
              <div key={label} className="flex-auto rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">{label}</p>
                <p className="text-base font-bold text-slate-900 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {hasActivity ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {cfg.bars.map((b) => (
                    <Bar key={b.key} yAxisId="left" dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  ))}
                  <Line yAxisId="right" type="monotone" dataKey={cfg.line.key} name={cfg.line.name} stroke={cfg.line.color} strokeWidth={2} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 py-10 text-center">
              Aún no hay actividad registrada en este período.
              {kind === 'produccion' ? ' Las comandas que marques como listas desde ahora aparecerán aquí.' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
