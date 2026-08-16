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
  MdInsights, MdStorefront, MdSettings, MdLogout, MdTableBar, MdAccessTime, MdKitchen, MdLocalBar, MdTouchApp,
  MdMenu,
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

export default function Sidebar({ collapsed, isMobile = false, mobileOpen = false, onClose = () => {}, onToggleMenu = () => {} }) {
  const { t } = useTranslation('dashboard');
  const { t: tc } = useTranslation('common');
  const { user } = useAuth();
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
    const onAreas = () => loadProductionAreas();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadProductionAreas();
    };
    window.addEventListener('production-areas-updated', onAreas);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('production-areas-updated', onAreas);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadProductionAreas, location.pathname]);

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
          const areasForNav = (role === 'produccion' && ownArea)
            ? productionAreas.filter((a) => a.id === ownArea)
            : (role === 'cocina'
              ? productionAreas.filter((a) => a.id === 'cocina')
              : (role === 'bar'
                ? productionAreas.filter((a) => a.id === 'bar')
                : productionAreas));
          for (const area of areasForNav) {
            const idLc = String(area.id || '').toLowerCase();
            const icon = getProductionAreaIcon(area);
            links.push({
              to: `/admin/produccion/${area.id}`,
              icon,
              label: area.name || area.id,
              end: false,
              roles: ['admin', 'produccion', 'cocina', 'bar'],
              // Permiso amplio: cualquier módulo de producción del plan
              moduleId: idLc === 'cocina' ? 'cocina' : idLc === 'bar' ? 'bar' : 'produccion',
              isProductionArea: true,
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
  const [isCajaExpanded, setIsCajaExpanded] = useState(location.pathname.startsWith('/admin/caja'));
  const [isMiRestaurantExpanded, setIsMiRestaurantExpanded] = useState(location.pathname.startsWith('/admin/mi-restaurant'));
  const [isAlmacenExpanded, setIsAlmacenExpanded] = useState(location.pathname.startsWith('/admin/almacen'));
  const hasLinkPermission = (link) => {
    if (link?.isProductionArea) {
      return canSeeProduction;
    }
    return canAccessStaffModule(user, { moduleId: link.moduleId, roles: link.roles });
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

  const isCollapsed = isMobile ? false : collapsed;

  return (
    <aside className={`rf-sidebar fixed left-0 top-0 h-full z-40 transition-all duration-300 flex flex-col border-r border-[color:var(--ui-sidebar-border)] ${
      isMobile
        ? `w-72 max-w-[85vw] transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`
        : (isCollapsed ? 'w-[var(--ui-sidebar-width-collapsed)]' : 'w-[var(--ui-sidebar-width)]')
    }`}>
      <div
        className={`rf-sidebar-logo-bar flex items-center shrink-0 h-[var(--ui-shell-header-h)] border-b border-[color:var(--ui-sidebar-border)] ${
          isCollapsed ? 'justify-center px-0' : 'gap-2 px-2.5'
        }`}
      >
        {isCollapsed ? (
          <button
            type="button"
            onClick={onToggleMenu}
            className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg transition-colors"
            aria-label={tc('layout.menu', { defaultValue: 'Menú' })}
          >
            <MdMenu className="text-xl text-[var(--ui-body-text)]" />
          </button>
        ) : (
          <>
            <div className="rf-sidebar-brand w-9 h-9 bg-gradient-to-br from-[var(--ui-logo-from)] to-[var(--ui-logo-to)] rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
              <MdStorefront className="text-white text-lg" />
            </div>
            <span className="rf-font-display font-bold text-base text-[var(--ui-body-text)] tracking-tight truncate min-w-0 flex-1">
              {tc('layout.brandName')}
            </span>
            <button
              type="button"
              onClick={onToggleMenu}
              className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg transition-colors shrink-0"
              aria-label={tc('layout.menu', { defaultValue: 'Menú' })}
            >
              <MdMenu className="text-xl text-[var(--ui-body-text)]" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 px-1.5 py-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleLinks.map(link => (
          <div key={link.to}>
            <NavLink
              to={link.moduleId === 'caja' ? '/admin/caja?view=cobrar' : link.to}
              end={link.end}
              className={linkClass}
              title={link.label}
              onClick={(e) => {
                if (isCollapsed) return;
                if (link.moduleId === 'caja' || link.to === '/admin/caja') {
                  const isInCaja = location.pathname.startsWith('/admin/caja');
                  const cajaView = new URLSearchParams(location.search).get('view') || 'cobrar';
                  if (isInCaja && cajaView === 'cobrar') {
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
                if (isMobile) onClose();
              }}
            >
              <link.icon className="text-lg flex-shrink-0" />
              {!isCollapsed && <span className="whitespace-nowrap leading-snug">{link.label}</span>}
            </NavLink>

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
          </div>
        ))}
      </nav>

      <div className="p-2 border-t border-[color:var(--ui-sidebar-border)]">
        <button type="button" onClick={() => void handleFinalizarJornadaClick()} className="flex items-center gap-3 px-3 py-2 rounded-lg text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] w-full transition-colors text-sm" title={tc('layout.endShift')}>
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
