export function isPosAdminUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'master_admin';
}

export function canEliminarLiberarMesa(user) {
  if (isPosAdminUser(user)) return true;
  const role = String(user?.role || '').toLowerCase();
  if (role !== 'cajero') return false;
  return Boolean(user?.sub_permissions?.caja?.eliminar_liberar_mesa);
}

export function canAjusteBarAutoDismiss(user) {
  if (isPosAdminUser(user)) return true;
  return String(user?.role || '').toLowerCase() === 'cajero';
}

export function canPosDeleteOrReleaseTable(user) {
  return canEliminarLiberarMesa(user);
}
