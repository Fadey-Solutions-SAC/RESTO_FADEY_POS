import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdNotificationsActive, MdTimerOff, MdVolumeOff, MdVolumeUp } from 'react-icons/md';
import {
  isNotificationAudioUnlocked,
  onNotificationAudioUnlockChange,
  playNotificationSound,
  unlockNotificationAudio,
} from '../../utils/playNotificationSound';

export const DEFAULT_AREA_SETTINGS = Object.freeze({
  autoDismissEnabled: false,
  autoDismissMinutes: 30,
  notifyEnabled: true,
  notifyVolume: 100,
});

export const AUTO_DISMISS_MINUTE_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

const CARD = 'rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-3';

export default function ProductionAreaSettingsSection({
  settings,
  loaded = true,
  saving = false,
  onSave,
  stationLabel,
  soundType = 'kitchen',
}) {
  const { t } = useTranslation('kitchen');
  const [volume, setVolume] = useState(settings.notifyVolume);
  const [soundReady, setSoundReady] = useState(() => isNotificationAudioUnlocked());
  const disabled = saving || !loaded;

  useEffect(() => setVolume(settings.notifyVolume), [settings.notifyVolume]);
  useEffect(() => onNotificationAudioUnlockChange((ready) => setSoundReady(Boolean(ready))), []);

  const testSound = async (vol = volume) => {
    await unlockNotificationAudio();
    playNotificationSound(soundType, `cfg-test-${Date.now()}`, { force: true, volume: vol / 100 });
  };

  const commitVolume = () => {
    if (volume === settings.notifyVolume) return;
    void onSave({ notifyVolume: volume });
    void testSound(volume);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ui-muted)]">{t('barSettings.modalHint')}</p>

      <div className={CARD}>
        <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
          <MdNotificationsActive className="text-lg text-[var(--ui-accent)]" />
          {t('barSettings.notifyTitle')}
        </p>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-[color:var(--ui-border)]"
            checked={Boolean(settings.notifyEnabled)}
            disabled={disabled}
            onChange={(e) => void onSave({ notifyEnabled: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium text-[var(--ui-body-text)]">{t('barSettings.notifyLabel')}</span>
            <span className="block text-xs text-[var(--ui-muted)] mt-1">{t('barSettings.notifyHelp')}</span>
          </span>
        </label>
        {settings.notifyEnabled ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--ui-body-text)]">{t('barSettings.volumeLabel')}</span>
              <span className="text-sm font-bold tabular-nums text-[var(--ui-body-text)]">{volume}%</span>
            </div>
            <div className="flex items-center gap-2">
              <MdVolumeOff className="text-lg text-[var(--ui-muted)] shrink-0" />
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={volume}
                disabled={disabled}
                onChange={(e) => setVolume(Number(e.target.value))}
                onPointerUp={commitVolume}
                onKeyUp={commitVolume}
                className="w-full accent-[var(--ui-accent)]"
                aria-label={t('barSettings.volumeLabel')}
              />
              <MdVolumeUp className="text-lg text-[var(--ui-muted)] shrink-0" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--ui-muted)]">
                {soundReady ? t('barSettings.volumeHelp') : t('barSettings.soundBlocked')}
              </span>
              <button
                type="button"
                className={`text-sm inline-flex items-center gap-1.5 shrink-0 ${soundReady ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => void testSound()}
              >
                <MdVolumeUp />
                {soundReady ? t('barSettings.testSound') : t('barSettings.activateSound')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={CARD}>
        <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
          <MdTimerOff className="text-lg text-[var(--ui-accent)]" />
          {t('barSettings.sectionTitle', { station: stationLabel })}
        </p>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-[color:var(--ui-border)]"
            checked={Boolean(settings.autoDismissEnabled)}
            disabled={disabled}
            onChange={(e) => void onSave({ autoDismissEnabled: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium text-[var(--ui-body-text)]">{t('barSettings.toggleLabel')}</span>
            <span className="block text-xs text-[var(--ui-muted)] mt-1">
              {t('barSettings.toggleHelp', { station: stationLabel })}
            </span>
          </span>
        </label>
        {settings.autoDismissEnabled ? (
          <label className="block">
            <span className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('barSettings.minutesLabel')}</span>
            <select
              className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 text-sm text-[var(--ui-body-text)]"
              value={settings.autoDismissMinutes}
              disabled={disabled}
              onChange={(e) => void onSave({ autoDismissMinutes: Number(e.target.value) })}
            >
              {AUTO_DISMISS_MINUTE_OPTIONS.map((mins) => (
                <option key={mins} value={mins}>
                  {t('barSettings.minutesOption', { count: mins })}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--ui-muted)] mt-1">{t('barSettings.minutesHelp')}</span>
          </label>
        ) : null}
      </div>

      {saving ? <p className="text-xs text-[var(--ui-muted)]">{t('barSettings.saving')}</p> : null}
    </div>
  );
}
