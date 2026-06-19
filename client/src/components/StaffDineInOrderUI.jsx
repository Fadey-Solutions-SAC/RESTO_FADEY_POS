import {
  MdSearch,
  MdRestaurantMenu,
  MdShoppingCart,
  MdAdd,
  MdRemove,
  MdDelete,
  MdEditNote,
} from 'react-icons/md';
import { showStockInOrderingUI } from '../utils/productStockDisplay';
import { resolveMediaUrl } from '../utils/api';

function CartLineItems({
  cart,
  cartLayout,
  formatCurrency,
  noteEditorLineKey,
  setNoteEditorLineKey,
  updateQty,
  removeFromCart,
  updateItemNote,
  /** Texto «Eliminar» junto al icono (p. ej. al modificar pedido en caja). */
  showLineDeleteLabel = false,
}) {
  if (cart.length === 0) {
    return <p className="py-4 text-center text-sm text-[var(--ui-accent)]">Selecciona productos arriba</p>;
  }
  if (cartLayout === 'lines') {
    return cart.map((item) => {
      const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
      return (
        <div key={item.line_key} className="border-b border-[color:var(--ui-border)] py-2">
          <p className="mb-2 w-full text-sm font-medium leading-snug text-[var(--ui-body-text)] break-words">
            {item.name}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setNoteEditorLineKey((prev) => (prev === item.line_key ? '' : item.line_key))}
                className={`flex h-7 w-7 items-center justify-center rounded border ${
                  item.notes?.trim()
                    ? 'border-amber-300 bg-amber-100 text-amber-700'
                    : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                }`}
                title="Agregar nota"
              >
                <MdEditNote className="text-sm" />
              </button>
              <button
                type="button"
                onClick={() => updateQty(item.line_key, -1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
              >
                <MdRemove className="text-xs" />
              </button>
              <span className="w-7 text-center font-bold tabular-nums text-[var(--ui-body-text)]">{item.quantity}</span>
              <button
                type="button"
                onClick={() => updateQty(item.line_key, 1)}
                className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
              >
                <MdAdd className="text-xs" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-[4.5rem] shrink-0 text-right font-semibold tabular-nums text-[var(--ui-body-text)]">
                {formatCurrency(lineTotal)}
              </span>
              <button
                type="button"
                onClick={() => removeFromCart(item.line_key)}
                className={
                  showLineDeleteLabel
                    ? 'shrink-0 inline-flex items-center gap-1 rounded-md border border-red-500/45 bg-red-950/40 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/55'
                    : 'shrink-0 p-0.5 text-[var(--ui-accent)] hover:text-[var(--ui-body-text)]'
                }
                aria-label={showLineDeleteLabel ? 'Eliminar producto' : 'Quitar'}
              >
                <MdDelete className="text-sm" />
                {showLineDeleteLabel ? <span>Eliminar</span> : null}
              </button>
            </div>
          </div>
          {Number(item.note_required || 0) === 1 && (
            <p className="mt-0.5 text-[11px] font-semibold text-[#FCA5A5]">Nota obligatoria</p>
          )}
          {item.modifier_name && item.modifier_option && (
            <p className="mt-0.5 break-words text-[11px] leading-snug text-[var(--ui-accent)]">
              {item.modifier_name}: {item.modifier_option}
            </p>
          )}
          {(noteEditorLineKey === item.line_key || item.notes?.trim()) && (
            <div className="mt-2">
              <textarea
                value={item.notes || ''}
                onChange={(e) => updateItemNote(item.line_key, e.target.value)}
                placeholder="Escribe una nota para cocina..."
                className="w-full rounded border border-[color:var(--ui-accent)] bg-[var(--ui-surface-2)] px-2 py-1.5 text-xs text-[var(--ui-body-text)] placeholder:text-[var(--ui-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
                rows={2}
              />
            </div>
          )}
        </div>
      );
    });
  }
  return cart.map((item) => (
    <div key={item.line_key} className="rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium leading-snug text-[var(--ui-body-text)]">{item.name}</p>
          {Number(item.note_required || 0) === 1 && (
            <p className="text-[11px] font-semibold text-[#FCA5A5]">Nota obligatoria</p>
          )}
          {item.modifier_name && item.modifier_option && (
            <p className="break-words text-[11px] leading-snug text-[var(--ui-accent)]">
              {item.modifier_name}: {item.modifier_option}
            </p>
          )}
          <p className="text-xs text-[var(--ui-accent)]">{formatCurrency(item.price)}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNoteEditorLineKey((prev) => (prev === item.line_key ? '' : item.line_key))}
            className={`flex h-7 w-7 items-center justify-center rounded border ${
              item.notes?.trim()
                ? 'border-amber-300 bg-amber-100 text-amber-700'
                : 'border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
            }`}
            title="Agregar nota"
          >
            <MdEditNote className="text-sm" />
          </button>
          <button
            type="button"
            onClick={() => updateQty(item.line_key, -1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            <MdRemove className="text-xs" />
          </button>
          <span className="w-6 text-center text-sm font-bold text-[var(--ui-body-text)]">{item.quantity}</span>
          <button
            type="button"
            onClick={() => updateQty(item.line_key, 1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
          >
            <MdAdd className="text-xs" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => removeFromCart(item.line_key)}
          className={
            showLineDeleteLabel
              ? 'inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/45 bg-red-950/40 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/55'
              : 'shrink-0 text-[var(--ui-accent)] hover:text-[var(--ui-body-text)]'
          }
          aria-label={showLineDeleteLabel ? 'Eliminar producto' : 'Quitar'}
        >
          <MdDelete className="text-sm" />
          {showLineDeleteLabel ? <span>Eliminar</span> : null}
        </button>
      </div>
      {(noteEditorLineKey === item.line_key || item.notes?.trim()) && (
        <div className="mt-2">
          <textarea
            value={item.notes || ''}
            onChange={(e) => updateItemNote(item.line_key, e.target.value)}
            placeholder="Escribe una nota para cocina..."
            className="w-full rounded border border-[color:var(--ui-accent)] bg-[var(--ui-surface-2)] px-2 py-1.5 text-xs text-[var(--ui-body-text)] placeholder:text-[var(--ui-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
            rows={2}
          />
        </div>
      )}
    </div>
  ));
}

/**
 * UI unificada “Tomar pedido” (Mesas / Caja / Reservas / Delivery / auto-pedido): buscador, categorías, grilla y carrito.
 * `stackedSelfOrder`: columna única — solo la grilla hace scroll; resumen + total + pie fijos (QR cliente).
 */
export default function StaffDineInOrderUI({
  search,
  onSearchChange,
  selectedCat,
  onSelectedCatChange,
  categories = [],
  filteredProducts = [],
  onProductPick,
  cart = [],
  noteEditorLineKey,
  setNoteEditorLineKey,
  updateQty,
  removeFromCart,
  updateItemNote,
  cartTotal,
  formatCurrency,
  sidebarTop = null,
  sidebarPreCart = null,
  footer = null,
  minHeightClass = 'min-h-[50vh]',
  embedded = false,
  cartLayout = 'lines',
  className = '',
  stackedSelfOrder = false,
  productActionLabel = '',
  /** Vista pública QR: una columna, miniatura y sin stock */
  singleColumnProductList = false,
  showProductThumbnail = false,
  hideProductStock = false,
  showLineDeleteLabel = false,
  /** Panel lateral de Mesas: altura del padre + una sola zona de scroll (categorías + productos). */
  fillParentHeight = false,
}) {
  const rootClass = embedded
    ? 'h-[min(50vh,460px)] max-h-[min(70vh,560px)] w-full min-h-0'
    : stackedSelfOrder
      ? 'min-h-0 flex-1 h-full'
      : `${minHeightClass} h-full min-h-0`;

  const searchBlock = (
    <div className="relative shrink-0">
      <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-accent)]" />
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Buscar producto..."
        className="input-field py-2.5 pl-10 pr-3 placeholder:text-[var(--ui-muted)]"
      />
    </div>
  );

  const scrollAreaProps = {
    className: fillParentHeight
      ? 'min-h-0 h-0 flex-1 basis-0 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch] touch-pan-y'
      : 'min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y',
    style: { touchAction: 'pan-y' },
    onWheel: (e) => e.stopPropagation(),
  };

  const categoryButtons = (
    <>
      <button
        type="button"
        onClick={() => onSelectedCatChange('all')}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
          selectedCat === 'all'
            ? 'border border-[color:var(--ui-accent)] bg-[var(--ui-accent)] text-white'
            : 'border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
        }`}
      >
        Todos
      </button>
      {categories.map((c) => (
        <button
          type="button"
          key={c.id}
          onClick={() => onSelectedCatChange(c.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            selectedCat === c.id
              ? 'border border-[color:var(--ui-accent)] bg-[var(--ui-accent)] text-white'
              : 'border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          {c.name}
        </button>
      ))}
    </>
  );

  const categoriesBlock = fillParentHeight ? (
    <div className="mb-3 flex shrink-0 flex-wrap gap-2">{categoryButtons}</div>
  ) : (
    <div
      className="flex max-h-[min(22vh,168px)] shrink-0 flex-wrap gap-2 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y"
      style={{ touchAction: 'pan-y' }}
      onWheel={(e) => e.stopPropagation()}
    >
      {categoryButtons}
    </div>
  );

  const gridGapClass = singleColumnProductList ? 'gap-3' : 'gap-2';
  const gridColsClass = stackedSelfOrder
    ? (singleColumnProductList ? 'grid-cols-1' : 'grid-cols-2')
    : 'grid-cols-2 md:grid-cols-3';

  const productGrid = (
    <>
      {filteredProducts.length === 0 ? (
        <div className="py-10 text-center text-[var(--ui-accent)]">
          <MdRestaurantMenu className="mx-auto mb-3 text-5xl opacity-40" />
          <p>No hay productos para este filtro</p>
        </div>
      ) : (
        <div className={`grid ${gridGapClass} ${gridColsClass}`}>
          {filteredProducts.map((p) => {
            const imgUrl = String(resolveMediaUrl(p.image || '') || '').trim();
            const showStock = !hideProductStock && showStockInOrderingUI(p);
            if (showProductThumbnail) {
              return (
                <div
                  key={p.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-left transition-shadow hover:border-[color:var(--ui-accent)] hover:shadow-md"
                >
                  <div className="aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[var(--ui-muted)]">
                        <MdRestaurantMenu className="text-4xl opacity-40" aria-hidden />
                        <span className="text-xs">Sin imagen</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => onProductPick(p)}
                      className="w-full text-left"
                    >
                      <p className="text-sm font-semibold leading-snug text-[var(--ui-body-text)]">{p.name}</p>
                      <p className="mt-1 text-base font-bold text-[var(--ui-body-text)]">{formatCurrency(p.price)}</p>
                      {showStock ? <p className="mt-0.5 text-xs text-[var(--ui-accent)]">Stock: {p.stock}</p> : null}
                    </button>
                    {productActionLabel ? (
                      <button
                        type="button"
                        onClick={() => onProductPick(p)}
                        className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-3 py-2.5 text-sm font-semibold text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                      >
                        {productActionLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={p.id}
                className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 text-left transition-shadow hover:border-[color:var(--ui-accent)] hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => onProductPick(p)}
                  className="w-full text-left"
                >
                  <div className="flex items-start gap-2">
                    {p.is_combo ? (
                      <span className="mt-0.5 shrink-0 rounded bg-[var(--ui-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ui-accent)]">
                        Combo
                      </span>
                    ) : null}
                    <p className="truncate text-sm font-medium text-[var(--ui-body-text)]">{p.name}</p>
                  </div>
                  <p className="mt-1 text-sm font-bold text-[var(--ui-body-text)]">{formatCurrency(p.price)}</p>
                  {p.is_combo && p.description ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--ui-muted)]">{p.description}</p>
                  ) : null}
                  {showStock ? <p className="mt-0.5 text-xs text-[var(--ui-accent)]">Stock: {p.stock}</p> : null}
                </button>
                {productActionLabel ? (
                  <button
                    type="button"
                    onClick={() => onProductPick(p)}
                    className="mt-2 w-full rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2 py-1.5 text-xs font-semibold text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                  >
                    {productActionLabel}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  const cartAsideInner = (
    <div className="flex min-h-0 flex-col overflow-hidden lg:max-h-[min(calc(100dvh-12rem),85vh)]">
      <h3 className="mb-3 flex shrink-0 items-center gap-2 font-bold text-[var(--ui-body-text)]">
        <MdShoppingCart /> Pedido
        {cart.length > 0 && (
          <span className="rounded-full bg-[var(--ui-accent)] px-2 py-0.5 text-xs text-white">{cart.length}</span>
        )}
      </h3>
      {sidebarTop ? <div className="mb-3 shrink-0 space-y-2">{sidebarTop}</div> : null}
      <div
        className={`min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] ${
          fillParentHeight ? 'h-0 basis-0 touch-pan-y' : ''
        }`}
        style={fillParentHeight ? { touchAction: 'pan-y' } : undefined}
        onWheel={fillParentHeight ? (e) => e.stopPropagation() : undefined}
      >
        {sidebarPreCart}
        {sidebarPreCart ? <div className="mt-1 border-t border-[color:var(--ui-border)] pt-3" /> : null}
        {sidebarPreCart ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ui-accent)]">Agregar al pedido</p>
        ) : null}
        <CartLineItems
          cart={cart}
          cartLayout={cartLayout}
          formatCurrency={formatCurrency}
          noteEditorLineKey={noteEditorLineKey}
          setNoteEditorLineKey={setNoteEditorLineKey}
          updateQty={updateQty}
          removeFromCart={removeFromCart}
          updateItemNote={updateItemNote}
          showLineDeleteLabel={showLineDeleteLabel}
        />
      </div>
      {footer ? (
        <div className="mt-3 shrink-0 space-y-2 border-t border-[color:var(--ui-border)] bg-[var(--ui-surface)] pt-3 lg:shadow-[0_-8px_24px_rgba(15,23,42,0.45)]">
          {footer}
        </div>
      ) : null}
    </div>
  );

  if (stackedSelfOrder) {
    return (
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden ${rootClass} ${className}`}>
        <div className="shrink-0">{searchBlock}</div>
        <div className="shrink-0">{categoriesBlock}</div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y"
          style={{ touchAction: 'pan-y' }}
          onWheel={(e) => e.stopPropagation()}
        >
          {productGrid}
        </div>
        <div className="shrink-0 rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[var(--ui-body-text)]">
            <MdShoppingCart /> Tu pedido
            {cart.length > 0 && (
              <span className="rounded-full bg-[var(--ui-accent)] px-2 py-0.5 text-xs text-white">{cart.length}</span>
            )}
          </h3>
          <div className="max-h-[min(26vh,200px)] overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y pr-0.5">
            <CartLineItems
              cart={cart}
              cartLayout={cartLayout}
              formatCurrency={formatCurrency}
              noteEditorLineKey={noteEditorLineKey}
              setNoteEditorLineKey={setNoteEditorLineKey}
              updateQty={updateQty}
              removeFromCart={removeFromCart}
              updateItemNote={updateItemNote}
              showLineDeleteLabel={showLineDeleteLabel}
            />
          </div>
          {footer ? <div className="mt-3 space-y-2 border-t border-[color:var(--ui-border)] pt-3">{footer}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch ${
        fillParentHeight ? 'h-full min-h-0 flex-1 basis-0 overflow-hidden' : ''
      } ${rootClass} ${className}`}
    >
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          fillParentHeight ? 'h-full basis-0' : 'h-full'
        }`}
      >
        <div className="mb-3 shrink-0">{searchBlock}</div>
        {fillParentHeight ? (
          <div {...scrollAreaProps}>
            {categoriesBlock}
            {productGrid}
          </div>
        ) : (
          <>
            <div className="mb-3 shrink-0">{categoriesBlock}</div>
            <div {...scrollAreaProps}>{productGrid}</div>
          </>
        )}
      </div>

      <div
        className={`flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-t border-[color:var(--ui-border)] bg-[var(--ui-surface)] pt-4 lg:sticky lg:top-0 lg:z-10 lg:w-72 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 lg:shadow-[-6px_0_20px_rgba(0,0,0,0.12)] ${
          fillParentHeight ? 'h-full basis-0 lg:max-h-full' : ''
        }`}
      >
        {cartAsideInner}
      </div>
    </div>
  );
}
