import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import toast from 'react-hot-toast';
import { MdPerson, MdLock, MdVisibility, MdVisibilityOff, MdArrowBack, MdCameraAlt } from 'react-icons/md';
import RestoFadeyEntrySplash from '../components/RestoFadeyEntrySplash';
import AttendancePhotoCapture from '../components/AttendancePhotoCapture';
import { getStoredAppLocale, setAppLocale } from '../i18n';

const APP_LOGO_SRC = '/branding/resto-fadey-logo.png?v=2';

function getRoleRoute(role) {
  if (role === 'master_admin') return '/master';
  if (role === 'cajero') return '/admin/caja';
  if (role === 'mozo') return '/admin/mesas';
  if (role === 'cocina') return '/kitchen';
  if (role === 'bar') return '/bar';
  if (role === 'delivery') return '/delivery';
  return '/admin';
}

/** Si en Mi empresa no hay nombre guardado, se muestra este texto en el login. */
const FALLBACK_RESTAURANT_NAME = 'Resto Fadey App';

export default function Login() {
  const { t } = useTranslation('auth');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoLogin, setPhotoLogin] = useState(null);
  const [showEntrySplash, setShowEntrySplash] = useState(true);
  const [attendancePolicy, setAttendancePolicy] = useState({ loading: true, loginRequired: false });
  const [step, setStep] = useState(1);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [restaurantName, setRestaurantName] = useState(FALLBACK_RESTAURANT_NAME);

  const photosRequired = attendancePolicy.loginRequired;
  const policyReady = !attendancePolicy.loading;

  useEffect(() => {
    const stored = getStoredAppLocale();
    if (stored) void setAppLocale(stored);
  }, []);

  useEffect(() => {
    api
      .get('/restaurant')
      .then((r) => {
        const n = String(r?.name || '').trim();
        setRestaurantName(n || FALLBACK_RESTAURANT_NAME);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get('/auth/attendance-photos-required')
      .then((data) =>
        setAttendancePolicy({
          loading: false,
          loginRequired: !!(data?.loginRequired ?? data?.required),
        })
      )
      .catch(() => {
        setAttendancePolicy({ loading: false, loginRequired: false });
      });
  }, []);

  const submitLogin = async () => {
    if (photosRequired && !photoLogin) {
      toast.error(t('login.photoRequired'));
      return;
    }
    setLoading(true);
    try {
      const loginOpts = {};
      if (photoLogin) loginOpts.photo_login = photoLogin;
      const user = await login(username, password, loginOpts);
      toast.success(t('login.welcome', { name: user.full_name }));
      navigate(getRoleRoute(user.role), { replace: true });
    } catch (err) {
      const msg = String(err?.message || '');
      if (/foto|inicio de jornada|jornada/i.test(msg)) {
        setAttendancePolicy((p) => ({ ...p, loading: false, loginRequired: true }));
        setPhotoLogin(null);
        setStep(2);
        toast.error(t('login.photoRequiredShort'));
      } else {
        toast.error(msg || t('login.loginFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = (e) => {
    e.preventDefault();
    if (!policyReady) {
      toast.error(t('login.waitPolicy'));
      return;
    }
    if (!username.trim() || !password) {
      toast.error(t('login.credentialsRequired'));
      return;
    }
    if (!photosRequired) {
      void submitLogin();
      return;
    }
    setPhotoLogin(null);
    setStep(2);
  };

  return (
    <div className="rf-login-shell rf-login-page">
      {showEntrySplash ? (
        <RestoFadeyEntrySplash active onComplete={() => setShowEntrySplash(false)} />
      ) : null}

      <div
        className={`rf-login-page__content${showEntrySplash ? ' rf-login-page__content--hidden' : ' rf-login-page__content--visible'}`}
        aria-hidden={showEntrySplash}
      >
        <div className="w-full max-w-md relative z-10 px-4">
          <div className="text-center mb-8">
            <img
              src={APP_LOGO_SRC}
              alt={restaurantName}
              className="rf-entry-brand-mark"
              width={56}
              height={56}
            />
            <h1 className="rf-font-display text-3xl font-bold text-[#e8f4fc] tracking-tight px-1">
              {restaurantName}
            </h1>
          </div>

          <div className="rf-login-card bg-[var(--ui-surface)] backdrop-blur-xl rounded-2xl shadow-2xl p-6 sm:p-8 border border-[color:var(--ui-border)]">
            {step === 1 && (
              <>
                <h2 className="rf-font-display text-xl font-bold text-[var(--ui-body-text)] mb-1">{t('login.title')}</h2>
                <p className="text-sm text-[var(--ui-muted)] mb-6">{t('login.subtitle')}</p>
                <form onSubmit={handleContinue} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1.5">{t('login.username')}</label>
                    <div className="relative">
                      <MdPerson className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] text-xl pointer-events-none" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('login.usernamePlaceholder')}
                        className="input-field pl-10"
                        required
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1.5">{t('login.password')}</label>
                    <div className="relative">
                      <MdLock className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] text-xl pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('login.passwordPlaceholder')}
                        className="input-field pl-10 pr-10"
                        required
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] hover:text-[var(--ui-body-text)] transition-colors"
                      >
                        {showPassword ? <MdVisibilityOff className="text-xl" /> : <MdVisibility className="text-xl" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !policyReady}
                    className="w-full py-3 btn-primary rounded-lg font-semibold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {!policyReady ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                        {t('login.loadingPolicy')}
                      </span>
                    ) : loading && !photosRequired ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                        {t('login.entering')}
                      </span>
                    ) : photosRequired ? (
                      t('login.continue')
                    ) : (
                      t('login.enter')
                    )}
                  </button>
                </form>
              </>
            )}

            {step === 2 && photosRequired && (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setPhotoLogin(null); }}
                    className="p-2 rounded-lg hover:bg-[var(--ui-sidebar-hover)] text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]"
                    aria-label={t('common:actions.back', { defaultValue: 'Volver' })}
                    disabled={loading}
                  >
                    <MdArrowBack className="text-xl" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold text-[var(--ui-body-text)] flex items-center gap-2">
                      <MdCameraAlt className="text-[var(--ui-accent)]" /> {t('login.attendanceTitle')}
                    </h2>
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4 mb-5">
                  <AttendancePhotoCapture onCapture={setPhotoLogin} disabled={loading} />
                </div>
                <button
                  type="button"
                  onClick={() => void submitLogin()}
                  disabled={loading || !photoLogin}
                  className="w-full py-3 btn-primary rounded-lg font-semibold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                      {t('login.entering')}
                    </span>
                  ) : (
                    t('login.enterSystem')
                  )}
                </button>
              </>
            )}
          </div>

          <p className="text-center text-[var(--ui-muted)] text-xs mt-6 select-none" aria-hidden="true">
            {t('login.footer')}
          </p>
        </div>
      </div>
    </div>
  );
}
