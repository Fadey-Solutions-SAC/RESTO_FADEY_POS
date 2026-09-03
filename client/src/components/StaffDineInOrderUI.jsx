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

function lineSubtitle(item) {
  if (item.modifier_option) return String(item.modifier_option);
  if (item.modifier_name) return String(item.modifier_name);
  return '';
}

const VIEWPORT_CART_MAX_CLASS = 'max-h-[min(calc(92vh-7.5rem),calc(100dvh-8rem))]';
/** En móvil (productos arriba + pedido abajo): no tapar el catálogo. */
const MOBILE_STACKED_CART_MAX_CLASS = 'max-h-[min(42vh,340px)]';
const SCROLL_INVISIBLE_CLASS =
  '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0';

export { VIEWPORT_CART_MAX_CLASS, MOBILE_STACKED_CART_MAX_CLASS };

function QtyStepper({ quantity, onDecrease, onIncrease, decreaseDisabled, compact = false }) {
  const btnClass = compact
    ? 'flex h-7 w-6 items-center justify-center border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-40'
    : 'flex h-8 w-8 items-center justify-center border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-40';
  const qtyClass = compact
    ? 'flex min-w-[1.1rem] items-center justify-center px-0.5 text-xs font-semibold tabular-nums text-[var(--ui-body-text)]'
    : 'flex min-w-[2rem] items-center justify-center px-1 font-semibold tabular-nums text-[var(--ui-body-text)]';
  const shellClass = compact
    ? 'inline-flex items-stretch overflow-hidden rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-xs'
    : 'inline-flex items-stretch overflow-hidden rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-sm';

  return (
    <div className={shellClass}>
      <button
        type="button"
        onClick={onDecrease}
        disabled={decreaseDisabled}
        className={`${btnClass} border-r`}
        aria-label="Disminuir cantidad"
      >
        <MdRemove className={compact ? 'text-sm' : 'text-base'} />
      </button>
      <span className={qtyClass}>{quantity}</span>
      <button
        type="button"
        onClick={onIncrease}
        className={`${btnClass} border-l`}
        aria-label="Aumentar cantidad"
      >
        <MdAdd className={compact ? 'text-sm' : 'text-base'} />
      </button>
    </div>
  );
}

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
  /** Si false, oculta eliminar y no permite bajar cantidad por debajo de 1. */
  canDeleteLine = true,
}) {
  if (cart.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--ui-muted)]">Selecciona productos arriba</p>;
  }
  if (cartLayout === 'lines') {
    const lineHeaderClass =
      'mb-1.5 flex shrink-0 items-center gap-1 border-b border-[color:var(--ui-border)] pb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--ui-muted)]';
    const lineRowClass = 'flex min-w-0 items-center gap-1 py-1.5';
    const priceColClass = 'w-[3.1rem] shrink-0 truncate text-right text-[11px] tabular-nums text-[var(--ui-body-text)]';
    const qtyColClass = 'flex w-[4.125rem] shrink-0 justify-center';

    return (
      <div className="min-w-0">
        <div className={lineHeaderClass}>
          <span className="min-w-0 flex-1 truncate">Producto</span>
          <span className={`${qtyColClass} text-center`}>Cant.</span>
          <span className={`${priceColClass} font-medium`}>Prec.</span>
          <span className={`${priceColClass} font-medium`}>Total</span>
          <span className="w-6 shrink-0" aria-hidden />
        </div>
        <div className="divide-y divide-[color:var(--ui-border)]">
          {cart.map((item) => {
            const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
            const subtitle = lineSubtitle(item);
            const showNoteEditor = noteEditorLineKey === item.line_key || item.notes?.trim();
            return (
              <div key={item.line_key} className="py-1">
                <div className={lineRowClass}>
                  <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                    <p
                      className="min-w-0 truncate text-xs font-semibold text-[var(--ui-body-text)]"
                      title={item.name}
                    >
                      {item.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setNoteEditorLineKey((prev) => (prev === item.line_key ? '' : item.line_key))}
                      className={`shrink-0 rounded p-0.5 ${
                        item.notes?.trim()
                          ? 'text-amber-600'
                          : 'text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
                      }`}
                      title="Nota para cocina"
                    >
                      <MdEditNote className="text-sm" />
                    </button>
                  </div>
                  <div className={qtyColClass}>
                    <QtyStepper
                      compact
                      quantity={item.quantity}
                      onDecrease={() => updateQty(item.line_key, -1)}
                      onIncrease={() => updateQty(item.line_key, 1)}
                      decreaseDisabled={!canDeleteLine && Number(item.quantity || 0) <= 1}
                    />
                  </div>
                  <p className={`${priceColClass} font-medium`} title={formatCurrency(item.price)}>
                    {formatCurrency(item.price)}
                  </p>
                  <p
                    className={`${priceColClass} font-semibold`}
                    title={formatCurrency(lineTotal)}
                  >
                    {formatCurrency(lineTotal)}
                  </p>
                  {canDeleteLine ? (
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.line_key)}
                      className={
                        showLineDeleteLabel
                          ? 'inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/45 bg-red-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-red-200 hover:bg-red-900/55'
                          : 'flex h-6 w-6 shrink-0 items-center justify-center text-red-500 hover:text-red-600'
                      }
                      aria-label={showLineDeleteLabel ? 'Eliminar producto' : 'Quitar'}
                    >
                      <MdDelete className={showLineDeleteLabel ? 'text-xs' : 'text-base'} />
                      {showLineDeleteLabel ? <span>Eliminar</span> : null}
                    </button>
                  ) : (
                    <span className="w-6 shrink-0" aria-hidden />
                  )}
                </div>
                {subtitle ? (
                  <p className="truncate pl-0 text-[10px] text-[var(--ui-muted)]" title={subtitle}>
                    {subtitle}
                  </p>
                ) : null}
                {Number(item.note_required || 0) === 1 ? (
                  <p className="text-[10px] font-semibold text-red-400">Nota obligatoria</p>
                ) : null}
                {showNoteEditor ? (
                  <div className="mt-1.5">
                    <textarea
                      value={item.notes || ''}
                      onChange={(e) => updateItemNote(item.line_key, e.target.value)}
                      placeholder="Escribe una nota para cocina..."
                      className="w-full resize-y rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] px-2 py-1.5 text-xs text-[var(--ui-body-text)] placeholder:text-[var(--ui-muted)] focus:border-[color:var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus-ring)]"
                      rows={2}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
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
            disabled={!canDeleteLine && Number(item.quantity || 0) <= 1}
            className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
        {canDeleteLine ? (
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
        ) : null}
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
 * Panel lateral «Detalle del pedido» (usable fuera del grid de productos).
 */
export function StaffDineInOrderCartPanel({
  fillParentHeight = false,
  /** Alineado al tope del modal (columna derecha completa). */
  elevatedAside = false,
  cartTitle = 'Detalle del pedido',
  orderBadge = '',
  cart = [],
  sidebarTop = null,
  sidebarPreCart = null,
  cartLayout = 'lines',
  formatCurrency,
  noteEditorLineKey,
  setNoteEditorLineKey,
  updateQty,
  removeFromCart,
  updateItemNote,
  showLineDeleteLabel = false,
  canDeleteLine = true,
  showOrderObservation = true,
  orderObservation = '',
  onOrderObservationChange = null,
  orderObservationPlaceholder = 'Observaciones del pedido...',
  footer = null,
  className = '',
  /** Catálogo arriba y pedido abajo en pantallas pequeñas. */
  stackedMobile = false,
}) {
  const observationRows = fillParentHeight || elevatedAside || stackedMobile ? 2 : 3;
  const pinFooter = true;
  const shellMaxClass = elevatedAside
    ? VIEWPORT_CART_MAX_CLASS
    : stackedMobile
      ? MOBILE_STACKED_CART_MAX_CLASS
      : fillParentHeight
        ? VIEWPORT_CART_MAX_CLASS
        : '';

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] lg:border lg:shadow-[0_4px_24px_rgba(15,23,42,0.08)] ${
        elevatedAside
          ? `h-full min-h-0 w-full self-start p-3 lg:w-[min(100%,22rem)] lg:max-w-[22rem] ${shellMaxClass}`
          : stackedMobile
            ? `w-full min-h-0 shrink-0 p-3 ${shellMaxClass}`
            : fillParentHeight
              ? `w-full min-h-0 self-start p-3 lg:w-[min(100%,22rem)] lg:max-w-[22rem] ${shellMaxClass}`
              : 'p-4 lg:min-h-0 lg:h-full lg:w-[min(100%,22rem)] lg:max-w-[22rem]'
      } ${className}`.trim()}
    >
      <div className="grid h-full max-h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <div className="min-h-0 shrink-0">
          <div className={`flex items-center justify-between gap-2 ${fillParentHeight ? 'mb-2' : 'mb-3'}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className={`font-bold text-[var(--ui-body-text)] ${fillParentHeight ? 'text-sm' : 'text-base'}`}>
                {cartTitle}
              </h3>
              {orderBadge ? (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--ui-accent)_18%,transparent)] px-2.5 py-0.5 text-xs font-semibold text-[var(--ui-accent)]">
                  {orderBadge}
                </span>
              ) : cart.length > 0 ? (
                <span className="rounded-full bg-[color-mix(in_srgb,var(--ui-accent)_18%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--ui-accent)]">
                  {cart.length}
                </span>
              ) : null}
            </div>
          </div>
          {sidebarTop ? <div className="mb-2 space-y-2">{sidebarTop}</div> : null}
        </div>
        <div
          className={`min-h-0 overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y ${SCROLL_INVISIBLE_CLASS}`}
          style={{ touchAction: 'pan-y' }}
          onWheel={(e) => e.stopPropagation()}
        >
          {sidebarPreCart}
          {sidebarPreCart ? <div className="mt-1 border-t border-[color:var(--ui-border)] pt-3" /> : null}
          {sidebarPreCart ? (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ui-muted)]">Agregar al pedido</p>
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
            canDeleteLine={canDeleteLine}
          />
        </div>
        <div
          className={`shrink-0 space-y-2 border-t border-[color:var(--ui-border)] bg-[var(--ui-surface)] ${
            pinFooter ? 'pt-2 shadow-[0_-6px_16px_rgba(15,23,42,0.12)]' : 'mt-3 pt-3 lg:shadow-[0_-8px_24px_rgba(15,23,42,0.12)]'
          }`}
        >
          {showOrderObservation && onOrderObservationChange ? (
            <div className="relative">
              <MdEditNote className="pointer-events-none absolute left-2.5 top-2.5 text-sm text-[var(--ui-muted)]" />
              <textarea
                value={orderObservation}
                onChange={(e) => onOrderObservationChange(e.target.value)}
                placeholder={orderObservationPlaceholder}
                rows={observationRows}
                className={`w-full resize-none rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] py-2 pl-8 pr-2 text-sm text-[var(--ui-body-text)] placeholder:text-[var(--ui-muted)] focus:border-[color:var(--ui-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-focus-ring)] ${
                  pinFooter ? 'h-[3.25rem] max-h-[3.25rem]' : 'max-h-[5.5rem]'
                }`}
              />
            </div>
          ) : null}
          {footer ? <div className="space-y-2">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
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
  canDeleteLine = true,
  /** Panel con altura del contenedor padre (modal Mesas / Caja). */
  fillParentHeight = false,
  cartTitle = 'Detalle del pedido',
  orderBadge = '',
  orderObservation = '',
  onOrderObservationChange = null,
  orderObservationPlaceholder = 'Observaciones del pedido...',
  showOrderObservation = true,
  /** En lg+: el carrito se renderiza fuera (columna derecha del modal). */
  externalCartAside = false,
}) {
  const panelLayout = fillParentHeight || (!embedded && !stackedSelfOrder);

  const rootClass = embedded
    ? 'h-[min(50vh,460px)] max-h-[min(70vh,560px)] w-full min-h-0'
    : stackedSelfOrder
      ? 'min-h-0 flex-1 h-full'
      : panelLayout
        ? 'min-h-0 flex-1'
        : `${minHeightClass} h-full min-h-0`;

  const catBtnBase = 'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium';

  const searchBlock = (
    <div className="relative shrink-0">
      <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-accent)]" />
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Buscar producto..."
        className={`input-field pl-10 pr-3 placeholder:text-[var(--ui-muted)] ${fillParentHeight ? 'py-2' : 'py-2.5'}`}
      />
    </div>
  );

  const scrollAreaProps = {
    className: `min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch] touch-pan-y`,
    style: { touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' },
  };

  const categoriesBlock = (
    <div
      className={`flex shrink-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-x ${fillParentHeight ? 'mb-2' : 'mb-3'}`}
      style={{ touchAction: 'pan-x' }}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onSelectedCatChange('all')}
        className={`${catBtnBase} ${
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
          className={`${catBtnBase} ${
            selectedCat === c.id
              ? 'border border-[color:var(--ui-accent)] bg-[var(--ui-accent)] text-white'
              : 'border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
          }`}
        >
          {c.name}
        </button>
      ))}
    </div>
  );

  const gridGapClass = singleColumnProductList ? 'gap-3' : 'gap-2';
  const gridColsClass = stackedSelfOrder
    ? (singleColumnProductList ? 'grid-cols-1' : 'grid-cols-2')
    : 'grid-cols-1';

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
                  className="flex flex-col overflow-hidden rounded-md bg-white text-left transition-shadow hover:shadow-md"
                  style={{ border: '1px solid var(--ui-border)' }}
                >
                  <div className="aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-[color:var(--ui-accent)] bg-white">
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[var(--ui-muted)]">
                        <MdRestaurantMenu className="text-4xl opacity-40" aria-hidden />
                        <span className="text-xs">Sin imagen</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 bg-white p-3">
                    <button
                      type="button"
                      onClick={() => onProductPick(p)}
                      className="w-full text-left"
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--ui-body-text)] break-words">
                          {p.name}
                        </p>
                        <p className="shrink-0 text-sm font-bold tabular-nums text-[var(--ui-body-text)]">
                          {formatCurrency(p.price)}
                        </p>
                      </div>
                      {showStock ? <p className="mt-0.5 text-xs text-[var(--ui-accent)]">Stock: {p.stock}</p> : null}
                    </button>
                    {productActionLabel ? (
                      <button
                        type="button"
                        onClick={() => onProductPick(p)}
                        className="w-full rounded-md border border-[color:var(--ui-accent)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
                        style={{ borderWidth: 1 }}
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
                className="rounded-md bg-white p-3 text-left transition-shadow hover:shadow-md"
                style={{ border: '1px solid var(--ui-border)' }}
              >
                <button
                  type="button"
                  onClick={() => onProductPick(p)}
                  className="w-full text-left"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {p.is_combo ? (
                      <span className="mt-0.5 shrink-0 rounded bg-[var(--ui-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ui-accent)]">
                        Combo
                      </span>
                    ) : null}
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-[var(--ui-body-text)] break-words">
                        {p.name}
                      </p>
                      <p className="shrink-0 text-sm font-bold tabular-nums text-[var(--ui-body-text)]">
                        {formatCurrency(p.price)}
                      </p>
                    </div>
                  </div>
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

  const cartPanelProps = {
    fillParentHeight,
    cartTitle,
    orderBadge,
    cart,
    sidebarTop,
    sidebarPreCart,
    cartLayout,
    formatCurrency,
    noteEditorLineKey,
    setNoteEditorLineKey,
    updateQty,
    removeFromCart,
    updateItemNote,
    showLineDeleteLabel,
    canDeleteLine,
    showOrderObservation,
    orderObservation,
    onOrderObservationChange,
    orderObservationPlaceholder,
    footer,
  };

  if (stackedSelfOrder) {
    return (
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden ${rootClass} ${className}`}>
        <div className="shrink-0">{searchBlock}</div>
        <div className="shrink-0">{categoriesBlock}</div>
        <div {...scrollAreaProps}>
          {productGrid}
        </div>
        <div className="shrink-0 rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[var(--ui-body-text)]">
            <MdShoppingCart /> Tu pedido
            {cart.length > 0 && (
              <span className="rounded-full bg-[var(--ui-accent)] px-2 py-0.5 text-xs text-white">{cart.length}</span>
            )}
          </h3>
          <div className="max-h-[min(26vh,200px)] overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] touch-pan-y pr-0.5" style={{ touchAction: 'pan-y' }} onWheel={(e) => e.stopPropagation()}>
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
              canDeleteLine={canDeleteLine}
            />
          </div>
          {footer ? <div className="mt-3 space-y-2 border-t border-[color:var(--ui-border)] pt-3">{footer}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${fillParentHeight ? 'gap-2' : 'gap-4'} ${externalCartAside ? 'flex-1' : ''} ${externalCartAside ? '' : 'lg:flex-row'} ${externalCartAside ? '' : 'lg:items-stretch'} ${rootClass} ${className}`}
    >
      <div className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${fillParentHeight ? 'gap-2' : ''}`}>
        <div className="shrink-0">{searchBlock}</div>
        {categoriesBlock}
        <div {...scrollAreaProps}>{productGrid}</div>
      </div>

      {externalCartAside ? (
        <div className={`flex min-h-0 shrink-0 flex-col overflow-hidden lg:hidden ${MOBILE_STACKED_CART_MAX_CLASS}`}>
          <StaffDineInOrderCartPanel
            {...cartPanelProps}
            stackedMobile
            className="h-full min-h-0 max-h-full"
          />
        </div>
      ) : (
        <StaffDineInOrderCartPanel {...cartPanelProps} />
      )}
    </div>
  );
}
