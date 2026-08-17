import { useEffect, useState } from 'react';
import { MdSave, MdPreview } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

const TIMEZONES = [
  { value: 'America/Lima', label: 'America/Lima (UTC-5)' },
  { value: 'America/Bogota', label: 'America/Bogota (UTC-5)' },
  { value: 'America/Mexico_City', label: 'America/Mexico_City (UTC-6)' },
  { value: 'America/Santiago', label: 'America/Santiago' },
  { value: 'America/Buenos_Aires', label: 'America/Buenos_Aires' },
];

export default function SettingsRegionalPanel({ regional, setRegional, onSave, saving, hasUnsaved }) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .post('/admin-modules/config/regional-preview', { regional: regional || {} })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [regional]);

  const update = (key, value) => {
    setRegional((prev) => ({ ...(prev || {}), [key]: value }));
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-semibold text-[var(--ui-body-text)] mb-4">Configuración regional</h3>
        {hasUnsaved ? (
          <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">Tienes cambios pendientes en esta sección.</p>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">País</label>
            <select className="input-field" value={regional?.country || 'Peru'} onChange={(e) => update('country', e.target.value)}>
              <option>Peru</option>
              <option>Colombia</option>
              <option>Mexico</option>
              <option>Argentina</option>
              <option>Chile</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Zona horaria</label>
            <select className="input-field" value={regional?.timezone || 'America/Lima'} onChange={(e) => update('timezone', e.target.value)}>
              {TIMEZONES.map((z) => (
                <option key={z.value} value={z.value}>{z.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">
              {t('regional.systemLanguage', { defaultValue: 'Idioma del sistema' })}
            </label>
            <select
              className="input-field"
              value={regional?.language || 'es'}
              onChange={(e) => update('language', e.target.value)}
            >
              <option value="es">{tc('language.es')}</option>
              <option value="en">{tc('language.en')}</option>
            </select>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              {t('regional.systemLanguageHint', {
                defaultValue: 'El idioma de menús cambia solo después de «Guardar regional» (no al elegir en la lista).',
              })}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Idioma tickets</label>
            <select className="input-field" value={regional?.ticket_language || 'es'} onChange={(e) => update('ticket_language', e.target.value)}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Formato fecha</label>
            <select className="input-field" value={regional?.date_format || 'DD/MM/YYYY'} onChange={(e) => update('date_format', e.target.value)}>
              <option>DD/MM/YYYY</option>
              <option>MM/DD/YYYY</option>
              <option>YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Formato hora</label>
            <select className="input-field" value={regional?.time_format || '24h'} onChange={(e) => update('time_format', e.target.value)}>
              <option value="24h">24 horas</option>
              <option value="12h">12 horas (AM/PM)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Moneda</label>
            <select className="input-field" value={regional?.currency_code || 'PEN'} onChange={(e) => {
              const code = e.target.value;
              update('currency_code', code);
              if (code === 'USD') update('currency_symbol', '$');
              else if (code === 'PEN') update('currency_symbol', 'S/');
            }}>
              <option value="PEN">PEN — Sol</option>
              <option value="USD">USD — Dólar</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Símbolo moneda</label>
            <input className="input-field" value={regional?.currency_symbol || 'S/'} onChange={(e) => update('currency_symbol', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Separador decimal</label>
            <select className="input-field" value={regional?.decimal_separator || '.'} onChange={(e) => update('decimal_separator', e.target.value)}>
              <option value=".">Punto (1,234.56)</option>
              <option value=",">Coma (1.234,56)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Separador miles</label>
            <select className="input-field" value={regional?.thousands_separator || ','} onChange={(e) => update('thousands_separator', e.target.value)}>
              <option value=",">Coma</option>
              <option value=".">Punto</option>
              <option value=" ">Espacio</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Decimales</label>
            <input type="number" min={0} max={4} className="input-field" value={regional?.number_decimals ?? 2} onChange={(e) => update('number_decimals', parseInt(e.target.value, 10) || 0)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Redondeo</label>
            <select className="input-field" value={regional?.rounding_mode || 'standard'} onChange={(e) => update('rounding_mode', e.target.value)}>
              <option value="standard">Estándar</option>
              <option value="up">Arriba</option>
              <option value="down">Abajo</option>
            </select>
          </div>
        </div>
      </div>

      {preview?.samples ? (
        <div className="card border-dashed border-gold-500/30 bg-gold-500/5">
          <h4 className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2 mb-3">
            <MdPreview /> Vista previa en vivo
          </h4>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-[var(--ui-muted)]">Fecha</dt><dd className="font-medium">{preview.samples.date}</dd></div>
            <div><dt className="text-[var(--ui-muted)]">Hora</dt><dd className="font-medium">{preview.samples.time}</dd></div>
            <div><dt className="text-[var(--ui-muted)]">Moneda</dt><dd className="font-medium">{preview.samples.currency}</dd></div>
            <div><dt className="text-[var(--ui-muted)]">Número</dt><dd className="font-medium">{preview.samples.number}</dd></div>
            <div className="col-span-2"><dt className="text-[var(--ui-muted)]">Línea ticket</dt><dd className="font-mono text-xs mt-1">{preview.samples.ticket_line}</dd></div>
          </dl>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave?.(regional)}
          className="btn-primary flex items-center gap-2"
        >
          <MdSave /> {saving ? t('regional.saving', { defaultValue: 'Guardando…' }) : t('regional.save', { defaultValue: 'Guardar regional' })}
        </button>
      </div>
    </div>
  );
}
