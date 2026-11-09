import toast from 'react-hot-toast';

/** Debe coincidir con el nombre exacto del asset en GitHub Releases y con `build.win.artifactName`. */
export const DESKTOP_SETUP_URL =
  import.meta.env.VITE_DESKTOP_SETUP_URL ||
  'https://github.com/Fadey-Solutions-SAC/RESTO_FADEY_POS/releases/latest/download/Fadey.Impresion.Setup.exe';

/** APK del asistente Android (repo independiente Fadey-Mobile-Assistant). */
export const ANDROID_APK_URL =
  import.meta.env.VITE_ANDROID_ASSISTANT_URL ||
  'https://github.com/Fadey-Solutions-SAC/Fadey-Mobile-Assistant/releases/latest/download/Fadey-Mobile-Assistant.apk';

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Abre la descarga del instalador del asistente de impresión (Resto FADEY desktop). */
export function openPrintingAssistantInstaller() {
  const url = String(DESKTOP_SETUP_URL || '').trim();
  if (!url) {
    toast.error('No hay URL de instalador configurada (VITE_DESKTOP_SETUP_URL).');
    return;
  }
  triggerDownload(url, 'Fadey.Impresion.Setup.exe');
}

/** Abre la descarga del APK Android (Asistente móvil). */
export function openAndroidAssistantApk() {
  const url = String(ANDROID_APK_URL || '').trim();
  if (!url) {
    toast.error('No hay URL de APK configurada (VITE_ANDROID_ASSISTANT_URL).');
    return;
  }
  triggerDownload(url, 'Fadey-Mobile-Assistant.apk');
}
