import {
  orderingProductUnitPrice,
  orderingStockCellIsOut,
  orderingStockCellText,
} from '../utils/productStockDisplay';

/** Misma rejilla en cabecera y filas (móvil / tablet / escritorio). */
const ROW_LAYOUT = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  width: '100%',
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
};

const COL_NAME = {
  flex: '1 1 0%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
};

const COL_STOCK = {
  flex: '0 0 2.75rem',
  width: '2.75rem',
  textAlign: 'right',
  fontSize: '0.6875rem',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: 1.2,
};

const COL_PRICE = {
  flex: '0 0 4.5rem',
  width: '4.5rem',
  textAlign: 'right',
  fontSize: '0.8125rem',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: '#2563eb',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

/**
 * Catálogo Mesas / Caja: nombre a la izquierda; stock y precio fijos a la derecha.
 */
export default function StaffOrderProductCatalog({
  products = [],
  onProductPick,
  formatCurrency,
  hideProductStock = false,
}) {
  const fmtMoney = formatCurrency || ((amount) => `S/ ${Number(amount || 0).toFixed(2)}`);

  if (!products.length) return null;

  return (
    <div className="min-w-0 w-full max-w-full">
      <div
        style={{ ...ROW_LAYOUT, padding: '0 0.75rem 0.25rem' }}
        className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-muted)]"
        aria-hidden="true"
      >
        <span style={COL_NAME}>Producto</span>
        <span style={{ ...COL_STOCK, color: 'var(--ui-muted)', fontWeight: 600 }}>Stock</span>
        <span style={{ ...COL_PRICE, color: 'var(--ui-muted)', fontWeight: 600, fontSize: '0.625rem' }}>
          Precio
        </span>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {products.map((product) => {
          const stockText = orderingStockCellText(product, { hideStock: hideProductStock });
          const stockOut = orderingStockCellIsOut(product, { hideStock: hideProductStock });
          const unitPrice = fmtMoney(orderingProductUnitPrice(product));
          const stockDisplay = stockText === '—' ? '—' : stockText;
          return (
            <li key={product.id} className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onProductPick(product)}
                className="rf-order-catalog-row w-full max-w-full rounded-md border border-[color:var(--ui-border)] bg-white px-3 py-2 sm:py-2.5 text-left shadow-sm transition-shadow hover:shadow-md"
                style={{
                  ...ROW_LAYOUT,
                  margin: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'var(--ui-body-text)',
                }}
                title={`${product.name} · ${stockDisplay} · ${unitPrice}`}
              >
                <span style={COL_NAME} className="text-sm font-medium text-[var(--ui-body-text)]">
                  {product.is_combo ? (
                    <span className="mr-1 inline-block rounded bg-blue-100 px-1 py-0.5 text-[9px] font-bold uppercase text-blue-800">
                      Combo
                    </span>
                  ) : null}
                  {product.name}
                </span>
                <span
                  style={{
                    ...COL_STOCK,
                    fontWeight: stockOut ? 600 : 500,
                    color: stockOut ? '#dc2626' : '#64748b',
                  }}
                >
                  {stockDisplay}
                </span>
                <span style={COL_PRICE} className="rf-order-catalog-price">
                  {unitPrice}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
