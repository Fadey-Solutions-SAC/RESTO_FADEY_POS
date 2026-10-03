import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MdPerson, MdLock, MdSave, MdArrowBack, MdVisibility, MdVisibilityOff,
} from 'react-icons/md';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { getProductionStaffPath } from '../../utils/staffModuleAccess';
import {
  roleLabel,
  StaffHoursCards,
  StaffContractCard,
  StaffProductivityCard,
} from '../../components/hr/StaffProfileSummary';

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

export default function MiPerfil() {
  const { user, refreshStaffProfile } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
              <p className="text-sm text-slate-500 truncate">@{data.user?.username} · {roleLabel(data.user?.role)}</p>
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
          <StaffHoursCards hours={hours} period={period} />
          <StaffContractCard contract={contract} title="Mi contrato de trabajo" />
        </div>
      </div>

      <StaffProductivityCard
        kind={kind}
        productivity={productivity}
        period={period}
        title="Mi productividad"
        selfView
      />
    </div>
  );
}
