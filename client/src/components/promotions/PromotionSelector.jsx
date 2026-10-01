import { useMemo, useState } from 'react';
import { MdSearch, MdCheckBox, MdCheckBoxOutlineBlank } from 'react-icons/md';
import { resolveMediaUrl } from '../../utils/api';

/** Selector múltiple de productos y categorías con buscador. */
export default function PromotionSelector({
  products = [],
  categories = [],
  productIds = [],
  categoryIds = [],
  onChange,
  allowCategories = true,
}) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const productSet = useMemo(() => new Set(productIds.map(String)), [productIds]);
  const categorySet = useMemo(() => new Set(categoryIds.map(String)), [categoryIds]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'all' && String(p.category_id || '') !== catFilter) return false;
      if (!q) return true;
      return (p.name || '').toLowerCase().includes(q) || (p.category_name || '').toLowerCase().includes(q);
    });
  }, [products, search, catFilter]);

  const toggleProduct = (id) => {
    const next = new Set(productSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ product_ids: [...next], category_ids: [...categorySet] });
  };

  const toggleCategory = (id) => {
    const next = new Set(categorySet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ product_ids: [...productSet], category_ids: [...next] });
  };

  const selectVisible = () => {
    const next = new Set(productSet);
    visibleProducts.forEach((p) => next.add(String(p.id)));
    onChange({ product_ids: [...next], category_ids: [...categorySet] });
  };

  const clearAll = () => onChange({ product_ids: [], category_ids: [] });

  return (
    <div className="space-y-3">
      {allowCategories && categories.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Categorías completas</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const on = categorySet.has(String(c.id));
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCategory(String(c.id))}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    on
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Productos</p>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={selectVisible} className="font-medium text-blue-600 hover:underline">
              Seleccionar visibles
            </button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={clearAll} className="font-medium text-slate-500 hover:underline">
              Limpiar
            </button>
          </div>
        </div>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
              placeholder="Buscar producto…"
              autoComplete="off"
            />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="input-field sm:w-48">
            <option value="all">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-1.5">
          {visibleProducts.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No hay productos que mostrar.</p>
          ) : (
            visibleProducts.map((p) => {
              const id = String(p.id);
              const viaCategory = categorySet.has(String(p.category_id || ''));
              const on = productSet.has(id) || viaCategory;
              const img = String(resolveMediaUrl(p.image || '') || '').trim();
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleProduct(id)}
                  disabled={viaCategory && !productSet.has(id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                    on ? 'bg-blue-50 text-slate-800' : 'text-slate-700 hover:bg-white'
                  } disabled:cursor-default`}
                >
                  {on ? (
                    <MdCheckBox className="shrink-0 text-lg text-blue-600" />
                  ) : (
                    <MdCheckBoxOutlineBlank className="shrink-0 text-lg text-slate-400" />
                  )}
                  {img ? (
                    <img src={img} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="h-7 w-7 shrink-0 rounded bg-slate-200" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  {viaCategory ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase text-blue-600">Por categoría</span>
                  ) : (
                    <span className="max-w-[110px] shrink-0 truncate text-xs text-slate-500">{p.category_name}</span>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    S/ {Number(p.price || 0).toFixed(2)}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Seleccionados: <strong>{productSet.size}</strong> producto(s)
          {allowCategories ? (
            <>
              {' '}· <strong>{categorySet.size}</strong> categoría(s)
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
