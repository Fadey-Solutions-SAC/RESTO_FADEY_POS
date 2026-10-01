/**
 * Motor único de promociones (servidor = fuente de verdad; cliente solo para mostrar).
 * Script UMD sin import/export: Node lo carga con require(); Vite lo importa por efecto y
 * queda en globalThis.RestoFadeyPromotionEngine.
 */
(function initPromotionEngine(factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.RestoFadeyPromotionEngine = api;
})(function promotionEngineFactory() {
  const PROMOTION_TYPES = ['percent', 'fixed', 'price', '2x1', '3x2', 'combo', 'quantity'];

  const PROMOTION_TYPE_LABELS = {
    percent: 'Porcentual',
    fixed: 'Monto fijo',
    price: 'Precio especial',
    '2x1': '2x1',
    '3x2': '3x2',
    combo: 'Combo',
    quantity: 'Por cantidad',
  };

  const PROMOTION_STATUS_LABELS = {
    active: 'Activa',
    scheduled: 'Programada',
    paused: 'Pausada',
    finished: 'Finalizada',
  };

  const DEFAULT_TIMEZONE = 'America/Lima';

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function parseIdList(raw) {
    if (raw == null || raw === '') return [];
    let arr = raw;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t) return [];
      if (t.startsWith('[')) {
        try {
          arr = JSON.parse(t);
        } catch (_) {
          return [];
        }
      } else {
        arr = t.split(',');
      }
    }
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.map((x) => String(x == null ? '' : x).trim()).filter(Boolean))];
  }

  function parseDayList(raw) {
    return parseIdList(raw)
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  }

  function parseTimeToMinutes(raw) {
    const m = String(raw == null ? '' : raw).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function truthy(v) {
    return v === true || v === 1 || v === '1' || v === 'true';
  }

  /** Normaliza una fila de BD o un objeto del API. */
  function normalizePromotion(row) {
    if (!row) return null;
    const type = PROMOTION_TYPES.includes(String(row.type)) ? String(row.type) : 'percent';
    return {
      ...row,
      id: String(row.id || ''),
      name: String(row.name || ''),
      description: String(row.description || ''),
      type,
      value: Number(row.value) || 0,
      status: String(row.status || 'active') === 'paused' ? 'paused' : 'active',
      start_date: String(row.start_date || '').slice(0, 10),
      end_date: String(row.end_date || '').slice(0, 10),
      no_end_date: truthy(row.no_end_date),
      days: parseDayList(row.days),
      start_time: String(row.start_time || '').slice(0, 5),
      end_time: String(row.end_time || '').slice(0, 5),
      product_ids: parseIdList(row.product_ids),
      category_ids: parseIdList(row.category_ids),
      expanded_product_ids: parseIdList(row.expanded_product_ids),
      min_quantity: Math.max(0, Math.floor(Number(row.min_quantity) || 0)),
      min_purchase: Math.max(0, Number(row.min_purchase) || 0),
      usage_limit: Math.max(0, Math.floor(Number(row.usage_limit) || 0)),
      per_customer_limit: Math.max(0, Math.floor(Number(row.per_customer_limit) || 0)),
      combinable: truthy(row.combinable),
      priority: Math.floor(Number(row.priority) || 0),
      uses: Math.max(0, Math.floor(Number(row.uses) || 0)),
    };
  }

  /** Reloj del negocio: fecha local, minutos del día y día de semana (0 = domingo). */
  function clockFromDate(date, timeZone) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    let parts;
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone || DEFAULT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
      });
      parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    } catch (_) {
      parts = null;
    }
    if (!parts) {
      const pad = (n) => String(n).padStart(2, '0');
      return {
        dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        minutes: d.getHours() * 60 + d.getMinutes(),
        dow: d.getDay(),
      };
    }
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = parts.hour === '24' ? 0 : Number(parts.hour);
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: hour * 60 + Number(parts.minute),
      dow: weekdays[parts.weekday] ?? d.getDay(),
    };
  }

  /** Estado comercial: activa / programada / pausada / finalizada. */
  function computePromotionStatus(rawPromo, clock) {
    const p = normalizePromotion(rawPromo);
    if (!p) return 'finished';
    if (p.status === 'paused') return 'paused';
    if (p.usage_limit > 0 && p.uses >= p.usage_limit) return 'finished';
    if (!p.no_end_date && p.end_date && clock.dateKey > p.end_date) return 'finished';
    if (p.start_date && clock.dateKey < p.start_date) return 'scheduled';
    return 'active';
  }

  function isWithinSchedule(p, clock) {
    if (p.days.length && !p.days.includes(clock.dow)) return false;
    const from = parseTimeToMinutes(p.start_time);
    const to = parseTimeToMinutes(p.end_time);
    if (from == null || to == null || from === to) return true;
    if (from < to) return clock.minutes >= from && clock.minutes < to;
    return clock.minutes >= from || clock.minutes < to;
  }

  /** Activa y dentro de día/horario en este momento. */
  function isPromotionApplicableNow(rawPromo, clock) {
    const p = normalizePromotion(rawPromo);
    if (!p) return false;
    if (computePromotionStatus(p, clock) !== 'active') return false;
    return isWithinSchedule(p, clock);
  }

  function promotionTargetsLine(p, line) {
    const pid = String(line.product_id || '');
    if (!pid) return false;
    if (p.product_ids.includes(pid)) return true;
    if (p.expanded_product_ids.includes(pid)) return true;
    const cat = String(line.category_id || '');
    return Boolean(cat) && p.category_ids.includes(cat);
  }

  function formatMoneyShort(n) {
    const v = round2(n);
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  /** Texto corto de la cinta diagonal. */
  function promotionBadgeLabel(rawPromo) {
    const p = normalizePromotion(rawPromo);
    if (!p) return 'PROMO';
    switch (p.type) {
      case 'percent':
        return `-${formatMoneyShort(p.value)}%`;
      case 'fixed':
        return `-S/${formatMoneyShort(p.value)}`;
      case '2x1':
        return '2X1';
      case '3x2':
        return '3X2';
      case 'combo':
        return 'COMBO';
      case 'quantity':
        return p.min_quantity > 1 ? `${p.min_quantity}+ -${formatMoneyShort(p.value)}%` : `-${formatMoneyShort(p.value)}%`;
      default:
        return 'PROMO';
    }
  }

  /** Descuento total de una línea (sin combos) para una promoción concreta. */
  function lineDiscountFor(p, unitPrice, qty) {
    const unit = Math.max(0, Number(unitPrice) || 0);
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    const base = unit * q;
    if (!q || !unit) return 0;
    if (p.type !== 'quantity' && p.min_quantity > 1 && q < p.min_quantity) return 0;
    let d = 0;
    switch (p.type) {
      case 'percent':
        d = base * Math.min(100, Math.max(0, p.value)) / 100;
        break;
      case 'fixed':
        d = Math.min(unit, Math.max(0, p.value)) * q;
        break;
      case 'price':
        d = p.value > 0 && p.value < unit ? (unit - p.value) * q : 0;
        break;
      case '2x1':
        d = Math.floor(q / 2) * unit;
        break;
      case '3x2':
        d = Math.floor(q / 3) * unit;
        break;
      case 'quantity':
        d = q >= Math.max(1, p.min_quantity) ? base * Math.min(100, Math.max(0, p.value)) / 100 : 0;
        break;
      default:
        d = 0;
    }
    return round2(Math.min(base, Math.max(0, d)));
  }

  /**
   * Aplica promociones a un carrito completo.
   * @param {Array<{key:string, product_id:string, category_id?:string, unit_price:number, quantity:number, is_combo?:boolean}>} lines
   * @param {Array<object>} promotions
   * @param {{ clock: {dateKey:string, minutes:number, dow:number}, customerUses?: Record<string, number> }} ctx
   * @returns {{ lines: Record<string, object>, original_total:number, discount_total:number, final_total:number }}
   */
  function applyPromotions(lines, promotions, ctx) {
    const clock = ctx && ctx.clock ? ctx.clock : clockFromDate(new Date());
    const customerUses = (ctx && ctx.customerUses) || {};
    const list = Array.isArray(lines) ? lines : [];
    const cartBase = list.reduce((s, l) => s + Math.max(0, Number(l.unit_price) || 0) * Math.max(0, Number(l.quantity) || 0), 0);

    const candidates = (Array.isArray(promotions) ? promotions : [])
      .map(normalizePromotion)
      .filter(Boolean)
      .filter((p) => isPromotionApplicableNow(p, clock))
      .filter((p) => !(p.min_purchase > 0 && cartBase + 1e-9 < p.min_purchase))
      .filter((p) => !(p.per_customer_limit > 0 && Number(customerUses[p.id] || 0) >= p.per_customer_limit))
      .sort((a, b) => b.priority - a.priority);

    const result = {};
    list.forEach((l) => {
      const unit = Math.max(0, Number(l.unit_price) || 0);
      const qty = Math.max(0, Math.floor(Number(l.quantity) || 0));
      result[l.key] = {
        key: l.key,
        original_unit_price: round2(unit),
        quantity: qty,
        original_total: round2(unit * qty),
        discount: 0,
        final_total: round2(unit * qty),
        final_unit_price: round2(unit),
        promotion_id: '',
        promotion_ids: [],
        promotion_name: '',
        promotion_type: '',
        badge: '',
        combinable: false,
      };
    });

    const eligibleLines = list.filter((l) => !l.is_combo && result[l.key] && result[l.key].original_total > 0);

    candidates
      .filter((p) => p.type === 'combo')
      .forEach((p) => {
        const needed = [...new Set([...p.product_ids, ...p.expanded_product_ids])];
        if (needed.length < 2 || p.value <= 0) return;
        const free = eligibleLines.filter((l) => !result[l.key].promotion_id || (result[l.key].combinable && p.combinable));
        const qtyByProduct = {};
        const priceByProduct = {};
        free.forEach((l) => {
          const pid = String(l.product_id);
          qtyByProduct[pid] = (qtyByProduct[pid] || 0) + Math.floor(Number(l.quantity) || 0);
          if (priceByProduct[pid] == null) priceByProduct[pid] = Number(l.unit_price) || 0;
        });
        const sets = Math.min(...needed.map((pid) => qtyByProduct[pid] || 0));
        if (!Number.isFinite(sets) || sets < 1) return;
        const setBase = needed.reduce((s, pid) => s + (priceByProduct[pid] || 0), 0);
        const perSet = Math.max(0, setBase - p.value);
        if (perSet <= 0) return;
        const totalDiscount = round2(perSet * sets);
        const participants = free.filter((l) => needed.includes(String(l.product_id)));
        const remainingSets = {};
        needed.forEach((pid) => { remainingSets[pid] = sets; });
        const shares = participants.map((l) => {
          const pid = String(l.product_id);
          const used = Math.min(remainingSets[pid], Math.floor(Number(l.quantity) || 0));
          remainingSets[pid] -= used;
          return { l, weight: used * (Number(l.unit_price) || 0) };
        }).filter((s) => s.weight > 0);
        const weightSum = shares.reduce((s, x) => s + x.weight, 0) || 1;
        let allocated = 0;
        shares.forEach((s, idx) => {
          const r = result[s.l.key];
          const share = idx === shares.length - 1
            ? round2(totalDiscount - allocated)
            : round2(totalDiscount * s.weight / weightSum);
          allocated = round2(allocated + share);
          const applied = Math.min(share, round2(r.final_total));
          if (applied <= 0) return;
          r.discount = round2(r.discount + applied);
          r.final_total = round2(r.original_total - r.discount);
          if (!r.promotion_id) {
            r.promotion_id = p.id;
            r.promotion_name = p.name;
            r.promotion_type = p.type;
            r.badge = promotionBadgeLabel(p);
            r.combinable = p.combinable;
          }
          r.promotion_ids.push(p.id);
        });
      });

    eligibleLines.forEach((l) => {
      const r = result[l.key];
      const unit = Number(l.unit_price) || 0;
      const qty = Math.floor(Number(l.quantity) || 0);
      const lineCandidates = candidates
        .filter((p) => p.type !== 'combo' && promotionTargetsLine(p, l))
        .map((p) => ({ p, d: lineDiscountFor(p, unit, qty) }))
        .filter((x) => x.d > 0)
        .sort((a, b) => (b.p.priority - a.p.priority) || (b.d - a.d));
      if (!lineCandidates.length) return;
      if (r.promotion_id && !r.combinable) return;
      lineCandidates.forEach(({ p, d }) => {
        const already = r.promotion_ids.length > 0;
        if (already && !(r.combinable && p.combinable)) return;
        const remaining = round2(r.original_total - r.discount);
        if (remaining <= 0) return;
        const applied = p.type === 'percent' && already
          ? round2(remaining * Math.min(100, p.value) / 100)
          : Math.min(d, remaining);
        if (applied <= 0) return;
        r.discount = round2(r.discount + applied);
        r.final_total = round2(r.original_total - r.discount);
        if (!r.promotion_id) {
          r.promotion_id = p.id;
          r.promotion_name = p.name;
          r.promotion_type = p.type;
          r.badge = promotionBadgeLabel(p);
          r.combinable = p.combinable;
        }
        r.promotion_ids.push(p.id);
      });
    });

    let original = 0;
    let discount = 0;
    Object.values(result).forEach((r) => {
      r.final_unit_price = r.quantity > 0 ? Math.round((r.final_total / r.quantity) * 10000) / 10000 : r.original_unit_price;
      if (r.promotion_ids.length > 1) r.badge = 'PROMO';
      original += r.original_total;
      discount += r.discount;
    });
    return {
      lines: result,
      original_total: round2(original),
      discount_total: round2(discount),
      final_total: round2(original - discount),
    };
  }

  /**
   * Vista previa para la tarjeta del producto (cantidad 1).
   * @returns {null | { promotion:object, badge:string, original_price:number, final_price:number, strike:boolean }}
   */
  function getProductPromotionPreview(product, promotions, clock) {
    if (!product || product.is_combo) return null;
    const line = {
      key: 'preview',
      product_id: product.id,
      category_id: product.category_id,
      unit_price: Number(product.price) || 0,
      quantity: 1,
    };
    const c = clock || clockFromDate(new Date());
    const matches = (Array.isArray(promotions) ? promotions : [])
      .map(normalizePromotion)
      .filter(Boolean)
      .filter((p) => isPromotionApplicableNow(p, c))
      .filter((p) => (p.type === 'combo'
        ? [...p.product_ids, ...p.expanded_product_ids].includes(String(product.id))
        : promotionTargetsLine(p, line)))
      .sort((a, b) => b.priority - a.priority);
    if (!matches.length) return null;
    const best = matches[0];
    const unitDiscount = best.type === 'combo' ? 0 : lineDiscountFor({ ...best, min_quantity: 0 }, line.unit_price, 1);
    const showsStrike = unitDiscount > 0 && ['percent', 'fixed', 'price'].includes(best.type) && best.min_quantity <= 1 && best.min_purchase <= 0;
    return {
      promotion: best,
      badge: promotionBadgeLabel(best),
      original_price: round2(line.unit_price),
      final_price: showsStrike ? round2(line.unit_price - unitDiscount) : round2(line.unit_price),
      strike: showsStrike,
    };
  }

  /** Validación de datos de entrada (crear/editar). Devuelve mensaje de error o ''. */
  function validatePromotionInput(raw) {
    const p = normalizePromotion(raw);
    if (!p.name.trim()) return 'El nombre de la promoción es obligatorio';
    if (['percent', 'quantity'].includes(p.type) && (p.value <= 0 || p.value > 100)) return 'El porcentaje debe estar entre 1 y 100';
    if (['fixed', 'price', 'combo'].includes(p.type) && p.value <= 0) return 'Ingresa un monto mayor a cero';
    if (p.type === 'quantity' && p.min_quantity < 2) return 'La promoción por cantidad requiere una cantidad mínima de 2 o más';
    if (p.type === 'combo' && p.product_ids.length < 2) return 'Un combo necesita al menos 2 productos';
    if (p.type !== 'combo' && !p.product_ids.length && !p.category_ids.length) return 'Selecciona al menos un producto o una categoría';
    if (!p.no_end_date && p.start_date && p.end_date && p.end_date < p.start_date) return 'La fecha de fin no puede ser anterior a la de inicio';
    return '';
  }

  return {
    PROMOTION_TYPES,
    PROMOTION_TYPE_LABELS,
    PROMOTION_STATUS_LABELS,
    DEFAULT_TIMEZONE,
    round2,
    parseIdList,
    normalizePromotion,
    clockFromDate,
    computePromotionStatus,
    isPromotionApplicableNow,
    promotionBadgeLabel,
    lineDiscountFor,
    applyPromotions,
    getProductPromotionPreview,
    validatePromotionInput,
  };
});
