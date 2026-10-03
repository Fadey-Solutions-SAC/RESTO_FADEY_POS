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

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function searchWords(value) {
  return normalizeSearchText(value).split(/[^a-z0-9ñ.]+/).filter(Boolean);
}

/**
 * Cada palabra escrita debe coincidir con el inicio de alguna palabra del nombre, en cualquier orden
 * («cabernet», «sauv cab», «fro malb»). Sin distinguir tildes ni mayúsculas.
 */
export function matchesOrderingProductSearch(productName, searchTerm) {
  const terms = searchWords(searchTerm);
  if (!terms.length) return true;
  const words = searchWords(productName);
  return terms.every((t) => words.some((w) => w.startsWith(t)));
}

/** Filtra por categoría y búsqueda; primero los nombres que empiezan con lo escrito. */
export function filterOrderingProducts(products = [], { search = '', selectedCat = 'all' } = {}) {
  const filtered = products.filter((p) => {
    if (selectedCat !== 'all' && p.category_id !== selectedCat) return false;
    if (!matchesOrderingProductSearch(p.name, search)) return false;
    return true;
  });
  const term = normalizeSearchText(search);
  if (!term) return filtered;
  const startsFirst = filtered.filter((p) => normalizeSearchText(p.name).startsWith(term));
  if (!startsFirst.length || startsFirst.length === filtered.length) return filtered;
  return [...startsFirst, ...filtered.filter((p) => !normalizeSearchText(p.name).startsWith(term))];
}

export function buildOrderItemsPayload(cart = []) {
  return cart.map((i) => {
    const qty = Number(i.quantity || 1);
    const unit = Number(i.price ?? i.unit_price ?? 0);
    const name = String(i.name || i.product_name || '').trim();
    return {
      product_id: i.product_id,
      combo_id: i.combo_id || undefined,
      quantity: qty,
      modifier_id: i.modifier_id || '',
      modifier_option: i.modifier_option || '',
      notes: String(i.notes || '').trim(),
      product_name: name,
      name,
      unit_price: unit,
      price: unit,
      subtotal: qty * unit,
      variant_name: i.variant_name || i.modifier_option || '',
    };
  });
}
