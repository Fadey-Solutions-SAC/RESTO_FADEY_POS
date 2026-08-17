import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { defaultBillingPanelPresence } from '../../data/sunat47Catalog';

/** Valor mostrado cuando el dato existe en servidor pero no se expone por API. */
const SECRET_MASK = '••••••••••••';

/**
 * Solo los campos que el emisor debe completar para enlazar con el bot (SUNAT).
 */
export default function BillingSunatManualForm({
  variant = 'light',
  restaurant,
  onRestaurantField,
  billingPanel,
  onBillingPanelField,
  billingPanelPresence = defaultBillingPanelPresence(),
  onUploadBillingCert,
  disabled,
  appConfig,
  onSeriesContingencia,
}) {
  const certFileRef = useRef(null);
  const [solUsuarioEditing, setSolUsuarioEditing] = useState(false);
  const [solClaveEditing, setSolClaveEditing] = useState(false);
  const [certPassEditing, setCertPassEditing] = useState(false);

  useEffect(() => {
    setSolUsuarioEditing(false);
    setSolClaveEditing(false);
    setCertPassEditing(false);
  }, [
    billingPanelPresence?.sol_usuario,
    billingPanelPresence?.sol_clave,
    billingPanelPresence?.cert_pfx_password,
  ]);

  const maskedSolUsuario =
    Boolean(billingPanelPresence?.sol_usuario) && !solUsuarioEditing;
  const maskedSolClave = Boolean(billingPanelPresence?.sol_clave) && !solClaveEditing;
  const maskedCertPass =
    Boolean(billingPanelPresence?.cert_pfx_password) && !certPassEditing;

  const beginSecretEdit = (field, setEditing) => {
    setEditing(true);
    onBillingPanelField(field, '');
  };

  const endSecretEdit = (field, editing, setEditing, hasStored) => {
    if (!editing) return;
    const empty = !String(billingPanel?.[field] ?? '').trim();
    if (empty && hasStored) {
      setEditing(false);
      onBillingPanelField(field, '');
    }
  };
  const isDark = variant === 'dark';
  const inputCls = isDark
    ? 'input-field bg-[#0f172a] border-slate-600 text-slate-100'
    : 'input-field';
  const labelCls = isDark ? 'text-[var(--ui-muted)]' : 'text-[var(--ui-muted)]';
  const sectionCls = isDark
    ? 'rounded-lg border border-slate-600 bg-slate-900/50 p-4 space-y-3'
    : 'rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4 space-y-3';
  const hCls = isDark ? 'font-semibold text-slate-100 text-sm' : 'font-semibold text-[var(--ui-body-text)] text-sm';

  const corrFact = Math.max(1, Math.floor(Number(billingPanel?.correlativo_inicial_factura) || 1));
  const corrBol = Math.max(1, Math.floor(Number(billingPanel?.correlativo_inicial_boleta) || 1));

  return (
    <form autoComplete="off" className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      <div className={sectionCls}>
        <h4 className={hCls}>Emisor</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>RUC (11 dígitos)</label>
            <input
              className={inputCls}
              value={String(restaurant?.company_ruc ?? '').replace(/\D/g, '').slice(0, 11)}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onRestaurantField('company_ruc', e.target.value.replace(/\D/g, '').slice(0, 11))}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Razón social</label>
            <input
              className={inputCls}
              value={restaurant?.legal_name ?? ''}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onRestaurantField('legal_name', e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Dirección fiscal</label>
            <input
              className={inputCls}
              value={restaurant?.billing_emisor_direccion ?? ''}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onRestaurantField('billing_emisor_direccion', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className={sectionCls}>
        <h4 className={hCls}>SOL y certificado</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Usuario SOL</label>
            <input
              type={maskedSolUsuario ? 'password' : 'text'}
              className={inputCls}
              value={
                maskedSolUsuario
                  ? SECRET_MASK
                  : billingPanel?.sol_usuario != null
                    ? String(billingPanel.sol_usuario)
                    : ''
              }
              readOnly={maskedSolUsuario}
              disabled={disabled}
              autoComplete="off"
              name="sunat-manual-sol-user"
              data-1p-ignore
              data-lpignore="true"
              placeholder={maskedSolUsuario ? '' : 'Usuario secundario SOL'}
              onFocus={() => {
                if (maskedSolUsuario) beginSecretEdit('sol_usuario', setSolUsuarioEditing);
              }}
              onBlur={() => {
                endSecretEdit(
                  'sol_usuario',
                  solUsuarioEditing,
                  setSolUsuarioEditing,
                  billingPanelPresence?.sol_usuario
                );
              }}
              onChange={(e) => onBillingPanelField('sol_usuario', e.target.value)}
            />
            {maskedSolUsuario ? (
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Guardado. Pulse el campo para cambiarlo.</p>
            ) : null}
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Clave SOL</label>
            <input
              type="password"
              className={inputCls}
              value={
                maskedSolClave
                  ? SECRET_MASK
                  : billingPanel?.sol_clave != null
                    ? String(billingPanel.sol_clave)
                    : ''
              }
              readOnly={maskedSolClave}
              disabled={disabled}
              autoComplete="new-password"
              name="sunat-manual-sol-pass"
              placeholder={maskedSolClave ? '' : 'Clave SOL'}
              onFocus={() => {
                if (maskedSolClave) beginSecretEdit('sol_clave', setSolClaveEditing);
              }}
              onBlur={() => {
                endSecretEdit(
                  'sol_clave',
                  solClaveEditing,
                  setSolClaveEditing,
                  billingPanelPresence?.sol_clave
                );
              }}
              onChange={(e) => onBillingPanelField('sol_clave', e.target.value)}
            />
            {maskedSolClave ? (
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Guardada. Pulse el campo para cambiarla.</p>
            ) : null}
          </div>
          <div className="md:col-span-2 space-y-2">
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Certificado digital (.pfx o .p12)</label>
            <input
              type="text"
              className={inputCls}
              value={billingPanel?.cert_pfx_path ?? ''}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onBillingPanelField('cert_pfx_path', e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={certFileRef}
                type="file"
                accept=".pfx,.p12,application/x-pkcs12"
                className="hidden"
                disabled={disabled}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f || !onUploadBillingCert) return;
                  try {
                    await onUploadBillingCert(f);
                    toast.success('Certificado subido. Guarde los cambios para registrar la ruta.');
                  } catch (err) {
                    toast.error(err?.message || 'No se pudo subir el certificado');
                  }
                }}
              />
              <button
                type="button"
                className={`text-xs font-medium rounded-lg px-3 py-2 border ${isDark ? 'border-slate-500 bg-slate-800 text-slate-100' : 'border-slate-300 bg-white text-slate-800'}`}
                disabled={disabled || !onUploadBillingCert}
                onClick={() => certFileRef.current?.click()}
              >
                Subir .pfx / .p12
              </button>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Contraseña del certificado</label>
            <input
              type="password"
              className={inputCls}
              value={
                maskedCertPass
                  ? SECRET_MASK
                  : billingPanel?.cert_pfx_password != null
                    ? String(billingPanel.cert_pfx_password)
                    : ''
              }
              readOnly={maskedCertPass}
              disabled={disabled}
              autoComplete="new-password"
              name="sunat-manual-cert-pass"
              placeholder={maskedCertPass ? '' : 'Contraseña del certificado'}
              onFocus={() => {
                if (maskedCertPass) beginSecretEdit('cert_pfx_password', setCertPassEditing);
              }}
              onBlur={() => {
                endSecretEdit(
                  'cert_pfx_password',
                  certPassEditing,
                  setCertPassEditing,
                  billingPanelPresence?.cert_pfx_password
                );
              }}
              onChange={(e) => onBillingPanelField('cert_pfx_password', e.target.value)}
            />
            {maskedCertPass ? (
              <p className="text-[10px] text-[var(--ui-muted)] mt-1">Guardada. Pulse el campo para cambiarla.</p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Ambiente SUNAT</label>
            <select
              className={inputCls}
              value={billingPanel?.sunat_modo === 'produccion' ? 'produccion' : 'beta'}
              disabled={disabled}
              onChange={(e) => onBillingPanelField('sunat_modo', e.target.value)}
            >
              <option value="beta">Beta (pruebas)</option>
              <option value="produccion">Producción</option>
            </select>
            <p className="text-[10px] text-[var(--ui-muted)] mt-1">
              Use beta hasta validar el certificado. Producción emite comprobantes reales.
            </p>
          </div>
        </div>
      </div>

      <div className={sectionCls}>
        <h4 className={hCls}>Series y correlativos</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Serie de factura</label>
            <input
              className={inputCls}
              value={restaurant?.billing_series_factura ?? ''}
              disabled={disabled}
              onChange={(e) => onRestaurantField('billing_series_factura', (e.target.value || '').toUpperCase())}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Serie de boleta</label>
            <input
              className={inputCls}
              value={restaurant?.billing_series_boleta ?? ''}
              disabled={disabled}
              onChange={(e) => onRestaurantField('billing_series_boleta', (e.target.value || '').toUpperCase())}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Correlativo inicial factura</label>
            <input
              type="number"
              min={1}
              max={99999999}
              className={inputCls}
              value={corrFact}
              disabled={disabled}
              onChange={(e) => onBillingPanelField('correlativo_inicial_factura', Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Correlativo inicial boleta</label>
            <input
              type="number"
              min={1}
              max={99999999}
              className={inputCls}
              value={corrBol}
              disabled={disabled}
              onChange={(e) => onBillingPanelField('correlativo_inicial_boleta', Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
        </div>
      </div>

      <div className={sectionCls}>
        <h4 className={hCls}>Moneda e IGV</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Moneda</label>
            <select
              className={inputCls}
              value={restaurant?.currency ?? 'PEN'}
              disabled={disabled}
              onChange={(e) => onRestaurantField('currency', e.target.value)}
            >
              <option value="PEN">PEN</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>IGV (%)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              className={inputCls}
              value={Number.isFinite(Number(restaurant?.tax_rate)) ? restaurant.tax_rate : 18}
              disabled={disabled}
              onChange={(e) => onRestaurantField('tax_rate', parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
      </div>

      <div className={sectionCls}>
        <h4 className={hCls}>Series de contingencia</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Serie factura contingencia</label>
            <input
              className={inputCls}
              value={appConfig?.series_contingencia?.factura || ''}
              disabled={disabled}
              onChange={(e) => onSeriesContingencia('factura', e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Serie boleta contingencia</label>
            <input
              className={inputCls}
              value={appConfig?.series_contingencia?.boleta || ''}
              disabled={disabled}
              onChange={(e) => onSeriesContingencia('boleta', e.target.value.toUpperCase())}
            />
          </div>
          <div className="md:col-span-2">
            <label className={`block text-xs font-medium mb-1 ${labelCls}`}>Modo contingencia</label>
            <select
              className={inputCls}
              value={appConfig?.series_contingencia?.enabled ? '1' : '0'}
              disabled={disabled}
              onChange={(e) => onSeriesContingencia('enabled', Number(e.target.value))}
            >
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </div>
        </div>
      </div>
    </form>
  );
}
