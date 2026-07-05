#!/usr/bin/env node
/**
 * Verifica reglas de fusión de comandas por mesa (40 min, despacho, cocina/bar).
 * Ejecutar: node scripts/verify-comanda-merge.js
 */
const {
  isWithinMergeWindowTx,
  isMergeBlockedByDispatchedStation,
  isOrderMergeableState,
  orderMatchesTableScope,
  TABLE_ORDER_MERGE_WINDOW_MINUTES,
} = require('../server/services/tableOrderMergeService');

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`  OK  ${name}`);
  } else {
    failed += 1;
    console.error(` FAIL ${name}`);
  }
}

function mockTx({ queries = {} } = {}) {
  return {
    queryOne(sql, params) {
      const key = String(sql).slice(0, 80);
      if (queries[key]) return queries[key](sql, params);
      if (sql.includes('kitchen_release_at') && sql.includes('held')) return { held: 0 };
      if (sql.includes(`${TABLE_ORDER_MERGE_WINDOW_MINUTES} minutes`)) {
        const anchor = params?.[0];
        return { ok: anchor === 'recent' ? 1 : 0 };
      }
      return null;
    },
    queryAll(sql, params) {
      const fn = queries.queryAll;
      if (typeof fn === 'function') return fn(sql, params);
      if (sql.includes('combo_items')) return [{ production_area: 'cocina' }];
      if (sql.includes('FROM order_items')) return queries.orderItems || [];
      return [];
    },
  };
}

console.log('Reglas comanda / mesa\n');

assert('ventana merge 40 min definida', TABLE_ORDER_MERGE_WINDOW_MINUTES === 40);

const recentOrder = { kitchen_last_send_at: 'recent', created_at: 'old' };
const oldOrder = { kitchen_last_send_at: 'old', created_at: 'old' };
const txWindow = mockTx();
assert('dentro de ventana → fusionable', isWithinMergeWindowTx(txWindow, recentOrder));
assert('fuera de ventana → nueva comanda', !isWithinMergeWindowTx(txWindow, oldOrder));

assert('pedido cobrado no fusiona', !isOrderMergeableState({ type: 'dine_in', payment_status: 'paid', status: 'ready' }));
assert('dine_in activo fusiona', isOrderMergeableState({ type: 'dine_in', payment_status: 'pending', status: 'preparing' }));

assert(
  'misma mesa por table_id',
  orderMatchesTableScope({ table_id: 't1', table_number: '4' }, { tableId: 't1', tableNumberRaw: '4' }),
);

const dispatchedKitchenOrder = {
  id: 'o1',
  station_cocina_ready_at: '2026-01-01 12:00:00',
  station_bar_ready_at: null,
};
const txDispatched = {
  queryOne(sql) {
    if (sql.includes('production_area FROM products')) return { production_area: 'cocina' };
    return null;
  },
  queryAll(sql) {
    if (sql.includes('FROM order_items')) {
      return [{ id: 'i1', product_name: 'Lomo', variant_name: '', production_area: 'cocina' }];
    }
    return [];
  },
};
assert(
  'cocina despachada + ítem cocina → no fusionar (nueva comanda)',
  isMergeBlockedByDispatchedStation(txDispatched, dispatchedKitchenOrder, [{ product_id: 'p1' }]),
);

const activeKitchenOrder = {
  id: 'o2',
  station_cocina_ready_at: null,
  station_cocina_preparing_at: '2026-01-01 12:00:00',
};
const txActive = mockTx({
  queryAll(sql) {
    if (sql.includes('production_area FROM products')) return [];
    if (sql.includes('combo_items')) return [{ production_area: 'cocina' }];
    if (sql.includes('FROM order_items')) {
      return [{ id: 'i1', product_name: 'Arroz', variant_name: '', production_area: 'cocina', station_cocina_ready_at: null }];
    }
    return [];
  },
  queries: {
    queryAll(sql) {
      if (sql.includes('FROM order_items')) {
        return [{ id: 'i1', product_name: 'Arroz', variant_name: '', production_area: 'cocina', station_cocina_ready_at: null }];
      }
      if (sql.includes('combo_items')) return [{ production_area: 'cocina' }];
      return [];
    },
  },
});
// Fix mock - use simpler approach
const txActive2 = {
  queryOne(sql, params) {
    if (sql.includes('production_area FROM products')) return { production_area: 'cocina' };
    if (sql.includes('held')) return { held: 0 };
    if (sql.includes('minutes')) return { ok: 1 };
    if (sql.includes('FROM combos')) return null;
    return null;
  },
  queryAll(sql) {
    if (sql.includes('combo_items')) return [{ production_area: 'cocina' }];
    if (sql.includes('FROM order_items')) {
      return [{ id: 'i1', product_name: 'Arroz', variant_name: '', production_area: 'cocina', station_cocina_ready_at: null }];
    }
    return [];
  },
};
assert(
  'cocina en curso + ítem cocina → sí fusionar',
  !isMergeBlockedByDispatchedStation(txActive2, activeKitchenOrder, [{ product_id: 'p1' }]),
);

console.log(`\n${passed} ok, ${failed} fallos`);
process.exit(failed > 0 ? 1 : 0);
