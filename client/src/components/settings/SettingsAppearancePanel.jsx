import { useState, useMemo } from 'react';
import { MdDarkMode, MdLightMode, MdSettingsBrightness, MdPerson, MdStore } from 'react-icons/md';
import {
  UI_THEME_OPTIONS,
  PREMIUM_THEME_IDS,
  applyUiTheme,
  applyUiThemeFromAppSettings,
  getValidUiThemeId,
  readUserUiThemePreference,
  saveUserUiThemePreference,
  UI_THEME_MODE_IDS,
  CUSTOM_THEME_VAR_KEYS,
} from '../../theme/uiTheme';
import { getThemePreset } from '../../theme/themePresets';

function ThemePreviewCard({ opt, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition-all hover:shadow-md ${
        selected
          ? 'border-[var(--ui-accent-muted)] ring-2 ring-[var(--ui-accent-muted)]/40 shadow-rf'
          : 'border-[color:var(--ui-border)] hover:border-[var(--ui-accent-muted)]'
      }`}
    >
      <div
        className="flex gap-2 mb-2 h-10 rounded-lg overflow-hidden border border-[color:var(--ui-border)]"
        style={{ background: opt.bodyBg }}
      >
        <span className="w-1/3 h-full" style={{ background: opt.swatch }} />
        <span className="flex-1 h-full" style={{ background: opt.surface }} />
      </div>
      <p className="font-semibold text-sm text-[var(--ui-body-text)]">{opt.label}</p>
      <p className="text-xs text-[var(--ui-muted)] mt-0.5 line-clamp-2">{opt.description}</p>
      {opt.premium ? (
        <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--ui-accent-muted)]">
          Premium
        </span>
      ) : null}
    </button>
  );
}

function readRestaurantCustom(appSettings) {
  return appSettings?.ui_theme_custom && typeof appSettings.ui_theme_custom === 'object'
    ? appSettings.ui_theme_custom
    : {};
}

export default function SettingsAppearancePanel({
  appSettings,
  setAppSettings,
  currentUserId,
  onSaveRestaurantAppearance,
}) {
  const [prefRevision, setPrefRevision] = useState(0);
  const bumpPref = () => setPrefRevision((n) => n + 1);

  const restaurantTheme = getValidUiThemeId(appSettings?.ui_theme);
  const restaurantMode = UI_THEME_MODE_IDS.includes(appSettings?.ui_theme_mode)
    ? appSettings.ui_theme_mode
    : 'light';
  const restaurantCustom = readRestaurantCustom(appSettings);

  const userPref = useMemo(() => {
    void prefRevision;
    return currentUserId ? readUserUiThemePreference(currentUserId) : null;
  }, [currentUserId, prefRevision]);

  const personalEnabled = Boolean(userPref?.usePersonal);

  const current = personalEnabled && userPref?.theme
    ? getValidUiThemeId(userPref.theme)
    : restaurantTheme;
  const mode = personalEnabled && userPref?.mode && UI_THEME_MODE_IDS.includes(userPref.mode)
    ? userPref.mode
    : restaurantMode;
  const custom = personalEnabled
    ? { ...restaurantCustom, ...(userPref?.custom || {}) }
    : restaurantCustom;

  const premiumOptions = UI_THEME_OPTIONS.filter((o) => PREMIUM_THEME_IDS.includes(o.id));
  const legacyOptions = UI_THEME_OPTIONS.filter((o) => !PREMIUM_THEME_IDS.includes(o.id));

  const applyRestaurantPatch = (patch, { debounceMs = 0 } = {}) => {
    const next = { ...appSettings, ...patch };
    setAppSettings(next);
    applyUiThemeFromAppSettings(next, currentUserId);
    onSaveRestaurantAppearance?.(next, { debounceMs });
  };

  const applyPersonalPatch = (patch) => {
    if (!currentUserId) return;
    const nextPref = {
      usePersonal: true,
      theme: getValidUiThemeId(patch.theme ?? current),
      mode: UI_THEME_MODE_IDS.includes(patch.mode) ? patch.mode : mode,
      custom: patch.custom !== undefined ? patch.custom : custom,
    };
    saveUserUiThemePreference(currentUserId, nextPref);
    applyUiTheme(nextPref.theme, {
      custom: nextPref.custom,
      mode: nextPref.mode,
      userId: currentUserId,
      persist: true,
      writeGlobalStorage: false,
    });
    bumpPref();
  };

  const selectTheme = (themeId) => {
    if (personalEnabled) applyPersonalPatch({ theme: themeId });
    else applyRestaurantPatch({ ui_theme: themeId });
  };

  const setMode = (nextMode) => {
    if (personalEnabled) applyPersonalPatch({ mode: nextMode });
    else applyRestaurantPatch({ ui_theme_mode: nextMode });
  };

  const setCustomVar = (cssKey, value) => {
    const nextCustom = { ...custom, [cssKey]: value };
    if (personalEnabled) applyPersonalPatch({ custom: nextCustom });
    else applyRestaurantPatch({ ui_theme_custom: nextCustom }, { debounceMs: 600 });
  };

  const togglePersonalTheme = (enabled) => {
    if (!currentUserId) return;
    if (enabled) {
      saveUserUiThemePreference(currentUserId, {
        usePersonal: true,
        theme: restaurantTheme,
        mode: restaurantMode,
        custom: restaurantCustom,
      });
      applyUiTheme(restaurantTheme, {
        custom: restaurantCustom,
        mode: restaurantMode,
        userId: currentUserId,
        persist: true,
        writeGlobalStorage: false,
      });
    } else {
      saveUserUiThemePreference(currentUserId, {
        ...(userPref || {}),
        usePersonal: false,
      });
      applyUiThemeFromAppSettings(appSettings, currentUserId);
    }
    bumpPref();
  };

  const restoreCustomColors = () => {
    if (personalEnabled) applyPersonalPatch({ custom: {} });
    else applyRestaurantPatch({ ui_theme_custom: {} });
  };

  const preset = getThemePreset(current);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="card">
        <h3 className="rf-font-display text-lg font-semibold text-[var(--ui-body-text)] mb-4">
          Temas premium
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {premiumOptions.map((opt) => (
            <ThemePreviewCard
              key={opt.id}
              opt={opt}
              selected={current === opt.id}
              onSelect={() => selectTheme(opt.id)}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-[var(--ui-body-text)] mb-3">Modo de apariencia</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'light', label: 'Claro', icon: MdLightMode },
            { id: 'dark', label: 'Oscuro', icon: MdDarkMode },
            { id: 'auto', label: 'Automático', icon: MdSettingsBrightness },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                mode === id
                  ? 'border-[var(--ui-accent-muted)] bg-[var(--ui-sidebar-active-bg)] text-[var(--ui-body-text)]'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              <Icon className="text-lg" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--ui-muted)] mt-3">
          El modo automático sigue la preferencia del sistema operativo (claro/oscuro).
        </p>
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-[var(--ui-body-text)] mb-4">Personalización avanzada</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CUSTOM_THEME_VAR_KEYS.map(({ key, label }) => (
            <label key={key} className="block">
              <span className="text-sm font-medium text-[var(--ui-body-text)] mb-1.5 block">{label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={
                    String(custom[key] || preset.vars[key] || '#2563eb').startsWith('#')
                      ? custom[key] || preset.vars[key]
                      : '#2563eb'
                  }
                  onChange={(e) => setCustomVar(key, e.target.value)}
                  className="h-10 w-14 rounded-lg border border-[color:var(--ui-border)] cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={custom[key] || ''}
                  placeholder={preset.vars[key] || ''}
                  onChange={(e) => setCustomVar(key, e.target.value)}
                  className="input-field flex-1 text-sm font-mono"
                />
              </div>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary mt-4 text-sm"
          onClick={restoreCustomColors}
        >
          Restaurar colores del tema
        </button>
      </div>

      {currentUserId ? (
        <div className="card">
          <h3 className="text-base font-semibold text-[var(--ui-body-text)] mb-2 flex items-center gap-2">
            <MdPerson /> Preferencia personal
          </h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={personalEnabled}
              onChange={(e) => togglePersonalTheme(e.target.checked)}
            />
            <span className="text-sm text-[var(--ui-body-text)]">
              Usar mi tema personal en este dispositivo (no afecta al resto del equipo). Si está desactivado, se usa el tema del restaurante{' '}
              <MdStore className="inline align-text-bottom" />.
            </span>
          </label>
          {personalEnabled ? (
            <p className="text-xs text-sky-300/90 mt-3 rounded-lg border border-sky-500/25 bg-sky-950/20 px-3 py-2">
              Los cambios de esta sección solo se guardan en este navegador. El tema del restaurante en el servidor no cambia.
            </p>
          ) : (
            <p className="text-xs text-[var(--ui-muted)] mt-3">
              Los cambios se sincronizan con el servidor y aplican a todo el personal.
            </p>
          )}
        </div>
      ) : null}

      <details className="card">
        <summary className="cursor-pointer font-semibold text-[var(--ui-body-text)]">
          Temas clásicos ({legacyOptions.length})
        </summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {legacyOptions.map((opt) => (
            <ThemePreviewCard
              key={opt.id}
              opt={opt}
              selected={current === opt.id}
              onSelect={() => selectTheme(opt.id)}
            />
          ))}
        </div>
      </details>

      <p className="text-xs text-[var(--ui-muted)]">
        {personalEnabled ? (
          <>
            Tema personal activo en este dispositivo:{' '}
            <strong className="text-[var(--ui-body-text)]">{preset.label}</strong>.
            Tema del restaurante (servidor):{' '}
            <strong className="text-[var(--ui-body-text)]">{getThemePreset(restaurantTheme).label}</strong>.
          </>
        ) : (
          <>
            Tema del restaurante (servidor):{' '}
            <strong className="text-[var(--ui-body-text)]">{preset.label}</strong>.
          </>
        )}
      </p>
    </div>
  );
}
