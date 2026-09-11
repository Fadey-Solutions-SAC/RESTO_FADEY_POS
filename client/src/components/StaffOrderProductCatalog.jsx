import {
  orderingProductUnitPrice,
  orderingStockCellIsOut,
  orderingStockCellText,
} from '../utils/productStockDisplay';

/**
 * Catálogo Mesas / Caja: una fila por producto; precio y stock a la derecha (float, sin flex).
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
    <table
      className="rf-order-catalog-table w-full min-w-0"
      style={{
        width: '100%',
        tableLayout: 'fixed',
        borderCollapse: 'separate',
        borderSpacing: '0 6px',
      }}
    >
      <thead>
        <tr>
          <th
            style={{
              padding: '0 0.75rem 0.25rem',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--ui-muted)',
              textAlign: 'left',
            }}
          >
            Producto
            <span
              style={{
                float: 'right',
                textTransform: 'uppercase',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              Stock · Precio
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {products.map((product) => {
          const stockText = orderingStockCellText(product, { hideStock: hideProductStock });
          const stockOut = orderingStockCellIsOut(product, { hideStock: hideProductStock });
          const unitPrice = fmtMoney(orderingProductUnitPrice(product));
          const showStock = stockText !== '—';
          return (
            <tr key={product.id}>
              <td style={{ padding: 0, border: 'none', verticalAlign: 'middle' }}>
                <button
                  type="button"
                  onClick={() => onProductPick(product)}
                  className="rf-order-catalog-row"
                  style={{
                    display: 'block',
                    width: '100%',
                    boxSizing: 'border-box',
                    margin: 0,
                    padding: '0.625rem 0.75rem',
                    border: '1px solid var(--ui-border)',
                    borderRadius: 6,
                    background: '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      paddingRight: '0.25rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--ui-body-text)',
                        wordBreak: 'break-word',
                      }}
                    >
                      {product.is_combo ? (
                        <span
                          style={{
                            marginRight: 4,
                            padding: '1px 4px',
                            borderRadius: 4,
                            fontSize: 9,
                            fontWeight: 700,
                            background: '#dbeafe',
                            color: '#1e40af',
                          }}
                        >
                          COMBO
                        </span>
                      ) : null}
                      {product.name}
                    </span>
                    <span
                      style={{
                        float: 'right',
                        clear: 'none',
                        marginLeft: '0.75rem',
                        whiteSpace: 'nowrap',
                        fontSize: '0.875rem',
                        lineHeight: 1.35,
                      }}
                    >
                      {showStock ? (
                        <span
                          style={{
                            marginRight: '0.65rem',
                            fontSize: '0.75rem',
                            fontWeight: stockOut ? 600 : 500,
                            fontVariantNumeric: 'tabular-nums',
                            color: stockOut ? '#dc2626' : '#64748b',
                          }}
                        >
                          {stockText}
                        </span>
                      ) : null}
                      <span
                        style={{
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          color: '#2563eb',
                        }}
                      >
                        {unitPrice}
                      </span>
                    </span>
                  </span>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
