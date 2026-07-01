export function isPosAdminUser(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'master_admin';
}

export function canEliminarLiberarMesa(user) {
  if (isPosAdminUser(user)) return true;
  return Boolean(user?.sub_permissions?.caja?.eliminar_liberar_mesa);
}

export function canAjusteBarAutoDismiss(user) {
  if (isPosAdminUser(user)) return true;
  return Boolean(user?.sub_permissions?.caja?.ajuste_bar_auto_dismiss);
}

export function canPosDeleteOrReleaseTable(user) {
  return canEliminarLiberarMesa(user);
}
