import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api, resolveMediaUrl } from '../utils/api';
import toast from 'react-hot-toast';
import { MdPerson, MdLock, MdVisibility, MdVisibilityOff, MdArrowBack, MdCameraAlt } from 'react-icons/md';
import AttendancePhotoCapture from '../components/AttendancePhotoCapture';
import { getStoredAppLocale, setAppLocale } from '../i18n';
import { getDefaultStaffPath } from '../utils/staffModuleAccess';

/** Si en Mi empresa no hay nombre guardado, se muestra este texto en el login. */
const FALLBACK_RESTAURANT_NAME = 'Resto Fadey App';

export default function Login() {
  const { t } = useTranslation('auth');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoLogin, setPhotoLogin] = useState(null);
  const [attendancePolicy, setAttendancePolicy] = useState({ loading: true, loginRequired: false });
  const [step, setStep] = useState(1);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [brandLogo, setBrandLogo] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [restaurantName, setRestaurantName] = useState(FALLBACK_RESTAURANT_NAME);

  const photosRequired = attendancePolicy.loginRequired;
  const policyReady = !attendancePolicy.loading;

  useEffect(() => {
    const stored = getStoredAppLocale();
    if (stored) void setAppLocale(stored);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('rf-login-lock');
    body.classList.add('rf-login-lock');
    return () => {
      html.classList.remove('rf-login-lock');
      body.classList.remove('rf-login-lock');
    };
  }, []);

  useEffect(() => {
    api
      .get('/restaurant')
      .then((r) => {
        const n = String(r?.name || '').trim();
        setRestaurantName(n || FALLBACK_RESTAURANT_NAME);
        setBrandLogo(String(r?.logo || '').trim());
        const cover = String(
          r?.profile_effective?.branding?.favicon ||
            r?.profile?.branding?.favicon ||
            ''
        ).trim();
        setCoverImage(cover);
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
      navigate(getDefaultStaffPath(user), { replace: true });
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
      <div
        className={`rf-login-cover-bg${coverImage ? ' rf-login-cover-bg--has-image' : ' rf-login-cover-bg--empty'}`}
        aria-hidden="true"
      >
        {coverImage ? <img src={resolveMediaUrl(coverImage)} alt="" /> : null}
      </div>
      <div className="rf-login-page__content rf-login-page__content--visible">
        <div className="rf-login-center w-full max-w-md relative z-10 px-4">
          <div className="rf-login-brand text-center">
            {brandLogo ? (
              <img
                src={resolveMediaUrl(brandLogo)}
                alt=""
                className="rf-login-brand-logo mx-auto rounded-full"
              />
            ) : null}
            <h1 className="rf-font-display text-3xl font-bold text-[#e8f4fc] tracking-tight px-1">
              {restaurantName}
            </h1>
          </div>

          <div className="rf-login-form">
            {step === 1 && (
              <>
                <h2 className="rf-login-title">{t('login.title')}</h2>
                <p className="rf-login-subtitle">{t('login.subtitle')}</p>
                <form onSubmit={handleContinue} className="rf-login-fields">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">{t('login.username')}</label>
                    <div className="relative">
                      <MdPerson className="rf-login-field-icon absolute left-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('login.usernamePlaceholder')}
                        className="rf-login-input pl-10"
                        required
                        autoComplete="username"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5">{t('login.password')}</label>
                    <div className="relative">
                      <MdLock className="rf-login-field-icon absolute left-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('login.passwordPlaceholder')}
                        className="rf-login-input pl-10 pr-10"
                        required
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="rf-login-field-toggle absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                      >
                        {showPassword ? <MdVisibilityOff className="text-xl" /> : <MdVisibility className="text-xl" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !policyReady}
                    className="rf-login-submit w-full py-3 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="rf-login-back p-2 rounded-lg"
                    aria-label={t('common:actions.back', { defaultValue: 'Volver' })}
                    disabled={loading}
                  >
                    <MdArrowBack className="text-xl" />
                  </button>
                  <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <MdCameraAlt className="text-[#2563EB]" /> {t('login.attendanceTitle')}
                    </h2>
                  </div>
                </div>
                <div className="rf-login-photo-box rounded-xl p-4 mb-5">
                  <AttendancePhotoCapture onCapture={setPhotoLogin} disabled={loading} />
                </div>
                <button
                  type="button"
                  onClick={() => void submitLogin()}
                  disabled={loading || !photoLogin}
                  className="rf-login-submit w-full py-3 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
        </div>
      </div>
      <p className="rf-login-footer text-center text-xs select-none" aria-hidden="true">
        {t('login.footer')}
      </p>
    </div>
  );
}
