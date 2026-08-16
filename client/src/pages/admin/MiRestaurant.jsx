import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocket } from '../../hooks/useSocket';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import RestaurantServiceContractForm, { normalizeContratoFromApi } from '../../components/RestaurantServiceContractForm';
import { api, resolveMediaUrl } from '../../utils/api';
import { proximaFechaFromControlAnchor } from '../../utils/nextBillingFromAnchor';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import MasterRestaurantBackupPanel from '../../components/master/MasterRestaurantBackupPanel';
import BillingSunatManualForm from '../../components/billing/BillingSunatManualForm';
import { defaultBillingPanel, defaultBillingPanelPresence } from '../../data/sunat47Catalog';
import { defaultMiRestaurantProfile, mergeMiRestaurantProfile } from '../../data/miRestaurantProfileDefaults';
import MiRestaurantEmpresaHub from '../../components/miRestaurant/MiRestaurantEmpresaHub';
import { isDeliveryEnabledValue, notifyDeliveryEnabledChanged } from '../../hooks/useDeliveryEnabled';
import { MdSave, MdReceipt, MdPayment, MdUpload, MdPeople, MdHistory } from 'react-icons/md';

const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const DAY_NAMES = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo' };
function pagoHistorialEstadoLabel(estado) {
  const e = String(estado || '').toLowerCase();
  if (e === 'approved' || e === 'aprobado') return 'Aprobado';
  if (e === 'pending' || e === 'pendiente') return 'Pendiente';
  if (e === 'rejected' || e === 'rechazado') return 'Rechazado';
  return estado || '—';
}

const MI_RESTAURANT_VIEWS = [
  { id: 'mi_empresa', label: 'Mi empresa' },
  { id: 'facturacion_electronica', label: 'Facturación electrónica' },
  { id: 'pagos_sistema', label: 'Pagos de créditos' },
  { id: 'contrato', label: 'Contrato del servicio' },
  { id: 'pago_uso_sistema', label: 'Pago por uso del sistema' },
  { id: 'informacion', label: 'Información' },
];

export default function MiRestaurant() {
  const { user } = useAuth();
  const isMasterAdmin = user?.role === 'master_admin';
  const subMr = user?.sub_permissions?.mi_restaurant || {};
  const planAllowsSunatView =
    isMasterAdmin || (user?.service_plan === 'profesional' && subMr.facturacion_electronica !== false);
  const miRestaurantViewsForPlan = (() => {
    let v = planAllowsSunatView
      ? MI_RESTAURANT_VIEWS
      : MI_RESTAURANT_VIEWS.filter((x) => x.id !== 'facturacion_electronica');
    if (!isMasterAdmin) {
      v = v.filter((x) => x.id !== 'informacion');
    }
    v = v.filter((x) => subMr[x.id] !== false);
    return v;
  })();
  const isRestaurantAdmin = user?.role === 'admin';
  const canEditContrato = isMasterAdmin;
  /** Bot SUNAT + series contingencia + URL bot: maestro, o admin si el maestro lo habilitó en el control. */
  const canEditBillingMaster = isMasterAdmin;
  const [allowRestaurantAdminBillingBot, setAllowRestaurantAdminBillingBot] = useState(false);
  const canEditBillingBot = isMasterAdmin || (isRestaurantAdmin && allowRestaurantAdminBillingBot);
  /** Comprobante de pago por uso: maestro o admin del restaurante. */
  const canEditPagoUsoComprobante = isMasterAdmin || isRestaurantAdmin;
  const [searchParams, setSearchParams] = useSearchParams();
  const comprobanteUsoInputRef = useRef(null);
  const [restaurant, setRestaurant] = useState(null);
  const [profile, setProfile] = useState(() => defaultMiRestaurantProfile());
  const [empresaTab, setEmpresaTab] = useState('info');
  const [autosaveStatus, setAutosaveStatus] = useState('');
  const autosaveTimerRef = useRef(null);
  const skipAutosaveRef = useRef(true);
  const [billingConfig, setBillingConfig] = useState({
    billing_api_url: '',
    billing_api_token: '',
    has_billing_api_token: false,
    billing_api_url_from_env: false,
    billing_api_secret_from_env: false,
    billing_offline_mode: 1,
    billing_auto_retry_enabled: 1,
    billing_auto_retry_interval_sec: 120,
  });
  const initialViewParam = searchParams.get('view') || 'mi_empresa';
  const [activeView, setActiveView] = useState(
    initialViewParam === 'series_contingencia' ? 'facturacion_electronica' : initialViewParam
  );
  const [appConfig, setAppConfig] = useState({
    regional: { country: 'Peru', timezone: 'America/Lima', language: 'es', date_format: 'DD/MM/YYYY' },
    pagos_sistema: {
      acepta_efectivo: 1,
      acepta_tarjeta: 1,
      acepta_yape: 1,
      acepta_plin: 1,
      requiere_referencia_digital: 0,
      propina_sugerida_pct: 10,
      tolerancia_diferencia_caja: 2,
      dias_max_credito: 15,
      monto_max_credito: 500,
      notificar_mora: 1,
      texto_politica_cobro: 'Todo crédito debe regularizarse dentro del plazo acordado.',
    },
    series_contingencia: { boleta: 'BC01', factura: 'FC01', enabled: 1 },
    contrato: {
      texto_contrato: '',
      documento_word_url: '',
      documento_word_nombre: '',
      firma_comprador_url: '',
      firma_vendedor_url: '',
    },
    pago_uso_sistema: {
      periodo_facturacion: 'mensual',
      fecha_proxima_facturacion: '',
      numero_cuenta: '',
      nombre_empresa_cobro: '',
      comprobante_pago_url: '',
      monto_comprobante: '',
      comprobante_grace_days_after_due: 3,
    },
  });

  /** Fecha de facturación del control maestro (ancla para próxima fecha de pago por uso). */
  const [billingAnchorDate, setBillingAnchorDate] = useState('');
  /** Ventana de carga del comprobante (servidor): enlazada a fecha_proxima_facturación y días de gracia. */
  const [pagoUsoComprobanteUi, setPagoUsoComprobanteUi] = useState(null);
  const pagoUsoHistorialRows = useMemo(() => {
    const historial = pagoUsoComprobanteUi?.platform_payment?.historial;
    if (!Array.isArray(historial)) return [];
    return historial.filter((h) => {
      const url = String(h?.comprobante_pago_url || h?.voucher || '').trim();
      return Boolean(url);
    });
  }, [pagoUsoComprobanteUi]);
  const [centralResyncBusy, setCentralResyncBusy] = useState(false);
  const [enviarComprobanteBusy, setEnviarComprobanteBusy] = useState(false);
  const [comprobanteUploadBusy, setComprobanteUploadBusy] = useState(false);
  const [pagoHistorialAbierto, setPagoHistorialAbierto] = useState(false);
  const [billingPanel, setBillingPanel] = useState(() => defaultBillingPanel());
  const [billingPanelPresence, setBillingPanelPresence] = useState(() => defaultBillingPanelPresence());
  const [staffUsers, setStaffUsers] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [payrollInvestModal, setPayrollInvestModal] = useState(null);
  const [payrollHours, setPayrollHours] = useState('');
  const [payrollConcept, setPayrollConcept] = useState('');
  const [payrollInvestBusy, setPayrollInvestBusy] = useState(false);

  const canReadBillingConfig = user?.role === 'admin' || user?.role === 'master_admin';

  const handleBillingCertUpload = useCallback(async (file) => {
    const r = await api.uploadBillingCert(file);
    setBillingPanel((p) => ({ ...p, cert_pfx_path: r.url }));
  }, []);

  const syncPagoUsoAppConfigFromServer = useCallback(async () => {
    try {
      const appCfg = await api.get('/admin-modules/config/app');
      const pago = appCfg?.pago_uso_sistema;
      if (!pago || typeof pago !== 'object') return;
      setAppConfig((prev) => {
        const merged = { ...(prev.pago_uso_sistema || {}), ...pago };
        if (!String(merged.comprobante_pago_url || '').trim()) {
          merged.monto_comprobante = '';
        }
        return { ...prev, pago_uso_sistema: merged };
      });
    } catch (_) {
      /* opcional */
    }
  }, []);

  const refreshPagoUsoComprobanteSchedule = useCallback(async () => {
    if (!canReadBillingConfig) return;
    try {
      await api.get('/platform-payments/status').catch(() => null);
      const s = await api.get('/master-admin/billing-schedule');
      setPagoUsoComprobanteUi(s?.pago_uso_comprobante || null);
      await syncPagoUsoAppConfigFromServer();
    } catch (_) {
      setPagoUsoComprobanteUi(null);
    }
  }, [canReadBillingConfig, syncPagoUsoAppConfigFromServer]);

  useEffect(() => {
    if (activeView !== 'pago_uso_sistema' || !canReadBillingConfig) return undefined;
    refreshPagoUsoComprobanteSchedule();
    const timer = setInterval(() => {
      refreshPagoUsoComprobanteSchedule();
    }, 60000);
    return () => clearInterval(timer);
  }, [activeView, canReadBillingConfig, refreshPagoUsoComprobanteSchedule]);

  const resyncCentralPayment = useCallback(async () => {
    if (!canReadBillingConfig) return;
    setCentralResyncBusy(true);
    try {
      await api.post('/platform-payments/resync');
      await refreshPagoUsoComprobanteSchedule();
    } catch (_) {
      /* mensaje amigable vía platform_payment */
    } finally {
      setCentralResyncBusy(false);
    }
  }, [canReadBillingConfig, refreshPagoUsoComprobanteSchedule]);

  const quitarComprobantePagoUso = useCallback(async () => {
    if (!canEditPagoUsoComprobante) {
      toast.error('No tienes permiso para quitar el comprobante.');
      return;
    }
    try {
      const res = await api.post('/platform-payments/clear');
      setAppConfig((prev) => ({
        ...prev,
        pago_uso_sistema: {
          ...(prev.pago_uso_sistema || {}),
          comprobante_pago_url: '',
          monto_comprobante: '',
        },
      }));
      await refreshPagoUsoComprobanteSchedule();
      if (res?.ok === false && res?.central_user_message) {
        toast.error(res.central_user_message);
      } else {
        toast.success('Comprobante quitado. Puede cargar otro archivo.');
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo quitar el comprobante.');
    }
  }, [canEditPagoUsoComprobante, refreshPagoUsoComprobanteSchedule]);

  const enviarComprobanteAlPanel = useCallback(async () => {
    if (!canEditPagoUsoComprobante) {
      toast.error('No tienes permiso para enviar el comprobante.');
      return;
    }
    const url = String(appConfig.pago_uso_sistema?.comprobante_pago_url || '').trim();
    if (!url) {
      toast.error('Cargue primero una imagen o PDF del comprobante.');
      return;
    }
    const monto = Number(appConfig.pago_uso_sistema?.monto_comprobante);
    if (!Number.isFinite(monto) || monto <= 0) {
      toast.error('Indique el monto pagado (S/) mayor a cero antes de enviar el comprobante.');
      return;
    }
    setEnviarComprobanteBusy(true);
    try {
      const res = await api.post('/platform-payments/submit', { comprobanteUrl: url, monto });
      await refreshPagoUsoComprobanteSchedule();
      if (res?.central_user_message && !res?.ok) {
        toast.error(res.central_user_message);
      } else {
        toast.success(res?.central_user_message || 'Comprobante enviado. Pendiente de aprobación.');
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar el comprobante.');
    } finally {
      setEnviarComprobanteBusy(false);
    }
  }, [
    canEditPagoUsoComprobante,
    appConfig.pago_uso_sistema?.comprobante_pago_url,
    appConfig.pago_uso_sistema?.monto_comprobante,
    refreshPagoUsoComprobanteSchedule,
  ]);

  const loadInitialData = useCallback(() => {
    const schedulePromise = canReadBillingConfig
      ? api.get('/master-admin/billing-schedule').catch(() => null)
      : Promise.resolve(null);
    return Promise.all([
      api.get('/restaurant'),
      canReadBillingConfig ? api.get('/billing/config').catch(() => null) : Promise.resolve(null),
      api.get('/admin-modules/config/app').catch(() => null),
      schedulePromise,
    ])
      .then(([restaurantData, billingData, appCfg, schedule]) => {
        const data = restaurantData || {};
        if (!data.schedule || typeof data.schedule !== 'object') data.schedule = {};
        DAYS.forEach(d => { if (!data.schedule[d]) data.schedule[d] = { open: '11:00', close: '23:00', enabled: true }; });
        setRestaurant(data);
        notifyDeliveryEnabledChanged(isDeliveryEnabledValue(data?.delivery_enabled));
        setProfile(mergeMiRestaurantProfile(defaultMiRestaurantProfile(), data.profile || data.profile_effective || {}));
        skipAutosaveRef.current = true;
        if (data?.billing_panel && typeof data.billing_panel === 'object') {
          setBillingPanel({ ...defaultBillingPanel(), ...data.billing_panel });
        } else {
          setBillingPanel(defaultBillingPanel());
        }
        setBillingPanelPresence(
          data?.billing_panel_presence && typeof data.billing_panel_presence === 'object'
            ? { ...defaultBillingPanelPresence(), ...data.billing_panel_presence }
            : defaultBillingPanelPresence()
        );
        if (billingData) {
          setAllowRestaurantAdminBillingBot(Boolean(billingData.allow_restaurant_admin_billing_bot));
          setBillingConfig(prev => ({
            ...prev,
            billing_api_url: billingData.billing_api_url || '',
            has_billing_api_token: Boolean(billingData.has_billing_api_token),
            billing_api_url_from_env: Boolean(billingData.billing_api_url_from_env),
            billing_api_secret_from_env: Boolean(billingData.billing_api_secret_from_env),
            billing_offline_mode: Number(billingData.billing_offline_mode ?? 1),
            billing_auto_retry_enabled: Number(billingData.billing_auto_retry_enabled ?? 1),
            billing_auto_retry_interval_sec: Number(billingData.billing_auto_retry_interval_sec || 120),
            billing_api_token: '',
          }));
        } else {
          setAllowRestaurantAdminBillingBot(false);
        }
        if (schedule?.billing_date) {
          setBillingAnchorDate(String(schedule.billing_date).trim());
        } else {
          setBillingAnchorDate('');
        }
        if (schedule?.pago_uso_comprobante) {
          setPagoUsoComprobanteUi(schedule.pago_uso_comprobante);
        } else {
          setPagoUsoComprobanteUi(null);
        }
        if (appCfg && typeof appCfg === 'object') {
          setAppConfig((prev) => {
            let next = { ...prev, ...appCfg };
            if (appCfg.contrato && typeof appCfg.contrato === 'object') {
              next.contrato = normalizeContratoFromApi(appCfg.contrato);
            }
            const anchor = String(schedule?.billing_date || '').trim();
            const p = next.pago_uso_sistema || {};
            if (
              isMasterAdmin
              && anchor
              && /^\d{4}-\d{2}-\d{2}$/.test(anchor)
              && !String(p.fecha_proxima_facturacion || '').trim()
            ) {
              const per = p.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
              next = {
                ...next,
                pago_uso_sistema: {
                  ...p,
                  fecha_proxima_facturacion: proximaFechaFromControlAnchor(anchor, per),
                },
              };
            }
            return next;
          });
        }
      })
      .catch(console.error);
  }, [canReadBillingConfig, isMasterAdmin]);

  useEffect(() => {
    if (!user?.role) return;
    loadInitialData();
  }, [user?.role, user?.id, loadInitialData]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'app_config') void loadInitialData();
  });

  useEffect(() => {
    const requestedView = searchParams.get('view');

    if (requestedView === 'series_contingencia') {
      if (!planAllowsSunatView) {
        setActiveView('mi_empresa');
        setSearchParams({ view: 'mi_empresa' }, { replace: true });
        return;
      }
      setActiveView('facturacion_electronica');
      setSearchParams({ view: 'facturacion_electronica' }, { replace: true });
      return;
    }
    const isValidView = miRestaurantViewsForPlan.some(option => option.id === requestedView);
    if (isValidView && requestedView !== activeView) {
      setActiveView(requestedView);
      return;
    }
    if (!isValidView) {
      if (activeView !== 'mi_empresa') setActiveView('mi_empresa');
      if (requestedView && requestedView !== 'mi_empresa') {
        setSearchParams({ view: 'mi_empresa' }, { replace: true });
      } else if (!requestedView) {
        setSearchParams({ view: 'mi_empresa' }, { replace: true });
      }
    }
  }, [activeView, searchParams, setSearchParams, miRestaurantViewsForPlan, planAllowsSunatView]);

  const save = async () => {
    try {
      if (activeView === 'contrato' && !canEditContrato) {
        toast.error('Solo el administrador maestro puede guardar el contrato.');
        return;
      }
      if (activeView === 'facturacion_electronica') {
        if (!canEditBillingBot) {
          toast.error(
            'No tiene permiso para guardar el bot de facturación. El administrador maestro debe activar la edición para administradores del restaurante, o guardar él mismo esta sección.'
          );
          return;
        }
        const savedRestaurant = await api.put('/restaurant', { ...restaurant, billing_panel: billingPanel });
        setRestaurant(savedRestaurant);
        if (savedRestaurant?.billing_panel && typeof savedRestaurant.billing_panel === 'object') {
          setBillingPanel({ ...defaultBillingPanel(), ...savedRestaurant.billing_panel });
        }
        if (savedRestaurant?.billing_panel_presence && typeof savedRestaurant.billing_panel_presence === 'object') {
          setBillingPanelPresence({ ...defaultBillingPanelPresence(), ...savedRestaurant.billing_panel_presence });
        }
        const saved = await api.put('/billing/config', {
          billing_offline_mode: billingConfig.billing_offline_mode,
          billing_auto_retry_enabled: billingConfig.billing_auto_retry_enabled,
          billing_auto_retry_interval_sec: billingConfig.billing_auto_retry_interval_sec,
        });
        setBillingConfig(prev => ({
          ...prev,
          billing_api_url: saved.billing_api_url || '',
          has_billing_api_token: Boolean(saved.has_billing_api_token),
          billing_api_url_from_env: Boolean(saved.billing_api_url_from_env),
          billing_api_secret_from_env: Boolean(saved.billing_api_secret_from_env),
          billing_offline_mode: Number(saved.billing_offline_mode ?? 1),
          billing_auto_retry_enabled: Number(saved.billing_auto_retry_enabled ?? 1),
          billing_auto_retry_interval_sec: Number(saved.billing_auto_retry_interval_sec || 120),
          billing_api_token: '',
        }));
        const sc = appConfig.series_contingencia || {};
        const seriesContingenciaPayload = {
          boleta: String(sc.boleta || '').trim().toUpperCase(),
          factura: String(sc.factura || '').trim().toUpperCase(),
          enabled: Number(sc.enabled) ? 1 : 0,
        };
        const savedApp = await api.put('/admin-modules/config/app', { series_contingencia: seriesContingenciaPayload });
        setAppConfig((prev) => ({ ...prev, ...savedApp }));
        toast.success('Facturación SUNAT (emisor, series, contingencia y bot) guardada');
        return;
      }
      if (activeView !== 'mi_empresa') {
        const key = activeView;
        if (key === 'pagos_sistema') {
          const pagos = appConfig.pagos_sistema || {};
          const sanitizePercent = (value, fallback) => {
            const parsed = Number(value);
            if (Number.isNaN(parsed)) return fallback;
            return Math.min(100, Math.max(0, parsed));
          };
          const sanitizeNumber = (value, fallback) => {
            const parsed = Number(value);
            if (Number.isNaN(parsed)) return fallback;
            return Math.max(0, parsed);
          };
          const payload = {
            ...pagos,
            propina_sugerida_pct: sanitizePercent(pagos.propina_sugerida_pct, 0),
            tolerancia_diferencia_caja: sanitizeNumber(pagos.tolerancia_diferencia_caja, 0),
            dias_max_credito: Math.round(sanitizeNumber(pagos.dias_max_credito, 0)),
            monto_max_credito: sanitizeNumber(pagos.monto_max_credito, 0),
          };
          const saved = await api.put('/admin-modules/config/app', { [key]: payload });
          setAppConfig(prev => ({ ...prev, ...saved }));
          toast.success('Configuración de pagos de crédito guardada');
          return;
        }
        if (key === 'pago_uso_sistema') {
          if (canEditBillingMaster) {
            const raw = appConfig.pago_uso_sistema || {};
            const periodo = raw.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
            const g = Number(raw.comprobante_grace_days_after_due);
            const grace = Number.isFinite(g) ? Math.max(1, Math.min(14, Math.round(g))) : 3;
            const montoRaw = Number(raw.monto_comprobante);
            const payload = {
              periodo_facturacion: periodo,
              fecha_proxima_facturacion: String(raw.fecha_proxima_facturacion || '').trim().slice(0, 32),
              numero_cuenta: String(raw.numero_cuenta || '').trim(),
              nombre_empresa_cobro: String(raw.nombre_empresa_cobro || '').trim(),
              comprobante_grace_days_after_due: grace,
              ...(Number.isFinite(montoRaw) && montoRaw > 0
                ? { monto_comprobante: Math.round(montoRaw * 100) / 100 }
                : {}),
            };
            const saved = await api.put('/admin-modules/config/app', { pago_uso_sistema: payload });
            setAppConfig(prev => ({ ...prev, ...saved }));
            await refreshPagoUsoComprobanteSchedule();
            toast.success('Datos de facturación guardados');
            return;
          }
          toast.error('Use «Enviar comprobante» para mandar el voucher al panel. «Guardar» es solo para datos de facturación.');
          return;
        }
        if (key === 'contrato') {
          const c = appConfig.contrato || {};
          const payload = {
            texto_contrato: String(c.texto_contrato || ''),
            documento_word_url: String(c.documento_word_url || '').trim(),
            documento_word_nombre: String(c.documento_word_nombre || '').trim(),
            firma_comprador_url: String(c.firma_comprador_url || '').trim(),
            firma_vendedor_url: String(c.firma_vendedor_url || '').trim(),
          };
          const saved = await api.put('/admin-modules/config/app', { contrato: payload });
          setAppConfig(prev => ({ ...prev, ...saved }));
          toast.success('Contrato guardado');
          return;
        }
        const saved = await api.put('/admin-modules/config/app', { [key]: appConfig[key] || {} });
        setAppConfig(prev => ({ ...prev, ...saved }));
        toast.success('Configuración guardada');
        return;
      }
      const saved = await api.put('/restaurant', buildRestaurantPutPayload(restaurant, profile));
      skipAutosaveRef.current = true;
      setRestaurant(saved);
      notifyDeliveryEnabledChanged(isDeliveryEnabledValue(saved?.delivery_enabled));
      if (saved?.profile) setProfile(mergeMiRestaurantProfile(defaultMiRestaurantProfile(), saved.profile));
      toast.success('Guardado correctamente');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const buildRestaurantPutPayload = useCallback((r, profilePayload) => ({
    name: r?.name,
    address: r?.address,
    phone: r?.phone,
    email: r?.email,
    logo: r?.logo,
    tax_rate: r?.tax_rate,
    currency: r?.currency,
    currency_symbol: r?.currency_symbol,
    delivery_enabled: r?.delivery_enabled,
    delivery_fee: r?.delivery_fee,
    delivery_min_order: r?.delivery_min_order,
    delivery_radius_km: r?.delivery_radius_km,
    schedule: r?.schedule,
    company_ruc: r?.company_ruc,
    legal_name: r?.legal_name,
    billing_nombre_comercial: r?.billing_nombre_comercial,
    billing_emisor_ubigeo: r?.billing_emisor_ubigeo,
    billing_emisor_direccion: r?.billing_emisor_direccion,
    billing_emisor_provincia: r?.billing_emisor_provincia,
    billing_emisor_departamento: r?.billing_emisor_departamento,
    billing_emisor_distrito: r?.billing_emisor_distrito,
    billing_series_boleta: r?.billing_series_boleta,
    billing_series_factura: r?.billing_series_factura,
    profile: profilePayload,
  }), []);

  const update = (f, v) => {
    setRestaurant((prev) => {
      const next = { ...(prev || {}), [f]: v };
      if (f === 'billing_emisor_direccion') {
        next.address = v;
      }
      return next;
    });
  };
  const updateBilling = (f, v) => setBillingConfig(prev => ({ ...prev, [f]: v }));
  const updateAppCfg = (section, field, value) => setAppConfig(prev => ({
    ...prev,
    [section]: { ...(prev[section] || {}), [field]: value },
  }));
  const updateSchedule = (day, field, value) => setRestaurant(prev => ({
    ...prev, schedule: { ...prev.schedule, [day]: { ...prev.schedule[day], [field]: value } }
  }));

  const updateProfileSection = (section, field, value) => {
    setProfile((prev) => ({
      ...prev,
      [section]: { ...(prev[section] || {}), [field]: value },
    }));
  };

  const profileValidation = useMemo(() => {
    const errs = [];
    if (!String(restaurant?.name || '').trim()) errs.push('El nombre comercial es obligatorio');
    const ruc = String(restaurant?.company_ruc || '').trim();
    if (ruc && !/^\d{11}$/.test(ruc)) errs.push('RUC: 11 dígitos');
    const email = String(restaurant?.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('Correo no válido');
    return errs;
  }, [restaurant]);

  const persistEmpresaSilent = useCallback(async () => {
    if (!restaurant || profileValidation.length) return;
    setAutosaveStatus('Guardando…');
    try {
      const saved = await api.put('/restaurant', buildRestaurantPutPayload(restaurant, profile));
      skipAutosaveRef.current = true;
      setRestaurant(saved);
      notifyDeliveryEnabledChanged(isDeliveryEnabledValue(saved?.delivery_enabled));
      if (saved?.profile) setProfile(mergeMiRestaurantProfile(defaultMiRestaurantProfile(), saved.profile));
      setAutosaveStatus('Guardado automático');
    } catch (err) {
      setAutosaveStatus('');
      toast.error(err.message || 'No se pudo guardar');
    }
  }, [restaurant, profile, profileValidation, buildRestaurantPutPayload]);

  useEffect(() => {
    if (activeView !== 'mi_empresa' || !restaurant) return undefined;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return undefined;
    }
    if (profileValidation.length) return undefined;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void persistEmpresaSilent();
    }, 2200);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [restaurant, profile, activeView, profileValidation, persistEmpresaSilent]);

  const uploadBranding = async (field, file) => {
    if (!file) return;
    try {
      const uploaded = await api.upload(file);
      const url = uploaded?.url || '';
      updateProfileSection('branding', field, url);
      toast.success('Imagen cargada. Se guardará automáticamente.');
    } catch (err) {
      toast.error(err.message || 'No se pudo subir');
    }
  };

  const patchStaffUser = (id, partial) => {
    setStaffUsers((prev) => prev.map((x) => (x.id === id ? { ...x, ...partial } : x)));
  };

  useEffect(() => {
    if (activeView !== 'mi_empresa' || empresaTab !== 'schedule' || !isRestaurantAdmin) return undefined;
    let cancelled = false;
    setStaffLoading(true);
    api
      .get('/users')
      .then((data) => {
        if (!cancelled) setStaffUsers(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setStaffUsers([]);
      })
      .finally(() => {
        if (!cancelled) setStaffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeView, empresaTab, isRestaurantAdmin]);

  const saveStaffPayroll = async (u) => {
    try {
      await api.put(`/users/${u.id}`, {
        username: u.username,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        phone: u.phone || '',
        is_active: u.is_active,
        caja_station_id: u.caja_station_id || '',
        payroll_pay_mode: u.payroll_pay_mode || '',
        payroll_amount: Number(u.payroll_amount) || 0,
        payroll_schedule_note: u.payroll_schedule_note || '',
        payroll_payment_day: parseInt(u.payroll_payment_day, 10) || 0,
      });
      toast.success(`Nómina guardada · ${u.full_name}`);
    } catch (e) {
      toast.error(e.message || 'No se pudo guardar');
    }
  };

  const submitPayrollInvestment = async () => {
    if (!payrollInvestModal?.id) return;
    try {
      setPayrollInvestBusy(true);
      const body = {};
      if (payrollConcept.trim()) body.concept = payrollConcept.trim();
      if (String(payrollInvestModal.payroll_pay_mode || '').toLowerCase() === 'hora') {
        const h = parseFloat(payrollHours);
        if (!Number.isFinite(h) || h <= 0) {
          toast.error('Indica horas válidas');
          return;
        }
        body.hours = h;
      }
      await api.post(`/users/${payrollInvestModal.id}/payroll-investment`, body);
      toast.success('Pago de nómina sumado a gastos operativos');
      setPayrollInvestModal(null);
      setPayrollHours('');
      setPayrollConcept('');
    } catch (e) {
      toast.error(e.message || 'No se pudo registrar');
    } finally {
      setPayrollInvestBusy(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    try {
      const uploaded = await api.upload(file);
      setRestaurant(prev => ({ ...prev, logo: uploaded?.url || prev.logo || '' }));
      toast.success('Logo cargado correctamente. Guarda para aplicar cambios.');
    } catch (err) {
      toast.error(err.message || 'No se pudo subir el logo');
    }
  };

  const uploadComprobantePagoUso = async (file) => {
    if (!file) return;
    if (!canEditPagoUsoComprobante) {
      toast.error('No tienes permiso para cargar el comprobante.');
      return;
    }
    setComprobanteUploadBusy(true);
    try {
      const uploaded = await api.upload(file);
      const url = uploaded?.url || '';
      if (!url) {
        toast.error('No se recibió la URL del archivo.');
        return;
      }
      const montoRaw = Number(appConfig.pago_uso_sistema?.monto_comprobante);
      const body = { pago_uso_sistema: { comprobante_pago_url: url } };
      if (Number.isFinite(montoRaw) && montoRaw > 0) {
        body.pago_uso_sistema.monto_comprobante = montoRaw;
      }
      const saved = await api.put('/admin-modules/config/app', body);
      setAppConfig((prev) => ({ ...prev, ...saved }));
      await refreshPagoUsoComprobanteSchedule();
      toast.success('Comprobante cargado. Pulse «Enviar comprobante» para mandarlo al panel.');
    } catch (err) {
      toast.error(err.message || 'No se pudo subir el comprobante');
    } finally {
      setComprobanteUploadBusy(false);
      if (comprobanteUsoInputRef.current) comprobanteUsoInputRef.current.value = '';
    }
  };

  if (!restaurant) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;
  const activeViewLabel = miRestaurantViewsForPlan.find(option => option.id === activeView)?.label || 'Mi empresa';
  const showSaveButton =
    activeView !== 'mi_empresa'
    && (activeView !== 'contrato' || canEditContrato)
    && (activeView !== 'facturacion_electronica' || canEditBillingMaster)
    && (activeView !== 'pago_uso_sistema' || canEditBillingMaster);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-[var(--ui-body-text)] rf-module-page-title">Mi Restaurante · {activeViewLabel}</h1>
        {showSaveButton ? (
          <button type="button" onClick={save} className="btn-primary flex items-center gap-2"><MdSave /> Guardar Cambios</button>
        ) : null}
      </div>

      {activeView === 'mi_empresa' && (
        <MiRestaurantEmpresaHub
          tab={empresaTab}
          setTab={setEmpresaTab}
          restaurant={restaurant}
          profile={profile}
          onRestaurantField={update}
          onProfileSection={updateProfileSection}
          onUploadLogoMain={uploadLogo}
          onUploadBranding={uploadBranding}
          validationErrors={profileValidation}
          autosaveStatus={autosaveStatus}
          scheduleSection={(
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div className="card">
            <h3 className="font-bold text-[var(--ui-body-text)] mb-4">Horario de Atención</h3>
            <div className="space-y-3">
              {DAYS.map(day => (
                <div key={day} className="flex items-center gap-4 py-2 border-b border-[color:var(--ui-border)] last:border-0 flex-wrap">
                  <label className="flex items-center gap-2 w-32">
                    <input type="checkbox" checked={restaurant.schedule[day]?.enabled} onChange={e => updateSchedule(day, 'enabled', e.target.checked)} className="rounded text-gold-600" />
                    <span className="font-medium text-sm">{DAY_NAMES[day]}</span>
                  </label>
                  <input type="time" value={restaurant.schedule[day]?.open || '11:00'} onChange={e => updateSchedule(day, 'open', e.target.value)} className="input-field w-auto" disabled={!restaurant.schedule[day]?.enabled} />
                  <span className="text-[var(--ui-muted)]">a</span>
                  <input type="time" value={restaurant.schedule[day]?.close || '23:00'} onChange={e => updateSchedule(day, 'close', e.target.value)} className="input-field w-auto" disabled={!restaurant.schedule[day]?.enabled} />
                </div>
              ))}
            </div>
          </div>

          <div className="card min-h-[200px]">
            <h3 className="font-bold text-[var(--ui-body-text)] mb-4 flex items-center gap-2">
              <MdPeople className="text-gold-600 shrink-0" /> Personal y nómina
            </h3>
            {!isRestaurantAdmin ? (
              <p className="text-sm text-[var(--ui-muted)]">Solo el administrador del restaurante gestiona la nómina aquí.</p>
            ) : staffLoading ? (
              <p className="text-sm text-[var(--ui-muted)]">Cargando usuarios…</p>
            ) : staffUsers.length === 0 ? (
              <p className="text-sm text-[var(--ui-muted)]">No hay usuarios. Créalos en Configuración → Usuarios.</p>
            ) : (
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
                {staffUsers.map((u) => (
                  <div key={u.id} className="border border-[color:var(--ui-border)] rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[var(--ui-body-text)]">{u.full_name}</p>
                        <p className="text-xs text-[var(--ui-muted)]">{u.role} · {u.username}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void saveStaffPayroll(u)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-600 text-white hover:bg-gold-500"
                        >
                          Guardar nómina
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPayrollHours('');
                            setPayrollConcept('');
                            setPayrollInvestModal(u);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                        >
                          Pago → gastos
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-[var(--ui-muted)] mb-0.5">Sueldo por</label>
                        <select
                          className="input-field text-sm"
                          value={u.payroll_pay_mode || ''}
                          onChange={(e) => patchStaffUser(u.id, { payroll_pay_mode: e.target.value })}
                        >
                          <option value="">—</option>
                          <option value="hora">Hora</option>
                          <option value="jornada">Jornada</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--ui-muted)] mb-0.5">Monto (S/ por hora o por jornada)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input-field text-sm"
                          value={Number.isFinite(Number(u.payroll_amount)) ? u.payroll_amount : ''}
                          onChange={(e) => patchStaffUser(u.id, { payroll_amount: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-[var(--ui-muted)] mb-0.5">Horario de trabajo</label>
                        <input
                          className="input-field text-sm"
                          placeholder="Ej. Lun–Sab 9:00–18:00"
                          value={u.payroll_schedule_note || ''}
                          onChange={(e) => patchStaffUser(u.id, { payroll_schedule_note: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--ui-muted)] mb-0.5">Día de pago del mes (0 = no definido)</label>
                        <input
                          type="number"
                          min="0"
                          max="31"
                          className="input-field text-sm"
                          value={u.payroll_payment_day ?? 0}
                          onChange={(e) => patchStaffUser(u.id, { payroll_payment_day: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
          )}
        />
      )}

      {activeView !== 'mi_empresa' && (
        <>
          {activeView === 'facturacion_electronica' ? (
            <div className="card space-y-5">
              <div className="flex items-center gap-2">
                <MdReceipt className="text-red-600 text-2xl" />
                <h3 className="font-bold text-[var(--ui-body-text)] text-lg">Facturación electrónica</h3>
              </div>

              <fieldset disabled={!canEditBillingBot} className="border-0 p-0 m-0 min-w-0 space-y-5">
              <BillingSunatManualForm
                variant="light"
                restaurant={restaurant}
                onRestaurantField={update}
                billingPanel={billingPanel}
                billingPanelPresence={billingPanelPresence}
                onBillingPanelField={(k, v) => setBillingPanel((p) => ({ ...p, [k]: v }))}
                onUploadBillingCert={canEditBillingBot ? handleBillingCertUpload : undefined}
                disabled={!canEditBillingBot}
                appConfig={appConfig}
                onSeriesContingencia={(field, value) => updateAppCfg('series_contingencia', field, value)}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Modo offline</label>
                  <select
                    className="input-field"
                    value={billingConfig.billing_offline_mode ? '1' : '0'}
                    onChange={e => updateBilling('billing_offline_mode', Number(e.target.value))}
                  >
                    <option value="1">Activo (guardar y sincronizar luego)</option>
                    <option value="0">Inactivo (errores de red quedan como fallo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Reintentos automáticos</label>
                  <select
                    className="input-field"
                    value={billingConfig.billing_auto_retry_enabled ? '1' : '0'}
                    onChange={e => updateBilling('billing_auto_retry_enabled', Number(e.target.value))}
                  >
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Intervalo entre reintentos (segundos)</label>
                  <input
                    type="number"
                    min="30"
                    max="3600"
                    className="input-field"
                    value={billingConfig.billing_auto_retry_interval_sec}
                    onChange={e => updateBilling('billing_auto_retry_interval_sec', Number(e.target.value))}
                  />
                </div>
              </div>
              </fieldset>
            </div>
          ) : activeView === 'pagos_sistema' ? (
            <div className="card space-y-5">
              <div className="flex items-center gap-2">
                <MdPayment className="text-red-600 text-2xl" />
                <h3 className="font-bold text-[var(--ui-body-text)] text-lg">Parámetros de cobro y crédito</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Aceptar efectivo</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.acepta_efectivo ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'acepta_efectivo', Number(e.target.value))}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Aceptar tarjeta</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.acepta_tarjeta ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'acepta_tarjeta', Number(e.target.value))}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Aceptar Yape</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.acepta_yape ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'acepta_yape', Number(e.target.value))}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Aceptar Plin</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.acepta_plin ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'acepta_plin', Number(e.target.value))}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Requiere referencia para pagos digitales</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.requiere_referencia_digital ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'requiere_referencia_digital', Number(e.target.value))}
                  >
                    <option value="1">Sí, exigir código de operación</option>
                    <option value="0">No, solo registrar método</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Propina sugerida (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="input-field"
                    value={appConfig.pagos_sistema?.propina_sugerida_pct ?? 0}
                    onChange={e => updateAppCfg('pagos_sistema', 'propina_sugerida_pct', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Tolerancia diferencia de caja (S/)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.10"
                    className="input-field"
                    value={appConfig.pagos_sistema?.tolerancia_diferencia_caja ?? 0}
                    onChange={e => updateAppCfg('pagos_sistema', 'tolerancia_diferencia_caja', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Días máximos de crédito</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={appConfig.pagos_sistema?.dias_max_credito ?? 0}
                    onChange={e => updateAppCfg('pagos_sistema', 'dias_max_credito', Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto máximo por crédito (S/)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.50"
                    className="input-field"
                    value={appConfig.pagos_sistema?.monto_max_credito ?? 0}
                    onChange={e => updateAppCfg('pagos_sistema', 'monto_max_credito', Number(e.target.value))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Notificar mora automáticamente</label>
                  <select
                    className="input-field"
                    value={appConfig.pagos_sistema?.notificar_mora ? '1' : '0'}
                    onChange={e => updateAppCfg('pagos_sistema', 'notificar_mora', Number(e.target.value))}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Política de cobranza</label>
                  <textarea
                    rows="3"
                    className="input-field"
                    value={appConfig.pagos_sistema?.texto_politica_cobro || ''}
                    onChange={e => updateAppCfg('pagos_sistema', 'texto_politica_cobro', e.target.value)}
                    placeholder="Define términos para ventas al crédito, mora y regularización."
                  />
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                Recomendación: mantener al menos dos métodos de pago activos para continuidad operativa.
              </div>
            </div>
          ) : activeView === 'contrato' ? (
            <RestaurantServiceContractForm
              contrato={appConfig.contrato}
              canEdit={canEditContrato}
              onChange={(next) => setAppConfig((prev) => ({ ...prev, contrato: next }))}
            />
          ) : activeView === 'pago_uso_sistema' ? (
            <div className="card space-y-5">
              <div className="flex items-center gap-2">
                <MdReceipt className="text-blue-600 text-2xl" />
                <h3 className="font-bold text-[var(--ui-body-text)] text-lg">Pago por uso del sistema</h3>
              </div>
              {pagoUsoComprobanteUi?.platform_payment?.show_approved_banner ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="font-semibold">
                    {pagoUsoComprobanteUi.platform_payment.mensaje_gracias
                      || 'Gracias por trabajar con nosotros.'}
                  </p>
                  <p className="mt-2 text-emerald-800">
                    {pagoUsoComprobanteUi.platform_payment.mensaje_aprobado
                      || 'Su pago fue aprobado correctamente. Licencia actualizada.'}
                  </p>
                </div>
              ) : null}
              {pagoUsoComprobanteUi?.platform_payment?.central_user_message ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <p>{pagoUsoComprobanteUi.platform_payment.central_user_message}</p>
                  {pagoUsoComprobanteUi.platform_payment.show_resync_hint ? (
                    <button
                      type="button"
                      className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-60"
                      disabled={centralResyncBusy}
                      onClick={() => resyncCentralPayment()}
                    >
                      {centralResyncBusy ? 'Reenviando…' : 'Reintentar envío'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {pagoUsoComprobanteUi?.platform_payment?.show_pending_banner ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">Comprobante en revisión</p>
                  <p className="mt-1">
                    Su pago está <strong>pendiente</strong> de aprobación por el administrador central.
                    {pagoUsoComprobanteUi.platform_payment.referencia
                      ? ` Referencia: ${pagoUsoComprobanteUi.platform_payment.referencia}`
                      : ''}
                  </p>
                </div>
              ) : null}
              {pagoUsoComprobanteUi?.platform_payment?.show_rejected_banner ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  <p className="font-semibold">Pago rechazado</p>
                  <p className="mt-1">Puede subir un nuevo comprobante dentro del plazo permitido.</p>
                </div>
              ) : null}
              {pagoUsoComprobanteUi?.policy_active && pagoUsoComprobanteUi.upload_comprobante_message ? (
                <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-sm text-[var(--ui-body-text)]">
                  <p className="whitespace-nowrap overflow-x-auto text-xs md:text-sm">
                    {pagoUsoComprobanteUi.fecha_proxima_facturacion
                      ? `Próxima facturación: ${pagoUsoComprobanteUi.fecha_proxima_facturacion}`
                      : ''}
                    {pagoUsoComprobanteUi.comprobante_upload_deadline
                      ? ` · Carga permitida hasta: ${pagoUsoComprobanteUi.comprobante_upload_deadline}`
                      : ''}
                  </p>
                </div>
              ) : null}
              {!canEditBillingMaster && !isRestaurantAdmin ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Solo el <strong>administrador maestro</strong> puede modificar esta sección. Los datos se muestran en solo lectura.
                </div>
              ) : null}
              {isRestaurantAdmin && !isMasterAdmin ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  Como <strong>administrador del restaurante</strong> puede cargar el comprobante de pago, indicar el monto y usar{' '}
                  <strong>Enviar comprobante</strong>. La configuración de facturación (frecuencia, cuenta, días de gracia) la define el administrador maestro.
                </div>
              ) : null}

              <fieldset disabled={!canEditBillingMaster} className="border-0 p-0 m-0 min-w-0 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Frecuencia de facturación</label>
                  <select
                    className="input-field"
                    value={appConfig.pago_uso_sistema?.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual'}
                    onChange={(e) => {
                      const v = e.target.value;
                      const anchor = String(billingAnchorDate || '').trim();
                      setAppConfig((prev) => {
                        const p = { ...(prev.pago_uso_sistema || {}), periodo_facturacion: v };
                        if (anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
                          p.fecha_proxima_facturacion = proximaFechaFromControlAnchor(
                            anchor,
                            v === 'semestral' ? 'semestral' : 'mensual',
                          );
                        }
                        return { ...prev, pago_uso_sistema: p };
                      });
                    }}
                  >
                    <option value="mensual">Mensual</option>
                    <option value="semestral">Semestral</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Próxima fecha de facturación (opcional)</label>
                  <input
                    type="date"
                    className="input-field"
                    value={appConfig.pago_uso_sistema?.fecha_proxima_facturacion || ''}
                    onChange={(e) => updateAppCfg('pago_uso_sistema', 'fecha_proxima_facturacion', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Días de gracia para subir comprobante</label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    className="input-field"
                    value={Number(appConfig.pago_uso_sistema?.comprobante_grace_days_after_due ?? 3)}
                    onChange={(e) => updateAppCfg(
                      'pago_uso_sistema',
                      'comprobante_grace_days_after_due',
                      Math.max(1, Math.min(14, Number(e.target.value) || 3)),
                    )}
                  />
                  <p className="text-xs text-[var(--ui-muted)] mt-1">Tras la fecha de facturación, cuántos días tiene para cargar el comprobante antes del bloqueo.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Número de cuenta</label>
                  <input
                    className="input-field"
                    placeholder="CCI, número de cuenta o datos de transferencia"
                    value={appConfig.pago_uso_sistema?.numero_cuenta || ''}
                    onChange={(e) => updateAppCfg('pago_uso_sistema', 'numero_cuenta', e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre de la empresa a la que debes pagar</label>
                  <input
                    className="input-field"
                    placeholder="Razón social o nombre del beneficiario"
                    value={appConfig.pago_uso_sistema?.nombre_empresa_cobro || ''}
                    onChange={(e) => updateAppCfg('pago_uso_sistema', 'nombre_empresa_cobro', e.target.value)}
                  />
                </div>
              </div>
              </fieldset>

              <div className="space-y-3 pt-2 border-t border-[color:var(--ui-border)]">
                <div>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto pagado (S/)</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="input-field max-w-xs"
                    placeholder="Ej. 99.00"
                    value={appConfig.pago_uso_sistema?.monto_comprobante ?? ''}
                    onChange={(e) => updateAppCfg('pago_uso_sistema', 'monto_comprobante', e.target.value)}
                    disabled={!canEditPagoUsoComprobante}
                  />
                  <p className="text-xs text-[var(--ui-muted)] mt-1">Obligatorio para enviar el comprobante al panel de aprobación.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Comprobante de pago</label>
                  <p className="text-xs text-[var(--ui-muted)] mb-2">Sube una imagen (o PDF) del voucher o transferencia.</p>
                  <div className="flex flex-wrap items-center gap-3">
                    {(() => {
                      const ppUi = pagoUsoComprobanteUi?.platform_payment;
                      const urlActual = String(appConfig.pago_uso_sistema?.comprobante_pago_url || '').trim();
                      const estadoPp = String(ppUi?.estado || '').toLowerCase();
                      const pendienteEnRevision =
                        (estadoPp === 'pendiente' || estadoPp === 'pending')
                        && Boolean(urlActual)
                        && ppUi?.last_central_sync_ok !== false;
                      const blockRemove =
                        Boolean(ppUi?.show_approved_banner)
                        || (pendienteEnRevision && ppUi?.quitar_comprobante_allowed === false);
                      const puedeCargar = canEditPagoUsoComprobante && !pendienteEnRevision && !comprobanteUploadBusy;
                      return (
                        <>
                          <label className={puedeCargar ? 'cursor-pointer' : 'cursor-not-allowed'}>
                            <span
                              className={`btn-secondary inline-flex items-center gap-2 text-sm ${!puedeCargar ? 'opacity-50 pointer-events-none' : ''}`}
                            >
                              <MdUpload /> {comprobanteUploadBusy ? 'Subiendo…' : 'Cargar comprobante'}
                            </span>
                            <input
                              ref={comprobanteUsoInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                              className="sr-only"
                              disabled={!puedeCargar}
                              onChange={(e) => uploadComprobantePagoUso(e.target.files?.[0])}
                            />
                          </label>
                          {pendienteEnRevision ? (
                            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                              Hay un comprobante en revisión. Espere la respuesta o pida al maestro que lo rechace para cargar otro.
                            </p>
                          ) : null}
                          {urlActual ? (
                            <>
                              <a
                                href={resolveMediaUrl(urlActual)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline"
                              >
                                Ver archivo
                              </a>
                              <button
                                type="button"
                                className="text-sm text-red-600 hover:underline disabled:opacity-50"
                                disabled={!canEditPagoUsoComprobante || blockRemove || comprobanteUploadBusy}
                                onClick={() => quitarComprobantePagoUso()}
                              >
                                Quitar
                              </button>
                            </>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                  {(() => {
                    const pp = pagoUsoComprobanteUi?.platform_payment;
                    const url = String(appConfig.pago_uso_sistema?.comprobante_pago_url || '').trim();
                    const estadoPp = String(pp?.estado || '').toLowerCase();
                    const pendienteEnRevision =
                      (estadoPp === 'pendiente' || estadoPp === 'pending')
                      && pp?.last_central_sync_ok !== false;
                    const enviadoOk = pendienteEnRevision;
                    const blockRemovePreview =
                      Boolean(pp?.show_approved_banner)
                      || (pendienteEnRevision && pagoUsoComprobanteUi?.quitar_comprobante_allowed === false);
                    const muestraEnviar = Boolean(url) && canEditPagoUsoComprobante && !pendienteEnRevision;
                    const tieneHistorial = pagoUsoHistorialRows.length > 0;
                    const isPdf = url.toLowerCase().endsWith('.pdf');

                    const botonHistorial = tieneHistorial ? (
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-2 text-sm px-4 py-2 shrink-0"
                        onClick={() => setPagoHistorialAbierto((v) => !v)}
                        aria-expanded={pagoHistorialAbierto}
                      >
                        <MdHistory />
                        {pagoHistorialAbierto
                          ? 'Ocultar historial'
                          : `Historial de pagos (${pagoUsoHistorialRows.length})`}
                      </button>
                    ) : null;

                    const listaHistorial = pagoHistorialAbierto && tieneHistorial ? (
                      <div className="w-full mt-3 pt-3 border-t border-[color:var(--ui-border)]">
                        <p className="text-xs text-[var(--ui-muted)] mb-3">
                          Comprobantes ya enviados o aprobados.
                        </p>
                        <ul className="space-y-3">
                          {pagoUsoHistorialRows.map((item) => {
                            const itemUrl = String(item.comprobante_pago_url || item.voucher || '').trim();
                            const itemPdf = itemUrl.toLowerCase().endsWith('.pdf');
                            const key = item.id || `${item.fecha}-${item.referencia}-${itemUrl}`;
                            return (
                              <li
                                key={key}
                                className="flex flex-wrap items-start gap-3 rounded-lg border border-[color:var(--ui-border)] p-3 bg-[var(--ui-surface-2)]"
                              >
                                {!itemPdf ? (
                                  <a
                                    href={resolveMediaUrl(itemUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 rounded overflow-hidden border border-[color:var(--ui-border)] max-w-[88px]"
                                  >
                                    <img
                                      src={resolveMediaUrl(itemUrl)}
                                      alt=""
                                      className="w-[88px] h-[66px] object-cover"
                                    />
                                  </a>
                                ) : (
                                  <span className="text-xs font-medium text-[var(--ui-muted)] px-2 py-1 bg-white rounded border">
                                    PDF
                                  </span>
                                )}
                                <div className="min-w-0 flex-1 text-sm">
                                  <p className="font-medium text-[var(--ui-body-text)]">
                                    {pagoHistorialEstadoLabel(item.estado)}
                                    {item.monto != null ? ` · S/ ${Number(item.monto).toFixed(2)}` : ''}
                                  </p>
                                  <p className="text-xs text-[var(--ui-muted)] mt-0.5">
                                    {item.fecha || '—'}
                                    {item.referencia ? ` · Ref. ${item.referencia}` : ''}
                                  </p>
                                  <a
                                    href={resolveMediaUrl(itemUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                  >
                                    Ver comprobante
                                  </a>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null;

                    if (!url && !tieneHistorial) return null;

                    return (
                      <div className="mt-3 flex flex-col gap-3">
                        {url ? (
                          <div className="flex flex-wrap items-end gap-3">
                            {!isPdf ? (
                              <div className="rounded-lg border border-[color:var(--ui-border)] overflow-hidden max-w-xs bg-[var(--ui-surface-2)]">
                                <img
                                  src={resolveMediaUrl(url)}
                                  alt="Vista previa del comprobante"
                                  className="w-full max-h-48 object-contain"
                                />
                              </div>
                            ) : (
                              <p className="text-sm text-[var(--ui-muted)]">PDF listo para enviar.</p>
                            )}
                          </div>
                        ) : null}
                        {(muestraEnviar || botonHistorial) ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                            <div className="flex flex-wrap gap-2">
                              {muestraEnviar ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
                                    disabled={enviarComprobanteBusy || comprobanteUploadBusy}
                                    onClick={() => enviarComprobanteAlPanel()}
                                  >
                                    {enviarComprobanteBusy
                                      ? 'Enviando…'
                                      : enviadoOk
                                        ? 'Reenviar comprobante'
                                        : 'Enviar comprobante'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary text-sm px-4 py-2 disabled:opacity-60"
                                    disabled={blockRemovePreview || comprobanteUploadBusy}
                                    onClick={() => quitarComprobantePagoUso()}
                                  >
                                    Quitar
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {botonHistorial}
                          </div>
                        ) : null}
                        {listaHistorial}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="rounded-lg bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] p-3 text-sm text-[var(--ui-muted)]">
                {canEditBillingMaster ? (
                  <>
                    <strong>Guardar cambios</strong> guarda frecuencia, fechas y datos de cuenta.
                    {' '}
                    <strong>Enviar comprobante</strong> manda el voucher al panel de aprobación.
                  </>
                ) : (
                  <>
                    Indique el <strong>monto pagado (S/)</strong>, cargue el archivo y pulse <strong>Enviar comprobante</strong>.
                  </>
                )}
              </div>
            </div>
          ) : activeView === 'informacion' ? (
            <MasterRestaurantBackupPanel onAfterMutate={loadInitialData} />
          ) : (
            <div className="card">
              <h3 className="font-bold text-[var(--ui-body-text)] mb-2">{activeViewLabel}</h3>
              <p className="text-[var(--ui-muted)]">No se encontró la vista solicitada. Selecciona una opción válida del menú.</p>
            </div>
          )}
        </>
      )}

      <Modal
        variant="light"
        isOpen={Boolean(payrollInvestModal)}
        onClose={() => !payrollInvestBusy && setPayrollInvestModal(null)}
        title={payrollInvestModal ? `Registrar pago — ${payrollInvestModal.full_name}` : ''}
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--ui-muted)]">
            Se registra un movimiento en <strong>gastos operativos</strong> según el monto de nómina (jornada completa o horas × tarifa).
          </p>
          {payrollInvestModal && String(payrollInvestModal.payroll_pay_mode || '').toLowerCase() === 'hora' ? (
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Horas a pagar</label>
              <input
                type="number"
                min="0.25"
                step="0.25"
                className="input-field w-full"
                value={payrollHours}
                onChange={(e) => setPayrollHours(e.target.value)}
                placeholder="Ej. 8"
              />
            </div>
          ) : null}
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Concepto (opcional)</label>
            <input
              className="input-field w-full"
              value={payrollConcept}
              onChange={(e) => setPayrollConcept(e.target.value)}
              placeholder="Quincena, fin de mes…"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={payrollInvestBusy}
              onClick={() => setPayrollInvestModal(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={payrollInvestBusy}
              onClick={() => void submitPayrollInvestment()}
            >
              {payrollInvestBusy ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
