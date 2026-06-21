import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { api, formatCurrency } from '../../utils/api';
import { useShowDeliveryUi } from '../../hooks/useDeliveryEnabled';
import toast from 'react-hot-toast';
import { MdAdd, MdRemove, MdDelete, MdShoppingCart, MdDeliveryDining, MdStorefront, MdRestaurant, MdArrowBack, MdEditNote } from 'react-icons/md';

export default function Cart() {
  const { items, updateQuantity, updateItemNotes, removeItem, clearCart, total, count } = useCart();
  const { user } = useAuth();
  const showDeliveryUi = useShowDeliveryUi();
  const navigate = useNavigate();
  const [orderType, setOrderType] = useState('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [noteEditorItemKey, setNoteEditorItemKey] = useState('');
  const [loading, setLoading] = useState(false);

  const taxRate = 0.18;
  const subtotal = total;
  const tax = subtotal * taxRate;
  const deliveryFee = showDeliveryUi && orderType === 'delivery' ? 5 : 0;
  const grandTotal = subtotal + tax + deliveryFee;

  useEffect(() => {
    if (!showDeliveryUi && orderType === 'delivery') setOrderType('pickup');
  }, [showDeliveryUi, orderType]);

  const handleOrder = async () => {
    if (!user || user.type !== 'customer') {
      toast.error('Debes iniciar sesión para hacer un pedido');
      return;
    }
    if (items.length === 0) return;
    if (orderType === 'delivery' && !deliveryAddress.trim()) {
      toast.error('Ingresa tu dirección de delivery');
      return;
    }
    const missingRequiredNote = items.find(i => Number(i.note_required || 0) === 1 && !String(i.notes || '').trim());
    if (missingRequiredNote) {
      setNoteEditorItemKey(missingRequiredNote.key);
      toast.error(`"${missingRequiredNote.name}" requiere nota obligatoria`);
      return;
    }

    setLoading(true);
    try {
      const order = await api.post('/orders', {
        items: items.map(i => ({
          product_id: i.product_id,
          quantity: i.quantity,
          variant_name: i.variant_name,
          price_modifier: i.price_modifier || 0,
          notes: String(i.notes || '').trim(),
        })),
        type: orderType,
        delivery_address: deliveryAddress,
        notes,
        payment_method: 'online',
      });
      toast.success(`Pedido #${order.order_number} creado exitosamente`);
      clearCart();
      navigate(`/customer/orders/${order.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <MdShoppingCart className="text-4xl text-gray-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Tu carrito está vacío</h2>
        <p className="text-gray-500 mb-6">Agrega productos desde nuestro menú para empezar</p>
        <button onClick={() => navigate('/customer')} className="btn-primary px-8 py-3 inline-flex items-center gap-2">
          <MdRestaurant /> Ver Menú
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <button onClick={() => navigate('/customer')} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-6 text-sm font-medium">
        <MdArrowBack /> Volver al Menú
      </button>

      <h1 className="text-2xl font-bold text-gray-800 mb-6">Tu Carrito ({count} productos)</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {items.map(item => (
            <div key={item.key} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                {item.image ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" /> : <span className="text-2xl">🍽️</span>}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-800">{item.name}</h3>
                {Number(item.note_required || 0) === 1 && <p className="text-[11px] text-red-600 font-medium">Nota obligatoria</p>}
                {item.variant_name && <p className="text-xs text-gray-400">{item.variant_name}</p>}
                <p className="text-primary-600 font-bold">{formatCurrency(item.price)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNoteEditorItemKey(prev => (prev === item.key ? '' : item.key))}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                    item.notes?.trim()
                      ? 'bg-amber-100 border-amber-300 text-amber-700'
                      : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                  title="Agregar nota"
                >
                  <MdEditNote className="text-base" />
                </button>
                <button onClick={() => updateQuantity(item.key, item.quantity - 1)} className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200">
                  <MdRemove className="text-sm" />
                </button>
                <span className="font-bold w-8 text-center">{item.quantity}</span>
                <button onClick={() => updateQuantity(item.key, item.quantity + 1)} className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-200">
                  <MdAdd className="text-sm" />
                </button>
              </div>
              <div className="text-right">
                <p className="font-bold">{formatCurrency(item.price * item.quantity)}</p>
                <button onClick={() => removeItem(item.key)} className="text-red-400 hover:text-red-600 mt-1">
                  <MdDelete className="text-lg" />
                </button>
              </div>
            </div>
            {(noteEditorItemKey === item.key || item.notes?.trim()) && (
              <div className="mt-3">
                <textarea
                  value={item.notes || ''}
                  onChange={(e) => updateItemNotes(item.key, e.target.value)}
                  rows={2}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:ui-text-muted focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                  placeholder="Escribe una nota para cocina/bar..."
                />
              </div>
            )}
            </div>
          ))}

          <button onClick={clearCart} className="text-sm text-red-500 hover:text-red-700 font-medium">Vaciar carrito</button>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-100 p-6 sticky top-24">
            <h3 className="font-bold text-gray-800 mb-4">Resumen del Pedido</h3>

            {showDeliveryUi ? (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Tipo de pedido</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setOrderType('pickup')}
                  className={`flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    orderType === 'pickup' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  <MdStorefront /> Recojo
                </button>
                <button
                  onClick={() => setOrderType('delivery')}
                  className={`flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    orderType === 'delivery' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  <MdDeliveryDining /> Delivery
                </button>
              </div>
            </div>
            ) : null}

            {showDeliveryUi && orderType === 'delivery' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de entrega *</label>
                <textarea
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  className="input-field"
                  rows={2}
                  placeholder="Ingresa tu dirección completa"
                />
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="input-field" placeholder="Instrucciones especiales..." />
            </div>

            <div className="space-y-2 mb-4 pt-4 border-t">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">IGV (18%)</span><span>{formatCurrency(tax)}</span></div>
              {showDeliveryUi && orderType === 'delivery' && (
                <div className="flex justify-between text-sm"><span className="text-gray-500">Delivery</span><span>{formatCurrency(deliveryFee)}</span></div>
              )}
              <div className="flex justify-between text-lg font-bold border-t pt-2">
                <span>Total</span>
                <span className="text-primary-600">{formatCurrency(grandTotal)}</span>
              </div>
            </div>

            <button
              onClick={handleOrder}
              disabled={loading || items.length === 0}
              className="btn-primary w-full py-3 text-lg"
            >
              {loading ? 'Procesando...' : !user || user.type !== 'customer' ? 'Inicia sesión para pedir' : 'Realizar Pedido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
