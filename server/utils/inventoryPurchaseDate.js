const { queryOne } = require('../database');

/** Fecha contable de la compra: la registrada o, si falta, el día del ingreso al sistema. */
const INVENTORY_EXPENSE_PURCHASE_DATE_SQL =
  `DATE(COALESCE(NULLIF(trim(purchase_date), ''), datetime(created_at, 'localtime')))`;

const INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL =
  `DATE(COALESCE(NULLIF(trim(ie.purchase_date), ''), datetime(ie.created_at, 'localtime')))`;

function parsePurchaseDateInput(input) {
  const v = String(input || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function defaultPurchaseDateToday() {
  return queryOne("SELECT date('now', 'localtime') AS d")?.d || new Date().toISOString().slice(0, 10);
}

function resolvePurchaseDate(input) {
  return parsePurchaseDateInput(input) || defaultPurchaseDateToday();
}

module.exports = {
  INVENTORY_EXPENSE_PURCHASE_DATE_SQL,
  INVENTORY_EXPENSE_PURCHASE_DATE_IE_SQL,
  parsePurchaseDateInput,
  resolvePurchaseDate,
};
