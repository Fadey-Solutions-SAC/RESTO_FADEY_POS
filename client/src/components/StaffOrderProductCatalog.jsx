import {
  orderingProductUnitPrice,
  orderingStockCellIsOut,
  orderingStockCellText,
} from '../utils/productStockDisplay';

const TABLE_STYLE = {
  width: '100%',
  tableLayout: 'fixed',
  borderCollapse: 'separate',
  borderSpacing: '0 6px',
};

const COL_STOCK = { width: '3.25rem' };
const COL_PRICE = { width: '5rem' };

const HEAD_CELL = {
  padding: '0 0.5rem 0.25rem',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--ui-muted)',
  textAlign: 'left',
};

const ROW_BTN_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 3.25rem 5rem',
  columnGap: '0.35rem',
  alignItems: 'center',
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
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
};

/**
 * Catálogo de productos al tomar pedido (Mesas / Caja). Tabla + grid inline para que
 * Precio y Stock no dependan de Tailwind ni de clases que el PWA pueda cachear mal.
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
    <div className="min-w-0 w-full max-w-full overflow-x-auto">
      <table style={TABLE_STYLE} className="min-w-[17rem]">
        <colgroup>
          <col />
          <col style={COL_STOCK} />
          <col style={COL_PRICE} />
        </colgroup>
        <thead>
          <tr>
            <th style={HEAD_CELL}>Producto</th>
            <th style={{ ...HEAD_CELL, textAlign: 'right' }}>Stock</th>
            <th style={{ ...HEAD_CELL, textAlign: 'right', paddingRight: '0.75rem' }}>Precio</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const stockText = orderingStockCellText(product, { hideStock: hideProductStock });
            const stockOut = orderingStockCellIsOut(product, { hideStock: hideProductStock });
            const unitPrice = fmtMoney(orderingProductUnitPrice(product));
            return (
              <tr key={product.id}>
                <td colSpan={3} style={{ padding: 0, verticalAlign: 'middle' }}>
                  <button
                    type="button"
                    onClick={() => onProductPick(product)}
                    style={ROW_BTN_STYLE}
                    className="rf-staff-order-catalog-row--btn"
                  >
                    <span
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        color: 'var(--ui-body-text)',
                      }}
                      title={product.name}
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
                        textAlign: 'right',
                        fontSize: '0.75rem',
                        fontVariantNumeric: 'tabular-nums',
                        color: stockOut ? '#dc2626' : '#64748b',
                        fontWeight: stockOut ? 600 : 500,
                      }}
                    >
                      {stockText}
                    </span>
                    <span
                      style={{
                        textAlign: 'right',
                        fontSize: '0.875rem',
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color: '#2563eb',
                      }}
                    >
                      {unitPrice}
                    </span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
