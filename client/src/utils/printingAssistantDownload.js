import toast from 'react-hot-toast';

/** Debe coincidir con el nombre exacto del asset en GitHub Releases (actual: RestoFADEY.Setup.exe). */
export const DESKTOP_SETUP_URL =
  import.meta.env.VITE_DESKTOP_SETUP_URL ||
  'https://github.com/MECATRONIC-MEN/RESTAURANT/releases/latest/download/RestoFADEY.Setup.exe';

/** Abre la descarga del instalador del asistente de impresión (Resto FADEY desktop). */
export function openPrintingAssistantInstaller() {
  const url = String(DESKTOP_SETUP_URL || '').trim();
  if (!url) {
    toast.error('No hay URL de instalador configurada (VITE_DESKTOP_SETUP_URL).');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  a.download = 'RestoFADEY-Setup.exe';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
