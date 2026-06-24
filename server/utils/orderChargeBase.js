/** Base cobrable alineada con getOrderChargeTotal del cliente (ítems + delivery). */

function sumLineSubtotals(items) {
  return (items || []).reduce((s, it) => {
    const qty = Number(it.quantity || 0);
    const unit = Number(it.unit_price ?? 0);
    return s + Number(it.subtotal != null ? it.subtotal : unit * qty);
  }, 0);
}

function getOrderChargeBase(order, items) {
  if (!order) return 0;
  const delivery = Number(order.delivery_fee || 0);
  const list = items || order.items;
  let base = 0;
  if (Array.isArray(list) && list.length) {
    base = sumLineSubtotals(list) + delivery;
  }
  if (base <= 0) {
    base = Number(order.subtotal || 0) + delivery;
  }
  if (base <= 0) {
    base = Number(order.total || 0) + Number(order.discount || 0);
  }
  return Math.max(0, base);
}

module.exports = {
  getOrderChargeBase,
  sumLineSubtotals,
};
