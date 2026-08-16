import { MdDownload } from 'react-icons/md';

/** Par de descarga: Excel por defecto (primero, resaltado) y TXT. */
export default function DownloadExcelTxtButtons({
  onExcel,
  onTxt,
  disabled = false,
  excelTitle,
  txtTitle,
  excelLabel = 'Excel',
  txtLabel = 'TXT',
  className = '',
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <button
        type="button"
        onClick={onExcel}
        disabled={disabled}
        title={excelTitle || 'Descargar Excel'}
        className="text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1 bg-gold-600 text-white border border-gold-600 hover:bg-gold-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <MdDownload /> {excelLabel}
      </button>
      <button
        type="button"
        onClick={onTxt}
        disabled={disabled}
        title={txtTitle || 'Descargar TXT'}
        className="text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1 border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-surface-2)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <MdDownload /> {txtLabel}
      </button>
    </div>
  );
}
