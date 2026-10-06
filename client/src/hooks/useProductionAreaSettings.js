import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { useSocket } from './useSocket';
import { DEFAULT_AREA_SETTINGS } from '../components/kitchen/ProductionAreaSettingsSection';

const DEVICE_AREA_SOUND_KEY_PREFIX = 'resto_area_sound_device_v1';
const LEGACY_USER_AREA_SOUND_KEY_PREFIX = 'resto_area_sound_user_v1';
const USER_SOUND_FIELDS = new Set(['notifyEnabled', 'notifyVolume']);

/**
 * Ajustes de un área de producción (cocina, bar u otra).
 * Sonido y volumen son de cada equipo (localStorage): caja puede ver cocina sin que suene en su laptop.
 * Demora y auto-despacho son del área (API).
 * Se usa en el panel del área y en Mi perfil, para que ambos lean y guarden lo mismo.
 */
export function useProductionAreaSettings(areaId, user, { onAutoDismissSaved } = {}) {
  const { t } = useTranslation('kitchen');
  const [settings, setSettings] = useState(DEFAULT_AREA_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const settingsRef = useRef(DEFAULT_AREA_SETTINGS);
  settingsRef.current = settings;
  const onAutoDismissSavedRef = useRef(onAutoDismissSaved);
  onAutoDismissSavedRef.current = onAutoDismissSaved;

  const userSoundKey = `${DEVICE_AREA_SOUND_KEY_PREFIX}:${areaId}`;
  const legacySoundKey = `${LEGACY_USER_AREA_SOUND_KEY_PREFIX}:${user?.id || 'anon'}:${areaId}`;
  const userSoundKeyRef = useRef(userSoundKey);
  userSoundKeyRef.current = userSoundKey;
  const legacySoundKeyRef = useRef(legacySoundKey);
  legacySoundKeyRef.current = legacySoundKey;

  const readUserSoundPrefs = useCallback(() => {
    try {
      const raw = window.localStorage?.getItem(userSoundKeyRef.current)
        ?? window.localStorage?.getItem(legacySoundKeyRef.current);
      const data = raw ? JSON.parse(raw) : null;
      if (!data || typeof data !== 'object') return {};
      const prefs = {};
      if (typeof data.notifyEnabled === 'boolean') prefs.notifyEnabled = data.notifyEnabled;
      const vol = Number(data.notifyVolume);
      if (Number.isFinite(vol) && vol >= 10 && vol <= 100) prefs.notifyVolume = vol;
      return prefs;
    } catch (_) {
      return {};
    }
  }, []);

  const mergeSettings = useCallback(
    (serverSettings) => ({
      ...DEFAULT_AREA_SETTINGS,
      ...(serverSettings || {}),
      notifyEnabled: DEFAULT_AREA_SETTINGS.notifyEnabled,
      notifyVolume: DEFAULT_AREA_SETTINGS.notifyVolume,
      ...readUserSoundPrefs(),
    }),
    [readUserSoundPrefs],
  );

  useEffect(() => {
    if (!areaId) return undefined;
    let cancelled = false;
    setLoaded(false);
    setSettings(mergeSettings(null));
    api
      .get(`/orders/production-area-settings/${encodeURIComponent(areaId)}`)
      .then((data) => {
        if (cancelled) return;
        setSettings(mergeSettings(data));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [areaId, userSoundKey, legacySoundKey, mergeSettings]);

  const saveUserSoundPrefs = (patch) => {
    const next = { ...readUserSoundPrefs(), ...patch };
    try {
      window.localStorage?.setItem(userSoundKeyRef.current, JSON.stringify(next));
    } catch (_) {
      /* noop */
    }
    setSettings((prev) => ({ ...prev, ...patch }));
    if ('notifyEnabled' in patch) {
      toast.success(patch.notifyEnabled ? t('barSettings.notifyOnToast') : t('barSettings.notifyOffToast'));
    } else if ('notifyVolume' in patch) {
      toast.success(t('barSettings.volumeSaved', { volume: patch.notifyVolume }));
    }
  };

  const save = async (rawPatch) => {
    const soundPatch = {};
    const patch = {};
    Object.entries(rawPatch || {}).forEach(([k, v]) => {
      if (USER_SOUND_FIELDS.has(k)) soundPatch[k] = v;
      else patch[k] = v;
    });
    if (Object.keys(soundPatch).length) saveUserSoundPrefs(soundPatch);
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      const saved = await api.put(`/orders/production-area-settings/${encodeURIComponent(areaId)}`, patch);
      setSettings(mergeSettings(saved));
      if ('autoDismissEnabled' in patch) {
        toast.success(
          saved?.autoDismissEnabled
            ? t('barSettings.enabledToast', { minutes: saved.autoDismissMinutes })
            : t('barSettings.disabledToast'),
        );
        onAutoDismissSavedRef.current?.();
      } else if ('autoDismissMinutes' in patch) {
        toast.success(t('barSettings.minutesSaved', { minutes: saved.autoDismissMinutes }));
        onAutoDismissSavedRef.current?.();
      }
    } catch (err) {
      toast.error(err?.message || t('barSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  useSocket('production-area-settings-update', (payload) => {
    if (!payload || String(payload.areaId) !== String(areaId)) return;
    setSettings(mergeSettings(payload.settings));
  });

  return { settings, loaded, saving, save, settingsRef };
}
