import { MdRestaurantMenu } from 'react-icons/md';
import { resolveMediaUrl } from '../../utils/api';
import PromotionBadge from './PromotionBadge';
import PromotionPrice from './PromotionPrice';

const defaultFmt = (amount) => `S/ ${Number(amount || 0).toFixed(2)}`;

/** Tarjeta de producto con cinta y precio promocional (vista previa del módulo y catálogos). */
export default function PromotionCard({ product, preview, formatCurrency = defaultFmt, footer = null, className = '' }) {
  const img = String(resolveMediaUrl(product?.image || '') || '').trim();
  const original = Number(preview?.original_price ?? product?.price ?? 0);
  const final = preview?.strike ? preview.final_price : original;
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()}
    >
      {preview?.badge ? <PromotionBadge label={preview.badge} type={preview.promotion?.type} seed={preview.promotion?.id} /> : null}
      <div className="aspect-[4/3] w-full overflow-hidden bg-slate-50">
        {img ? (
          <img src={img} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <MdRestaurantMenu className="text-4xl" aria-hidden />
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 p-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{product?.name || 'Producto'}</p>
        <PromotionPrice original={original} final={final} formatCurrency={formatCurrency} className="text-sm" />
      </div>
      {footer}
    </div>
  );
}
