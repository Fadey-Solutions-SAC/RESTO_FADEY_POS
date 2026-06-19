import { useState, useCallback, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { ADMIN_MODULE_PATHS, canAccessStaffModule } from '../utils/staffModuleAccess';
import EndShiftModal from './EndShiftModal';
import AdminAttendanceReviewModal from './AdminAttendanceReviewModal';
import {
  MdDashboard, MdAttachMoney, MdPointOfSale, MdEventSeat,
  MdCreditCard, MdPeopleAlt, MdRestaurantMenu, MdLocalOffer,
  MdDiscount, MdWarehouse, MdDeliveryDining, MdAssessment,
  MdInsights, MdStorefront, MdSettings, MdLogout, MdTableBar, MdAccessTime, MdKitchen, MdLocalBar, MdQrCode2,
} from 'react-icons/md';

/** Icono por módulo; etiqueta vía i18n `dashboard:nav.*`. */
const SIDEBAR_LINK_META = {
  escritorio: { icon: MdDashboard, labelKey: 'nav.escritorio', end: true },
  caja: { icon: MdPointOfSale, labelKey: 'nav.caja' },
  mesas: { icon: MdTableBar, labelKey: 'nav.mesas' },
  cocina: { icon: MdKitchen, labelKey: 'nav.cocina' },
  bar: { icon: MdLocalBar, labelKey: 'nav.bar' },
  delivery: { icon: MdDeliveryDining, labelKey: 'nav.delivery' },
  reservas: { icon: MdEventSeat, labelKey: 'nav.reservas' },
  auto_pedido: { icon: MdQrCode2, labelKey: 'nav.auto_pedido' },
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
  'cobrar', 'apertura_cierre', 'cierres_caja', 'ingresos', 'egresos',
  'notas_credito', 'notas_debito', 'consulta_precios',
];
const MI_RESTAURANT_SUB_IDS = [
  'mi_empresa', 'facturacion_electronica', 'pagos_sistema', 'contrato', 'pago_uso_sistema', 'informacion',
];
const ALMACEN_SUB_IDS = [
  'movimiento_interno', 'ir_modulo_logistica', 'requerimiento', 'recepcion', 'ir_modulo_gastos',
];

export default function Sidebar({ collapsed, isMobile = false, mobileOpen = false, onClose = () => {} }) {
  const { t } = useTranslation('dashboard');
  const { t: tc } = useTranslation('common');
  const { user } = useAuth();

  const allLinks = useMemo(
    () =>
      ADMIN_MODULE_PATHS.map((row) => {
        const meta = SIDEBAR_LINK_META[row.moduleId];
        if (!meta) return null;
        return {
          to: row.path,
          icon: meta.icon,
          label: t(meta.labelKey),
          end: Boolean(meta.end),
          roles: row.roles,
          moduleId: row.moduleId,
        };
      }).filter(Boolean),
    [t],
  );
  const location = useLocation();
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
  const hasLinkPermission = (link) => canAccessStaffModule(user, { moduleId: link.moduleId, roles: link.roles });
  const filtered = allLinks.filter(hasLinkPermission);
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
  const cajaSubOptions = CAJA_SUB_IDS.filter((id) => {
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
    <aside className={`rf-sidebar fixed left-0 top-0 h-full bg-[var(--ui-surface)] z-40 transition-all duration-300 flex flex-col border-r border-[color:var(--ui-sidebar-border)] ${
      isMobile
        ? `w-72 max-w-[85vw] transform ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`
        : (isCollapsed ? 'w-16' : 'w-60')
    }`}>
      <div
        className={`flex items-center shrink-0 h-[var(--ui-shell-header-h)] border-b border-[color:var(--ui-sidebar-border)] ${
          isCollapsed ? 'justify-center px-0' : 'gap-3 px-4'
        }`}
      >
        <div className="rf-sidebar-brand w-9 h-9 bg-gradient-to-br from-[var(--ui-logo-from)] to-[var(--ui-logo-to)] rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
          <MdStorefront className="text-white text-lg" />
        </div>
        {!isCollapsed && <span className="rf-font-display font-bold text-base text-[var(--ui-body-text)] tracking-tight truncate">{tc('layout.brandName')}</span>}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
        {visibleLinks.map(link => (
          <div key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              className={linkClass}
              title={link.label}
              onClick={(e) => {
                if (isCollapsed) return;
                if (link.to === '/admin/caja') {
                  const isInCaja = location.pathname.startsWith('/admin/caja');
                  if (isInCaja) {
                    e.preventDefault();
                    setIsCajaExpanded(prev => !prev);
                    return;
                  }
                  setIsCajaExpanded(true);
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
              {!isCollapsed && <span className="truncate">{link.label}</span>}
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
