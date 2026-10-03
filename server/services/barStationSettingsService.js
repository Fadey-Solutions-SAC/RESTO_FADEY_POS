/**
 * Compatibilidad: ajustes de bar en el formato antiguo, guardados en los ajustes del área "bar".
 */
const {
  AUTO_DISMISS_MINUTES_DEFAULT,
  AUTO_DISMISS_MINUTES_MIN,
  AUTO_DISMISS_MINUTES_MAX,
  normalizeAutoDismissMinutes,
  readAreaSettings,
  saveAreaSettings,
} = require('./productionAreaSettingsService');

const SETTINGS_KEY = 'bar_station_settings';

function toLegacyShape(area) {
  return {
    autoDismissPendingAfter30Min: Boolean(area.autoDismissEnabled),
    autoDismissMinutes: area.autoDismissMinutes,
  };
}

function readBarStationSettings() {
  return toLegacyShape(readAreaSettings('bar'));
}

function saveBarStationSettings(input) {
  const patch = input && typeof input === 'object' ? input : {};
  const next = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'autoDismissPendingAfter30Min')) {
    next.autoDismissEnabled = patch.autoDismissPendingAfter30Min;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'autoDismissMinutes')) {
    next.autoDismissMinutes = patch.autoDismissMinutes;
  }
  return toLegacyShape(saveAreaSettings('bar', next));
}

module.exports = {
  SETTINGS_KEY,
  BAR_AUTO_DISMISS_MINUTES_DEFAULT: AUTO_DISMISS_MINUTES_DEFAULT,
  BAR_AUTO_DISMISS_MINUTES_MIN: AUTO_DISMISS_MINUTES_MIN,
  BAR_AUTO_DISMISS_MINUTES_MAX: AUTO_DISMISS_MINUTES_MAX,
  normalizeAutoDismissMinutes,
  readBarStationSettings,
  saveBarStationSettings,
};
