import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationCenter from './NotificationCenter';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { useSocket } from '../hooks/useSocket';
import { MdMenu, MdPointOfSale, MdLock, MdAdminPanelSettings } from 'react-icons/md';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppLocaleBootstrap } from '../hooks/useAppLocaleBootstrap';

export default function Layout() {
  const { t } = useTranslation('common');
  useAppLocaleBootstrap();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, refreshStaffProfile } = useAuth();
  const location = useLocation();
  const [cajaOpen, setCajaOpen] = useState(null);
  const [checkingCaja, setCheckingCaja] = useState(true);
  const hideNotificationsInKitchenBar =
    location.pathname.startsWith('/admin/cocina') ||
    location.pathname.startsWith('/admin/bar') ||
    location.pathname.startsWith('/kitchen') ||
    location.pathname.startsWith('/bar') ||
    user?.role === 'cocina' ||
    user?.role === 'bar';
  const checkCaja = useCallback(() => {
    api.get('/pos/register-status')
      .then((data) => setCajaOpen(data.is_open))
      .catch(() => setCajaOpen(false))
      .finally(() => setCheckingCaja(false));
  }, []);

  useSocket('register-update', () => {
    if (user?.role === 'mozo') checkCaja();
  });

  useEffect(() => {
    if (!user || user.type === 'customer' || typeof refreshStaffProfile !== 'function') return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshStaffProfile();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, refreshStaffProfile]);

  useEffect(() => {
    if (user?.role === 'mozo') {
      checkCaja();
      const interval = setInterval(checkCaja, 15000);
      return () => clearInterval(interval);
    }
    setCajaOpen(true);
    setCheckingCaja(false);
    return undefined;
  }, [user?.role, checkCaja]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileMenuOpen(false);
    }
  }, [isMobile]);

  const isMozoBlocked = user?.role === 'mozo' && cajaOpen === false && !checkingCaja;

  return (
    <div className="min-h-screen bg-[var(--ui-body-bg)]">
      {isMobile && mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-30 rf-modal-overlay" onClick={() => setMobileMenuOpen(false)} role="presentation" />
      )}
      <Sidebar
        collapsed={collapsed}
        isMobile={isMobile}
        mobileOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
      <div className={`transition-all duration-300 ${isMobile ? 'ml-0' : (collapsed ? 'ml-16' : 'ml-60')}`}>
        <header className="rf-shell-header h-[var(--ui-shell-header-h)] shrink-0 bg-[var(--ui-surface)] flex items-center justify-between px-3 sm:px-6 sticky top-0 z-30 border-b border-[color:var(--ui-sidebar-border)]">
          <div className="flex items-center gap-4">
            <button
              onClick={() => (isMobile ? setMobileMenuOpen(prev => !prev) : setCollapsed(!collapsed))}
              className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg transition-colors"
            >
              <MdMenu className="text-xl text-[var(--ui-body-text)]" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === 'master_admin' && (
              <Link
                to="/master"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-accent-muted)] hover:bg-[var(--ui-sidebar-hover)]"
              >
                <MdAdminPanelSettings className="text-base" /> {t('layout.masterPanel')}
              </Link>
            )}
            {isMozoBlocked && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-[var(--ui-sidebar-active-bg)] text-[var(--ui-body-text)] text-xs rounded-full font-medium border border-[color:var(--ui-border)]">
                <MdLock className="text-sm" /> {t('layout.registerClosed')}
              </span>
            )}
            {!hideNotificationsInKitchenBar && <NotificationCenter />}
            {!isMobile && <div className="h-8 w-px bg-[color:var(--ui-border)]" />}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[var(--ui-sidebar-active-bg)] rounded-full flex items-center justify-center border border-[color:var(--ui-border)]">
                <span className="text-[var(--ui-body-text)] text-xs font-bold">{user?.full_name?.[0] || 'U'}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-[var(--ui-body-text)] leading-tight">{user?.full_name || user?.username}</p>
                <p className="text-xs text-[var(--ui-muted)] capitalize">{t(`roles.${user?.role}`, { defaultValue: user?.role })}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="rf-main-content p-3 sm:p-6 bg-[var(--ui-body-bg)] min-h-[calc(100vh-var(--ui-shell-header-h))]">
          {isMozoBlocked ? (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="w-24 h-24 bg-[var(--ui-surface)] rounded-3xl flex items-center justify-center mb-6 border border-[color:var(--ui-border)]">
                <MdPointOfSale className="text-5xl text-[var(--ui-accent-muted)]" />
              </div>
              <div className="w-16 h-16 bg-[var(--ui-body-bg)] rounded-full flex items-center justify-center mb-4 -mt-10 ml-14 border-4 border-[var(--ui-surface)]">
                <MdLock className="text-2xl text-[var(--ui-accent)]" />
              </div>
              <h2 className="text-2xl font-bold text-[var(--ui-body-text)] mb-2">{t('layout.registerNotOpenTitle')}</h2>
              <p className="text-[var(--ui-muted)] max-w-md mb-4">
                {t('layout.registerNotOpenBody')}
              </p>
              <div className="flex items-center gap-2 px-4 py-2 bg-[var(--ui-surface)] border border-[color:var(--ui-border)] rounded-xl text-sm text-[var(--ui-accent-muted)]">
                <MdPointOfSale />
                <span>{t('layout.waitingRegister')}</span>
                <div className="animate-spin w-4 h-4 border-2 border-[var(--ui-accent-muted)] border-t-transparent rounded-full ml-1" />
              </div>
            </div>
          ) : checkingCaja ? (
            <div className="flex justify-center py-16">
              <div className="rf-loader rf-loader--md" />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
