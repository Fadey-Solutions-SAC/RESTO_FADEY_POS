/** Dirección del local (emisor) para rellenar cliente cuando no hay dirección propia. */
export function restaurantLocalAddress(restaurant) {
  const fiscal = String(restaurant?.billing_emisor_direccion || '').trim();
  if (fiscal) return fiscal;
  const local = String(restaurant?.address || '').trim();
  if (local) return local;
  const geo = [
    restaurant?.billing_emisor_distrito,
    restaurant?.billing_emisor_provincia,
    restaurant?.billing_emisor_departamento,
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  return geo.length ? geo.join(' - ') : '';
}
