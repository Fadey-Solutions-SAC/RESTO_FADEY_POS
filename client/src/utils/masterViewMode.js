/** Vista del administrador maestro dentro del POS como si fuera el admin dueño. */

export const MASTER_VIEW_AS_OWNER_KEY = 'resto-master-view-as-owner';

export function isMasterViewingAsOwner() {
  try {
    return localStorage.getItem(MASTER_VIEW_AS_OWNER_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMasterViewAsOwner(enabled) {
  try {
    if (enabled) localStorage.setItem(MASTER_VIEW_AS_OWNER_KEY, '1');
    else localStorage.removeItem(MASTER_VIEW_AS_OWNER_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent('master-view-mode-change', { detail: { asOwner: Boolean(enabled) } }));
  } catch {
    /* ignore */
  }
}

export function clearMasterViewAsOwner() {
  setMasterViewAsOwner(false);
}
