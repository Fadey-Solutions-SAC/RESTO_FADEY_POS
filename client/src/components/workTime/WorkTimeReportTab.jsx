import { MdAccessTime, MdPhotoCamera } from 'react-icons/md';
import Modal from '../Modal';
import { formatDateTime } from '../../utils/api';
import { formatMinutes, ROLE_LABEL } from './workTimeUtils';

const ATT_LABEL = {
  pending: 'Pendiente',
  asistente: 'Asistente',
  justificado: 'Justificado',
  ausente: 'Ausente',
};

export default function WorkTimeReportTab({
  sessions,
  summary,
  loading,
  loadReport,
  photoModal,
  setPhotoModal,
  openSessionPhotos,
  classifyDraft,
  setClassifyDraft,
  classifySavingId,
  applyClassification,
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ui-muted)]">
        El rol <strong>Administrador</strong> no entra en revisión de asistencia: su tiempo cuenta con la jornada cerrada.
        Para el resto, mientras quede en <strong>Pendiente</strong>, el tiempo computable es <strong>0</strong>.
        Clasifique cada jornada cerrada como <strong>Asistente</strong>, <strong>Justificado</strong> o <strong>Ausente</strong>.
        Si el mismo usuario entra desde varios dispositivos (PC + teléfono), el reporte usa la <strong>primera entrada</strong> y la{' '}
        <strong>última salida real</strong> del día; los accesos extra de monitoreo no acortan la jornada.
      </p>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
            <MdAccessTime /> Reporte de jornadas
          </p>
          <button type="button" onClick={loadReport} className="btn-secondary text-sm" disabled={loading}>
            {loading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-[color:var(--ui-border)] rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-[var(--ui-surface-2)] border-b border-[color:var(--ui-border)]">
              <p className="text-sm font-semibold text-[var(--ui-body-text)]">Resumen por usuario</p>
            </div>
            {summary.length === 0 ? (
              <p className="p-4 text-sm text-[var(--ui-muted)]">Sin registros para el rango seleccionado.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {summary.map((item) => (
                  <div key={item.user_id} className="px-3 py-2 border-b border-[color:var(--ui-border)] last:border-0 flex justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--ui-body-text)]">{item.full_name}</p>
                      <p className="text-xs text-[var(--ui-muted)]">@{item.username} · {ROLE_LABEL[item.role] || item.role}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[var(--ui-body-text)]">{formatMinutes(item.total_minutes)}</p>
                      <p className="text-xs text-[var(--ui-muted)]">{item.sessions_count} jornada(s)</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-[color:var(--ui-border)] rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-[var(--ui-surface-2)] border-b border-[color:var(--ui-border)]">
              <p className="text-sm font-semibold text-[var(--ui-body-text)]">Detalle de jornadas</p>
            </div>
            {sessions.length === 0 ? (
              <p className="p-4 text-sm text-[var(--ui-muted)]">Sin jornadas registradas.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {sessions.map((row) => {
                  const isAdminSession = String(row.role || '').toLowerCase() === 'admin';
                  return (
                    <div key={row.id} className="px-3 py-2 border-b border-[color:var(--ui-border)] last:border-0">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[var(--ui-body-text)]">{row.full_name}</p>
                          <p className="text-xs text-[var(--ui-muted)]">Inicio: {formatDateTime(row.login_at)}</p>
                          <p className="text-xs text-[var(--ui-muted)]">Fin: {row.logout_at ? formatDateTime(row.logout_at) : 'Jornada activa'}</p>
                          {Number(row.device_sessions_count || 0) > 1 ? (
                            <p className="text-xs text-sky-600">
                              {row.device_sessions_count} acceso(s) en el día
                              {Number(row.parallel_sessions_count || 0) > 0
                                ? ` · ${row.parallel_sessions_count} de monitoreo`
                                : ''}
                            </p>
                          ) : null}
                          <p className="text-xs mt-1">
                            Asistencia:{' '}
                            <span className={row.attendance_status === 'asistente' || (isAdminSession && row.attendance_status === 'pending') ? 'text-emerald-600 font-medium' : row.attendance_status === 'pending' ? 'text-amber-600 font-medium' : 'text-[var(--ui-muted)]'}>
                              {isAdminSession && row.attendance_status === 'pending' ? 'Sin revisión (admin)' : ATT_LABEL[row.attendance_status] || ATT_LABEL.pending}
                            </span>
                          </p>
                          {(row.has_photo_login || row.has_photo_logout) ? (
                            <button type="button" onClick={() => openSessionPhotos(row.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:underline">
                              <MdPhotoCamera /> Ver fotos
                            </button>
                          ) : null}
                          {row.attendance_status === 'pending' && row.logout_at && !isAdminSession ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <select className="input-field text-xs py-1.5 max-w-[11rem]" value={classifyDraft[row.id] || 'asistente'} onChange={(e) => setClassifyDraft((p) => ({ ...p, [row.id]: e.target.value }))}>
                                <option value="asistente">Asistente</option>
                                <option value="justificado">Justificado</option>
                                <option value="ausente">Ausente</option>
                              </select>
                              <button type="button" className="btn-primary text-xs py-1.5 px-2" disabled={classifySavingId === row.id} onClick={() => applyClassification(row.id)}>
                                {classifySavingId === row.id ? 'Guardando…' : 'Guardar'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[var(--ui-body-text)]">{formatMinutes(row.worked_minutes)}</p>
                          <p className={`text-xs mt-0.5 ${row.logout_at ? 'text-emerald-600' : 'text-amber-600'}`}>{row.logout_at ? 'Cerrada' : 'En curso'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal isOpen={!!photoModal} onClose={() => setPhotoModal(null)} title="Fotos de asistencia" variant="light" size="lg">
        {photoModal && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-[var(--ui-muted)] mb-2">Inicio</p>
              {photoModal.photo_login ? <img src={photoModal.photo_login} alt="" className="rounded-lg max-h-72 w-full object-contain bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]" /> : <p className="text-sm text-[var(--ui-muted)]">Sin foto</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--ui-muted)] mb-2">Fin</p>
              {photoModal.photo_logout ? <img src={photoModal.photo_logout} alt="" className="rounded-lg max-h-72 w-full object-contain bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)]" /> : <p className="text-sm text-[var(--ui-muted)]">Sin foto</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
