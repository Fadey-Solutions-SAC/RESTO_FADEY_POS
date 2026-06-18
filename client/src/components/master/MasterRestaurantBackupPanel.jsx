import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { MdDownload, MdUpload, MdRestartAlt } from 'react-icons/md';
import { api, getApiOrigin } from '../../utils/api';
import Modal from '../Modal';

/**
 * Respaldo / restauración / reinicio operativo (solo administrador maestro en API).
 * @param {{ onAfterMutate?: () => void | Promise<void>, cardClassName?: string, textTone?: 'theme' | 'slate' }} props
 */
export default function MasterRestaurantBackupPanel({ onAfterMutate, cardClassName = 'card space-y-4', textTone = 'theme' }) {
  const restoreInputRef = useRef(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const apiOrigin = getApiOrigin();

  const finishRestoreSession = () => {
    localStorage.removeItem('token');
    window.location.href = '/';
  };

  const downloadBackup = async () => {
    try {
      const { blob, filename } = await api.downloadBackup();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Backup descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo descargar el backup');
    }
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    const headBuf = await file.slice(0, 16).arrayBuffer();
    const head = new TextDecoder().decode(headBuf);
    if (!head.startsWith('SQLite format')) {
      toast.error(
        'Archivo inválido: no es un backup .db. Abra el archivo con Bloc de notas: debe empezar con «SQLite format 3».',
      );
      if (restoreInputRef.current) restoreInputRef.current.value = '';
      return;
    }
    const confirmed = window.confirm('Esta acción reemplazará toda la información actual por la del backup. ¿Deseas continuar?');
    if (!confirmed) return;
    setRestoreBusy(true);
    const tid = toast.loading(`Restaurando en ${apiOrigin || 'API'}…`);
    try {
      const data = await api.restoreBackup(file);
      const name = String(data?.restaurant_name || '').trim();
      const detail = name
        ? `${name} · ${data?.products_count ?? '?'} productos · ${data?.users_count ?? '?'} usuarios`
        : '';
      toast.success(
        `${data?.message || 'Información restaurada correctamente'}${detail ? ` (${detail})` : ''}. Inicie sesión con el administrador del restaurante.`,
        { id: tid, duration: 8000 },
      );
      setTimeout(finishRestoreSession, 600);
    } catch (err) {
      toast.error(err.message || 'No se pudo restaurar el backup', { id: tid, duration: 8000 });
    } finally {
      setRestoreBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const submitResetOperational = async (e) => {
    e?.preventDefault?.();
    const pwd = String(resetPassword || '').trim();
    if (!pwd) {
      toast.error('Introduce la contraseña de reinicio.');
      return;
    }
    setResetBusy(true);
    try {
      await api.post('/restaurant/reset-operational', { password: pwd });
      toast.success('Datos operativos reiniciados para pruebas');
      setResetDialogOpen(false);
      setResetPassword('');
      if (typeof onAfterMutate === 'function') {
        await onAfterMutate();
      } else {
        window.location.reload();
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo reiniciar la información operativa');
    } finally {
      setResetBusy(false);
    }
  };

  const titleCls = textTone === 'slate' ? 'font-bold text-slate-900' : 'font-bold text-[var(--ui-body-text)]';
  const bodyCls = textTone === 'slate' ? 'text-sm text-[var(--ui-muted)]' : 'text-sm text-[var(--ui-muted)]';

  return (
    <>
      <div className={cardClassName}>
        <h3 className={titleCls}>Respaldo y restauración de información</h3>
        <p className={bodyCls}>
          Descarga una copia completa de datos antes de actualizar la app y luego restaura desde ese archivo para recuperar toda la información.
          Tras restaurar, cierre sesión y entre con el <strong>usuario administrador del restaurante</strong> incluido en ese backup (no el maestro).
        </p>
        {apiOrigin ? (
          <p className="text-xs font-mono text-[var(--ui-muted)] break-all">
            API destino: {apiOrigin}
          </p>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button type="button" onClick={() => void downloadBackup()} className="w-full btn-secondary flex items-center justify-center gap-2" disabled={restoreBusy}>
            <MdDownload /> Guardar backup
          </button>
          <button type="button" onClick={() => restoreInputRef.current?.click()} className="w-full btn-primary flex items-center justify-center gap-2" disabled={restoreBusy}>
            <MdUpload /> {restoreBusy ? 'Restaurando…' : 'Restaurar información'}
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".db,.sqlite,application/octet-stream"
            className="hidden"
            onChange={(e) => restoreBackup(e.target.files?.[0])}
          />
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
          Importante: al restaurar, se reemplaza la información actual por la del archivo de backup.
          En Render el servicio Node debe tener disco en <code className="text-xs">/data</code> y <code className="text-xs">DB_PATH=/data/restaurant.db</code>.
        </div>
        <div className="pt-2 flex justify-start">
          <button
            type="button"
            onClick={() => {
              setResetPassword('');
              setResetDialogOpen(true);
            }}
            className="px-4 py-2 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-[#2563EB]/10 font-medium text-sm flex items-center gap-2"
          >
            <MdRestartAlt />
            Reiniciar datos de la app (pruebas)
          </button>
        </div>
      </div>

      <Modal
        variant="light"
        isOpen={resetDialogOpen}
        onClose={() => !resetBusy && setResetDialogOpen(false)}
        title="Reiniciar datos (pruebas)"
        size="md"
      >
        <form onSubmit={submitResetOperational} className="space-y-4">
          <p className={textTone === 'slate' ? 'text-sm text-[var(--ui-muted)]' : 'text-sm text-[var(--ui-muted)]'}>
            Se borrarán ventas, pedidos, caja, clientes, productos y demás datos operativos. El{' '}
            <strong>contrato del servicio</strong> (texto y firmas guardados en Mi Restaurante) no se elimina.
          </p>
          <div>
            <label htmlFor="master-backup-reset-password" className={`block text-sm font-medium mb-1 ${textTone === 'slate' ? 'text-slate-800' : 'text-[var(--ui-body-text)]'}`}>
              Contraseña de reinicio
            </label>
            <input
              id="master-backup-reset-password"
              type="password"
              autoComplete="off"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="input-field w-full"
              placeholder="Contraseña"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" className="btn-secondary" disabled={resetBusy} onClick={() => setResetDialogOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={resetBusy}>
              {resetBusy ? 'Reiniciando…' : 'Confirmar reinicio'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
