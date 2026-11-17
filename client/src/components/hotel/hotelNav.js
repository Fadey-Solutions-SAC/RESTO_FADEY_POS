/** Submódulos de Hotelería. La ruta sigue siendo `/admin/hoteleria`. */
export const HOTEL_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'habitaciones', label: 'Habitaciones' },
  { id: 'reservas', label: 'Reservas' },
  { id: 'huespedes', label: 'Huéspedes' },
  { id: 'estadias', label: 'Estadías y recepción' },
  { id: 'cuentas', label: 'Cuentas y cobros' },
  { id: 'limpieza', label: 'Limpieza y mantenimiento' },
  { id: 'informes', label: 'Informes' },
  { id: 'configuracion', label: 'Configuración' },
];

export function resolveHotelSection(search) {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : (search || new URLSearchParams());
  const raw = String(params.get('seccion') || params.get('view') || '').trim();
  return HOTEL_SECTIONS.some((item) => item.id === raw) ? raw : 'dashboard';
}

export function hotelSectionLabel(id) {
  return HOTEL_SECTIONS.find((item) => item.id === id)?.label || 'Dashboard';
}
