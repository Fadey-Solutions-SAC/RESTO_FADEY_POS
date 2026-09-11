import {
  orderingProductUnitPrice,
  orderingStockCellIsOut,
  orderingStockCellText,
} from '../utils/productStockDisplay';

const ROW_SHELL = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '0.625rem 0.75rem',
  margin: 0,
  border: '1px solid var(--ui-border)',
  borderRadius: 6,
  background: '#ffffff',
  cursor: 'pointer',
  textAlign: 'left',
};

const COL_NAME = {
  flex: '1 1 0',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: 'var(--ui-body-text)',
};

const COL_STOCK = {
  flex: '0 0 3rem',
  width: '3rem',
  textAlign: 'right',
  fontSize: '0.75rem',
  fontVariantNumeric: 'tabular-nums',
};

const COL_PRICE = {
  flex: '0 0 4.75rem',
  width: '4.75rem',
  textAlign: 'right',
  fontSize: '0.875rem',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: '#2563eb',
};

const HEAD_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  width: '100%',
  minWidth: 0,
  padding: '0 0.75rem 0.25rem',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--ui-muted)',
};

/**
 * Catálogo al tomar pedido (Mesas / Caja). Flex fijo: nombre | stock | precio en una línea.
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
    <div className="min-w-0 w-full max-w-full" style={{ minWidth: 0, maxWidth: '100%' }}>
      <div style={HEAD_ROW} aria-hidden="true">
        <span style={{ ...COL_NAME, flex: '1 1 0', fontWeight: 600, color: 'var(--ui-muted)' }}>Producto</span>
        <span style={{ ...COL_STOCK, color: 'var(--ui-muted)' }}>Stock</span>
        <span style={{ ...COL_PRICE, color: 'var(--ui-muted)', fontWeight: 600 }}>Precio</span>
      </div>
      <ul className="m-0 list-none space-y-1.5 p-0" style={{ minWidth: 0, maxWidth: '100%' }}>
        {products.map((product) => {
          const stockText = orderingStockCellText(product, { hideStock: hideProductStock });
          const stockOut = orderingStockCellIsOut(product, { hideStock: hideProductStock });
          const unitPrice = fmtMoney(orderingProductUnitPrice(product));
          return (
            <li key={product.id} style={{ minWidth: 0, maxWidth: '100%' }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onProductPick(product)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onProductPick(product);
                  }
                }}
                style={ROW_SHELL}
                className="rf-order-catalog-row"
              >
                <span style={COL_NAME} title={product.name}>
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
                    ...COL_STOCK,
                    color: stockOut ? '#dc2626' : '#64748b',
                    fontWeight: stockOut ? 600 : 500,
                  }}
                >
                  {stockText}
                </span>
                <span style={COL_PRICE}>{unitPrice}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
