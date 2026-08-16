/**
 * Caja / mesas sin internet: cache de lecturas, cola de escrituras y sync al reconectar.
 */
const CACHE_KEY = 'rf_offline_get_v1';
const QUEUE_KEY = 'rf_offline_mut_v1';
const META_KEY = 'rf_offline_meta_v1';

const GET_CACHE_PREFIXES = [
  '/auth/me',
  '/tables',
  '/orders',
  '/products',
  '/categories',
  '/pos/current-register',
  '/pos/register-status',
  '/pos/payment-methods',
  '/pos/caja-stations',
  '/pos/history',
  '/pos/movements',
  '/pos/notes',
  '/admin-modules/modifiers',
  '/admin-modules/combos',
  '/admin-modules/config/app',
  '/restaurant',
];

const MUTATION_RULES = [
  { method: 'POST', test: (p) => p === '/orders' },
  { method: 'PUT', test: (p) => /^\/orders\/[^/]+\/(status|lines|payment)$/.test(p) },
  { method: 'POST', test: (p) => p === '/pos/checkout-table' },
  { method: 'PATCH', test: (p) => /^\/tables\/[^/]+\/status$/.test(p) },
  { method: 'POST', test: (p) => p === '/pos/movements' || p === '/pos/notes' },
];

const listeners = new Set();
let syncing = false;
let lastError = '';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    try {
      localStorage.removeItem(key);
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}

export function pathOf(endpoint) {
  return String(endpoint || '').split('?')[0];
}

export function shouldCacheGet(endpoint) {
  const p = pathOf(endpoint);
  return GET_CACHE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`) || p.startsWith(`${pre}?`));
}

export function isOfflinePosMutation(method, endpoint) {
  const m = String(method || 'GET').toUpperCase();
  const p = pathOf(endpoint);
  return MUTATION_RULES.some((r) => r.method === m && r.test(p));
}

export function isBrowserOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function isNetworkFailure(err) {
  if (isBrowserOffline()) return true;
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return true;
  const msg = String(err?.message || err || '');
  return /failed to fetch|networkerror|load failed|network|err_internet|err_connection|timed out|timeout|offline|aborted|abort|no se pudo conectar al api/i.test(msg);
}

function getCache() {
  return readJson(CACHE_KEY, {}) || {};
}

export function saveGetCache(endpoint, data) {
  if (!shouldCacheGet(endpoint) || data == null) return;
  const cache = getCache();
  cache[endpoint] = { at: Date.now(), data };
  writeJson(CACHE_KEY, cache);
}

export function readGetCache(endpoint) {
  const cache = getCache();
  const exact = cache[endpoint];
  if (exact?.data != null) return exact.data;
  const p = pathOf(endpoint);
  let best = null;
  for (const [key, row] of Object.entries(cache)) {
    if (pathOf(key) !== p || row?.data == null) continue;
    if (!best || Number(row.at || 0) > Number(best.at || 0)) best = row;
  }
  return best?.data;
}

export function getMutationQueue() {
  const q = readJson(QUEUE_KEY, []);
  return Array.isArray(q) ? q : [];
}

function setMutationQueue(q) {
  writeJson(QUEUE_KEY, q);
  emitOfflinePos();
}

export function getOfflinePosStatus() {
  return {
    online: !isBrowserOffline(),
    pending: getMutationQueue().length,
    syncing,
    lastError,
  };
}

export function subscribeOfflinePos(fn) {
  listeners.add(fn);
  try { fn(getOfflinePosStatus()); } catch { /* ignore */ }
  return () => listeners.delete(fn);
}

function emitOfflinePos() {
  const st = getOfflinePosStatus();
  listeners.forEach((fn) => {
    try { fn(st); } catch { /* ignore */ }
  });
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('rf-offline-pos', { detail: st }));
    } catch { /* ignore */ }
  }
}

function clone(v) {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

function parseBody(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isActiveOrder(o) {
  const pay = String(o?.payment_status || '').toLowerCase();
  const st = String(o?.status || '').toLowerCase();
  if (pay === 'paid' || pay === 'refunded') return false;
  if (st === 'cancelled' || st === 'delivered') return false;
  return true;
}

function recomputeTable(table) {
  const orders = (table.orders || []).filter(isActiveOrder);
  const order_total = orders.reduce((s, o) => s + Number(o.total || o.subtotal || 0), 0);
  return {
    ...table,
    orders,
    order_total,
    order_count: orders.length,
    status: orders.length ? 'occupied' : (table.status === 'occupied' ? 'available' : (table.status || 'available')),
  };
}

function findTablesInCache() {
  const cache = getCache();
  let best = null;
  for (const [key, row] of Object.entries(cache)) {
    if (pathOf(key) !== '/tables') continue;
    if (Array.isArray(row?.data) && (!best || row.data.length >= best.length)) best = row.data;
  }
  return Array.isArray(best) ? clone(best) : [];
}

function findCatalogMap() {
  const cache = getCache();
  const map = new Map();
  for (const [key, row] of Object.entries(cache)) {
    const p = pathOf(key);
    const raw = row?.data;
    let list = [];
    if (p === '/products' || p.startsWith('/products/')) {
      list = Array.isArray(raw) ? raw : [];
    } else if (p === '/admin-modules/combos' || p.startsWith('/admin-modules/combos')) {
      list = Array.isArray(raw) ? raw : [];
    } else {
      continue;
    }
    for (const prod of list) {
      if (!prod || typeof prod !== 'object') continue;
      if (prod.id) map.set(String(prod.id), prod);
      if (prod.combo_id) map.set(`combo:${prod.combo_id}`, prod);
      if (p.includes('combos') && prod.id) map.set(`combo:${prod.id}`, prod);
    }
  }
  return map;
}

function hydrateOrderItem(it, catalog) {
  const qty = Number(it?.quantity || 1);
  const comboId = String(it?.combo_id || '').trim();
  const pid = String(it?.product_id || '').trim();
  const src = (comboId && (catalog.get(`combo:${comboId}`) || catalog.get(comboId)))
    || (pid && catalog.get(pid))
    || null;
  const name = String(it?.product_name || it?.name || src?.name || src?.product_name || '').trim();
  const unit = Number(it?.unit_price ?? it?.price ?? src?.price ?? src?.unit_price ?? 0);
  const sub = it?.subtotal != null ? Number(it.subtotal) : qty * unit;
  return {
    ...it,
    id: it?.id || uuid(),
    product_id: pid || it?.product_id,
    product_name: name || 'Producto',
    quantity: qty,
    unit_price: unit,
    subtotal: sub,
    notes: it?.notes || '',
    variant_name: it?.variant_name || it?.modifier_option || '',
  };
}

function buildOptimisticOrder(body) {
  const catalog = findCatalogMap();
  const items = (Array.isArray(body.items) ? body.items : []).map((it) => hydrateOrderItem(it, catalog));
  const subtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
  const discount = Number(body.discount || 0);
  const delivery = Number(body.delivery_fee || 0);
  const now = new Date().toISOString();
  return {
    id: body.id,
    order_number: body.order_number || `L-${String(body.id || '').slice(0, 8)}`,
    type: body.type || 'dine_in',
    table_id: body.table_id || '',
    table_number: body.table_number || '',
    customer_name: body.customer_name || '',
    status: 'pending',
    payment_status: 'pending',
    payment_method: body.payment_method || 'efectivo',
    items,
    subtotal,
    discount,
    delivery_fee: delivery,
    total: Math.max(0, subtotal + delivery - discount),
    notes: body.notes || '',
    created_at: now,
    updated_at: now,
    offline_local: true,
  };
}

function applyQueueToTables(tables, queue) {
  let next = clone(tables || []);
  const byId = () => {
    const m = new Map();
    next.forEach((t, i) => m.set(String(t.id), i));
    return m;
  };
  for (const job of queue) {
    const p = pathOf(job.endpoint);
    const body = parseBody(job.body);
    if (job.method === 'POST' && p === '/orders') {
      const order = buildOptimisticOrder(body);
      const tid = String(order.table_id || '').trim();
      const tnum = String(order.table_number || '').trim();
      const map = byId();
      let idx = tid && map.has(tid) ? map.get(tid) : -1;
      if (idx < 0 && tnum) {
        idx = next.findIndex((t) => String(t.number) === tnum);
      }
      if (idx >= 0) {
        const t = next[idx];
        const orders = [...(t.orders || []), order];
        next[idx] = recomputeTable({ ...t, orders, status: 'occupied' });
      }
    } else if (job.method === 'POST' && p === '/pos/checkout-table') {
      const ids = new Set((Array.isArray(body.order_ids) ? body.order_ids : []).map(String));
      const itemIds = new Set((Array.isArray(body.order_item_ids) ? body.order_item_ids : []).map(String));
      next = next.map((t) => {
        const orders = (t.orders || []).map((o) => {
          if (ids.has(String(o.id))) {
            return { ...o, payment_status: 'paid', status: 'delivered' };
          }
          if (itemIds.size && (o.items || []).some((it) => itemIds.has(String(it.id)))) {
            const remain = (o.items || []).filter((it) => !itemIds.has(String(it.id)));
            if (!remain.length) return { ...o, payment_status: 'paid', status: 'delivered', items: [] };
            const sub = remain.reduce((s, it) => s + Number(it.subtotal || 0), 0);
            return { ...o, items: remain, subtotal: sub, total: sub };
          }
          return o;
        });
        return recomputeTable({ ...t, orders });
      });
    } else if (job.method === 'PATCH' && /^\/tables\/[^/]+\/status$/.test(p)) {
      const tid = p.split('/')[2];
      const map = byId();
      if (map.has(tid)) {
        const i = map.get(tid);
        next[i] = { ...next[i], status: body.status || next[i].status };
      }
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/status$/.test(p)) {
      const oid = p.split('/')[2];
      next = next.map((t) => ({
        ...t,
        orders: (t.orders || []).map((o) => (String(o.id) === oid ? { ...o, status: body.status || o.status } : o)),
      })).map(recomputeTable);
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/lines$/.test(p)) {
      const oid = p.split('/')[2];
      const items = Array.isArray(body.items) ? body.items : [];
      next = next.map((t) => ({
        ...t,
        orders: (t.orders || []).map((o) => {
          if (String(o.id) !== oid) return o;
          const mapped = items.map((it) => {
            const qty = Number(it.quantity || 1);
            const unit = Number(it.unit_price ?? it.price ?? 0);
            return {
              ...it,
              id: it.id || uuid(),
              quantity: qty,
              unit_price: unit,
              subtotal: it.subtotal != null ? Number(it.subtotal) : qty * unit,
            };
          });
          const sub = mapped.reduce((s, it) => s + Number(it.subtotal || 0), 0);
          return { ...o, items: mapped, subtotal: sub, total: Math.max(0, sub - Number(o.discount || 0)) };
        }),
      })).map(recomputeTable);
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/payment$/.test(p)) {
      const oid = p.split('/')[2];
      next = next.map((t) => ({
        ...t,
        orders: (t.orders || []).map((o) => (String(o.id) === oid ? { ...o, ...body } : o)),
      })).map(recomputeTable);
    }
  }
  return next;
}

function applyQueueToOrders(orders, queue) {
  let next = Array.isArray(orders) ? clone(orders) : [];
  for (const job of queue) {
    const p = pathOf(job.endpoint);
    const body = parseBody(job.body);
    if (job.method === 'POST' && p === '/orders') {
      const order = buildOptimisticOrder(body);
      if (!next.some((o) => String(o.id) === String(order.id))) next = [order, ...next];
    } else if (job.method === 'POST' && p === '/pos/checkout-table') {
      const ids = new Set((Array.isArray(body.order_ids) ? body.order_ids : []).map(String));
      next = next.map((o) => (ids.has(String(o.id)) ? { ...o, payment_status: 'paid', status: 'delivered' } : o));
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/payment$/.test(p)) {
      const oid = p.split('/')[2];
      next = next.map((o) => (String(o.id) === oid ? { ...o, ...body } : o));
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/status$/.test(p)) {
      const oid = p.split('/')[2];
      next = next.map((o) => (String(o.id) === oid ? { ...o, status: body.status || o.status } : o));
    } else if (job.method === 'PUT' && /^\/orders\/[^/]+\/lines$/.test(p)) {
      const oid = p.split('/')[2];
      const items = Array.isArray(body.items) ? body.items : [];
      next = next.map((o) => {
        if (String(o.id) !== oid) return o;
        const mapped = items.map((it) => {
          const qty = Number(it.quantity || 1);
          const unit = Number(it.unit_price ?? it.price ?? 0);
          return {
            ...it,
            id: it.id || uuid(),
            quantity: qty,
            unit_price: unit,
            subtotal: it.subtotal != null ? Number(it.subtotal) : qty * unit,
          };
        });
        const sub = mapped.reduce((s, it) => s + Number(it.subtotal || 0), 0);
        return { ...o, items: mapped, subtotal: sub, total: Math.max(0, sub - Number(o.discount || 0)) };
      });
    }
  }
  return next;
}

export function overlayCachedGet(endpoint, data) {
  const queue = getMutationQueue();
  const catalog = findCatalogMap();
  const hydrateList = (list) => {
    if (!Array.isArray(list) || !catalog.size) return list;
    return list.map((o) => {
      const items = (o.items || []).map((it) => hydrateOrderItem(it, catalog));
      const subtotal = items.reduce((s, it) => s + Number(it.subtotal || 0), 0);
      const discount = Number(o.discount || 0);
      const delivery = Number(o.delivery_fee || 0);
      const looksEmpty = Number(o.total || o.subtotal || 0) <= 0 && subtotal > 0;
      return {
        ...o,
        items,
        ...(looksEmpty
          ? { subtotal, total: Math.max(0, subtotal + delivery - discount) }
          : {}),
      };
    });
  };
  const hydrateTables = (tables) => {
    if (!Array.isArray(tables) || !catalog.size) return tables;
    return tables.map((t) => recomputeTable({
      ...t,
      orders: hydrateList(t.orders || []),
    }));
  };
  let next = data;
  if (queue.length && data != null) {
    const p = pathOf(endpoint);
    if (p === '/tables') {
      const list = Array.isArray(data) ? data : [];
      next = applyQueueToTables(list, queue);
    } else if (/^\/tables\/[^/]+$/.test(p) && data && typeof data === 'object' && !Array.isArray(data)) {
      const tables = applyQueueToTables([data], queue);
      next = tables[0] || data;
    } else if (p === '/orders') {
      next = applyQueueToOrders(data, queue);
    }
  }
  if (next == null) return next;
  const p = pathOf(endpoint);
  if (p === '/tables' && Array.isArray(next)) return hydrateTables(next);
  if (/^\/tables\/[^/]+$/.test(p) && next && typeof next === 'object' && !Array.isArray(next)) {
    return hydrateTables([next])[0] || next;
  }
  if (p === '/orders') return hydrateList(next);
  return next;
}

export function prepareMutation(method, endpoint, bodyText) {
  const m = String(method || 'POST').toUpperCase();
  const p = pathOf(endpoint);
  let body = parseBody(bodyText);
  if (m === 'POST' && p === '/orders') {
    if (!body.id) body.id = uuid();
    body.offline_force_new = true;
  }
  return {
    id: uuid(),
    method: m,
    endpoint,
    body: JSON.stringify(body),
    createdAt: Date.now(),
  };
}

export function enqueueMutation(job) {
  const q = getMutationQueue();
  q.push(job);
  setMutationQueue(q);
  return job;
}

export function optimisticMutationResult(job) {
  const p = pathOf(job.endpoint);
  const body = parseBody(job.body);
  if (job.method === 'POST' && p === '/orders') {
    return { ...buildOptimisticOrder(body), merged_into_existing: false, new_item_ids: [] };
  }
  if (job.method === 'POST' && p === '/pos/checkout-table') {
    const tables = applyQueueToTables(findTablesInCache(), getMutationQueue());
    const ids = new Set((Array.isArray(body.order_ids) ? body.order_ids : []).map(String));
    const itemIds = new Set((Array.isArray(body.order_item_ids) ? body.order_item_ids : []).map(String));
    const orders = [];
    for (const t of tables) {
      for (const o of t.orders || []) {
        if (ids.has(String(o.id))) orders.push({ ...o, payment_status: 'paid', status: 'delivered' });
      }
    }
    const fromCache = applyQueueToOrders(readGetCache('/orders?limit=600') || readGetCache('/orders') || [], getMutationQueue());
    for (const o of fromCache) {
      if (ids.has(String(o.id)) && !orders.some((x) => String(x.id) === String(o.id))) {
        orders.push({ ...o, payment_status: 'paid', status: 'delivered' });
      }
    }
    if (!orders.length && itemIds.size) {
      for (const t of findTablesInCache()) {
        for (const o of t.orders || []) {
          if ((o.items || []).some((it) => itemIds.has(String(it.id)))) {
            orders.push({ ...o, payment_status: 'paid', status: 'delivered' });
          }
        }
      }
    }
    return { success: true, orders, discounts_applied_by_order: {}, offline_local: true };
  }
  if (job.method === 'PATCH' && /^\/tables\/[^/]+\/status$/.test(p)) {
    const tid = p.split('/')[2];
    const tables = applyQueueToTables(findTablesInCache(), getMutationQueue());
    return tables.find((t) => String(t.id) === tid) || { id: tid, status: body.status };
  }
  if (job.method === 'PUT' && /^\/orders\//.test(p)) {
    return { ok: true, offline_local: true, ...body };
  }
  if (job.method === 'POST' && (p === '/pos/movements' || p === '/pos/notes')) {
    return { id: uuid(), ...body, created_at: new Date().toISOString(), offline_local: true };
  }
  return { ok: true, offline_local: true };
}

export async function flushOfflineQueue(sendFn) {
  if (syncing) return { flushed: 0 };
  const queue = getMutationQueue();
  if (!queue.length) {
    lastError = '';
    emitOfflinePos();
    return { flushed: 0 };
  }
  if (isBrowserOffline()) return { flushed: 0, deferred: true };
  syncing = true;
  lastError = '';
  emitOfflinePos();
  let flushed = 0;
  try {
    while (getMutationQueue().length) {
      const [job, ...rest] = getMutationQueue();
      try {
        await sendFn(job);
        setMutationQueue(rest);
        flushed += 1;
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 401 || status === 403) {
          lastError = err.message || 'Sesión inválida al sincronizar';
          break;
        }
        lastError = err.message || 'No se pudo sincronizar';
        break;
      }
    }
  } finally {
    syncing = false;
    emitOfflinePos();
    writeJson(META_KEY, { lastFlush: Date.now(), lastError });
    if (flushed > 0 && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new Event('rf-offline-synced'));
      } catch { /* ignore */ }
    }
  }
  return { flushed, pending: getMutationQueue().length, lastError };
}

export function startOfflinePosListeners(flushFn) {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => {
    emitOfflinePos();
    flushFn();
  };
  const onOffline = () => emitOfflinePos();
  const onVisible = () => {
    if (document.visibilityState === 'visible' && !isBrowserOffline()) flushFn();
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const tick = setInterval(() => {
    if (!isBrowserOffline() && getMutationQueue().length) flushFn();
  }, 20000);
  if (!isBrowserOffline()) {
    setTimeout(() => flushFn(), 800);
  }
  emitOfflinePos();
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(tick);
  };
}
