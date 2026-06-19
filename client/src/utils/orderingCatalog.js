/** Categoría virtual para combos en tomar pedido / caja. */
export const ORDERING_COMBOS_CATEGORY_ID = '__combos__';

export function buildCombosCategory() {
  return { id: ORDERING_COMBOS_CATEGORY_ID, name: 'COMBOS', active: 1 };
}

export function combosToOrderingProducts(combos = []) {
  return (Array.isArray(combos) ? combos : [])
    .filter((c) => Number(c.active ?? 1) === 1)
    .map((c) => {
      const comboItems = (Array.isArray(c.items) ? c.items : []).map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name || it.name || '',
        quantity: Number(it.quantity || 1),
      }));
      return {
        id: `combo:${c.id}`,
        combo_id: c.id,
        is_combo: true,
        name: c.name,
        description: c.description || '',
        price: Number(c.price || 0),
        category_id: ORDERING_COMBOS_CATEGORY_ID,
        is_active: 1,
        stock: null,
        process_type: 'transformed',
        production_area: 'cocina',
        combo_items: comboItems,
        note_required: 0,
        modifier_id: '',
      };
    });
}

/**
 * Añade combos activos al catálogo de pedidos con categoría «COMBOS».
 */
export function mergeOrderingCatalog(products = [], categories = [], combos = []) {
  const comboProducts = combosToOrderingProducts(combos);
  if (!comboProducts.length) {
    return { products: [...products], categories: [...categories] };
  }
  const hasCombosCategory = categories.some((c) => c.id === ORDERING_COMBOS_CATEGORY_ID);
  return {
    products: [...products, ...comboProducts],
    categories: hasCombosCategory ? [...categories] : [buildCombosCategory(), ...categories],
  };
}

/** Filtra productos visibles en pedidos (incluye combos virtuales). */
export function filterVisibleOrderingProducts(products = [], categoryIds = new Set()) {
  return products.filter((p) => p.is_combo || categoryIds.has(p.category_id));
}

/** Coincide si el nombre del producto empieza con el texto buscado (orden de escritura). */
export function matchesOrderingProductSearch(productName, searchTerm) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return true;
  const name = String(productName || '').trim().toLowerCase();
  return name.startsWith(term);
}

/** Filtra catálogo de pedidos por categoría y búsqueda por prefijo. */
export function filterOrderingProducts(products = [], { search = '', selectedCat = 'all' } = {}) {
  return products.filter((p) => {
    if (selectedCat !== 'all' && p.category_id !== selectedCat) return false;
    if (!matchesOrderingProductSearch(p.name, search)) return false;
    return true;
  });
}

export function buildOrderItemsPayload(cart = []) {
  return cart.map((i) => ({
    product_id: i.product_id,
    combo_id: i.combo_id || undefined,
    quantity: i.quantity,
    modifier_id: i.modifier_id || '',
    modifier_option: i.modifier_option || '',
    notes: String(i.notes || '').trim(),
  }));
}
