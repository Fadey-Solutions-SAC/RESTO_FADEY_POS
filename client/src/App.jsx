import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './context/AuthContext';
import { shouldSkipEntrySplash, markEntrySplashDone } from './utils/entrySplashSession';
import { registerServiceWorkerAfterSplash } from './serviceWorkerRegister';

import Layout from './components/Layout';
import Login from './pages/Login';
import RestoFadeyEntrySplash from './components/RestoFadeyEntrySplash';
import Escritorio from './pages/admin/Escritorio';
import Ventas from './pages/admin/Ventas';
import POSPanel from './pages/pos/POSPanel';
import Tables from './pages/admin/Tables';
import Reservas from './pages/admin/Reservas';
import AutoPedidoAdmin from './pages/admin/AutoPedidoAdmin';
import SelfOrder from './pages/public/SelfOrder';
import SelfOrderCliente from './pages/public/SelfOrderCliente';
import Creditos from './pages/admin/Creditos';
import Clientes from './pages/admin/Clientes';
import Productos from './pages/admin/Productos';
import Ofertas from './pages/admin/Ofertas';
import Descuentos from './pages/admin/Descuentos';
import Almacen from './pages/admin/Almacen';
import Delivery from './pages/admin/Delivery';
import Reports from './pages/admin/Reports';
import Indicadores from './pages/admin/Indicadores';
import MiRestaurant from './pages/admin/MiRestaurant';
import Settings from './pages/admin/Settings';
import WorkTime from './pages/admin/WorkTime';
import KitchenPanel from './pages/kitchen/KitchenPanel';
import DeliveryPanel from './pages/delivery/DeliveryPanel';
import CustomerLayout from './pages/customer/CustomerLayout';
import Menu from './pages/customer/Menu';
import Cart from './pages/customer/Cart';
import CustomerOrders from './pages/customer/CustomerOrders';
import OrderTracking from './pages/customer/OrderTracking';
import MasterAdmin from './pages/master/MasterAdmin';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import BackgroundKitchenAutoPrinter from './components/BackgroundKitchenAutoPrinter';
import PrintingAssistantAutoDiscover from './components/PrintingAssistantAutoDiscover';
import { ADMIN_MODULE_PATHS, hasModulePermission, getDefaultStaffPath } from './utils/staffModuleAccess';
import { useDeliverySettings } from './hooks/useDeliveryEnabled';

function DeliveryModuleGate({ children }) {
  const { enabled, loaded } = useDeliverySettings();
  const { user } = useAuth();
  if (!loaded) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="rf-loader rf-loader--md" />
      </div>
    );
  }
  if (!enabled) {
    if (user?.role === 'delivery') return <Navigate to="/" replace />;
    return <Navigate to="/admin" replace />;
  }
  return children;
}

function ProtectedRoute({ children, roles, moduleId, moduleIds }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="rf-loader rf-loader--md" /></div>;
  if (!user || user.type === 'customer') return <Navigate to="/" />;
  const ids = Array.isArray(moduleIds) && moduleIds.length
    ? moduleIds
    : (moduleId ? [moduleId] : []);
  const hasPermission = ids.length === 0 ? true : ids.some((id) => hasModulePermission(user, id));
  if (roles && !roles.includes(user.role) && !hasPermission) {
    if (user.role === 'delivery') {
      return <Navigate to="/delivery" replace />;
    }
    return <Navigate to="/admin" replace />;
  }
  if (
    ids.includes('delivery') &&
    user.role !== 'delivery' &&
    hasPermission &&
    ['admin', 'cajero', 'mozo'].includes(String(user.role || '')) &&
    location.pathname.startsWith('/delivery') &&
    !location.pathname.startsWith('/admin/delivery')
  ) {
    return <Navigate to="/admin/delivery" replace />;
  }
  if (ids.length > 0 && !hasPermission) return <Navigate to="/admin" replace />;
  return children;
}

function KitchenAreaRoute() {
  const { areaId } = useParams();
  const id = String(areaId || '').trim() || 'cocina';
  return <KitchenPanel areaId={id} />;
}

function DefaultPage() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (user.role === 'master_admin') return <Navigate to="/master" replace />;
  const defaultPath = getDefaultStaffPath(user);
  if (defaultPath !== '/admin') return <Navigate to={defaultPath} replace />;
  if (!hasModulePermission(user, 'escritorio')) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="card max-w-md text-center">
          <h2 className="text-xl font-bold mb-2">{t('app.noModulesTitle')}</h2>
          <p className="text-[var(--ui-muted)] text-sm">{t('app.noModulesBody')}</p>
        </div>
      </div>
    );
  }
  return <Escritorio />;
}

function LegacyTrackingRedirect() {
  const { id } = useParams();
  return <Navigate to={`/customer/orders/${id}`} replace />;
}

/** Configuración de cartas y QR: solo rol `admin` (vista pública del QR en `/auto-pedido`). */
function AdminOnlyAutoPedido() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/admin" replace />;
  return <AutoPedidoAdmin />;
}

export default function App() {
  const { user, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(() => shouldSkipEntrySplash());

  const handleSplashComplete = useCallback(() => {
    markEntrySplashDone();
    setSplashDone(true);
  }, []);

  useEffect(() => {
    if (user || splashDone) {
      registerServiceWorkerAfterSplash();
    }
  }, [user, splashDone]);

  if (user) {
    return <AppRoutes user={user} />;
  }

  const hasStoredSession = typeof localStorage !== 'undefined' && !!localStorage.getItem('token');
  if (loading && hasStoredSession) {
    return <div className="rf-splash-boot" aria-hidden="true" />;
  }

  if (!splashDone) {
    return <RestoFadeyEntrySplash onComplete={handleSplashComplete} />;
  }

  return <AppRoutes user={null} />;
}

function AppRoutes({ user }) {
  return (
    <>
      <Routes>
      <Route path="/auto-pedido" element={<SelfOrder />} />
      <Route path="/auto-pedido-cliente" element={<SelfOrderCliente />} />
      <Route path="/" element={user && user.type === 'staff' ? <Navigate to={
        getDefaultStaffPath(user)
      } /> : <Login />} />

      <Route path="/admin" element={<ProtectedRoute roles={['admin', 'cajero', 'mozo', 'produccion', 'cocina', 'bar', 'master_admin']}><Layout /></ProtectedRoute>}>
        <Route index element={<DefaultPage />} />
        <Route path="ventas" element={<ProtectedRoute roles={['admin', 'cajero']} moduleId="ventas"><Ventas /></ProtectedRoute>} />
        <Route path="caja" element={<ProtectedRoute roles={['admin', 'cajero']} moduleId="caja"><POSPanel /></ProtectedRoute>} />
        <Route path="tiempo-trabajado" element={<ProtectedRoute roles={['admin']} moduleId="tiempo_trabajado"><WorkTime /></ProtectedRoute>} />
        <Route path="mesas" element={<ProtectedRoute roles={['admin', 'mozo']} moduleId="mesas"><Tables /></ProtectedRoute>} />
        <Route path="reservas" element={<ProtectedRoute roles={['admin', 'cajero', 'mozo']} moduleId="reservas"><Reservas /></ProtectedRoute>} />
        <Route path="auto-pedido" element={<AdminOnlyAutoPedido />} />
        <Route path="creditos" element={<ProtectedRoute roles={['admin', 'cajero']} moduleId="creditos"><Creditos /></ProtectedRoute>} />
        <Route path="clientes" element={<ProtectedRoute roles={['admin', 'cajero']} moduleId="clientes"><Clientes /></ProtectedRoute>} />
        <Route path="productos" element={<ProtectedRoute roles={['admin']} moduleId="productos"><Productos /></ProtectedRoute>} />
        <Route path="ofertas" element={<ProtectedRoute roles={['admin']} moduleId="ofertas"><Ofertas /></ProtectedRoute>} />
        <Route path="descuentos" element={<ProtectedRoute roles={['admin']} moduleId="descuentos"><Descuentos /></ProtectedRoute>} />
        <Route path="almacen" element={<ProtectedRoute roles={['admin']} moduleId="almacen"><Almacen /></ProtectedRoute>} />
        <Route path="delivery" element={<ProtectedRoute roles={['admin', 'cajero', 'mozo']} moduleId="delivery"><DeliveryModuleGate><Delivery /></DeliveryModuleGate></ProtectedRoute>} />
        <Route path="produccion/:areaId" element={<ProtectedRoute roles={['admin', 'produccion', 'cocina', 'bar']} moduleIds={['produccion', 'cocina', 'bar']}><KitchenAreaRoute /></ProtectedRoute>} />
        <Route path="cocina" element={<ProtectedRoute roles={['admin', 'produccion', 'cocina']} moduleIds={['cocina', 'produccion']}><KitchenPanel station="cocina" areaId="cocina" /></ProtectedRoute>} />
        <Route path="bar" element={<ProtectedRoute roles={['admin', 'produccion', 'bar']} moduleIds={['bar', 'produccion']}><KitchenPanel station="bar" areaId="bar" /></ProtectedRoute>} />
        <Route path="informes" element={<ProtectedRoute roles={['admin', 'cajero']} moduleId="informes"><Reports /></ProtectedRoute>} />
        <Route path="indicadores" element={<ProtectedRoute roles={['admin']} moduleId="indicadores"><Indicadores /></ProtectedRoute>} />
        <Route path="comprobantes-emitidos" element={<Navigate to="/admin/informes?seccion=facturacion" replace />} />
        <Route path="mi-restaurant" element={<ProtectedRoute roles={['admin', 'master_admin']} moduleId="mi_restaurant"><MiRestaurant /></ProtectedRoute>} />
        <Route path="configuracion" element={<ProtectedRoute roles={['admin']} moduleId="configuracion"><Settings /></ProtectedRoute>} />
      </Route>

      <Route path="/produccion/:areaId" element={<ProtectedRoute roles={['admin', 'produccion', 'cocina', 'bar']} moduleIds={['produccion', 'cocina', 'bar']}><KitchenAreaRoute /></ProtectedRoute>} />
      <Route path="/kitchen" element={<ProtectedRoute roles={['admin', 'cocina', 'produccion']} moduleIds={['cocina', 'produccion']}><KitchenPanel station="cocina" areaId="cocina" /></ProtectedRoute>} />
      <Route path="/bar" element={<ProtectedRoute roles={['admin', 'bar', 'produccion']} moduleIds={['bar', 'produccion']}><KitchenPanel station="bar" areaId="bar" /></ProtectedRoute>} />
      <Route path="/delivery" element={<ProtectedRoute roles={['delivery']} moduleId="delivery"><DeliveryModuleGate><DeliveryPanel /></DeliveryModuleGate></ProtectedRoute>} />
      <Route path="/master" element={<ProtectedRoute roles={['master_admin']}><MasterAdmin /></ProtectedRoute>} />
      <Route path="/customer" element={<CustomerLayout />}>
        <Route index element={<Menu />} />
        <Route path="cart" element={<Cart />} />
        <Route path="orders" element={<CustomerOrders />} />
        <Route path="orders/:id" element={<OrderTracking />} />
      </Route>

      <Route path="/menu" element={<Navigate to="/customer" replace />} />
      <Route path="/cart" element={<Navigate to="/customer/cart" replace />} />
      <Route path="/my-orders" element={<Navigate to="/customer/orders" replace />} />
      <Route path="/tracking/:id" element={<LegacyTrackingRedirect />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      {user && user.type === 'staff' ? (
        <>
          <PrintingAssistantAutoDiscover />
          <BackgroundKitchenAutoPrinter />
        </>
      ) : null}
      <PwaInstallPrompt />
    </>
  );
}
