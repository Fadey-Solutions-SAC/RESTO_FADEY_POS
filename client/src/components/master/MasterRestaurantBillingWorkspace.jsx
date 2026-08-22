import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../../hooks/useSocket';
import toast from 'react-hot-toast';
import { api, resolveMediaUrl } from '../../utils/api';
import { proximaFechaFromControlAnchor } from '../../utils/nextBillingFromAnchor';
import { normalizeContratoFromApi } from '../RestaurantServiceContractForm';
import BillingSunatManualForm from '../billing/BillingSunatManualForm';
import { defaultBillingPanel, defaultBillingPanelPresence } from '../../data/sunat47Catalog';
import { MdReceipt, MdPayment, MdSave, MdUpload } from 'react-icons/md';

const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

const defaultBillingConfig = () => ({
  billing_api_url: '',
  billing_api_token: '',
  has_billing_api_token: false,
  billing_api_url_from_env: false,
  billing_api_secret_from_env: false,
  billing_offline_mode: 1,
  billing_auto_retry_enabled: 1,
  billing_auto_retry_interval_sec: 120,
});

const defaultAppConfig = () => ({
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
    numero_telefono: '',
    nombre_empresa_cobro: '',
    precio_plan: '',
    comprobante_pago_url: '',
    comprobante_grace_days_after_due: 3,
  },
});

/**
 * Misma data que Mi Restaurante → Bot SUNAT / Pago por uso; montado en Administrador Maestro
 * para que el maestro edite sin salir de /master.
 */
export default function MasterRestaurantBillingWorkspace({ active }) {
  const isSunat = active === 'sunat';
  const [restaurant, setRestaurant] = useState(null);
  const [billingConfig, setBillingConfig] = useState(defaultBillingConfig);
  const [appConfig, setAppConfig] = useState(defaultAppConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billingAnchorDate, setBillingAnchorDate] = useState('');
  const [pagoUsoComprobanteUi, setPagoUsoComprobanteUi] = useState(null);
  const [allowRestaurantAdminBillingBot, setAllowRestaurantAdminBillingBot] = useState(false);
  const [permSaving, setPermSaving] = useState(false);
  const [billingPanel, setBillingPanel] = useState(() => defaultBillingPanel());
  const [billingPanelPresence, setBillingPanelPresence] = useState(defaultBillingPanelPresence);
  const comprobanteUsoInputRef = useRef(null);

  const handleBillingCertUpload = useCallback(async (file) => {
    const r = await api.uploadBillingCert(file);
    setBillingPanel((p) => ({ ...p, cert_pfx_path: r.url }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [restaurantData, billingData, appCfg, schedule] = await Promise.all([
        api.get('/restaurant'),
        api.get('/billing/config').catch(() => null),
        api.get('/admin-modules/config/app').catch(() => null),
        api.get('/master-admin/billing-schedule').catch(() => null),
      ]);
      const data = restaurantData || {};
      if (!data.schedule || typeof data.schedule !== 'object') data.schedule = {};
      DAYS.forEach((d) => {
        if (!data.schedule[d]) data.schedule[d] = { open: '11:00', close: '23:00', enabled: true };
      });
      setRestaurant(data);
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
        setBillingConfig({
          billing_api_url: billingData.billing_api_url || '',
          has_billing_api_token: Boolean(billingData.has_billing_api_token),
          billing_api_url_from_env: Boolean(billingData.billing_api_url_from_env),
          billing_api_secret_from_env: Boolean(billingData.billing_api_secret_from_env),
          billing_offline_mode: Number(billingData.billing_offline_mode ?? 1),
          billing_auto_retry_enabled: Number(billingData.billing_auto_retry_enabled ?? 1),
          billing_auto_retry_interval_sec: Number(billingData.billing_auto_retry_interval_sec || 120),
          billing_api_token: '',
        });
      } else {
        setAllowRestaurantAdminBillingBot(false);
        setBillingConfig(defaultBillingConfig());
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
          if (anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) && !String(p.fecha_proxima_facturacion || '').trim()) {
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
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar la configuración del restaurante');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'app_config') void load();
  });

  const update = (f, v) => setRestaurant((prev) => ({ ...prev, [f]: v }));
  const updateBilling = (f, v) => setBillingConfig((prev) => ({ ...prev, [f]: v }));
  const updateAppCfg = (section, field, value) => setAppConfig((prev) => ({
    ...prev,
    [section]: { ...(prev[section] || {}), [field]: value },
  }));

  const saveAllowRestaurantAdminBilling = async (checked) => {
    setPermSaving(true);
    try {
      const next = await api.put('/master-admin/control', {
        allow_restaurant_admin_billing_bot: checked ? 1 : 0,
      });
      setAllowRestaurantAdminBillingBot(Number(next.allow_restaurant_admin_billing_bot) === 1);
      toast.success(
        checked
          ? 'Los administradores del restaurante pueden editar «Bot facturación SUNAT» en Mi Restaurante.'
          : 'Solo el maestro puede editar el bot de facturación desde ahora.'
      );
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar el permiso');
    } finally {
      setPermSaving(false);
    }
  };

  const uploadComprobantePagoUso = async (file) => {
    if (!file) return;
    try {
      const uploaded = await api.upload(file);
      const url = uploaded?.url || '';
      updateAppCfg('pago_uso_sistema', 'comprobante_pago_url', url);
      toast.success('Comprobante cargado. Pulsa Guardar para conservarlo.');
    } catch (err) {
      toast.error(err.message || 'No se pudo subir el comprobante');
    } finally {
      if (comprobanteUsoInputRef.current) comprobanteUsoInputRef.current.value = '';
    }
  };

  const saveSunat = async () => {
    if (!restaurant) return;
    setSaving(true);
    try {
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
      setBillingConfig((prev) => ({
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
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const savePagoUso = async () => {
    setSaving(true);
    try {
      const raw = appConfig.pago_uso_sistema || {};
      const periodo = raw.periodo_facturacion === 'semestral' ? 'semestral' : 'mensual';
      const g = Number(raw.comprobante_grace_days_after_due);
      const grace = Number.isFinite(g) ? Math.max(1, Math.min(14, Math.round(g))) : 3;
      const payload = {
        periodo_facturacion: periodo,
        fecha_proxima_facturacion: String(raw.fecha_proxima_facturacion || '').trim().slice(0, 32),
        numero_cuenta: String(raw.numero_cuenta || '').trim(),
        numero_telefono: String(raw.numero_telefono || '').trim().slice(0, 40),
        nombre_empresa_cobro: String(raw.nombre_empresa_cobro || '').trim(),
        comprobante_pago_url: String(raw.comprobante_pago_url || '').trim(),
        comprobante_grace_days_after_due: grace,
        ...(Number.isFinite(Number(raw.precio_plan)) && Number(raw.precio_plan) >= 0
          ? { precio_plan: Math.round(Number(raw.precio_plan) * 100) / 100 }
          : { precio_plan: '' }),
      };
      const saved = await api.put('/admin-modules/config/app', { pago_uso_sistema: payload });
      setAppConfig((prev) => ({ ...prev, ...saved }));
      try {
        const s = await api.get('/master-admin/billing-schedule');
        setPagoUsoComprobanteUi(s?.pago_uso_comprobante || null);
      } catch (_) {
        setPagoUsoComprobanteUi(null);
      }
      toast.success('Datos de pago por uso del sistema guardados');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !restaurant) {
    return (
      <div className="card py-16 flex justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ui-muted)] px-1">
        Misma configuración que en <strong className="text-[var(--ui-body-text)]">Mi Restaurante → Bot facturación SUNAT</strong>. Los
        administradores del restaurante pueden verla; si activa la casilla de abajo, también podrán editarla desde su panel.
      </p>

      {isSunat ? (
        <div className="card space-y-5">
          <div className="flex items-center gap-2">
            <MdReceipt className="text-red-600 text-2xl" />
            <div>
              <h2 className="font-bold text-[var(--ui-body-text)] text-lg">Facturación SUNAT (emisor + bot)</h2>
              <p className="text-sm text-[var(--ui-muted)] mt-0.5">
                Formulario reducido con los datos que debe completar el emisor. SOL y certificado también pueden ir en el{' '}
                <code className="text-xs">.env</code> del bot. Pulse <strong>Guardar</strong> una vez.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-violet-200 bg-violet-50/90 p-4 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-1 rounded border-violet-300 text-violet-700 focus:ring-violet-500"
                checked={allowRestaurantAdminBillingBot}
                disabled={permSaving}
                onChange={(e) => void saveAllowRestaurantAdminBilling(e.target.checked)}
              />
              <span>
                <span className="font-semibold text-[var(--ui-body-text)]">Permitir que el administrador del restaurante edite el bot SUNAT</span>
                <span className="block text-xs text-[var(--ui-muted)] mt-1">
                  Si está activo, el usuario admin puede cambiar en Mi Restaurante la misma sección (emisor, series, contingencia,
                  URL del bot, reintentos). Si está desactivado, solo usted (maestro) puede guardar esos datos.
                </span>
              </span>
            </label>
          </div>

          <BillingSunatManualForm
            variant="light"
            restaurant={restaurant}
            onRestaurantField={update}
            billingPanel={billingPanel}
            onBillingPanelField={(k, v) => setBillingPanel((p) => ({ ...p, [k]: v }))}
            billingPanelPresence={billingPanelPresence}
            onUploadBillingCert={handleBillingCertUpload}
            disabled={false}
            appConfig={appConfig}
            onSeriesContingencia={(field, value) => updateAppCfg('series_contingencia', field, value)}
          />

          <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-sm text-[var(--ui-body-text)] space-y-2">
            <p>
              <strong>Conexión al bot (Node → Python):</strong> la URL del API y el secreto{' '}
              <code className="text-xs bg-white px-1 rounded border">X-EFACT-SECRET</code> no se editan aquí. Configúrelos
              en el entorno del API Node con <code className="text-xs bg-white px-1 rounded border">EFACT_API_URL</code> y{' '}
              <code className="text-xs bg-white px-1 rounded border">EFACT_HTTP_SECRET</code> (p. ej. Docker Compose o{' '}
              <code className="text-xs bg-white px-1 rounded border">.env</code> del servidor).
            </p>
            <p className="text-xs text-[var(--ui-muted)]">
              Estado (sin mostrar valores):{' '}
              {billingConfig.billing_api_url_from_env || billingConfig.billing_api_secret_from_env
                ? 'prioridad por variables de entorno en el API Node.'
                : billingConfig.has_billing_api_token || (billingConfig.billing_api_url && String(billingConfig.billing_api_url).trim())
                  ? 'valores almacenados en el servidor; guardar esta pantalla no cambia URL ni secreto.'
                  : 'defina EFACT_API_URL y EFACT_HTTP_SECRET en el servidor para habilitar el envío al bot.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Modo offline</label>
              <select
                className="input-field"
                value={billingConfig.billing_offline_mode ? '1' : '0'}
                onChange={(e) => updateBilling('billing_offline_mode', Number(e.target.value))}
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
                onChange={(e) => updateBilling('billing_auto_retry_enabled', Number(e.target.value))}
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
                onChange={(e) => updateBilling('billing_auto_retry_interval_sec', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary flex items-center gap-2" disabled={saving} onClick={saveSunat}>
              <MdSave /> {saving ? 'Guardando…' : 'Guardar facturación SUNAT y bot'}
            </button>
          </div>
        </div>
      ) : (
        <div className="card space-y-5">
          <div className="flex items-center gap-2">
            <MdPayment className="text-blue-600 text-2xl" />
            <div>
              <h2 className="font-bold text-[var(--ui-body-text)] text-lg">Pago de plan</h2>
              <p className="text-sm text-[var(--ui-muted)]">
                Periodicidad, cuenta de destino y comprobante de pago al proveedor del software.
              </p>
            </div>
          </div>

          {pagoUsoComprobanteUi?.policy_active && pagoUsoComprobanteUi.upload_comprobante_message ? (
            <div className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-sm text-[var(--ui-body-text)]">
              <p>{pagoUsoComprobanteUi.upload_comprobante_message}</p>
              {pagoUsoComprobanteUi.fecha_proxima_facturacion ? (
                <p className="text-xs text-[var(--ui-muted)] mt-2">
                  Próxima facturación: {pagoUsoComprobanteUi.fecha_proxima_facturacion}
                  {pagoUsoComprobanteUi.comprobante_upload_deadline
                    ? ` · Ventana de carga hasta: ${pagoUsoComprobanteUi.comprobante_upload_deadline}`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}

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
              <p className="text-xs text-[var(--ui-muted)] mt-1">Después de la fecha de facturación, días hábiles de ventana antes del bloqueo automático.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio del plan (S/)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input-field tabular-nums"
                placeholder="Monto a cobrar por el periodo"
                value={appConfig.pago_uso_sistema?.precio_plan ?? ''}
                onChange={(e) => updateAppCfg('pago_uso_sistema', 'precio_plan', e.target.value)}
              />
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
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Número de teléfono</label>
              <input
                className="input-field tabular-nums"
                placeholder="Ej. 934029719"
                value={appConfig.pago_uso_sistema?.numero_telefono || ''}
                onChange={(e) => updateAppCfg('pago_uso_sistema', 'numero_telefono', e.target.value)}
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
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Comprobante de pago</label>
              <p className="text-xs text-[var(--ui-muted)] mb-2">Sube una imagen (o PDF) del voucher o transferencia.</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => comprobanteUsoInputRef.current?.click()}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <MdUpload /> Cargar comprobante
                </button>
                <input
                  ref={comprobanteUsoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  className="hidden"
                  onChange={(e) => uploadComprobantePagoUso(e.target.files?.[0])}
                />
                {appConfig.pago_uso_sistema?.comprobante_pago_url ? (
                  <>
                    <a
                      href={resolveMediaUrl(appConfig.pago_uso_sistema.comprobante_pago_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Ver archivo
                    </a>
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => updateAppCfg('pago_uso_sistema', 'comprobante_pago_url', '')}
                    >
                      Quitar
                    </button>
                  </>
                ) : null}
              </div>
              {appConfig.pago_uso_sistema?.comprobante_pago_url &&
              !String(appConfig.pago_uso_sistema.comprobante_pago_url).toLowerCase().endsWith('.pdf') ? (
                <div className="mt-3 rounded-lg border border-[color:var(--ui-border)] overflow-hidden max-w-xs bg-[var(--ui-surface-2)]">
                  <img
                    src={resolveMediaUrl(appConfig.pago_uso_sistema.comprobante_pago_url)}
                    alt="Vista previa del comprobante"
                    className="w-full max-h-48 object-contain"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-[var(--ui-muted)]">Tras cargar un archivo, pulse <strong>Guardar</strong> para persistir la URL del comprobante.</p>

          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary flex items-center gap-2" disabled={saving} onClick={savePagoUso}>
              <MdSave /> {saving ? 'Guardando…' : 'Guardar pago por uso'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
