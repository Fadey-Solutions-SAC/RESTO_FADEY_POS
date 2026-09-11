import {
  orderingProductUnitPrice,
  orderingStockCellIsOut,
  orderingStockCellText,
} from '../utils/productStockDisplay';

function formatProductLine(product, unitPrice, stockText) {
  const name = String(product.name || '').trim();
  const stockPart = stockText && stockText !== '—' ? ` · Stk ${stockText}` : '';
  return `${name}${stockPart}  ·  ${unitPrice}`;
}

/**
 * Catálogo Mesas / Caja: precio y stock en el mismo texto visible (sin columnas que se recorten).
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
      <p
        className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-muted)]"
        style={{ margin: '0 0 0.25rem', padding: '0 0.75rem 0.25rem' }}
      >
        Producto · Stock · Precio
      </p>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {products.map((product) => {
          const stockText = orderingStockCellText(product, { hideStock: hideProductStock });
          const stockOut = orderingStockCellIsOut(product, { hideStock: hideProductStock });
          const unitPrice = fmtMoney(orderingProductUnitPrice(product));
          const line = formatProductLine(product, unitPrice, stockText);
          return (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onProductPick(product)}
                className="rf-order-catalog-row block w-full max-w-full rounded-md border border-[color:var(--ui-border)] bg-white px-3 py-2.5 text-left text-sm leading-snug shadow-sm transition-shadow hover:shadow-md"
                style={{
                  color: 'var(--ui-body-text)',
                  wordBreak: 'break-word',
                }}
                title={line}
              >
                {product.is_combo ? (
                  <span className="mr-1 inline-block rounded bg-blue-100 px-1 py-0.5 text-[9px] font-bold uppercase text-blue-800">
                    Combo
                  </span>
                ) : null}
                <span style={{ fontWeight: 500 }}>{product.name}</span>
                {stockText !== '—' ? (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: '0.75rem',
                      fontWeight: stockOut ? 600 : 500,
                      color: stockOut ? '#dc2626' : '#64748b',
                    }}
                  >
                    Stk {stockText}
                  </span>
                ) : null}
                <span
                  style={{
                    marginLeft: 8,
                    fontWeight: 700,
                    color: '#2563eb',
                    whiteSpace: 'nowrap',
                  }}
                >
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
