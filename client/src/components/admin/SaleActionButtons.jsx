import { MdCancel, MdEdit, MdPrint, MdTableChart, MdVisibility } from 'react-icons/md';

/** Acciones de una cuenta de venta: 'ver' | 'imprimir' | 'excel' | 'editar' | 'anular'. */
export const SALE_ACTIONS = ['ver', 'imprimir', 'excel', 'editar', 'anular'];

function onPrimaryClick(handler) {
  return (event) => {
    if (event.detail > 1) return;
    handler(event);
  };
}

export default function SaleActionButtons({ group, onAction, isVoided = false }) {
  const allCancelled = (group?.orders || []).every((ord) => ord.status === 'cancelled');
  return (
    <div className="flex items-center gap-1 relative">
      <button
        type="button"
        onClick={onPrimaryClick(() => onAction('ver', group))}
        onDoubleClick={(event) => event.preventDefault()}
        className="px-2 py-1 rounded bg-slate-600 text-white text-xs hover:bg-slate-700"
        title="Ver detalle"
      >
        <MdVisibility />
      </button>
      <button
        type="button"
        onClick={onPrimaryClick(() => onAction('imprimir', group))}
        className="px-2 py-1 rounded bg-cyan-600 text-white text-xs hover:bg-cyan-700"
        title="Imprimir"
      >
        <MdPrint />
      </button>
      <button
        type="button"
        onClick={onPrimaryClick(() => onAction('excel', group))}
        className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
        title="Excel"
      >
        <MdTableChart />
      </button>
      {!isVoided ? (
        <>
          <button
            type="button"
            onClick={onPrimaryClick(() => onAction('editar', group))}
            className="px-2 py-1 rounded bg-amber-500 text-white text-xs hover:bg-amber-600"
            title="Editar"
          >
            <MdEdit />
          </button>
          <button
            type="button"
            onClick={onPrimaryClick(() => onAction('anular', group))}
            disabled={allCancelled}
            className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
            title="Anular venta"
          >
            <MdCancel />
          </button>
        </>
      ) : null}
    </div>
  );
}
