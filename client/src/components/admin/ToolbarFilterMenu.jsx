import { useEffect, useRef, useState } from 'react';
import { MdExpandMore } from 'react-icons/md';

/** Menú de la barra de filtros: fechas, exportar y acciones extra, en la misma fila que el buscador. */
export default function ToolbarFilterMenu({ label = 'Opciones', active = false, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex h-9 max-w-[6.5rem] items-center gap-1 rounded-xl border px-2 text-xs font-semibold sm:h-10 sm:max-w-none sm:px-3 sm:text-sm ${
          active || open
            ? 'border-blue-400 bg-blue-50 text-blue-800'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <span className="truncate">{label}</span>
        <MdExpandMore className={`shrink-0 text-base transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}
