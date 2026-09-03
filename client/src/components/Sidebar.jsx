import { useState, useCallback, useMemo, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { ADMIN_MODULE_PATHS, canAccessStaffModule, hasModulePermission } from '../utils/staffModuleAccess';
import { useShowDeliveryUi } from '../hooks/useDeliveryEnabled';
import { usePrintingModule } from '../hooks/usePrintingModule';
import EndShiftModal from './EndShiftModal';
import AdminAttendanceReviewModal from './AdminAttendanceReviewModal';
import {
  MdDashboard, MdAttachMoney, MdPointOfSale, MdEventSeat,
  MdCreditCard, MdPeopleAlt, MdRestaurantMenu, MdLocalOffer,
  MdDiscount, MdWarehouse, MdDeliveryDining, MdAssessment,
  MdInsights, MdStorefront, MdSettings, MdLogout, MdTableBar, MdAccessTime, MdKitchen, MdLocalBar, MdTouchApp, MdStars,
} from 'react-icons/md';
import { getProductionAreaIcon } from '../utils/productionAreaUi';

/** Icono por módulo; etiqueta vía i18n `dashboard:nav.*`. */
const SIDEBAR_LINK_META = {
  escritorio: { icon: MdDashboard, labelKey: 'nav.escritorio', end: true },
  caja: { icon: MdPointOfSale, labelKey: 'nav.caja' },
  mesas: { icon: MdTableBar, labelKey: 'nav.mesas' },
  produccion: { icon: MdKitchen, labelKey: 'nav.produccion' },
  cocina: { icon: MdKitchen, labelKey: 'nav.cocina' },
  bar: { icon: MdLocalBar, labelKey: 'nav.bar' },
  delivery: { icon: MdDeliveryDining, labelKey: 'nav.delivery' },
  reservas: { icon: MdEventSeat, labelKey: 'nav.reservas' },
  auto_pedido: { icon: MdTouchApp, labelKey: 'nav.auto_pedido' },
  clientes: { icon: MdPeopleAlt, labelKey: 'nav.clientes' },
  creditos: { icon: MdCreditCard, labelKey: 'nav.creditos' },
  ofertas: { icon: MdLocalOffer, labelKey: 'nav.ofertas' },
  descuentos: { icon: MdDiscount, labelKey: 'nav.descuentos' },
  almacen: { icon: MdWarehouse, labelKey: 'nav.almacen' },
  productos: { icon: MdRestaurantMenu, labelKey: 'nav.productos' },
  informes: { icon: MdAssessment, labelKey: 'nav.informes' },
  ventas: { icon: MdAttachMoney, labelKey: 'nav.ventas' },
  indicadores: { icon: MdInsights, labelKey: 'nav.indicadores' },
  fidelizacion: { icon: MdStars, labelKey: 'nav.fidelizacion' },
  mi_restaurant: { icon: MdStorefront, labelKey: 'nav.mi_restaurant' },
  tiempo_trabajado: { icon: MdAccessTime, labelKey: 'nav.tiempo_trabajado' },
  configuracion: { icon: MdSettings, labelKey: 'nav.configuracion' },
};

if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
  ADMIN_MODULE_PATHS.forEach((row) => {
    if (!SIDEBAR_LINK_META[row.moduleId]) {
      console.warn(
        `[Sidebar] Falta SIDEBAR_LINK_META para moduleId="${row.moduleId}" (añada icono y etiqueta en Sidebar.jsx).`
      );
    }
  });
}

const CAJA_SUB_IDS = [
  'apertura_cierre', 'cierres_caja', 'ingresos', 'egresos',
  'notas_credito', 'notas_debito', 'impresora',
];
const MI_RESTAURANT_SUB_IDS = [
  'mi_empresa', 'facturacion_electronica', 'pagos_sistema', 'contrato', 'pago_uso_sistema', 'informacion',
];
const ALMACEN_SUB_IDS = [
  'movimiento_interno', 'ir_modulo_logistica', 'requerimiento', 'recepcion', 'ir_modulo_gastos',
];
const INFORMES_SUB_IDS = [
  'ventas', 'descuentos', 'productos', 'caja', 'compras', 'finanzas', 'facturacion', 'inventario',
];

export default function Sidebar({ collapsed, isMobile = false, mobileOpen = false, onClose = () => {}, onToggleMenu = () => {} }) {
  const { t } = useTranslation('dashboard');
  const { t: tc } = useTranslation('common');
  const { user, refreshStaffProfile } = useAuth();
  const location = useLocation();
  const showDeliveryUi = useShowDeliveryUi();
  const [productionAreas, setProductionAreas] = useState([]);

  const loadProductionAreas = useCallback(() => {
    api
      .get('/production-areas/active')
      .then((list) => {
        const areas = (Array.isArray(list) ? list : [])
          .map((a) => ({
            id: String(a?.id || '').trim(),
            name: String(a?.name || '').trim() || String(a?.id || ''),
          }))
          .filter((a) => a.id);
        // Siempre reemplazar: si se eliminó Cocina/Bar, deben desaparecer del menú.
        const rank = (id) => (id === 'cocina' ? 0 : id === 'bar' ? 1 : 2);
        areas.sort((a, b) => {
          const ra = rank(a.id);
          const rb = rank(b.id);
          if (ra !== rb) return ra - rb;
          return String(a.name).localeCompare(String(b.name), 'es');
        });
        setProductionAreas(areas);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadProductionAreas();
    const onAreas = () => {
      loadProductionAreas();
      // Si vinculan el usuario a un área nueva, refrescar production_area_id sin re-login.
      if (typeof refreshStaffProfile === 'function') {
        void refreshStaffProfile();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadProductionAreas();
    };
    window.addEventListener('production-areas-updated', onAreas);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('production-areas-updated', onAreas);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadProductionAreas, location.pathname, refreshStaffProfile]);

  const canSeeProduction =
    canAccessStaffModule(user, { moduleId: 'produccion', roles: ['admin', 'produccion', 'cocina', 'bar'] })
    || hasModulePermission(user, 'cocina')
    || hasModulePermission(user, 'bar');

  const allLinks = useMemo(
    () => {
      const links = [];
      let productionInserted = false;
      for (const row of ADMIN_MODULE_PATHS) {
        if (row.moduleId === 'cocina' || row.moduleId === 'bar' || row.moduleId === 'produccion') {
          if (productionInserted || !canSeeProduction) continue;
          productionInserted = true;
          const role = String(user?.role || '').toLowerCase();
          const ownArea = String(user?.production_area_id || '').trim();
          let areasForNav = [];
          if (role === 'produccion') {
            // Una área vinculada (incluye áreas creadas además de cocina/bar).
            if (ownArea) {
              const match = productionAreas.find((a) => a.id === ownArea);
              areasForNav = match
                ? [match]
                : [{ id: ownArea, name: ownArea }];
            } else {
              areasForNav = [];
            }
          } else if (role === 'cocina') {
            areasForNav = productionAreas.filter((a) => a.id === 'cocina');
            if (!areasForNav.length && (!ownArea || ownArea === 'cocina')) {
              areasForNav = [{ id: 'cocina', name: 'Cocina' }];
            } else if (ownArea && ownArea !== 'cocina') {
              const match = productionAreas.find((a) => a.id === ownArea);
              areasForNav = match ? [match] : [{ id: ownArea, name: ownArea }];
            }
          } else if (role === 'bar') {
            areasForNav = productionAreas.filter((a) => a.id === 'bar');
            if (!areasForNav.length && (!ownArea || ownArea === 'bar')) {
              areasForNav = [{ id: 'bar', name: 'Bar' }];
            } else if (ownArea && ownArea !== 'bar') {
              const match = productionAreas.find((a) => a.id === ownArea);
              areasForNav = match ? [match] : [{ id: ownArea, name: ownArea }];
            }
          } else {
            // Admin u otros con permiso: todas las áreas activas.
            areasForNav = productionAreas;
          }
          for (const area of areasForNav) {
            const idLc = String(area.id || '').toLowerCase();
            const icon = getProductionAreaIcon(area);
            links.push({
              to: `/admin/produccion/${area.id}`,
              icon,
              label: area.name || area.id,
              end: false,
              roles: ['admin', 'produccion', 'cocina', 'bar'],
              moduleId: idLc === 'cocina' ? 'cocina' : idLc === 'bar' ? 'bar' : 'produccion',
              isProductionArea: true,
              productionAreaId: String(area.id || '').trim(),
            });
          }
          continue;
        }
        const meta = SIDEBAR_LINK_META[row.moduleId];
        if (!meta) continue;
        links.push({
          to: row.path,
          icon: meta.icon,
          label: t(meta.labelKey),
          end: Boolean(meta.end),
          roles: row.roles,
          moduleId: row.moduleId,
        });
      }
      // Asistencia QR: admin bajo RR. HH.; otros roles bajo su módulo operativo (ver submenús abajo).
      return links;
    },
    [t, productionAreas, canSeeProduction, user?.role, user?.production_area_id],
  );
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [attendanceReviewOpen, setAttendanceReviewOpen] = useState(false);
  const onAttendanceReviewComplete = useCallback(() => {
    setAttendanceReviewOpen(false);
    setEndShiftOpen(true);
  }, []);

  const handleFinalizarJornadaClick = async () => {
    if (user?.role !== 'admin') {
      setEndShiftOpen(true);
      return;
    }
    try {
      const data = await api.get('/users/attendance-review/today');
      if (Array.isArray(data?.pending) && data.pending.length > 0) {
        setAttendanceReviewOpen(true);
        return;
      }
    } catch (_) {
      /* si falla la comprobación, permitimos abrir cierre para no bloquear */
    }
    setEndShiftOpen(true);
  };
  const roleLc = String(user?.role || '').toLowerCase();
  const [asistenciaQrActiva, setAsistenciaQrActiva] = useState(() => {
    try {
      const v = localStorage.getItem('resto-asistencia-qr-activa');
      if (v === '0' || v === 'false') return false;
      if (v === '1' || v === 'true') return true;
    } catch { /* ignore */ }
    return user?.asistencia_qr_activa == null ? true : Boolean(user.asistencia_qr_activa);
  });

  useEffect(() => {
    api.get('/hr/asistencia-qr-mode')
      .then((mode) => {
        const on = mode?.active !== false;
        setAsistenciaQrActiva(on);
        try { localStorage.setItem('resto-asistencia-qr-activa', on ? '1' : '0'); } catch { /* ignore */ }
      })
      .catch(() => {});
  }, [location.pathname]);

  const onAsistenciaPath = location.pathname.startsWith('/admin/asistencia');
  const [isCajaExpanded, setIsCajaExpanded] = useState(
    location.pathname.startsWith('/admin/caja') || (roleLc === 'cajero' && onAsistenciaPath),
  );
  const [isMiRestaurantExpanded, setIsMiRestaurantExpanded] = useState(location.pathname.startsWith('/admin/mi-restaurant'));
  const [isAlmacenExpanded, setIsAlmacenExpanded] = useState(location.pathname.startsWith('/admin/almacen'));
  const [isInformesExpanded, setIsInformesExpanded] = useState(location.pathname.startsWith('/admin/informes'));
  const [isHrExpanded, setIsHrExpanded] = useState(
    location.pathname.startsWith('/admin/tiempo-trabajado')
    || (roleLc === 'admin' && onAsistenciaPath),
  );
  const [isMesasExpanded, setIsMesasExpanded] = useState(
    location.pathname.startsWith('/admin/mesas') || (roleLc === 'mozo' && onAsistenciaPath),
  );
  const [isProdExpanded, setIsProdExpanded] = useState(
    location.pathname.startsWith('/admin/produccion')
    || location.pathname.startsWith('/admin/cocina')
    || location.pathname.startsWith('/admin/bar')
    || (['produccion', 'cocina', 'bar'].includes(roleLc) && onAsistenciaPath),
  );

  useEffect(() => {
    if (location.pathname.startsWith('/admin/tiempo-trabajado') || (roleLc === 'admin' && onAsistenciaPath)) {
      setIsHrExpanded(true);
    }
    if (location.pathname.startsWith('/admin/mesas') || (roleLc === 'mozo' && onAsistenciaPath)) {
      setIsMesasExpanded(true);
    }
    if (location.pathname.startsWith('/admin/caja') || (roleLc === 'cajero' && onAsistenciaPath)) {
      setIsCajaExpanded(true);
    }
    if (
      location.pathname.startsWith('/admin/produccion')
      || location.pathname.startsWith('/admin/cocina')
      || location.pathname.startsWith('/admin/bar')
      || (['produccion', 'cocina', 'bar'].includes(roleLc) && onAsistenciaPath)
    ) {
      setIsProdExpanded(true);
    }
  }, [location.pathname, roleLc, onAsistenciaPath]);

  const hasLinkPermission = (link) => {
    if (link?.isProductionArea) {
      return canSeeProduction;
    }
    return canAccessStaffModule(user, { moduleId: link.moduleId, roles: link.roles });
  };

  /** Asistencia QR cuelga del módulo del rol (admin → RR. HH.; producción → su área vinculada). */
  const linkHostsAttendanceQr = (link) => {
    if (!asistenciaQrActiva) return false;
    if (roleLc === 'admin') return link.moduleId === 'tiempo_trabajado';
    if (roleLc === 'mozo') return link.moduleId === 'mesas';
    if (roleLc === 'cajero') return link.moduleId === 'caja';
    if (roleLc === 'produccion' || roleLc === 'cocina' || roleLc === 'bar') {
      if (!link.isProductionArea) return false;
      const own = String(user?.production_area_id || '').trim();
      const linkArea = String(link.productionAreaId || '').trim();
      // Solo bajo el área vinculada al usuario (funciona con 1..N áreas en el sistema).
      if (own) return linkArea === own;
      // Legado cocina/bar sin production_area_id explícito
      if (roleLc === 'cocina') return linkArea === 'cocina';
      if (roleLc === 'bar') return linkArea === 'bar';
      return false;
    }
    return false;
  };

  const attendanceExpandedFor = (link) => {
    if (roleLc === 'admin') return isHrExpanded;
    if (roleLc === 'mozo') return isMesasExpanded;
    if (roleLc === 'cajero') return isCajaExpanded;
    if (roleLc === 'produccion' || roleLc === 'cocina' || roleLc === 'bar') return isProdExpanded;
    return false;
  };
  const filtered = allLinks
    .filter(hasLinkPermission)
    .filter((link) => link.moduleId !== 'delivery' || showDeliveryUi);
  const planAllowsAlmacenAvanzado = user?.service_plan !== 'basico';
  const subAlmacen = user?.sub_permissions?.almacen || {};
  const almacenSubOptions = ALMACEN_SUB_IDS.filter((id) => {
    if (!planAllowsAlmacenAvanzado && ['requerimiento', 'recepcion'].includes(id)) return false;
    if (subAlmacen[id] === false) return false;
    return true;
  }).map((id) => ({ id, label: t(`almacenSub.${id}`) }));
  const informesSubOptions = INFORMES_SUB_IDS.map((id) => ({ id, label: t(`informesSub.${id}`) }));
  const planProfesional = user?.service_plan === 'profesional';
  const subMi = user?.sub_permissions?.mi_restaurant || {};
  const miRestaurantSubOptionsByPlan = MI_RESTAURANT_SUB_IDS.filter((id) => {
    if (!planProfesional && id === 'facturacion_electronica') return false;
    if (subMi[id] === false) return false;
    return true;
  }).map((id) => ({ id, label: t(`miRestaurantSub.${id}`) }));
  /** Respaldo/restauración: solo administrador maestro (API también exige rol). */
  const miRestaurantSubOptions =
    user?.role === 'master_admin'
      ? miRestaurantSubOptionsByPlan
      : miRestaurantSubOptionsByPlan.filter((o) => o.id !== 'informacion');
  const subCaja = user?.sub_permissions?.caja || {};
  const { moduleEnabled: cajaPrinterEnabled } = usePrintingModule('caja');
  const cajaSubOptions = CAJA_SUB_IDS.filter((id) => {
    if (id === 'impresora' && !cajaPrinterEnabled) return false;
    if (subCaja[id] === false) return false;
    if (String(user?.role || '').toLowerCase() === 'cajero' && (id === 'apertura_cierre' || id === 'cierres_caja')) {
      return false;
    }
    return true;
  }).map((id) => ({ id, label: t(`cajaSub.${id}`) }));
  const visibleLinks = user?.role === 'cajero'
    ? [
        filtered.find(l => l.to === '/admin/caja'),
        ...filtered.filter(l => l.to !== '/admin/caja'),
      ].filter(Boolean)
    : filtered;

  const linkClass = ({ isActive }) =>
    `rf-nav-link ${isActive ? 'rf-nav-link--active' : ''}`;

  const parentLinkClass = (link) => ({ isActive }) => {
    const hostsAtt = linkHostsAttendanceQr(link);
    const active = isActive || (hostsAtt && onAsistenciaPath);
    return `rf-nav-link ${active ? 'rf-nav-link--active' : ''}`;
  };

  const isCollapsed = isMobile ? false : collapsed;

  const renderAsistenciaQrSub = () => (
    <NavLink
      to="/admin/asistencia"
      className={({ isActive }) => `rf-nav-sublink ${isActive ? 'rf-nav-sublink--active' : ''}`}
      onClick={() => { if (isMobile) onClose(); }}
    >
      {t('nav.asistencia', { defaultValue: 'Asistencia QR' })}
    </NavLink>
  );

  return (
    <aside className={`rf-sidebar fixed left-0 top-0 h-full z-40 transition-all duration-300 flex flex-col border-r border-[color:var(--ui-sidebar-border)] ${
      isMobile
        ? `w-72 max-w-[85vw] transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`
        : (isCollapsed ? 'w-[var(--ui-sidebar-width-collapsed)]' : 'w-[var(--ui-sidebar-width)]')
    }`}>
      <div
        className={`rf-sidebar-logo-bar flex items-center shrink-0 h-[var(--ui-shell-header-h)] border-b border-[color:var(--ui-sidebar-border)] ${
          isCollapsed ? 'justify-center px-0' : 'gap-1.5 px-2'
        }`}
      >
        {isCollapsed ? (
          <button
            type="button"
            onClick={onToggleMenu}
            className="h-full w-full flex flex-row items-center justify-center gap-1 transition-colors"
            aria-label={tc('layout.menu', { defaultValue: 'Menú' })}
          >
            <div className="rf-sidebar-brand w-6 h-6 bg-gradient-to-br from-[var(--ui-logo-from)] to-[var(--ui-logo-to)] rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
              <MdStorefront className="text-white text-sm" />
            </div>
            <span className="rf-sidebar-burger" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        ) : (
          <>
            <div className="rf-sidebar-brand w-8 h-8 bg-gradient-to-br from-[var(--ui-logo-from)] to-[var(--ui-logo-to)] rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
              <MdStorefront className="text-white text-base" />
            </div>
            <span className="rf-sidebar-logo-name rf-font-display">
              {tc('layout.brandName')}
            </span>
            <button
              type="button"
              onClick={onToggleMenu}
              className="rf-sidebar-menu-btn transition-colors"
              aria-label={tc('layout.menu', { defaultValue: 'Menú' })}
            >
              <span className="rf-sidebar-burger" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </>
        )}
      </div>

      <nav className="rf-sidebar__nav flex-1 px-1.5 py-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleLinks.map(link => (
          <div key={link.to}>
            <NavLink
              to={
                link.moduleId === 'caja'
                  ? '/admin/caja?view=cobrar'
                  : link.moduleId === 'informes'
                    ? '/admin/informes?view=ventas'
                    : link.to
              }
              end={link.end}
              className={linkHostsAttendanceQr(link) ? parentLinkClass(link) : linkClass}
              title={link.label}
              onClick={(e) => {
                if (isCollapsed) return;
                if (link.moduleId === 'caja' || link.to === '/admin/caja') {
                  const isInCaja = location.pathname.startsWith('/admin/caja');
                  const cajaView = new URLSearchParams(location.search).get('view') || 'cobrar';
                  if (isInCaja && cajaView === 'cobrar' && !onAsistenciaPath) {
                    e.preventDefault();
                    setIsCajaExpanded((prev) => !prev);
                    return;
                  }
                  setIsCajaExpanded(true);
                  if (isMobile) onClose();
                  return;
                }
                if (link.to === '/admin/mi-restaurant') {
                  const isInMiRestaurant = location.pathname.startsWith('/admin/mi-restaurant');
                  if (isInMiRestaurant) {
                    e.preventDefault();
                    setIsMiRestaurantExpanded(prev => !prev);
                    return;
                  }
                  setIsMiRestaurantExpanded(true);
                  return;
                }
                if (link.to === '/admin/almacen') {
                  const isInAlmacen = location.pathname.startsWith('/admin/almacen');
                  if (isInAlmacen) {
                    e.preventDefault();
                    setIsAlmacenExpanded(prev => !prev);
                    return;
                  }
                  setIsAlmacenExpanded(true);
                }
                if (link.to === '/admin/informes') {
                  const isInInformes = location.pathname.startsWith('/admin/informes');
                  if (isInInformes) {
                    e.preventDefault();
                    setIsInformesExpanded((prev) => !prev);
                    return;
                  }
                  setIsInformesExpanded(true);
                }
                if (link.moduleId === 'tiempo_trabajado') {
                  const isInHr = location.pathname.startsWith('/admin/tiempo-trabajado')
                    || (roleLc === 'admin' && onAsistenciaPath);
                  if (isInHr) {
                    e.preventDefault();
                    setIsHrExpanded((prev) => !prev);
                    return;
                  }
                  setIsHrExpanded(true);
                }
                if (link.moduleId === 'mesas') {
                  const isInMesas = location.pathname.startsWith('/admin/mesas');
                  if (isInMesas) {
                    e.preventDefault();
                    setIsMesasExpanded((prev) => !prev);
                    return;
                  }
                  setIsMesasExpanded(true);
                }
                if (link.isProductionArea) {
                  const isInProd = location.pathname.startsWith(link.to);
                  if (isInProd) {
                    e.preventDefault();
                    setIsProdExpanded((prev) => !prev);
                    return;
                  }
                  setIsProdExpanded(true);
                }
                if (isMobile) onClose();
              }}
            >
              <link.icon className="text-lg flex-shrink-0" />
              {!isCollapsed && <span className="whitespace-nowrap leading-snug">{link.label}</span>}
            </NavLink>

            {!isCollapsed && link.moduleId === 'tiempo_trabajado' && isHrExpanded && (
              <div className="mt-1 ml-8 space-y-0.5">
                <NavLink
                  to="/admin/tiempo-trabajado"
                  end
                  className={({ isActive }) => `rf-nav-sublink flex items-center gap-1.5 ${isActive ? 'rf-nav-sublink--active' : ''}`}
                  onClick={() => { if (isMobile) onClose(); }}
                >
                  <MdAccessTime className="text-base flex-shrink-0" aria-hidden="true" />
                  <span>{t('hrSub.panel', { defaultValue: 'Panel RR. HH.' })}</span>
                </NavLink>
                {asistenciaQrActiva ? renderAsistenciaQrSub() : null}
              </div>
            )}

            {!isCollapsed && linkHostsAttendanceQr(link) && link.moduleId !== 'tiempo_trabajado' && link.moduleId !== 'caja' && attendanceExpandedFor(link) && (
              <div className="mt-1 ml-8 space-y-0.5">
                {renderAsistenciaQrSub()}
              </div>
            )}

            {!isCollapsed && link.to === '/admin/caja' && isCajaExpanded && (
              <div className="mt-1 ml-8 space-y-0.5">
                {cajaSubOptions.map(option => (
                  <NavLink
                    key={option.id}
                    to={`/admin/caja?view=${option.id}`}
                    className={({ isActive }) => {
                      const selected = isActive && new URLSearchParams(location.search).get('view') === option.id;
                      return `rf-nav-sublink ${selected ? 'rf-nav-sublink--active' : ''}`;
                    }}
                  >
                    {option.label}
                  </NavLink>
                ))}
                {roleLc === 'cajero' && asistenciaQrActiva ? renderAsistenciaQrSub() : null}
              </div>
            )}

            {!isCollapsed && link.to === '/admin/mi-restaurant' && isMiRestaurantExpanded && (
              <div className="mt-1 ml-8 space-y-0.5">
                {miRestaurantSubOptions.map(option => (
                  <NavLink
                    key={option.id}
                    to={`/admin/mi-restaurant?view=${option.id}`}
                    className={({ isActive }) => {
                      const selected = isActive && new URLSearchParams(location.search).get('view') === option.id;
                      return `rf-nav-sublink ${selected ? 'rf-nav-sublink--active' : ''}`;
                    }}
                  >
                    {option.label}
                  </NavLink>
                ))}
              </div>
            )}

            {!isCollapsed && link.to === '/admin/almacen' && isAlmacenExpanded && (
              <div className="mt-1 ml-8 space-y-0.5">
                {almacenSubOptions.map(option => (
                  <NavLink
                    key={option.id}
                    to={`/admin/almacen?view=${option.id}`}
                    className={({ isActive }) => {
                      const selected = isActive && new URLSearchParams(location.search).get('view') === option.id;
                      return `rf-nav-sublink ${selected ? 'rf-nav-sublink--active' : ''}`;
                    }}
                  >
                    <span>{option.label}</span>
                    {option.isNew && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500 text-white">NUEVO</span>}
                  </NavLink>
                ))}
              </div>
            )}

            {!isCollapsed && link.to === '/admin/informes' && isInformesExpanded && (
              <div className="mt-1 ml-8 space-y-0.5">
                {informesSubOptions.map((option) => (
                  <NavLink
                    key={option.id}
                    to={`/admin/informes?view=${option.id}`}
                    className={({ isActive }) => {
                      const raw = new URLSearchParams(location.search).get('view')
                        || new URLSearchParams(location.search).get('seccion')
                        || 'ventas';
                      const current = raw === 'cortesias' ? 'descuentos' : raw;
                      const selected = isActive && current === option.id;
                      return `rf-nav-sublink !whitespace-normal leading-snug ${selected ? 'rf-nav-sublink--active' : ''}`;
                    }}
                  >
                    {option.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="rf-sidebar__footer p-2 border-t border-[color:var(--ui-sidebar-border)]">
        <button type="button" onClick={() => void handleFinalizarJornadaClick()} className="rf-sidebar__footer-btn flex items-center gap-3 px-3 py-2 w-full transition-colors text-sm" title={tc('layout.endShift')}>
          <MdLogout className="text-lg flex-shrink-0" />
          {!isCollapsed && <span>{tc('layout.endShift')}</span>}
        </button>
      </div>
      <AdminAttendanceReviewModal
        isOpen={attendanceReviewOpen}
        onClose={() => setAttendanceReviewOpen(false)}
        onComplete={onAttendanceReviewComplete}
      />
      <EndShiftModal isOpen={endShiftOpen} onClose={() => setEndShiftOpen(false)} />
    </aside>
  );
}
