import { MdDownload, MdPhoneAndroid } from 'react-icons/md';
import { isElectronRuntime } from '../../utils/api';
import {
  openAndroidAssistantApk,
  openPrintingAssistantInstaller,
} from '../../utils/printingAssistantDownload';

/**
 * Descarga del asistente de impresión (Windows) y del APK Android.
 * Oculto cuando ya corre dentro de Electron.
 */
export default function PrintingAssistantDownloadButton({
  className = 'btn-secondary text-sm inline-flex items-center gap-2',
  disabled = false,
  label = 'Descargar asistente Windows',
  androidLabel = 'Asistente Android (APK)',
  showAndroid = true,
}) {
  if (isElectronRuntime()) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        onClick={openPrintingAssistantInstaller}
        disabled={disabled}
      >
        <MdDownload className="text-base shrink-0" />
        {label}
      </button>
      {showAndroid ? (
        <button
          type="button"
          className={className}
          onClick={openAndroidAssistantApk}
          disabled={disabled}
          title="Misma función de impresión y e-fact en el teléfono"
        >
          <MdPhoneAndroid className="text-base shrink-0" />
          {androidLabel}
        </button>
      ) : null}
    </div>
  );
}
