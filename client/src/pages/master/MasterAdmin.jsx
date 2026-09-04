import { useEffect, useState } from 'react';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import { api, resolveMediaUrl } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Modal';
import RestaurantServiceContractForm from '../../components/RestaurantServiceContractForm';
import { normalizeContratoFromApi } from '../../utils/contratoNormalize';
import MasterRestaurantBackupPanel from '../../components/master/MasterRestaurantBackupPanel';
import {
  MdAdminPanelSettings,
  MdReceiptLong,
  MdEventAvailable,
  MdNotifications,
  MdLock,
  MdSave,
  MdAdd,
  MdUpload,
  MdLogout,
  MdManageAccounts,
  MdVisibility,
  MdVisibilityOff,
  MdClose,
  MdEdit,
  MdDelete,
  MdReceipt,
  MdPayment,
  MdLayers,
  MdBackup,
} from 'react-icons/md';
import MasterRestaurantBillingWorkspace from '../../components/master/MasterRestaurantBillingWorkspace';

const TABS = [
  { id: 'usuarios', label: 'Usuario administrador', icon: MdAdminPanelSettings },
  { id: 'plan', label: 'Plan comercial', icon: MdLayers },
  { id: 'contrato', label: 'Contrato digital del servicio', icon: MdReceiptLong },
  { id: 'sunat_bot', label: 'Bot facturación SUNAT', icon: MdReceipt },
  { id: 'pago_uso_sistema', label: 'Pago de plan', icon: MdPayment },
  { id: 'facturacion', label: 'Fecha de facturación', icon: MdEventAvailable },
  { id: 'respaldo', label: 'Respaldo', icon: MdBackup },
  { id: 'notificaciones', label: 'Notificaciones', icon: MdNotifications },
  { id: 'bloqueo', label: 'Bloqueo por falta de pago', icon: MdLock },
];

export default function MasterAdmin() {
  const { logout } = useAuth();
  const [tab, setTab] = useState('usuarios');
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [adminForm, setAdminForm] = useState({ username: '', full_name: '', email: '', password: '' });
  const [notifyForm, setNotifyForm] = useState({ title: '', message: '', image_url: '', duration_value: 1, duration_unit: 'hours', no_expiry: false });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showMasterAccessModal, setShowMasterAccessModal] = useState(false);
  const [showCreateBuyerModal, setShowCreateBuyerModal] = useState(false);
  const [showBuyerPassword, setShowBuyerPassword] = useState(false);
  const [previewNotification, setPreviewNotification] = useState(null);
  const [masterCredForm, setMasterCredForm] = useState({
    current_password: '',
    new_username: '',
    new_password: '',
    confirm_password: '',
  });
  const [showEditNotificationModal, setShowEditNotificationModal] = useState(false);
  const [notificationToDelete, setNotificationToDelete] = useState(null);
  const [deleteNotifyBusy, setDeleteNotifyBusy] = useState(false);
  const [editingNotification, setEditingNotification] = useState(null);
  const [editNotifyForm, setEditNotifyForm] = useState({ title: '', message: '', image_url: '', duration_value: 1, duration_unit: 'hours', no_expiry: false });
  const [showEditBuyerModal, setShowEditBuyerModal] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState(null);
  const [editBuyerForm, setEditBuyerForm] = useState({ username: '', full_name: '', email: '', password: '' });
  const [showEditBuyerPassword, setShowEditBuyerPassword] = useState(false);
  const [serviceContrato, setServiceContrato] = useState(() => normalizeContratoFromApi(null));
  const [serviceContratoLoading, setServiceContratoLoading] = useState(false);
  const [serviceContratoSaving, setServiceContratoSaving] = useState(false);
  /** Overrides de módulos / submódulos (false = deshabilitado). Se guardan con el plan. */
  const [planModuleDraft, setPlanModuleDraft] = useState({});
  const [planPrecioDraft, setPlanPrecioDraft] = useState('');
  const [planPrecioSaving, setPlanPrecioSaving] = useState(false);

  const loadDashboard = async () => {
    try {
      const data = await api.get('/master-admin/dashboard');
      setDashboard(data);
      setPlanModuleDraft({ ...(data?.control?.service_plan_module_overrides || {}) });
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar administrador maestro');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDashboard(); }, []);

  useEffect(() => {
    if (tab !== 'plan') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const appCfg = await api.get('/admin-modules/config/app');
        if (cancelled) return;
        const precio = appCfg?.pago_uso_sistema?.precio_plan;
        setPlanPrecioDraft(
          precio === null || precio === undefined || precio === ''
            ? ''
            : String(precio),
        );
      } catch (_) {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    if (tab !== 'contrato') return;
    let cancelled = false;
    (async () => {
      setServiceContratoLoading(true);
      try {
        const appCfg = await api.get('/admin-modules/config/app');
        if (cancelled) return;
        setServiceContrato(normalizeContratoFromApi(appCfg?.contrato));
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'No se pudo cargar el contrato del servicio');
      } finally {
        if (!cancelled) setServiceContratoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain !== 'app_config' || tab !== 'contrato') return;
    (async () => {
      setServiceContratoLoading(true);
      try {
        const appCfg = await api.get('/admin-modules/config/app');
        setServiceContrato(normalizeContratoFromApi(appCfg?.contrato));
      } catch (err) {
        toast.error(err.message || 'No se pudo actualizar el contrato del servicio');
      } finally {
        setServiceContratoLoading(false);
      }
    })();
  });

  const saveServiceContrato = async () => {
    const c = serviceContrato || {};
    const payload = {
      texto_contrato: String(c.texto_contrato || ''),
      documento_word_url: String(c.documento_word_url || '').trim(),
      documento_word_nombre: String(c.documento_word_nombre || '').trim(),
      firma_comprador_url: String(c.firma_comprador_url || '').trim(),
      firma_vendedor_url: String(c.firma_vendedor_url || '').trim(),
    };
    try {
      setServiceContratoSaving(true);
      const saved = await api.put('/admin-modules/config/app', { contrato: payload });
      setServiceContrato(normalizeContratoFromApi(saved?.contrato));
      toast.success('Contrato del servicio guardado');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setServiceContratoSaving(false);
    }
  };

  const resolveDurationHours = (formState) => {
    if (formState?.no_expiry) return null;
    const value = Math.max(1, Number(formState?.duration_value || 1));
    const unit = formState?.duration_unit === 'days' ? 'days' : 'hours';
    return unit === 'days' ? value * 24 : value;
  };

  const getRemainingLabel = (expiresAt) => {
    if (!expiresAt) return 'Sin vencimiento';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(ms)) return 'Sin vencimiento';
    if (ms <= 0) return 'Expirada';
    const totalHours = Math.ceil(ms / (1000 * 60 * 60));
    if (totalHours < 24) return `Activa · ${totalHours}h restantes`;
    const days = Math.ceil(totalHours / 24);
    return `Activa · ${days} día(s) restantes`;
  };

  const updateControl = async (patch, okMessage) => {
    try {
      const controlResp = await api.put('/master-admin/control', patch);
      setDashboard((prev) => ({
        ...(prev || {}),
        control: controlResp,
        lock: { ...(prev?.lock || {}), locked: Number(controlResp.global_lock_enabled || 0) === 1, reason: controlResp.global_lock_reason || '' },
      }));
      if (controlResp && typeof controlResp.service_plan_module_overrides === 'object') {
        setPlanModuleDraft({ ...(controlResp.service_plan_module_overrides || {}) });
      }
      if (okMessage) toast.success(okMessage);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const createAdminBuyer = async (e) => {
    e.preventDefault();
    try {
      await api.post('/users', {
        ...adminForm,
        role: 'admin',
      });
      toast.success('Administrador dueño creado');
      setAdminForm({ username: '', full_name: '', email: '', password: '' });
      setShowBuyerPassword(false);
      setShowCreateBuyerModal(false);
      await loadDashboard();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteAdminBuyer = async (buyer) => {
    if (!buyer?.id) return;
    const label = String(buyer.full_name || buyer.username || 'este administrador').trim();
    const list = dashboard?.admin_users || [];
    const isLast = list.length <= 1;
    const ok = window.confirm(
      isLast
        ? `¿Eliminar a «${label}»? Es el único administrador dueño. Hasta crear otro, no habrá dueño del negocio en el maestro.`
        : `¿Eliminar al administrador dueño «${label}»? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    try {
      await api.delete(`/users/${buyer.id}`);
      toast.success('Administrador eliminado');
      await loadDashboard();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar el administrador');
    }
  };

  const uploadImage = async (file) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const uploaded = await api.upload(file);
      setNotifyForm((prev) => ({ ...prev, image_url: uploaded?.url || '' }));
      toast.success('Imagen cargada');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const sendNotification = async (e) => {
    e.preventDefault();
    try {
      await api.post('/master-admin/notifications', {
        title: notifyForm.title,
        message: notifyForm.message,
        image_url: notifyForm.image_url,
        duration_hours: resolveDurationHours(notifyForm),
      });
      toast.success('Notificación publicada');
      setNotifyForm({ title: '', message: '', image_url: '', duration_value: 1, duration_unit: 'hours', no_expiry: false });
      await loadDashboard();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const previewDraftNotification = () => {
    if (!notifyForm.title.trim() || !notifyForm.message.trim()) {
      return toast.error('Escribe título y mensaje para la vista previa');
    }
    setPreviewNotification({
      id: 'draft-preview',
      title: notifyForm.title.trim(),
      message: notifyForm.message.trim(),
      image_url: notifyForm.image_url || '',
      created_by: 'Vista previa',
      created_at: new Date().toISOString(),
      expires_at: (() => {
        const hours = resolveDurationHours(notifyForm);
        if (!hours) return null;
        return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
      })(),
    });
  };

  const openEditNotification = (notification) => {
    setEditingNotification(notification);
    setEditNotifyForm({
      title: notification?.title || '',
      message: notification?.message || '',
      image_url: notification?.image_url || '',
      duration_value: 1,
      duration_unit: 'hours',
      no_expiry: !notification?.expires_at,
    });
    setShowEditNotificationModal(true);
  };

  const submitEditNotification = async (e) => {
    e.preventDefault();
    if (!editingNotification?.id) return;
    try {
      await api.put(`/master-admin/notifications/${editingNotification.id}`, {
        title: editNotifyForm.title,
        message: editNotifyForm.message,
        image_url: editNotifyForm.image_url,
        duration_hours: resolveDurationHours(editNotifyForm),
      });
      toast.success('Notificación actualizada');
      setShowEditNotificationModal(false);
      setEditingNotification(null);
      await loadDashboard();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const confirmDeleteNotification = async () => {
    const notification = notificationToDelete;
    if (!notification?.id) return;
    setDeleteNotifyBusy(true);
    try {
      await api.delete(`/master-admin/notifications/${notification.id}`);
      toast.success('Notificación eliminada');
      setNotificationToDelete(null);
      await loadDashboard();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleteNotifyBusy(false);
    }
  };

  const openEditBuyer = (buyer) => {
    setEditingBuyer(buyer);
    setEditBuyerForm({
      username: buyer?.username || '',
      full_name: buyer?.full_name || '',
      email: buyer?.email || '',
      password: '',
    });
    setShowEditBuyerPassword(false);
    setShowEditBuyerModal(true);
  };

  const submitEditBuyer = async (e) => {
    e.preventDefault();
    if (!editingBuyer?.id) return;
    try {
      const payload = {
        username: editBuyerForm.username,
        full_name: editBuyerForm.full_name,
        email: editBuyerForm.email,
        role: 'admin',
      };
      if (String(editBuyerForm.password || '').trim()) {
        payload.password = editBuyerForm.password;
      }
      await api.put(`/users/${editingBuyer.id}`, payload);
      toast.success('Credenciales del administrador actualizadas');
      setShowEditBuyerModal(false);
      setEditingBuyer(null);
      await loadDashboard();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateMasterCredentials = async (e) => {
    e.preventDefault();
    if (masterCredForm.new_password && masterCredForm.new_password !== masterCredForm.confirm_password) {
      return toast.error('La confirmación de contraseña no coincide');
    }
    try {
      const payload = {
        current_password: masterCredForm.current_password,
        new_username: masterCredForm.new_username,
        new_password: masterCredForm.new_password,
      };
      await api.put('/master-admin/credentials', payload);
      toast.success('Credenciales de administrador maestro actualizadas');
      setMasterCredForm({ current_password: '', new_username: '', new_password: '', confirm_password: '' });
      setShowMasterAccessModal(false);
      await loadDashboard();
      logout();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;
  }

  const control = dashboard?.control || {};
  const planModuleTrees = dashboard?.plan_module_trees || { basico: [], intermedio: [], profesional: [] };
  const notifications = dashboard?.notifications || [];
  const adminUsers = dashboard?.admin_users || [];
  const creds = dashboard?.master_credentials || { username: 'Romero25879' };
  const lockEnabled = Number(control.global_lock_enabled || 0) === 1;

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)] p-6 text-[var(--ui-body-text)]">
      <div className="max-w-7xl mx-auto">
        <div className="card mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[var(--ui-body-text)]">Administrador Maestro</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={logout} className="btn-secondary flex items-center gap-2"><MdLogout /> Salir</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-2 ${tab === item.id ? 'bg-[var(--ui-accent)] text-white border-[color:var(--ui-accent)]' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'}`}
              >
                <item.icon />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'usuarios' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card lg:col-span-2">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold rf-section-title">Administrador dueño del negocio</h3>
                </div>
                <button
                  type="button"
                  className="btn-primary flex items-center gap-2"
                  onClick={() => setShowCreateBuyerModal(true)}
                >
                  <MdAdd /> Crear administrador dueño
                </button>
              </div>
              <div className="space-y-2">
                {adminUsers.map((u) => (
                  <div key={u.id} className="border rounded-lg px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-slate-800">{u.full_name}</p>
                      <p className="text-xs ui-text-muted">{u.username} · {u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${Number(u.is_active || 0) === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {Number(u.is_active || 0) === 1 ? 'Activo' : 'Inactivo'}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEditBuyer(u)}
                        className="p-2 rounded bg-sky-50 hover:bg-sky-100 text-sky-700"
                        aria-label="Editar credenciales del comprador"
                      >
                        <MdEdit />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteAdminBuyer(u)}
                        className="p-2 rounded bg-rose-50 hover:bg-rose-100 text-rose-700"
                        aria-label="Eliminar administrador"
                      >
                        <MdDelete />
                      </button>
                    </div>
                  </div>
                ))}
                {adminUsers.length === 0 && <p className="text-sm ui-text-muted">No hay administrador dueño. Cree uno para el negocio.</p>}
              </div>
            </div>
          </div>
        )}

        {tab === 'plan' && (
          <div className="card">
            <h2 className="font-semibold rf-section-title mb-2">Plan comercial del restaurante</h2>
            <p className="text-sm ui-text-muted mb-4">
              Elija el plan y active o desactive módulos y submódulos incluidos en ese plan. Los cambios aplican al guardar; el personal debe{' '}
              <strong>volver a iniciar sesión</strong> o recargar la página.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Plan activo</label>
                  <select
                    className="input-field"
                    value={
                      control.service_plan === 'basico' || control.service_plan === 'básico'
                        ? 'basico'
                        : control.service_plan === 'intermedio'
                          ? 'intermedio'
                          : 'profesional'
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setDashboard((p) => ({
                        ...(p || {}),
                        control: { ...(p?.control || {}), service_plan: v },
                      }));
                      setPlanModuleDraft((draft) => {
                        const tree = planModuleTrees[v] || [];
                        const allowed = new Set();
                        for (const n of tree) {
                          allowed.add(n.id);
                          for (const ch of n.children || []) {
                            allowed.add(`${n.id}:${ch.id}`);
                          }
                        }
                        const next = {};
                        for (const [k, val] of Object.entries(draft || {})) {
                          if (allowed.has(k)) next[k] = val;
                        }
                        return next;
                      });
                    }}
                  >
                    <option value="basico">plan basico</option>
                    <option value="intermedio">plan pro</option>
                    <option value="profesional">plan premium</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio del plan (S/)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input-field tabular-nums"
                    placeholder="Ej. 99.00"
                    value={planPrecioDraft}
                    onChange={(e) => setPlanPrecioDraft(e.target.value)}
                  />
                  <p className="text-xs text-[var(--ui-muted)] mt-1">
                    Este monto se sugiere al cargar el comprobante de pago del plan.
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-[var(--ui-muted)]">
                  Desactivar un módulo oculta su entrada en el menú. Desactivar un submódulo (p. ej. una vista de Caja) oculta solo esa opción si el módulo
                  padre sigue activo.
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-primary flex items-center gap-2"
                    disabled={planPrecioSaving}
                    onClick={async () => {
                      try {
                        setPlanPrecioSaving(true);
                        await updateControl(
                          {
                            service_plan: control.service_plan || 'profesional',
                            service_plan_module_overrides: planModuleDraft,
                          },
                          null,
                        );
                        const precioNum = Number(planPrecioDraft);
                        const precioPayload = Number.isFinite(precioNum) && precioNum >= 0
                          ? Math.round(precioNum * 100) / 100
                          : '';
                        await api.put('/admin-modules/config/app', {
                          pago_uso_sistema: { precio_plan: precioPayload },
                        });
                        setPlanPrecioDraft(precioPayload === '' ? '' : String(precioPayload));
                        toast.success('Plan comercial actualizado');
                      } catch (err) {
                        toast.error(err.message || 'No se pudo guardar el plan');
                      } finally {
                        setPlanPrecioSaving(false);
                      }
                    }}
                  >
                    <MdSave /> {planPrecioSaving ? 'Guardando…' : 'Guardar plan y módulos'}
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 max-h-[min(70vh,560px)] overflow-y-auto">
                <h3 className="text-sm font-semibold rf-section-title mb-3">Módulos del plan seleccionado</h3>
                {(() => {
                  const planKey =
                    control.service_plan === 'basico' || control.service_plan === 'básico'
                      ? 'basico'
                      : control.service_plan === 'intermedio'
                        ? 'intermedio'
                        : 'profesional';
                  const tree = planModuleTrees[planKey] || [];
                  const setToggle = (key, enabled) => {
                    setPlanModuleDraft((prev) => {
                      const next = { ...prev };
                      if (enabled) delete next[key];
                      else next[key] = false;
                      return next;
                    });
                  };
                  const isOn = (key) => planModuleDraft[key] !== false;
                  return tree.length === 0 ? (
                    <p className="text-sm ui-text-muted">No hay datos de catálogo. Recargue la página.</p>
                  ) : (
                    <ul className="space-y-3">
                      {tree.map((node) => {
                        const parentKey = node.id;
                        const parentOn = isOn(parentKey);
                        return (
                          <li key={parentKey} className="border border-slate-200 rounded-lg bg-white px-3 py-2">
                            <label className="flex items-center justify-between gap-2 cursor-pointer">
                              <span className="text-sm font-medium text-slate-800">{node.label}</span>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                checked={parentOn}
                                onChange={(e) => setToggle(parentKey, e.target.checked)}
                              />
                            </label>
                            {(node.children || []).length > 0 && (
                              <ul className="mt-2 ml-2 space-y-1.5 border-t border-slate-100 pt-2">
                                {(node.children || []).map((ch) => {
                                  const ck = `${parentKey}:${ch.id}`;
                                  const subOn = parentOn && isOn(ck);
                                  return (
                                    <li key={ck}>
                                      <label
                                        className={`flex items-center justify-between gap-2 text-sm ${
                                          parentOn ? 'cursor-pointer text-slate-700' : 'text-[var(--ui-muted)] cursor-not-allowed'
                                        }`}
                                      >
                                        <span>{ch.label}</span>
                                        <input
                                          type="checkbox"
                                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                          checked={subOn}
                                          disabled={!parentOn}
                                          onChange={(e) => setToggle(ck, e.target.checked)}
                                        />
                                      </label>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {tab === 'contrato' && (
          <div className="flex flex-col gap-2 min-h-0 h-[calc(100dvh-7.5rem)]">
            {serviceContratoLoading ? (
              <div className="card py-12 flex justify-center">
                <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
              </div>
            ) : (
              <>
                <RestaurantServiceContractForm
                  contrato={serviceContrato}
                  canEdit={!serviceContrato?.text_locked && serviceContrato?.estado_firma !== 'firmado'}
                  onChange={setServiceContrato}
                  cardClassName="rf-contrato-panel rounded-xl shadow-sm border border-[color:var(--ui-border)] bg-[var(--ui-surface)] flex flex-col min-h-0 flex-1 overflow-hidden p-3 sm:p-4 gap-2"
                />
                {!serviceContrato?.text_locked && serviceContrato?.estado_firma !== 'firmado' ? (
                  <div className="flex justify-end shrink-0">
                    <button
                      type="button"
                      className="btn-primary flex items-center gap-2"
                      disabled={serviceContratoSaving}
                      onClick={saveServiceContrato}
                    >
                      <MdSave /> {serviceContratoSaving ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {(tab === 'sunat_bot' || tab === 'pago_uso_sistema') && (
          <MasterRestaurantBillingWorkspace active={tab === 'sunat_bot' ? 'sunat' : 'pago_uso'} />
        )}

        {tab === 'facturacion' && (
          <div className="card">
            <h2 className="font-semibold rf-section-title mb-2">Fecha de facturación y bloqueo automático</h2>
            <p className="text-xs ui-text-muted mb-3">
              La fecha es la <strong>ancla del ciclo</strong> (p. ej. día de venta o alta). No exige pago ese mismo día: los avisos y el bloqueo automático por mora se calculan contra la <strong>próxima fecha de cobro</strong> (Pago por uso → próxima facturación, según periodo mensual o semestral).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Fecha de referencia del ciclo</label>
                <input className="input-field" type="date" value={control.billing_date || ''} onChange={(e) => setDashboard((p) => ({ ...p, control: { ...(p?.control || {}), billing_date: e.target.value } }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Avisar antes (días)</label>
                <input className="input-field" type="number" min="1" max="30" value={control.notify_days_before ?? 5} onChange={(e) => setDashboard((p) => ({ ...p, control: { ...(p?.control || {}), notify_days_before: Number(e.target.value || 5) } }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Bloqueo automático por mora</label>
                <select className="input-field" value={Number(control.auto_block_on_overdue || 0) === 1 ? '1' : '0'} onChange={(e) => setDashboard((p) => ({ ...p, control: { ...(p?.control || {}), auto_block_on_overdue: Number(e.target.value) } }))}>
                  <option value="1">Activo</option>
                  <option value="0">Inactivo</option>
                </select>
              </div>
            </div>
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold rf-section-title mb-2">Consultas DNI / RUC (padrón en caja)</h3>
              <p className="text-xs ui-text-muted mb-3">
                Por defecto no hay límite. Si indica un número, el sistema permitirá como máximo esa cantidad de consultas exitosas al mes (zona horaria
                Lima). El contador se muestra al personal en la caja.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Límite mensual (vacío = ilimitado)</label>
                  <input
                    className="input-field"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="Sin límite"
                    value={
                      control.padron_monthly_query_limit === null ||
                      control.padron_monthly_query_limit === undefined ||
                      control.padron_monthly_query_limit === ''
                        ? ''
                        : String(control.padron_monthly_query_limit)
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setDashboard((p) => ({
                        ...p,
                        control: {
                          ...(p?.control || {}),
                          padron_monthly_query_limit: raw === '' ? null : Math.max(1, parseInt(raw, 10) || 1),
                        },
                      }));
                    }}
                  />
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-[var(--ui-muted)]">
                  Uso este mes (Lima):{' '}
                  <strong>
                    {(() => {
                      const lim = control.padron_monthly_query_limit;
                      const used =
                        String(control.padron_query_usage_month || '').trim() ===
                        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit' })
                          .format(new Date())
                          .slice(0, 7)
                          ? Number(control.padron_query_usage_count || 0)
                          : 0;
                      return lim == null || lim === '' ? `${used} (sin tope)` : `${used} / ${lim}`;
                    })()}
                  </strong>
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="btn-primary flex items-center gap-2"
                onClick={() =>
                  updateControl(
                    {
                      billing_date: control.billing_date || '',
                      notify_days_before: Number(control.notify_days_before || 5),
                      auto_block_on_overdue: Number(control.auto_block_on_overdue || 0),
                      padron_monthly_query_limit: control.padron_monthly_query_limit,
                    },
                    'Parámetros de facturación guardados'
                  )
                }
              >
                <MdSave /> Guardar facturación
              </button>
            </div>
          </div>
        )}

        {tab === 'respaldo' && (
          <div className="max-w-3xl">
            <MasterRestaurantBackupPanel
              textTone="slate"
              cardClassName="card space-y-4"
              onAfterMutate={() => {
                window.location.reload();
              }}
            />
          </div>
        )}

        {tab === 'notificaciones' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="font-semibold rf-section-title mb-3">Publicar notificación para administradores</h2>
              <form onSubmit={sendNotification} className="space-y-3">
                <input className="input-field" placeholder="Título" value={notifyForm.title} onChange={(e) => setNotifyForm((p) => ({ ...p, title: e.target.value }))} required />
                <textarea className="input-field" rows={4} placeholder="Mensaje" value={notifyForm.message} onChange={(e) => setNotifyForm((p) => ({ ...p, message: e.target.value }))} required />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Duración</label>
                    <input
                      type="number"
                      min="1"
                      className="input-field"
                      value={notifyForm.duration_value}
                      onChange={(e) => setNotifyForm((p) => ({ ...p, duration_value: Number(e.target.value || 1) }))}
                      disabled={notifyForm.no_expiry}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Unidad</label>
                    <select
                      className="input-field"
                      value={notifyForm.duration_unit}
                      onChange={(e) => setNotifyForm((p) => ({ ...p, duration_unit: e.target.value }))}
                      disabled={notifyForm.no_expiry}
                    >
                      <option value="hours">Horas (ej. 1h, 5h)</option>
                      <option value="days">Días</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="inline-flex items-center gap-2 text-sm text-[var(--ui-body-text)]">
                      <input
                        type="checkbox"
                        checked={notifyForm.no_expiry}
                        onChange={(e) => setNotifyForm((p) => ({ ...p, no_expiry: e.target.checked }))}
                      />
                      Sin vencimiento
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Imagen (opcional)</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => uploadImage(e.target.files?.[0])} />
                  {uploadingImage && <p className="text-xs ui-text-muted mt-1">Subiendo imagen...</p>}
                  {notifyForm.image_url && <p className="text-xs text-emerald-700 mt-1">Imagen cargada: {notifyForm.image_url}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={previewDraftNotification} className="btn-secondary">Mostrar en pantalla</button>
                  <button type="submit" className="btn-primary flex items-center gap-2"><MdUpload /> Publicar notificación</button>
                </div>
              </form>
            </div>
            <div className="card">
              <h3 className="font-semibold rf-section-title mb-2">Historial de notificaciones</h3>
              <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
                {notifications.map((n) => (
                  <div key={n.id} className="border rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm text-slate-800">{n.title}</p>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setPreviewNotification(n)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs text-slate-700">Mostrar</button>
                        <button type="button" onClick={() => openEditNotification(n)} className="p-2 rounded bg-sky-50 hover:bg-sky-100 text-sky-700" aria-label="Editar notificación"><MdEdit /></button>
                        <button
                          type="button"
                          onClick={() => setNotificationToDelete(n)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700 border border-red-200"
                          aria-label="Eliminar notificación"
                        >
                          <MdDelete className="text-sm shrink-0" />
                          Eliminar
                        </button>
                      </div>
                    </div>
                    <p className="text-xs ui-text-muted mb-2">{new Date(n.created_at).toLocaleString('es-PE')} · {n.created_by}</p>
                    <p className={`text-xs mb-2 ${n.expires_at && new Date(n.expires_at).getTime() <= Date.now() ? 'text-red-600' : 'text-emerald-600'}`}>{getRemainingLabel(n.expires_at)}</p>
                    {n.image_url ? (
                      <div className="mb-2 rounded-lg border border-slate-200 bg-white overflow-hidden">
                        <img
                          src={resolveMediaUrl(n.image_url)}
                          alt={n.title}
                          className="w-full h-auto max-h-[min(40vh,280px)] object-contain object-center block"
                        />
                      </div>
                    ) : null}
                    <p className="text-sm text-[var(--ui-body-text)]">{n.message}</p>
                  </div>
                ))}
                {notifications.length === 0 && <p className="text-sm ui-text-muted">No hay notificaciones publicadas.</p>}
              </div>
            </div>
          </div>
        )}

        {tab === 'bloqueo' && (
          <div className="card">
            <h2 className="font-semibold rf-section-title mb-3">Bloqueo total del sistema</h2>
            <div className={`rounded-lg border p-3 mb-3 ${lockEnabled ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              Estado actual: <strong>{lockEnabled ? 'BLOQUEADO' : 'OPERATIVO'}</strong>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Motivo de bloqueo</label>
                <input className="input-field" value={control.global_lock_reason || ''} onChange={(e) => setDashboard((p) => ({ ...p, control: { ...(p?.control || {}), global_lock_reason: e.target.value } }))} />
              </div>
              <div className="flex items-end gap-2">
                <button
                  className={`px-4 py-2 rounded-lg text-white font-medium ${lockEnabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
                  onClick={() => updateControl({ global_lock_enabled: lockEnabled ? 0 : 1, global_lock_reason: control.global_lock_reason || 'Bloqueo por falta de pago' }, lockEnabled ? 'Sistema desbloqueado' : 'Sistema bloqueado')}
                >
                  {lockEnabled ? 'Desactivar bloqueo' : 'Activar "bloqueo por falta de pago"'}
                </button>
              </div>
            </div>
            <p className="text-xs ui-text-muted mt-3">Cuando está activo, ningún usuario estándar podrá ingresar ni operar hasta que lo desactives.</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowMasterAccessModal(true)}
        className="fixed bottom-6 right-6 z-40 px-4 py-3 rounded-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-lg flex items-center gap-2"
      >
        <MdManageAccounts />
        Acceso maestro
      </button>

      <Modal isOpen={showMasterAccessModal} onClose={() => setShowMasterAccessModal(false)} title="Acceso administrador maestro">
        <form onSubmit={updateMasterCredentials} className="space-y-3">
          <div className="rounded-lg bg-slate-50 border px-3 py-2 text-sm">
            <strong>Usuario actual:</strong> {creds.username}
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Contraseña actual *</label>
            <input
              type="password"
              className="input-field"
              value={masterCredForm.current_password}
              onChange={(e) => setMasterCredForm((p) => ({ ...p, current_password: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nuevo usuario (opcional)</label>
            <input
              className="input-field"
              value={masterCredForm.new_username}
              onChange={(e) => setMasterCredForm((p) => ({ ...p, new_username: e.target.value }))}
              placeholder="Deja vacío para mantener actual"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nueva contraseña (opcional)</label>
            <input
              type="password"
              className="input-field"
              value={masterCredForm.new_password}
              onChange={(e) => setMasterCredForm((p) => ({ ...p, new_password: e.target.value }))}
              placeholder="Deja vacío para mantener actual"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Confirmar nueva contraseña</label>
            <input
              type="password"
              className="input-field"
              value={masterCredForm.confirm_password}
              onChange={(e) => setMasterCredForm((p) => ({ ...p, confirm_password: e.target.value }))}
              placeholder="Solo si cambias contraseña"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowMasterAccessModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary flex items-center gap-2"><MdSave /> Guardar credenciales</button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showCreateBuyerModal}
        onClose={() => {
          setShowCreateBuyerModal(false);
          setShowBuyerPassword(false);
        }}
        title="Crear administrador dueño del negocio"
      >
        <form onSubmit={createAdminBuyer} className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input-field" placeholder="Usuario" value={adminForm.username} onChange={(e) => setAdminForm((p) => ({ ...p, username: e.target.value }))} required />
          <input className="input-field" placeholder="Nombre completo" value={adminForm.full_name} onChange={(e) => setAdminForm((p) => ({ ...p, full_name: e.target.value }))} required />
          <input className="input-field md:col-span-2" type="email" placeholder="Email" value={adminForm.email} onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))} required />
          <div className="md:col-span-2 relative">
            <input
              className="input-field pr-10"
              type={showBuyerPassword ? 'text' : 'password'}
              placeholder="Contraseña"
              value={adminForm.password}
              onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))}
              required
            />
            <button
              type="button"
              onClick={() => setShowBuyerPassword((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 ui-text-muted hover:text-slate-700"
              aria-label={showBuyerPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showBuyerPassword ? <MdVisibilityOff /> : <MdVisibility />}
            </button>
          </div>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreateBuyerModal(false)}>Cancelar</button>
            <button className="btn-primary flex items-center justify-center gap-2" type="submit"><MdAdd /> Crear administrador dueño</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showEditNotificationModal} onClose={() => setShowEditNotificationModal(false)} title="Editar notificación">
        <form onSubmit={submitEditNotification} className="space-y-3">
          <input className="input-field" placeholder="Título" value={editNotifyForm.title} onChange={(e) => setEditNotifyForm((p) => ({ ...p, title: e.target.value }))} required />
          <textarea className="input-field" rows={4} placeholder="Mensaje" value={editNotifyForm.message} onChange={(e) => setEditNotifyForm((p) => ({ ...p, message: e.target.value }))} required />
          <input className="input-field" placeholder="URL de imagen (opcional)" value={editNotifyForm.image_url} onChange={(e) => setEditNotifyForm((p) => ({ ...p, image_url: e.target.value }))} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Duración</label>
              <input
                type="number"
                min="1"
                className="input-field"
                value={editNotifyForm.duration_value}
                onChange={(e) => setEditNotifyForm((p) => ({ ...p, duration_value: Number(e.target.value || 1) }))}
                disabled={editNotifyForm.no_expiry}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Unidad</label>
              <select
                className="input-field"
                value={editNotifyForm.duration_unit}
                onChange={(e) => setEditNotifyForm((p) => ({ ...p, duration_unit: e.target.value }))}
                disabled={editNotifyForm.no_expiry}
              >
                <option value="hours">Horas</option>
                <option value="days">Días</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--ui-body-text)]">
                <input
                  type="checkbox"
                  checked={editNotifyForm.no_expiry}
                  onChange={(e) => setEditNotifyForm((p) => ({ ...p, no_expiry: e.target.checked }))}
                />
                Sin vencimiento
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowEditNotificationModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary flex items-center gap-2"><MdSave /> Guardar cambios</button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!notificationToDelete}
        onClose={() => {
          if (!deleteNotifyBusy) setNotificationToDelete(null);
        }}
        title="Eliminar notificación"
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <strong className="font-semibold">Aviso:</strong> asegúrese de haber comprendido el mensaje antes de eliminarlo, porque{' '}
            <strong>no podrá recuperarlo</strong> ni restaurarlo desde el sistema.
          </div>
          {notificationToDelete ? (
            <p className="text-sm text-[#D1D5DB]">
              Se eliminará de forma permanente la notificación «<span className="font-semibold text-[var(--ui-body-text)]">{notificationToDelete.title}</span>».
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" disabled={deleteNotifyBusy} onClick={() => setNotificationToDelete(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={deleteNotifyBusy}
              onClick={() => void confirmDeleteNotification()}
            >
              {deleteNotifyBusy ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Eliminando…
                </>
              ) : (
                <>
                  <MdDelete className="text-lg" />
                  Sí, eliminar
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showEditBuyerModal} onClose={() => setShowEditBuyerModal(false)} title="Editar administrador dueño">
        <form onSubmit={submitEditBuyer} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Usuario</label>
            <input className="input-field" value={editBuyerForm.username} onChange={(e) => setEditBuyerForm((p) => ({ ...p, username: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre completo</label>
            <input className="input-field" value={editBuyerForm.full_name} onChange={(e) => setEditBuyerForm((p) => ({ ...p, full_name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Email</label>
            <input type="email" className="input-field" value={editBuyerForm.email} onChange={(e) => setEditBuyerForm((p) => ({ ...p, email: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nueva contraseña (opcional)</label>
            <div className="relative">
              <input
                className="input-field pr-10"
                type={showEditBuyerPassword ? 'text' : 'password'}
                value={editBuyerForm.password}
                onChange={(e) => setEditBuyerForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="Dejar vacío para mantener la actual"
              />
              <button
                type="button"
                onClick={() => setShowEditBuyerPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 ui-text-muted hover:text-slate-700"
                aria-label={showEditBuyerPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showEditBuyerPassword ? <MdVisibilityOff /> : <MdVisibility />}
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setShowEditBuyerModal(false)}>Cancelar</button>
            <button type="submit" className="btn-primary flex items-center gap-2"><MdSave /> Guardar</button>
          </div>
        </form>
      </Modal>

      {previewNotification && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setPreviewNotification(null)} />
          <aside className="fixed top-0 right-0 h-screen w-full md:w-1/2 bg-white z-50 shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold rf-section-title">Vista previa de notificación</h3>
              <button
                type="button"
                onClick={() => setPreviewNotification(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-[var(--ui-muted)]"
                aria-label="Cerrar vista previa"
              >
                <MdClose className="text-xl" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <h4 className="text-2xl font-bold rf-page-title mb-2">{previewNotification.title}</h4>
              <p className="text-sm ui-text-muted mb-4">
                {new Date(previewNotification.created_at).toLocaleString('es-PE')} · {previewNotification.created_by}
              </p>
              <p className="text-sm text-[var(--ui-muted)] mb-4">{getRemainingLabel(previewNotification.expires_at)}</p>
              {previewNotification.image_url ? (
                <div className="mb-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <img
                    src={resolveMediaUrl(previewNotification.image_url)}
                    alt={previewNotification.title}
                    className="w-full h-auto max-h-[min(50vh,420px)] object-contain object-center block"
                  />
                </div>
              ) : (
                <p className="mb-4 text-sm text-[var(--ui-muted)]">Esta notificación no tiene imagen.</p>
              )}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800 text-base leading-relaxed whitespace-pre-wrap">
                {previewNotification.message}
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
