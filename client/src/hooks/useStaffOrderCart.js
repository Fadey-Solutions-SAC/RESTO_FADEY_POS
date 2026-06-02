import { useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';

/**
 * Misma lógica de líneas de pedido que Caja/POS: line_key, modificadores opcionales/obligatorios, notas.
 */
export function useStaffOrderCart(modifiers = []) {
  const [cart, setCart] = useState([]);
  const [noteEditorLineKey, setNoteEditorLineKey] = useState('');
  const [modifierPrompt, setModifierPrompt] = useState({
    open: false,
    product: null,
    modifier: null,
    selectedOption: '',
  });

  const appendToCart = useCallback((product, { modifierId = '', modifierName = '', modifierOption = '' } = {}) => {
    const isCombo = !!(product.is_combo || product.combo_id);
    const lineKey = isCombo
      ? `combo:${product.combo_id}`
      : `${product.id}::${modifierId}::${modifierOption}`;
    setCart((prev) => {
      const existing = prev.find((i) => i.line_key === lineKey);
      if (existing) {
        return prev.map((i) => (i.line_key === lineKey ? { ...i, quantity: i.quantity + 1 } : i));
      }
      const anchorProductId = isCombo
        ? (product.combo_items?.[0]?.product_id || '')
        : product.id;
      return [
        ...prev,
        {
          line_key: lineKey,
          product_id: anchorProductId,
          combo_id: isCombo ? product.combo_id : '',
          name: product.name,
          price: product.price,
          quantity: 1,
          modifier_id: modifierId,
          modifier_name: modifierName,
          modifier_option: modifierOption,
          note_required: Number(product.note_required || 0) === 1 ? 1 : 0,
          notes: '',
        },
      ];
    });
  }, []);

  const addToCart = useCallback(
    (product) => {
      if (product.is_combo || product.combo_id) {
        appendToCart(product);
        return;
      }
      const modifierId = String(product?.modifier_id || '').trim();
      if (!modifierId) {
        appendToCart(product);
        return;
      }
      const modifier = (modifiers || []).find((m) => m.id === modifierId && Number(m.active ?? 1) === 1);
      if (!modifier) {
        appendToCart(product);
        return;
      }
      const options = Array.isArray(modifier.options) ? modifier.options.filter(Boolean) : [];
      if (options.length === 0) {
        if (Number(modifier.required || 0) === 1) {
          toast.error(`El modificador "${modifier.name}" no tiene opciones configuradas`);
          return;
        }
        appendToCart(product);
        return;
      }
      setModifierPrompt({
        open: true,
        product,
        modifier,
        selectedOption: '',
      });
    },
    [modifiers, appendToCart]
  );

  const confirmModifierForCart = useCallback(() => {
    const modifier = modifierPrompt.modifier;
    const product = modifierPrompt.product;
    if (!modifier || !product) return;
    const required = Number(modifier.required || 0) === 1;
    const option = String(modifierPrompt.selectedOption || '').trim();
    if (required && !option) {
      toast.error(`Debes seleccionar ${modifier.name}`);
      return;
    }
    appendToCart(product, {
      modifierId: modifier.id,
      modifierName: modifier.name,
      modifierOption: option,
    });
    setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' });
  }, [modifierPrompt, appendToCart]);

  const addProductWithoutOptionalModifier = useCallback(() => {
    const modifier = modifierPrompt.modifier;
    const product = modifierPrompt.product;
    if (!modifier || !product) return;
    const required = Number(modifier.required || 0) === 1;
    if (required) return;
    appendToCart(product);
    setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' });
  }, [modifierPrompt, appendToCart]);

  const updateQty = useCallback((lineKey, delta) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.line_key !== lineKey) return i;
          const newQty = i.quantity + delta;
          return newQty > 0 ? { ...i, quantity: newQty } : i;
        })
        .filter((i) => i.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((lineKey) => {
    setCart((prev) => prev.filter((i) => i.line_key !== lineKey));
  }, []);

  const updateItemNote = useCallback((lineKey, nextNote) => {
    setCart((prev) => prev.map((i) => (i.line_key === lineKey ? { ...i, notes: String(nextNote || '') } : i)));
  }, []);

  const cartTotal = useMemo(() => cart.reduce((sum, i) => sum + i.price * i.quantity, 0), [cart]);

  const resetCart = useCallback(() => {
    setCart([]);
    setNoteEditorLineKey('');
    setModifierPrompt({ open: false, product: null, modifier: null, selectedOption: '' });
  }, []);

  return {
    cart,
    setCart,
    noteEditorLineKey,
    setNoteEditorLineKey,
    modifierPrompt,
    setModifierPrompt,
    addToCart,
    confirmModifierForCart,
    addProductWithoutOptionalModifier,
    updateQty,
    removeFromCart,
    updateItemNote,
    cartTotal,
    resetCart,
  };
}
