import { useState, useEffect, useCallback } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { showStockInOrderingUI, isProductLowStock } from '../../utils/productStockDisplay';
import { useCart } from '../../context/CartContext';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';
import { MdAdd, MdSearch, MdShoppingCart, MdStar, MdRemove } from 'react-icons/md';

export default function Menu() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const { addItem } = useCart();

  const loadMenu = useCallback(() => {
    Promise.all([
      api.get('/products?active_only=true&available_now=true'),
      api.get('/categories/active'),
    ]).then(([prods, cats]) => {
      setProducts(prods);
      setCategories(cats);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'catalog') loadMenu();
  });
  useSocket('inventory-update', loadMenu);

  const handleAddToCart = () => {
    if (!selectedProduct) return;
    addItem(selectedProduct, quantity, selectedVariant);
    toast.success(`${selectedProduct.name} agregado al carrito`);
    setSelectedProduct(null);
    setQuantity(1);
    setSelectedVariant(null);
  };

  const quickAdd = (product) => {
    addItem(product, 1, null);
    toast.success(`${product.name} agregado al carrito`, { icon: '🛒' });
  };

  const filtered = products.filter(p => {
    if (selectedCat !== 'all' && p.category_id !== selectedCat) return false;
    const term = search.toLowerCase();
    const name = (p.name || '').toLowerCase();
    const description = (p.description || '').toLowerCase();
    if (search && !name.includes(term) && !description.includes(term)) return false;
    return true;
  });

  const groupedByCategory = categories
    .filter(c => selectedCat === 'all' || c.id === selectedCat)
    .map(c => ({
      ...c,
      products: filtered.filter(p => p.category_id === c.id),
    }))
    .filter(c => c.products.length > 0);

  return (
    <div>
      <div className="bg-gradient-to-r from-primary-600 to-primary-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-12 md:py-16">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Nuestro Menú</h1>
          <p className="text-primary-200 text-lg mb-6">Descubre los mejores sabores de la cocina peruana</p>
          <div className="relative max-w-xl">
            <MdSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar platos, bebidas..."
              className="w-full pl-12 pr-4 py-3 rounded-xl text-gray-800 bg-white shadow-lg focus:ring-2 focus:ring-white/50 outline-none"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-2 overflow-x-auto pb-3 mb-6 scrollbar-hide">
          <button
            onClick={() => setSelectedCat('all')}
            className={`px-5 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              selectedCat === 'all'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-200'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:text-primary-600'
            }`}
          >
            Todos
          </button>
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCat(c.id)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                selectedCat === c.id
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-200'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:text-primary-600'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {groupedByCategory.map(cat => (
          <div key={cat.id} className="mb-10">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-800">{cat.name}</h2>
              {cat.description && <p className="text-gray-500 text-sm mt-1">{cat.description}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {cat.products.map(product => (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg transition-all group cursor-pointer"
                  onClick={() => { setSelectedProduct(product); setQuantity(1); setSelectedVariant(null); }}
                >
                  <div className="aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center overflow-hidden relative">
                    {product.image ? (
                      <img src={product.image} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <span className="text-5xl">🍽️</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); quickAdd(product); }}
                      className="absolute bottom-3 right-3 w-10 h-10 bg-primary-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary-700 transition-all opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0"
                    >
                      <MdAdd className="text-xl" />
                    </button>
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-gray-800 mb-1">{product.name}</h3>
                    <p className="text-sm text-gray-400 line-clamp-2 mb-3 min-h-[2.5rem]">{product.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold text-primary-600">{formatCurrency(product.price)}</span>
                      {product.variants?.length > 0 && (
                        <span className="text-xs text-gray-400">{product.variants.length} variantes</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <span className="text-6xl block mb-4">🔍</span>
            <p className="text-xl text-gray-400">No se encontraron productos</p>
            <p className="text-gray-400 mt-2">Intenta con otro término de búsqueda</p>
          </div>
        )}
      </div>

      <Modal variant="light" isOpen={!!selectedProduct} onClose={() => setSelectedProduct(null)} title={selectedProduct?.name} size="md">
        {selectedProduct && (
          <div>
            <div className="aspect-video bg-gray-100 rounded-xl mb-4 flex items-center justify-center overflow-hidden">
              {selectedProduct.image ? (
                <img src={selectedProduct.image} alt={selectedProduct.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-6xl">🍽️</span>
              )}
            </div>

            <p className="text-gray-500 mb-4">{selectedProduct.description}</p>

            <div className="flex items-center justify-between mb-4">
              <span className="text-2xl font-bold text-primary-600">
                {formatCurrency(selectedProduct.price + (selectedVariant?.price_modifier || 0))}
              </span>
              {showStockInOrderingUI(selectedProduct) &&
                selectedProduct.stock > 0 &&
                isProductLowStock(selectedProduct.stock, selectedProduct.min_stock) && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg">Pocas unidades</span>
              )}
            </div>

            {selectedProduct.variants?.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Variantes</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedVariant(null)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      !selectedVariant ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    Normal
                  </button>
                  {selectedProduct.variants.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariant(v)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        selectedVariant?.id === v.id ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {v.name} {v.price_modifier > 0 ? `(+${formatCurrency(v.price_modifier)})` : v.price_modifier < 0 ? `(${formatCurrency(v.price_modifier)})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 mb-6">
              <p className="text-sm font-medium text-gray-700">Cantidad</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200 transition-colors">
                  <MdRemove />
                </button>
                <span className="text-lg font-bold w-8 text-center">{quantity}</span>
                <button onClick={() => setQuantity(q => q + 1)} className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200 transition-colors">
                  <MdAdd />
                </button>
              </div>
            </div>

            <button onClick={handleAddToCart} className="btn-primary w-full py-3 text-lg flex items-center justify-center gap-2">
              <MdShoppingCart />
              Agregar al Carrito - {formatCurrency((selectedProduct.price + (selectedVariant?.price_modifier || 0)) * quantity)}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
