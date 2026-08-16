import { API_BASE } from './api';
import { downloadBlobFile, downloadExcelFile } from './inventoryCuadreExport';

export async function downloadIndicatorsExport({ format = 'csv', tab = 'all', from, to }) {
  const token = localStorage.getItem('token');
  const requested = String(format || 'csv').toLowerCase();
  const serverFormat = requested === 'txt' || requested === 'excel' ? 'csv' : requested;
  const qs = new URLSearchParams({ format: serverFormat, tab });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const res = await fetch(`${API_BASE}/reports/indicators-export?${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'No se pudo exportar');
  }
  const baseName = `indicadores-${tab}-${from || 'periodo'}`;
  if (requested === 'txt') {
    downloadBlobFile(`${baseName}.txt`, await res.text());
    return;
  }
  if (requested === 'csv' || requested === 'excel') {
    downloadExcelFile(baseName, await res.text());
    return;
  }
  const blob = await res.blob();
  const ext = requested === 'pdf' ? 'pdf' : 'json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportHubJsonClient(hub, filename = 'indicadores.json') {
  const blob = new Blob([JSON.stringify(hub, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
