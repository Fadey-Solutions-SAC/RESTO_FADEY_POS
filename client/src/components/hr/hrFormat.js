export function formatSqlTime(sql) {
  const m = String(sql || '').match(/(\d{2}):(\d{2})/);
  if (!m) return '—';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

export function formatMinutes(mins) {
  const n = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function attendanceStatusLabel(status) {
  const map = {
    on_time: 'A tiempo',
    late: 'Tardanza',
    late_justified: 'Tardanza justificada',
    open: 'En jornada',
    leave: 'Permiso',
    absent: 'Inasistencia',
  };
  return map[status] || status || '—';
}

export function employeeStatusLabel(status) {
  const map = { active: 'Activo', inactive: 'Inactivo', suspended: 'Suspendido' };
  return map[status] || status || '—';
}

export function leaveTypeLabel(type) {
  const map = {
    personal: 'Personal',
    medico: 'Médico',
    comision: 'Comisión',
    vacaciones: 'Vacaciones',
    descanso: 'Descanso',
    otro: 'Otro',
  };
  return map[type] || type || '—';
}

export function leaveStatusLabel(status) {
  const map = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
  return map[status] || status || '—';
}

export function getHrDeviceId() {
  const key = 'rf_hr_device_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export const WEEKDAY_LABELS = [
  { v: 0, label: 'Lun' },
  { v: 1, label: 'Mar' },
  { v: 2, label: 'Mié' },
  { v: 3, label: 'Jue' },
  { v: 4, label: 'Vie' },
  { v: 5, label: 'Sáb' },
  { v: 6, label: 'Dom' },
];

export function parseWorkDays(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(Number) : [0, 1, 2, 3, 4, 5];
  } catch {
    return [0, 1, 2, 3, 4, 5];
  }
}
