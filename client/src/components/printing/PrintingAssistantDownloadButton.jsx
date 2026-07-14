import { MdDownload } from 'react-icons/md';
import { isElectronRuntime } from '../../utils/api';
import { openPrintingAssistantInstaller } from '../../utils/printingAssistantDownload';

/**
 * Descarga del asistente de impresión (app de escritorio).
 * Oculto cuando ya corre dentro de Electron.
 */
export default function PrintingAssistantDownloadButton({
  className = 'btn-secondary text-sm inline-flex items-center gap-2',
  disabled = false,
  label = 'Descargar asistente de impresión',
}) {
  if (isElectronRuntime()) return null;

  return (
    <button
      type="button"
      className={className}
      onClick={openPrintingAssistantInstaller}
      disabled={disabled}
    >
      <MdDownload className="text-base shrink-0" />
      {label}
    </button>
  );
}
