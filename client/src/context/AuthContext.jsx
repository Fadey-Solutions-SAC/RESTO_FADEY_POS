import { createContext, useContext, useState, useEffect } from 'react';
import { api, getApiOrigin } from '../utils/api';
import { applyUiThemeFromAppSettings } from '../theme/uiTheme';
import { isBrowserOffline, readGetCache, saveGetCache } from '../utils/offlinePos';

const STAFF_USER_KEY = 'rf_offline_staff_user';

function persistStaffUser(profile) {
  if (!profile || profile.type === 'customer') return;
  try {
    localStorage.setItem(STAFF_USER_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
  saveGetCache('/auth/me', profile);
}

function readPersistedStaffUser() {
  const fromCache = readGetCache('/auth/me');
  if (fromCache && typeof fromCache === 'object') return fromCache;
  try {
    const raw = localStorage.getItem(STAFF_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function applyAuthUserTheme(profile) {
  if (!profile) return;
  applyUiThemeFromAppSettings(
    {
      ui_theme: profile.ui_theme,
      ui_theme_mode: profile.ui_theme_mode,
      ui_theme_custom: profile.ui_theme_custom,
    },
    profile.id,
  );
}

/** Solo borrar token si el servidor rechazó la sesión (no por red / API aún arrancando). */
function shouldClearAuthToken(err) {
  if (!err) return false;
  if (err.code === 'SESSION_IDLE_TIMEOUT') return true;
  const status = Number(err.status);
  if (status === 401 || status === 403) return true;
  const raw = String(err.apiError || err.message || '');
  if (/token\s*(expirad|inv[aá]lido)|sesi[oó]n\s*inv[aá]lida|usuario no autorizado|no autenticado/i.test(raw)) {
    return true;
  }
  return false;
}

function isLikelyTransientAuthError(err) {
  if (!err) return true;
  if (shouldClearAuthToken(err)) return false;
  const status = Number(err.status);
  if (status >= 500) return true;
  const msg = String(err.message || '');
  return /failed to fetch|networkerror|load failed|network|timeout|aborterror|api local|no se pudo conectar/i.test(msg)
    || !status;
}

async function waitForApiReady(maxAttempts = 12) {
  if (isBrowserOffline()) return;
  const origin = getApiOrigin();
  if (!origin || typeof window === 'undefined') return;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const opts = { method: 'GET', cache: 'no-store' };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        opts.signal = AbortSignal.timeout(2500);
      }
      const res = await fetch(`${origin}/api/healthz`, opts);
      if (res.ok) return;
    } catch (_) {
      /* API aún arrancando (app instalada / Render cold start) */
    }
    await new Promise((r) => setTimeout(r, 500 + i * 250));
  }
}

async function restoreStaffSession() {
  const cachedMe = () => readPersistedStaffUser();
  if (isBrowserOffline()) {
    const hit = cachedMe();
    if (hit) return hit;
  }
  let lastErr = null;
  await waitForApiReady(isBrowserOffline() ? 0 : 4);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const data = await api.get('/auth/me');
      return data;
    } catch (err) {
      lastErr = err;
      if (shouldClearAuthToken(err)) throw err;
      const hit = cachedMe();
      if (hit && (isLikelyTransientAuthError(err) || isBrowserOffline())) return hit;
      if (!isLikelyTransientAuthError(err)) throw err;
      await new Promise((r) => setTimeout(r, 400 + attempt * 300));
    }
  }
  const hit = cachedMe();
  if (hit) return hit;
  throw lastErr || new Error('No se pudo restaurar la sesión');
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    restoreStaffSession()
      .then((data) => {
        if (cancelled) return;
        if (data?.token) {
          localStorage.setItem('token', data.token);
        }
        applyAuthUserTheme(data);
        persistStaffUser({ ...data, type: 'staff' });
        setUser({ ...data, type: 'staff' });
      })
      .catch((err) => {
        if (cancelled) return;
        if (shouldClearAuthToken(err)) {
          localStorage.removeItem('token');
          try { localStorage.removeItem(STAFF_USER_KEY); } catch { /* ignore */ }
          setUser(null);
        }
        /* Fallo de red / API lenta: se conserva el token para el próximo intento */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (username, password, opts = {}) => {
    const body = { username, password };
    if (opts.photo_login) body.photo_login = opts.photo_login;
    const data = await api.post('/auth/login', body);
    localStorage.setItem('token', data.token);
    applyAuthUserTheme(data.user);
    persistStaffUser({ ...data.user, type: 'staff' });
    setUser({ ...data.user, type: 'staff' });
    return data.user;
  };

  const customerLogin = async (email, password) => {
    const data = await api.post('/auth/customer/login', { email, password });
    localStorage.setItem('token', data.token);
    applyAuthUserTheme(data.customer);
    setUser({ ...data.customer, type: 'customer' });
    return data.customer;
  };

  const customerRegister = async (formData) => {
    const data = await api.post('/auth/customer/register', formData);
    localStorage.setItem('token', data.token);
    applyAuthUserTheme(data.customer);
    setUser({ ...data.customer, type: 'customer' });
    return data.customer;
  };

  const logout = async (opts = {}) => {
    const body = {};
    if (opts.photo_logout) body.photo_logout = opts.photo_logout;
    try {
      await api.post('/auth/logout', body);
    } catch (_) {
      /* Cerrar UI aunque el API no responda */
    }
    localStorage.removeItem('token');
    try { localStorage.removeItem(STAFF_USER_KEY); } catch { /* ignore */ }
    setUser(null);
    window.location.href = '/';
  };

  const refreshStaffProfile = async () => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
      const data = await api.get('/auth/me');
      if (data?.token) {
        localStorage.setItem('token', data.token);
      }
      applyAuthUserTheme(data);
      persistStaffUser({ ...data, type: 'staff' });
      setUser({ ...data, type: 'staff' });
      return data;
    } catch (err) {
      if (shouldClearAuthToken(err)) {
        localStorage.removeItem('token');
        try { localStorage.removeItem(STAFF_USER_KEY); } catch { /* ignore */ }
        setUser(null);
      }
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, customerLogin, customerRegister, logout, refreshStaffProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
