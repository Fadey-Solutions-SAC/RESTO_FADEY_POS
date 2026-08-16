import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  MdStore,
  MdImage,
  MdReceipt,
  MdPercent,
  MdDeliveryDining,
  MdQrCode2,
  MdChat,
  MdSchedule,
  MdPeople,
  MdLink,
} from 'react-icons/md';
import { notifyDeliveryEnabledChanged } from '../../hooks/useDeliveryEnabled';
import { resolveMediaUrl } from '../../utils/api';
import { MESSAGE_VARIABLES_HELP } from '../../data/miRestaurantProfileDefaults';
import TicketPreviewPanel from './TicketPreviewPanel';

const EMPRESA_TABS = [
  { id: 'info', label: 'Información', icon: MdStore },
  { id: 'identidad', label: 'Identidad visual', icon: MdImage },
  { id: 'tickets', label: 'Tickets', icon: MdReceipt },
  { id: 'tributaria', label: 'Tributaria', icon: MdPercent },
  { id: 'delivery', label: 'Delivery', icon: MdDeliveryDining },
  { id: 'qr', label: 'QR / menú', icon: MdQrCode2 },
  { id: 'mensajes', label: 'Mensajes', icon: MdChat },
  { id: 'schedule', label: 'Horarios', icon: MdSchedule },
];

function Field({ label, children, hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-[var(--ui-muted)] mt-0.5">{hint}</p> : null}
    </div>
  );
}

function ImageUploadTile({ label, url, onPick, onClear, circular = false }) {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--ui-border)] p-3 bg-[var(--ui-surface-2)]">
      <p className="text-xs font-medium text-[var(--ui-body-text)] mb-2">{label}</p>
      <div
        className={`bg-[var(--ui-surface)] flex items-center justify-center overflow-hidden cursor-pointer border border-[color:var(--ui-border)] ${
          circular ? 'w-24 h-24 mx-auto rounded-full' : 'w-full h-24 rounded-lg'
        }`}
        onClick={onPick}
        onKeyDown={(e) => e.key === 'Enter' && onPick()}
        role="button"
        tabIndex={0}
      >
        {url ? (
          <img
            src={resolveMediaUrl(url)}
            alt=""
            className={circular ? 'w-full h-full object-cover' : 'max-h-full max-w-full object-contain'}
          />
        ) : (
          <MdImage className="text-3xl text-[var(--ui-muted)]" />
        )}
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" className="text-xs text-gold-600 hover:underline" onClick={onPick}>
          Subir
        </button>
        {url ? (
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={onClear}>
            Quitar
          </button>
        ) : null}
      </div>
    </div>
  );
}


export default function MiRestaurantEmpresaHub({
  tab,
  setTab,
  restaurant,
  profile,
  onRestaurantField,
  onProfileSection,
  onUploadLogoMain,
  onUploadBranding,
  scheduleSection,
  validationErrors = [],
  autosaveStatus = '',
}) {
  const fileRefs = useRef({});

  const pickFile = (key, handler) => {
    if (!fileRefs.current[key]) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.onchange = (e) => {
        const f = e.target.files?.[0];
        if (f) void handler(f);
        input.value = '';
      };
      fileRefs.current[key] = input;
    }
    fileRefs.current[key].click();
  };

  const g = profile?.general || {};
  const b = profile?.branding || {};
  const t = profile?.ticket || {};
  const d = profile?.delivery_extra || {};
  const q = profile?.qr || {};
  const m = profile?.messages || {};
  const deliveryOn = Number(restaurant.delivery_enabled) === 1;

  const toggleDelivery = () => {
    const next = !deliveryOn;
    onRestaurantField('delivery_enabled', next ? 1 : 0);
    notifyDeliveryEnabledChanged(next);
  };

  const messageFields = [
    ['ticket', 'Mensaje en ticket'],
    ['reservas', 'Reservas'],
    ...(deliveryOn ? [['delivery', 'Delivery']] : []),
    ['promos', 'Promociones'],
    ['clientes', 'Clientes'],
    ['whatsapp', 'Plantilla WhatsApp'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {EMPRESA_TABS.map((tdef) => (
          <button
            key={tdef.id}
            type="button"
            onClick={() => setTab(tdef.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition ${
              tab === tdef.id
                ? 'bg-gold-600 text-white border-gold-600'
                : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
          >
            <tdef.icon className="text-lg shrink-0" /> {tdef.label}
          </button>
        ))}
      </div>

      {validationErrors.length > 0 ? (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {validationErrors.join(' · ')}
        </div>
      ) : null}
      {autosaveStatus ? (
        <p className="text-xs text-[var(--ui-muted)]">{autosaveStatus}</p>
      ) : null}

      {tab === 'info' && (
        <div className="card space-y-6">
          <section>
            <h3 className="font-bold text-[var(--ui-body-text)] mb-3">Datos comerciales y fiscales</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nombre comercial *">
                <input className="input-field" value={restaurant.name || ''} onChange={(e) => onRestaurantField('name', e.target.value)} required />
              </Field>
              <Field label="Razón social">
                <input className="input-field" value={restaurant.legal_name || ''} onChange={(e) => onRestaurantField('legal_name', e.target.value)} />
              </Field>
              <Field label="RUC">
                <input className="input-field" value={restaurant.company_ruc || ''} onChange={(e) => onRestaurantField('company_ruc', e.target.value)} maxLength={11} placeholder="11 dígitos" />
              </Field>
              <Field label="Nombre comercial (facturación)">
                <input className="input-field" value={restaurant.billing_nombre_comercial || ''} onChange={(e) => onRestaurantField('billing_nombre_comercial', e.target.value)} />
              </Field>
              <Field label="Dirección fiscal" className="md:col-span-2">
                <input className="input-field" value={restaurant.billing_emisor_direccion || restaurant.address || ''} onChange={(e) => onRestaurantField('billing_emisor_direccion', e.target.value)} />
              </Field>
              <Field label="Referencia / indicaciones">
                <input className="input-field" value={g.address_reference || ''} onChange={(e) => onProfileSection('general', 'address_reference', e.target.value)} />
              </Field>
            </div>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ui-body-text)] mb-3">Contacto</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Teléfono principal">
                <input className="input-field" value={restaurant.phone || ''} onChange={(e) => onRestaurantField('phone', e.target.value)} />
              </Field>
              <Field label="Teléfono secundario">
                <input className="input-field" value={g.phone_secondary || ''} onChange={(e) => onProfileSection('general', 'phone_secondary', e.target.value)} />
              </Field>
              <Field label="WhatsApp">
                <input className="input-field" value={g.whatsapp || ''} onChange={(e) => onProfileSection('general', 'whatsapp', e.target.value)} placeholder="+51 999 999 999" />
              </Field>
              <Field label="Correo electrónico">
                <input type="email" className="input-field" value={restaurant.email || ''} onChange={(e) => onRestaurantField('email', e.target.value)} />
              </Field>
              <Field label="Página web">
                <input className="input-field" value={g.website || ''} onChange={(e) => onProfileSection('general', 'website', e.target.value)} placeholder="https://..." />
              </Field>
            </div>
          </section>
          <section>
            <h3 className="font-bold text-[var(--ui-body-text)] mb-3">Redes y descripción</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Field label="Facebook">
                <input className="input-field" value={g.social_facebook || ''} onChange={(e) => onProfileSection('general', 'social_facebook', e.target.value)} />
              </Field>
              <Field label="Instagram">
                <input className="input-field" value={g.social_instagram || ''} onChange={(e) => onProfileSection('general', 'social_instagram', e.target.value)} />
              </Field>
              <Field label="TikTok">
                <input className="input-field" value={g.social_tiktok || ''} onChange={(e) => onProfileSection('general', 'social_tiktok', e.target.value)} />
              </Field>
            </div>
            <Field label="Descripción del restaurante">
              <textarea className="input-field min-h-[88px]" value={g.description || ''} onChange={(e) => onProfileSection('general', 'description', e.target.value)} placeholder="Breve texto para QR, carta digital o reportes." />
            </Field>
          </section>
        </div>
      )}

      {tab === 'identidad' && (
        <div className="card">
          <h3 className="font-bold text-[var(--ui-body-text)] mb-4">Logos e identidad visual</h3>
          <p className="text-sm text-[var(--ui-muted)] mb-4">Se usan en tickets, encabezados, QR, inicio de sesión y reportes. Formatos PNG/JPG/WebP recomendados.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ImageUploadTile label="Logo principal" url={restaurant.logo} circular onPick={() => pickFile('logo_main', onUploadLogoMain)} onClear={() => onRestaurantField('logo', '')} />
            <ImageUploadTile label="Logo tickets" url={b.logo_ticket} onPick={() => pickFile('logo_ticket', (f) => onUploadBranding('logo_ticket', f))} onClear={() => onProfileSection('branding', 'logo_ticket', '')} />
            <ImageUploadTile label="Fondo de portada" url={b.favicon} onPick={() => pickFile('favicon', (f) => onUploadBranding('favicon', f))} onClear={() => onProfileSection('branding', 'favicon', '')} />
            <ImageUploadTile label="Imagen portada QR" url={b.qr_hero_image} onPick={() => pickFile('qr_hero', (f) => onUploadBranding('qr_hero_image', f))} onClear={() => onProfileSection('branding', 'qr_hero_image', '')} />
          </div>
        </div>
      )}

      {tab === 'tickets' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div className="card space-y-4">
            <h3 className="font-bold text-[var(--ui-body-text)]">Configuración de tickets</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Ancho papel (mm)">
                <select className="input-field" value={t.paper_width_mm ?? 80} onChange={(e) => onProfileSection('ticket', 'paper_width_mm', Number(e.target.value))}>
                  <option value={58}>58 mm</option>
                  <option value={80}>80 mm</option>
                </select>
              </Field>
              <Field label="Alineación">
                <select className="input-field" value={t.alignment || 'center'} onChange={(e) => onProfileSection('ticket', 'alignment', e.target.value)}>
                  <option value="center">Centrado</option>
                  <option value="left">Izquierda</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!t.show_logo} onChange={(e) => onProfileSection('ticket', 'show_logo', e.target.checked ? 1 : 0)} />
                Mostrar logo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!t.show_qr} onChange={(e) => onProfileSection('ticket', 'show_qr', e.target.checked ? 1 : 0)} />
                Mostrar QR
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!t.show_social} onChange={(e) => onProfileSection('ticket', 'show_social', e.target.checked ? 1 : 0)} />
                Redes en pie
              </label>
            </div>
            <Field label="Mensaje de bienvenida">
              <input className="input-field" value={t.welcome_message || ''} onChange={(e) => onProfileSection('ticket', 'welcome_message', e.target.value)} />
            </Field>
            <Field label="Mensaje final">
              <input className="input-field" value={t.footer_message || ''} onChange={(e) => onProfileSection('ticket', 'footer_message', e.target.value)} placeholder="Ej. GRACIAS POR SU PREFERENCIA" />
            </Field>
            <Field label="Promociones en ticket">
              <input className="input-field" value={t.promo_message || ''} onChange={(e) => onProfileSection('ticket', 'promo_message', e.target.value)} />
            </Field>
            <Field label="Observaciones automáticas">
              <input className="input-field" value={t.auto_notes || ''} onChange={(e) => onProfileSection('ticket', 'auto_notes', e.target.value)} />
            </Field>
            <Field label="Pie personalizado">
              <textarea className="input-field min-h-[60px]" value={t.custom_footer || ''} onChange={(e) => onProfileSection('ticket', 'custom_footer', e.target.value)} />
            </Field>
            <p className="text-xs text-[var(--ui-muted)]">
              Elija el tipo de ticket en la vista previa (precuenta, pedido
              {deliveryOn ? ', delivery' : ''}
              , nota de venta, boleta, factura).
              La impresión real usa la misma plantilla y la configuración de impresoras en Configuración → Impresoras.
            </p>
          </div>
          <TicketPreviewPanel restaurant={restaurant} profile={profile} showDeliveryType={deliveryOn} />
        </div>
      )}

      {tab === 'tributaria' && (
        <div className="card space-y-4">
          <h3 className="font-bold text-[var(--ui-body-text)]">Configuración tributaria</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="IGV (%)">
              <input type="number" min="0" max="100" step="0.1" className="input-field" value={restaurant.tax_rate ?? 18} onChange={(e) => onRestaurantField('tax_rate', parseFloat(e.target.value) || 0)} />
            </Field>
            <Field label="Moneda">
              <input className="input-field" value={restaurant.currency || 'PEN'} onChange={(e) => onRestaurantField('currency', e.target.value)} />
            </Field>
            <Field label="Símbolo">
              <input className="input-field" value={restaurant.currency_symbol || 'S/'} onChange={(e) => onRestaurantField('currency_symbol', e.target.value)} />
            </Field>
            <Field label="Redondeo en ticket">
              <select className="input-field" value={profile?.tax_display?.rounding_mode || 'standard'} onChange={(e) => onProfileSection('tax_display', 'rounding_mode', e.target.value)}>
                <option value="standard">Estándar</option>
                <option value="up">Hacia arriba</option>
                <option value="down">Hacia abajo</option>
              </select>
            </Field>
          </div>
          <p className="text-sm text-[var(--ui-muted)] flex items-center gap-1 flex-wrap">
            <MdLink className="shrink-0" />
            Series SUNAT, correlativos y bot de facturación:
            <Link to="/admin/mi-restaurant?view=facturacion_electronica" className="text-gold-600 font-semibold hover:underline">
              Facturación electrónica
            </Link>
          </p>
        </div>
      )}

      {tab === 'delivery' && (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--ui-body-text)]">
              {deliveryOn ? 'Activado en su negocio' : 'Desactivado'}
            </p>
            <button
              type="button"
              className={deliveryOn ? 'btn-secondary text-sm' : 'btn-primary text-sm'}
              onClick={toggleDelivery}
            >
              {deliveryOn ? 'Desactivar' : 'Activar'}
            </button>
          </div>
          {deliveryOn ? (
          <div className="card space-y-4">
            <h4 className="font-bold text-[var(--ui-body-text)]">Configuración</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Costo delivery (S/)">
                <input type="number" step="0.5" className="input-field" value={restaurant.delivery_fee ?? 0} onChange={(e) => onRestaurantField('delivery_fee', parseFloat(e.target.value))} />
              </Field>
              <Field label="Pedido mínimo (S/)">
                <input type="number" step="1" className="input-field" value={restaurant.delivery_min_order ?? 0} onChange={(e) => onRestaurantField('delivery_min_order', parseFloat(e.target.value))} />
              </Field>
              <Field label="Radio cobertura (km)">
                <input type="number" step="0.5" className="input-field" value={restaurant.delivery_radius_km ?? 0} onChange={(e) => onRestaurantField('delivery_radius_km', parseFloat(e.target.value))} />
              </Field>
              <Field label="Tiempo estimado (min)">
                <input type="number" min="5" className="input-field" value={d.estimated_minutes ?? 45} onChange={(e) => onProfileSection('delivery_extra', 'estimated_minutes', parseInt(e.target.value, 10) || 45)} />
              </Field>
              <Field label="Teléfono contacto delivery">
                <input className="input-field" value={d.contact_phone || ''} onChange={(e) => onProfileSection('delivery_extra', 'contact_phone', e.target.value)} />
              </Field>
              <Field label="Mensaje para cliente" className="md:col-span-2">
                <textarea className="input-field min-h-[60px]" value={d.message || ''} onChange={(e) => onProfileSection('delivery_extra', 'message', e.target.value)} />
              </Field>
              <Field label="Observaciones automáticas" className="md:col-span-2">
                <input className="input-field" value={d.auto_notes || ''} onChange={(e) => onProfileSection('delivery_extra', 'auto_notes', e.target.value)} />
              </Field>
              <Field label="Zonas de cobertura (manual)" className="md:col-span-2" hint="Una zona por línea, ej. Miraflores, San Isidro">
                <textarea className="input-field min-h-[72px]" value={d.coverage_zones || ''} onChange={(e) => onProfileSection('delivery_extra', 'coverage_zones', e.target.value)} />
              </Field>
            </div>
          </div>
          ) : null}
        </div>
      )}

      {tab === 'qr' && (
        <div className="card space-y-4">
          <h3 className="font-bold text-[var(--ui-body-text)]">Configuración QR / Auto pedido</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Título portada">
              <input className="input-field" value={q.cover_title || ''} onChange={(e) => onProfileSection('qr', 'cover_title', e.target.value)} />
            </Field>
            <Field label="Color principal">
              <input type="color" className="input-field h-10 p-1" value={q.primary_color || '#f04438'} onChange={(e) => onProfileSection('qr', 'primary_color', e.target.value)} />
            </Field>
            <Field label="Mensaje bienvenida" className="md:col-span-2">
              <textarea className="input-field min-h-[60px]" value={q.welcome_message || ''} onChange={(e) => onProfileSection('qr', 'welcome_message', e.target.value)} />
            </Field>
            <Field label="URL banner promociones">
              <input className="input-field" value={q.banner_url || ''} onChange={(e) => onProfileSection('qr', 'banner_url', e.target.value)} placeholder="/uploads/..." />
            </Field>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={!!q.show_social} onChange={(e) => onProfileSection('qr', 'show_social', e.target.checked ? 1 : 0)} />
              Mostrar redes en menú QR
            </label>
            <Field label="Términos y condiciones" className="md:col-span-2">
              <textarea className="input-field min-h-[100px]" value={q.terms_text || ''} onChange={(e) => onProfileSection('qr', 'terms_text', e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-[var(--ui-muted)]">
            Cartas y mesas QR se gestionan en{' '}
            <Link to="/admin/auto-pedido" className="text-gold-600 hover:underline">
              Auto pedido
            </Link>
            .
          </p>
        </div>
      )}

      {tab === 'mensajes' && (
        <div className="card space-y-4">
          <h3 className="font-bold text-[var(--ui-body-text)]">Mensajes automáticos</h3>
          <p className="text-xs text-[var(--ui-muted)]">{MESSAGE_VARIABLES_HELP}</p>
          {messageFields.map(([key, label]) => (
            <Field key={key} label={label}>
              <textarea className="input-field min-h-[56px] font-mono text-sm" value={m[key] || ''} onChange={(e) => onProfileSection('messages', key, e.target.value)} />
            </Field>
          ))}
        </div>
      )}

      {tab === 'schedule' && scheduleSection}
    </div>
  );
}
