import '@promotionEngine';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { getSocket } from '../hooks/useSocket';

/** Mismo motor que usa el servidor (packages/shared-types/promotionEngine.js). */
export const promotionEngine = globalThis.RestoFadeyPromotionEngine;

export const {
  PROMOTION_TYPES,
  PROMOTION_TYPE_LABELS,
  PROMOTION_STATUS_LABELS,
  promotionBadgeLabel,
  computePromotionStatus,
  validatePromotionInput,
} = promotionEngine;

const REFRESH_MS = 60_000;

let state = { promotions: [], timezone: promotionEngine.DEFAULT_TIMEZONE, loaded: false };
let inflight = null;
let pollTimer = null;
let socketBound = false;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function refreshActivePromotions() {
  if (inflight) return inflight;
  inflight = api
    .get('/promotions/active')
    .then((res) => {
      state = {
        promotions: Array.isArray(res?.promotions) ? res.promotions : [],
        timezone: String(res?.timezone || '').trim() || promotionEngine.DEFAULT_TIMEZONE,
        loaded: true,
      };
      emit();
    })
    .catch(() => {
      if (!state.loaded) {
        state = { ...state, loaded: true };
        emit();
      }
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function ensureLiveUpdates() {
  if (!pollTimer && typeof window !== 'undefined') {
    pollTimer = window.setInterval(() => void refreshActivePromotions(), REFRESH_MS);
    window.addEventListener('focus', () => void refreshActivePromotions());
  }
  let hasStaffSession = false;
  try {
    hasStaffSession = Boolean(localStorage.getItem('token'));
  } catch (_) {
    hasStaffSession = false;
  }
  if (!socketBound && hasStaffSession) {
    try {
      getSocket().on('staff-data-update', (payload) => {
        if (payload?.domain === 'promotions' || payload?.domain === 'catalog') void refreshActivePromotions();
      });
      socketBound = true;
    } catch (_) {
      /* sin socket: queda el sondeo periódico */
    }
  }
}

function useMinuteClock(timezone) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => promotionEngine.clockFromDate(new Date(), timezone), [timezone, tick]);
}

/** Promociones vigentes + reloj del negocio (se refresca cada 30 s para horarios). */
export function useActivePromotions() {
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    listeners.add(setSnap);
    ensureLiveUpdates();
    if (!state.loaded) void refreshActivePromotions();
    else setSnap(state);
    return () => listeners.delete(setSnap);
  }, []);
  const clock = useMinuteClock(snap.timezone);
  return { promotions: snap.promotions, clock, loaded: snap.loaded };
}

/** Vista previa de un producto del catálogo (cinta + precio tachado). */
export function getProductPromotion(product, promotions, clock) {
  if (!promotions?.length) return null;
  return promotionEngine.getProductPromotionPreview(product, promotions, clock);
}

/**
 * Precios del carrito con el mismo cálculo que hará el servidor al crear el pedido.
 * @param {Array<{line_key:string, product_id:string, category_id?:string, combo_id?:string, price:number, quantity:number}>} cart
 */
export function priceCartWithPromotions(cart, promotions, clock) {
  const lines = (cart || []).map((item) => ({
    key: String(item.line_key),
    product_id: item.product_id,
    category_id: item.category_id || '',
    unit_price: Number(item.price || 0),
    quantity: Number(item.quantity || 0),
    is_combo: Boolean(item.combo_id),
  }));
  return promotionEngine.applyPromotions(lines, promotions || [], { clock });
}

export function useCartPromotionPricing(cart) {
  const { promotions, clock } = useActivePromotions();
  return useMemo(() => priceCartWithPromotions(cart, promotions, clock), [cart, promotions, clock]);
}
