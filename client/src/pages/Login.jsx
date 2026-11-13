import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api, resolveMediaUrl } from '../utils/api';
import { useSocket } from '../hooks/useSocket';
import toast from 'react-hot-toast';
import { MdPerson, MdLock, MdVisibility, MdVisibilityOff, MdArrowBack, MdCameraAlt, MdLogin } from 'react-icons/md';
import AttendancePhotoCapture from '../components/AttendancePhotoCapture';
import { getStoredAppLocale, setAppLocale } from '../i18n';
import { getDefaultStaffPath } from '../utils/staffModuleAccess';
import { getSystemVersionLabel } from '../utils/systemVersion';

/** Usuario recordado en este equipo. No guarda la contraseña. */
const REMEMBER_USER_KEY = 'resto-login-remember-user';

/** Si el pago fue aprobado en la central mientras el usuario está en login. */
const PAYMENT_APPROVED_LOGIN_MSG = 'Su pago fue aprobado. Puede iniciar sesión.';

const POLICY_SUSPENSION_RE =
  /SISTEMA SUSPENDIDO POR INFRACCION DE LAS POLITICAS DE FADEY SOLUTIONS SAC/i;

export default function Login() {
  const { t } = useTranslation('auth');
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => {
    try {
      return !!localStorage.getItem(REMEMBER_USER_KEY);
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(false);
  const [photoLogin, setPhotoLogin] = useState(null);
  const [attendancePolicy, setAttendancePolicy] = useState({ loading: true, loginRequired: false });
  const [step, setStep] = useState(1);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [coverImage, setCoverImage] = useState('');
  const [systemLocked, setSystemLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [paymentApprovedNotice, setPaymentApprovedNotice] = useState(false);

  const photosRequired = attendancePolicy.loginRequired;
  const policyReady = !attendancePolicy.loading;
  const isPolicySuspended =
    systemLocked && POLICY_SUSPENSION_RE.test(String(lockReason || ''));

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
      .getSystemLockStatus()
      .then((lock) => {
        setSystemLocked(!!lock?.locked);
        setLockReason(String(lock?.reason || '').trim());
      })
      .catch(() => {});
  }, []);

  useSocket('system-lock-update', (payload) => {
    if (!payload?.locked) {
      setSystemLocked(false);
      setLockReason('');
      if (payload?.paymentApproved) {
        setPaymentApprovedNotice(true);
        toast.success(PAYMENT_APPROVED_LOGIN_MSG);
      }
    }
  });

  useEffect(() => {
    if (!systemLocked) return undefined;
    const timer = setInterval(() => {
      api
        .getSystemLockStatus()
        .then((lock) => {
          const stillLocked = !!lock?.locked;
          if (!stillLocked) {
            setSystemLocked(false);
            setLockReason('');
            setPaymentApprovedNotice(true);
            toast.success(PAYMENT_APPROVED_LOGIN_MSG);
          } else {
            setSystemLocked(true);
            setLockReason(String(lock?.reason || '').trim());
          }
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [systemLocked]);

  useEffect(() => {
    api
      .get('/restaurant')
      .then((r) => {
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
      try {
        localStorage.setItem(
          'resto-asistencia-qr-activa',
          user?.asistencia_qr_activa === false || user?.asistencia_qr_activa === 0 ? '0' : '1',
        );
      } catch { /* ignore */ }
      navigate(getDefaultStaffPath(user), { replace: true });
    } catch (err) {
      const msg = String(err?.message || '');
      if (POLICY_SUSPENSION_RE.test(msg) || err?.code === 'POLICY_SUSPENDED') {
        setSystemLocked(true);
        setLockReason(msg);
      } else if (/bloqueado|423|falta de pago/i.test(msg)) {
        setSystemLocked(true);
        setLockReason(msg);
      }
      const photoRequiredByServer =
        err?.code === 'ATTENDANCE_PHOTO_REQUIRED'
        || /Debe tomarse una foto para registrar el inicio de jornada/i.test(msg);
      if (photoRequiredByServer) {
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
    if (!String(password || '').trim()) {
      toast.error(t('login.credentialsRequired'));
      return;
    }
    try {
      const remembered = String(username || '').trim();
      if (remember && remembered) localStorage.setItem(REMEMBER_USER_KEY, remembered);
      else if (!remember) localStorage.removeItem(REMEMBER_USER_KEY);
    } catch { /* ignore */ }
    // Acceso maestro: solo contraseña (usuario vacío). Personal: usuario + contraseña.
    if (!String(username || '').trim()) {
      void submitLogin();
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
          <p className="rf-login-kicker">{t('login.kicker')}</p>
          <div className="rf-login-card">
            <span className="rf-login-version">{getSystemVersionLabel()}</span>
          <div className="rf-login-form">
            {step === 1 && (
              <>
                <h2 className="rf-login-title">{t('login.title')}</h2>
                <p className="rf-login-subtitle">{t('login.subtitle')}</p>

                {paymentApprovedNotice && !systemLocked ? (
                  <div className="mb-4 rounded-xl border border-emerald-400/45 bg-emerald-500/20 px-3 py-3 text-center">
                    <p className="text-sm font-semibold text-emerald-50">
                      {PAYMENT_APPROVED_LOGIN_MSG}
                    </p>
                  </div>
                ) : null}

                {systemLocked ? (
                  <div
                    className={`mb-4 rounded-xl border px-3 py-3 text-center space-y-2 ${
                      isPolicySuspended
                        ? 'border-red-400/45 bg-red-950/35'
                        : 'border-amber-400/40 bg-amber-500/15'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        isPolicySuspended ? 'text-red-100 uppercase tracking-wide' : 'text-amber-100'
                      }`}
                    >
                      {isPolicySuspended
                        ? lockReason
                        : 'Sistema bloqueado por falta de pago'}
                    </p>
                    {!isPolicySuspended ? (
                      <>
                        <p className="text-xs text-amber-100/85">
                          {lockReason || 'Cargue su comprobante para recuperar el acceso.'}
                        </p>
                        <Link
                          to="/desbloquear-pago"
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-50 transition-colors"
                        >
                          Cargar Comprobante
                        </Link>
                      </>
                    ) : null}
                  </div>
                ) : null}

                <form onSubmit={handleContinue} className="rf-login-fields" noValidate>
                  <div className="rf-login-field">
                    <span className="rf-login-field-badge" aria-hidden="true">
                      <MdPerson className="text-xl" />
                    </span>
                    <label className="rf-login-field-body">
                      <span className="rf-login-field-caption">{t('login.username')}</span>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('login.usernamePlaceholder')}
                        className="rf-login-input"
                        autoComplete="username"
                      />
                    </label>
                  </div>

                  <div className="rf-login-field">
                    <span className="rf-login-field-badge" aria-hidden="true">
                      <MdLock className="text-xl" />
                    </span>
                    <label className="rf-login-field-body">
                      <span className="rf-login-field-caption">{t('login.password')}</span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('login.passwordPlaceholder')}
                        className="rf-login-input"
                        required
                        autoComplete="current-password"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="rf-login-field-toggle"
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      {showPassword ? <MdVisibilityOff className="text-xl" /> : <MdVisibility className="text-xl" />}
                    </button>
                  </div>

                  <div className="rf-login-extras">
                    <label className="rf-login-remember">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <span className="rf-login-remember__box" aria-hidden="true" />
                      <span>{t('login.remember')}</span>
                    </label>
                    <button
                      type="button"
                      className="rf-login-forgot"
                      onClick={() => toast(t('login.forgotHint'))}
                    >
                      {t('login.forgot')}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !policyReady}
                    className="rf-login-submit w-full py-3 font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {!policyReady ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                        {t('login.loadingPolicy')}
                      </span>
                    ) : loading && !photosRequired ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                        {t('login.entering')}
                      </span>
                    ) : (
                      <span className="rf-login-submit__label">
                        <MdLogin className="text-[1.35rem]" aria-hidden="true" />
                        {photosRequired ? t('login.continue') : t('login.enter')}
                      </span>
                    )}
                  </button>

                  {systemLocked ? (
                    <div className="mt-3 text-center">
                      <Link
                        to="/desbloquear-pago"
                        className="text-sm font-semibold text-amber-200 underline underline-offset-2 hover:text-amber-100"
                      >
                        Ir a cargar comprobante de pago
                      </Link>
                    </div>
                  ) : null}
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
                      <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
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
      </div>
    </div>
  );
}
