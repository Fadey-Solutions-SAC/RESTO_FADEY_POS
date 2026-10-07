/**
 * Kardex valorizado (promedio ponderado) — insumos, recetas, integración ventas/compras/ajustes.
 * Usar siempre dentro de withTransaction(tx => ...) para operaciones que deben ser atómicas con cobros.
 */

const { v4: uuidv4 } = require('uuid');
const { getKardexMetodoValorizacion } = require('./businessConfigService');
const { isUnidadUm, isMasaOrLitrajeUm, recipeQtyToStock } = require('../utils/insumoUnidadMedida');
const { resolveKardexInsumoLines } = require('../utils/productKardexInsumos');

function kardexMeta(p = {}) {
  const cantidadOriginal = p.cantidadOriginal != null && p.cantidadOriginal !== ''
    ? Number(p.cantidadOriginal)
    : null;
  return {
    motivo: String(p.motivo || ''),
    recetaId: String(p.recetaId || ''),
    almacenId: String(p.almacenId || ''),
    unidadOriginal: String(p.unidadOriginal || ''),
    cantidadOriginal: Number.isFinite(cantidadOriginal) ? cantidadOriginal : null,
    ip: String(p.ip || ''),
  };
}

function etiquetaMovimiento(referencia, tipoMovimiento) {
  const ref = String(referencia || '').toLowerCase();
  const tipo = String(tipoMovimiento || '').toLowerCase();
  const map = {
    inicial: 'Inventario inicial',
    compra: 'Compra',
    recepcion: 'Recepción',
    venta: 'Consumo por receta',
    venta_masa: 'Consumo por receta',
    anulacion_venta: 'Anulación',
    merma: 'Merma',
    ajuste: tipo === 'entrada' ? 'Ajuste positivo' : 'Ajuste negativo',
    inventario_fisico: tipo === 'entrada' ? 'Ajuste positivo' : 'Ajuste negativo',
    transformacion: tipo === 'entrada' ? 'Producción' : 'Transformación',
    anulacion_transformacion: 'Anulación',
    devolucion: 'Devolución',
    traslado_entrada: 'Traslado entrada',
    traslado_salida: 'Traslado salida',
  };
  if (map[ref]) return map[ref];
  if (tipo === 'entrada') return 'Entrada';
  if (tipo === 'salida') return 'Salida';
  return 'Ajuste';
}

function resolverAlmacenInsumos(tx) {
  const wh = tx.queryOne(
    `SELECT id, name FROM warehouse_locations
     WHERE is_active = 1
       AND (linked_insumos = 1 OR LOWER(name) = LOWER('Almacen de insumos'))
     ORDER BY linked_insumos DESC
     LIMIT 1`
  );
  return { id: wh?.id || '', name: wh?.name || '' };
}

function normalizeKardexTimestamp(eventAt) {
  const raw = String(eventAt || '').trim();
  if (!raw) return null;
  return raw.includes('T') ? raw : raw.replace(' ', 'T');
}

/**
 * @param {import('../database').Tx} tx
 * @param {object} p
 */
function registrarEntrada(tx, { insumoId, cantidad, costoUnitario, referencia, referenciaId, userId, unidadesIngreso, eventAt }) {
  const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [insumoId]);
  if (!ins) throw new Error(`Insumo no encontrado: ${insumoId}`);
  if (!Number(ins.activo)) throw new Error(`Insumo inactivo: ${ins.nombre}`);

  const cant = Number(cantidad);
  const costoN = Number(costoUnitario);
  if (cant <= 0 || Number.isNaN(cant)) throw new Error('La cantidad de entrada debe ser mayor a 0');
  if (costoN < 0 || Number.isNaN(costoN)) throw new Error('Costo unitario inválido');

  const porUnidad = isUnidadUm(ins.unidad_medida);
  const stockAnt = Number(ins.stock_actual || 0);
  let uAnt = Number(ins.stock_unidades != null ? ins.stock_unidades : 0) || 0;
  if (porUnidad && uAnt < 1e-12 && stockAnt > 1e-12) uAnt = stockAnt;

  const hasUnidadesMov = unidadesIngreso != null;
  const uInMov = hasUnidadesMov ? Math.max(0, Number(unidadesIngreso) || 0) : 0;
  const unitsAdd = porUnidad ? (uInMov > 0 ? uInMov : cant) : (hasUnidadesMov ? uInMov : 0);
  const qtyAdd = porUnidad ? unitsAdd : cant;
  const uRes = uAnt + unitsAdd;
  const kpuAnt = Number(ins.kg_por_unidad != null ? ins.kg_por_unidad : 0) || 0;
  let kpuN = kpuAnt;
  if (!porUnidad) {
    if (uRes > 1e-9) {
      kpuN = (kpuAnt * uAnt + cant) / uRes;
    } else {
      kpuN = 0;
    }
  }

  const costoAnt = Number(ins.costo_promedio || 0);
  const stockRes = stockAnt + qtyAdd;
  const nuevoCosto =
    stockRes > 0 ? (stockAnt * costoAnt + qtyAdd * costoN) / stockRes : costoN;
  const costoTotal = qtyAdd * costoN;

  if (porUnidad || hasUnidadesMov) {
    tx.run(
      `UPDATE insumos SET stock_actual = ?, stock_unidades = ?, costo_promedio = ?, kg_por_unidad = ?, updated_at = datetime('now') WHERE id = ?`,
      [stockRes, uRes, nuevoCosto, kpuN, insumoId]
    );
  } else {
    tx.run(
      `UPDATE insumos SET stock_actual = ?, costo_promedio = ?, kg_por_unidad = ?, updated_at = datetime('now') WHERE id = ?`,
      [stockRes, nuevoCosto, kpuN, insumoId]
    );
  }

  const kid = uuidv4();
  const ts = normalizeKardexTimestamp(eventAt);
  const meta = kardexMeta(arguments[1] || {});
  tx.run(
    `INSERT INTO kardex (
      id, id_insumo, tipo_movimiento, cantidad, costo_unitario, costo_total,
      stock_anterior, stock_resultante, metodo_valorizacion, referencia, referencia_id, fecha, created_at, created_by,
      motivo, receta_id, almacen_id, unidad_original, cantidad_original, ip
    ) VALUES (?, ?, 'entrada', ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?)`,
    [
      kid,
      insumoId,
      qtyAdd,
      costoN,
      costoTotal,
      stockAnt,
      stockRes,
      getKardexMetodoValorizacion(),
      String(referencia || 'compra'),
      String(referenciaId || ''),
      ts,
      ts,
      userId || null,
      meta.motivo,
      meta.recetaId,
      meta.almacenId,
      meta.unidadOriginal,
      meta.cantidadOriginal,
      meta.ip,
    ]
  );
  return kid;
}

/**
 * @param {import('../database').Tx} tx
 * @param {object} p
 * @param {string} p.insumoId
 * @param {number} p.cantidad — kg/L (si hay unidadesSalida + kpu, se reemplaza por U×kpu)
 * @param {number} [p.unidadesSalida] — p. ej. 1/4 = 0,25 U; con kpu>0 el producto vinculado (num/den) descuenta U y kg coherente
 * @param {boolean} [p.soloMasa] — solo descuenta stock en kg/L; no descuenta unidades (carnes por gramos en el plato)
 */
function registrarSalida(tx, { insumoId, cantidad, unidadesSalida, soloMasa, referencia, referenciaId, userId, eventAt }) {
  const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [insumoId]);
  if (!ins) throw new Error(`Insumo no encontrado: ${insumoId}`);
  if (!Number(ins.activo)) throw new Error(`Insumo inactivo: ${ins.nombre}`);

  const porUnidad = isUnidadUm(ins.unidad_medida);
  const stockAnt = Number(ins.stock_actual || 0);
  let uAnt = Number(ins.stock_unidades != null ? ins.stock_unidades : 0) || 0;
  if (porUnidad && uAnt < 1e-12 && stockAnt > 1e-12) uAnt = stockAnt;
  const kpu = Number(ins.kg_por_unidad != null ? ins.kg_por_unidad : 0) || 0;
  const useUnidadExacta = unidadesSalida != null && unidadesSalida !== '' && Number.isFinite(Number(unidadesSalida));
  const dUin = useUnidadExacta ? Math.max(0, Number(unidadesSalida)) : 0;

  let need;
  if (useUnidadExacta && dUin > 0 && kpu > 1e-12) {
    if (dUin - uAnt > 1e-4) {
      throw new Error(
        `Unidades de «${ins.nombre}» insuficientes: se requieren ${dUin.toFixed(3)} U, hay ${uAnt.toFixed(3)} U.`
      );
    }
    need = dUin * kpu;
  } else {
    need = Number(cantidad);
    if (need <= 0 || Number.isNaN(need)) throw new Error('La cantidad de salida debe ser mayor a 0');
  }

  if (stockAnt + 1e-9 < need) {
    throw new Error(
      `Stock insuficiente para «${ins.nombre}»: hay ${stockAnt} ${ins.unidad_medida}, se requieren ${need}`
    );
  }

  const soloKilos = soloMasa === true;
  let dU = 0;
  if (soloKilos) {
    dU = 0;
  } else if (porUnidad) {
    dU = useUnidadExacta && dUin > 0 ? dUin : need;
    if (dU - uAnt > 1e-4) {
      throw new Error(
        `Unidades de «${ins.nombre}» insuficientes: se requieren ${dU.toFixed(3)} U, hay ${uAnt.toFixed(3)} U.`
      );
    }
  } else if (useUnidadExacta && dUin > 0 && kpu > 1e-12) {
    dU = dUin;
  } else if (kpu > 1e-12 && uAnt > 1e-12) {
    dU = need / kpu;
    if (dU - uAnt > 1e-4) {
      throw new Error(
        `Unidades de «${ins.nombre}» insuficientes: para ${need.toFixed(3)} ${
          ins.unidad_medida
        } (≈${dU.toFixed(3)} U a ${kpu.toFixed(3)} kg/U) solo hay ${uAnt.toFixed(3)} U en stock. Ajuste compras o recetas.`
      );
    }
  }

  const costoU = Number(ins.costo_promedio || 0);
  const stockRes = stockAnt - need;
  const uRes = Math.max(0, uAnt - dU);
  const costoTotal = need * costoU;

  tx.run(
    `UPDATE insumos SET stock_actual = ?, stock_unidades = ?, updated_at = datetime('now') WHERE id = ?`,
    [stockRes, uRes, insumoId]
  );

  const kid = uuidv4();
  const ts = normalizeKardexTimestamp(eventAt);
  const meta = kardexMeta(arguments[1] || {});
  tx.run(
    `INSERT INTO kardex (
      id, id_insumo, tipo_movimiento, cantidad, costo_unitario, costo_total,
      stock_anterior, stock_resultante, metodo_valorizacion, referencia, referencia_id, fecha, created_at, created_by,
      motivo, receta_id, almacen_id, unidad_original, cantidad_original, ip
    ) VALUES (?, ?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?)`,
    [
      kid,
      insumoId,
      need,
      costoU,
      costoTotal,
      stockAnt,
      stockRes,
      getKardexMetodoValorizacion(),
      String(referencia || 'venta'),
      String(referenciaId || ''),
      ts,
      ts,
      userId || null,
      meta.motivo,
      meta.recetaId,
      meta.almacenId,
      meta.unidadOriginal,
      meta.cantidadOriginal,
      meta.ip,
    ]
  );
  return kid;
}

/**
 * Salida por merma o ajuste manual (usa costo promedio).
 */
function registrarAjusteSalida(tx, params) {
  return registrarSalida(tx, { ...params, referencia: params.referencia || 'merma' });
}

/**
 * Ajuste de entrada por hallazgo (sobrante de inventario físico) — costo a valor promedio.
 */
function registrarAjusteEntrada(tx, params) {
  const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [params.insumoId]);
  if (!ins) throw new Error(`Insumo no encontrado: ${params.insumoId}`);
  const costoU = Number(ins.costo_promedio || 0);
  return registrarEntrada(tx, {
    ...params,
    costoUnitario: costoU,
    referencia: params.referencia || 'ajuste',
  });
}

/**
 * Idempotencia: no duplicar salidas de insumos por el mismo pedido ya valorizado.
 */
function yaAplicoVentaEnKardex(tx, orderId) {
  const row = tx.queryOne(
    `SELECT 1 as x FROM kardex WHERE referencia IN ('venta', 'venta_masa') AND referencia_id = ? LIMIT 1`,
    [String(orderId)]
  );
  return Boolean(row);
}

function yaRevertioVentaEnKardex(tx, orderId) {
  const row = tx.queryOne(
    `SELECT 1 as x FROM kardex WHERE referencia = 'anulacion_venta' AND referencia_id = ? LIMIT 1`,
    [String(orderId)]
  );
  return Boolean(row);
}

/**
 * Revierte salidas kardex de un pedido cobrado (anulación). Entradas compensatorias con referencia `anulacion_venta`.
 * Unidades: si había stock en U antes de la venta (inferido por stock_anterior kg / kg_por_unidad), se restauran; `venta_masa` solo restaura kg.
 */
function revertirSalidasVentaPedido(tx, orderId, userId) {
  if (yaRevertioVentaEnKardex(tx, orderId)) return { skipped: true, reason: 'ya_revertido' };
  const rows = tx.queryAll(
    `SELECT * FROM kardex WHERE referencia IN ('venta', 'venta_masa') AND referencia_id = ? AND tipo_movimiento = 'salida' ORDER BY datetime(created_at) ASC`,
    [String(orderId)]
  );
  if (!rows.length) return { skipped: true, reason: 'sin_salidas_venta' };
  for (const k of rows) {
    const ref = String(k.referencia || '');
    const need = Number(k.cantidad) || 0;
    if (need <= 1e-12) continue;
    const costoU = Number(k.costo_unitario || 0);
    const insumoId = k.id_insumo;
    const stockAntKg = Number(k.stock_anterior) || 0;

    if (ref === 'venta_masa') {
      registrarEntrada(tx, {
        insumoId,
        cantidad: need,
        costoUnitario: costoU,
        referencia: 'anulacion_venta',
        referenciaId: String(orderId),
        userId,
      });
      continue;
    }

    const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [insumoId]);
    const kpu = ins ? Number(ins.kg_por_unidad || 0) || 0 : 0;
    const uAntBefore = kpu > 1e-12 ? stockAntKg / kpu : 0;
    const shouldRestoreUnits = kpu > 1e-12 && uAntBefore > 1e-9;
    const unidadesIngreso = shouldRestoreUnits ? need / kpu : undefined;

    registrarEntrada(tx, {
      insumoId,
      cantidad: need,
      costoUnitario: costoU,
      referencia: 'anulacion_venta',
      referenciaId: String(orderId),
      userId,
      unidadesIngreso: unidadesIngreso != null && unidadesIngreso > 1e-12 ? unidadesIngreso : undefined,
    });
  }
  return { skipped: false, reverted: rows.length };
}

function salidaUnKardexLine(tx, line, qtyLine, { referenciaId, userId, eventAt }) {
  const insumoId = String(line?.insumo_id || '').trim();
  if (!insumoId) return { skipped: true, reason: 'sin_insumo' };
  const insRow = tx.queryOne('SELECT unidad_medida, kg_por_unidad, stock_unidades, stock_actual FROM insumos WHERE id = ?', [insumoId]);
  const umInsumo = insRow ? insRow.unidad_medida : '';
  if (isMasaOrLitrajeUm(umInsumo)) {
    const q = Number(line.qty) || 0;
    const need = recipeQtyToStock(q, umInsumo) * qtyLine;
    if (need <= 0) return { skipped: true, reason: 'sin_masa' };
    registrarSalida(tx, {
      insumoId,
      cantidad: need,
      soloMasa: true,
      referencia: 'venta_masa',
      referenciaId,
      userId,
      eventAt,
    });
    return { skipped: false };
  }
  const asUnidades = isUnidadUm(umInsumo) || String(line.modo || 'unidad').toLowerCase() !== 'peso';
  if (!asUnidades) {
    const q = Number(line.qty) || 0;
    const need = recipeQtyToStock(q, umInsumo) * qtyLine;
    if (need <= 0) return { skipped: true, reason: 'sin_masa' };
    registrarSalida(tx, {
      insumoId,
      cantidad: need,
      soloMasa: true,
      referencia: 'venta_masa',
      referenciaId,
      userId,
      eventAt,
    });
    return { skipped: false };
  }
  const qtyUnidad = Number(line.qty) || 0;
  const fracU = qtyUnidad * qtyLine;
  if (fracU <= 0) return { skipped: true, reason: 'sin_unidades' };
  const kpu0 = insRow ? Number(insRow.kg_por_unidad) || 0 : 0;
  if (kpu0 > 1e-12) {
    const needKg = fracU * kpu0;
    registrarSalida(tx, {
      insumoId,
      cantidad: needKg,
      unidadesSalida: fracU,
      referencia: 'venta',
      referenciaId,
      userId,
      eventAt,
    });
  } else {
    registrarSalida(tx, {
      insumoId,
      cantidad: fracU,
      referencia: 'venta',
      referenciaId,
      userId,
      eventAt,
    });
  }
  return { skipped: false };
}

function salidaInsumosPorProducto(tx, { productId, quantity, referencia, referenciaId, userId, eventAt }) {
  const pid = String(productId || '').trim();
  const qtyLine = Number(quantity || 0);
  if (!pid || qtyLine <= 0) return { skipped: true, reason: 'sin_producto' };

  const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [pid]);
  // El no transformable se descuenta del almacén del producto. No volver a descontar insumos.
  if (product && String(product.process_type || '') === 'non_transformed') {
    return { skipped: true, reason: 'stock_almacen' };
  }

  const rec = tx.queryOne(
    `SELECT * FROM recetas WHERE product_id = ? AND activo = 1 LIMIT 1`,
    [pid],
  );
  if (!rec) {
    const product = tx.queryOne('SELECT * FROM products WHERE id = ?', [pid]);
    const kardexLines = resolveKardexInsumoLines(product || {});
    if (!kardexLines.length) return { skipped: true, reason: 'sin_receta' };
    let any = false;
    for (const line of kardexLines) {
      const result = salidaUnKardexLine(tx, line, qtyLine, { referenciaId, userId, eventAt });
      if (!result.skipped) any = true;
    }
    return any ? { skipped: false } : { skipped: true, reason: 'sin_cantidad' };
  }

  const resultadoId = String(rec.insumo_resultado_id || '').trim();
  const rendimiento = Number(rec.rendimiento || 0);
  if (resultadoId && rendimiento > 0) {
    registrarSalida(tx, {
      insumoId: resultadoId,
      cantidad: rendimiento * qtyLine,
      referencia: 'venta',
      referenciaId,
      userId,
      eventAt,
      recetaId: rec.id,
      motivo: 'Consumo del transformable producido',
    });
    return { skipped: false };
  }

  const dets = tx.queryAll('SELECT * FROM receta_detalle WHERE receta_id = ?', [rec.id]);
  for (const d of dets) {
    const need = Number(d.cantidad_usada) * qtyLine;
    if (need <= 0) continue;
    const insLine = tx.queryOne('SELECT insumo_clase FROM insumos WHERE id = ?', [d.insumo_id]);
    const esDoble = String(insLine?.insumo_clase || '').toLowerCase() === 'doble';
    // El doble ya se fabricó con sus directos. La venta solo descuenta este insumo.
    registrarSalida(tx, {
      insumoId: d.insumo_id,
      cantidad: need,
      referencia: 'venta',
      referenciaId,
      userId,
      eventAt,
      motivo: esDoble ? 'Consumo de insumo doble' : '',
    });
  }
  return { skipped: false };
}

/** Descontar insumos de todas las líneas de un pedido cobrado. */
function aplicarSalidasVentaPedido(tx, orderId, userId, eventAt) {
  if (yaAplicoVentaEnKardex(tx, orderId)) return { skipped: true, reason: 'ya_procesado' };

  const movAt = eventAt || null;
  const items = tx.queryAll('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  for (const line of items) {
    if (String(line.variant_name || '').toLowerCase() === 'combo') {
      const combo = tx.queryOne(
        `SELECT id FROM combos WHERE name = ? AND IFNULL(active, 1) = 1 ORDER BY updated_at DESC LIMIT 1`,
        [String(line.product_name || '').trim()],
      );
      const comps = combo?.id
        ? tx.queryAll('SELECT product_id, quantity FROM combo_items WHERE combo_id = ?', [combo.id])
        : [];
      if (comps.length) {
        const qtyCombo = Number(line.quantity || 0);
        for (const c of comps) {
          salidaInsumosPorProducto(tx, {
            productId: c.product_id,
            quantity: Number(c.quantity || 0) * qtyCombo,
            referencia: 'venta',
            referenciaId: orderId,
            userId,
            eventAt: movAt,
          });
        }
        continue;
      }
    }
    salidaInsumosPorProducto(tx, {
      productId: line.product_id,
      quantity: line.quantity,
      referencia: 'venta',
      referenciaId: orderId,
      userId,
      eventAt: movAt,
    });
  }
  return { skipped: false };
}

/**
 * @param {import('../database').Tx} tx
 * @param {string[]} orderIds
 * @param {string} [userId]
 */
function aplicarSalidasVentasEnTransaccion(tx, orderIds, userId) {
  const r = [];
  for (const oid of orderIds) {
    r.push({ orderId: oid, ...aplicarSalidasVentaPedido(tx, oid, userId) });
  }
  return r;
}

/**
 * Compra de insumos (una operación, un referencia_id compartido).
 * @param {import('../database').Tx} tx
 * @param {Array<{ insumo_id: string, cantidad: number, costo_unitario: number, unidades?: number }>} items
 *   unidades: opcional; con kg actualiza el promedio `kg_por_unidad` y el stock en U. Sin unidades, solo afecta al kardex (kg).
 * @param {string} [userId]
 * @returns {string} id de operación
 */
function registrarCompraInsumos(tx, items, userId) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Debe enviar al menos un ítem de compra');
  const opId = uuidv4();
  for (const it of items) {
    const iid = String(it.insumo_id || '').trim();
    const cant = Number(it.cantidad);
    const cu = Number(it.costo_unitario);
    if (!iid) throw new Error('insumo_id requerido');
    if (cant <= 0 || Number.isNaN(cant)) throw new Error('Cantidad inválida en compra');
    if (cu < 0 || Number.isNaN(cu)) throw new Error('Costo unitario inválido');
    const uIn = it.unidades != null && it.unidades !== '' ? Number(it.unidades) : null;
    if (uIn != null && (Number.isNaN(uIn) || uIn < 0)) throw new Error('Unidades de compra inválidas (≥ 0)');
    registrarEntrada(tx, {
      insumoId: iid,
      cantidad: cant,
      costoUnitario: cu,
      referencia: 'compra',
      referenciaId: opId,
      userId,
      unidadesIngreso: uIn,
    });
  }
  return opId;
}

/**
 * Cierra inventario físico: genera entradas/salidas por diferencia.
 */
function cerrarInventarioFisico(tx, inventarioId, userId) {
  const inv = tx.queryOne('SELECT * FROM inventario_fisico WHERE id = ?', [inventarioId]);
  if (!inv) throw new Error('Inventario físico no encontrado');
  if (inv.estado === 'cerrado') throw new Error('Este inventario ya está cerrado');

  const dets = tx.queryAll('SELECT * FROM inventario_fisico_detalle WHERE inventario_id = ?', [inventarioId]);
  for (const d of dets) {
    const ins = tx.queryOne('SELECT stock_actual FROM insumos WHERE id = ?', [d.insumo_id]);
    const current = Number(ins?.stock_actual || 0);
    const counted = Number(d.stock_real || 0);
    const diff = counted - current;
    if (Math.abs(diff) < 1e-9) continue;
    if (diff > 0) {
      registrarAjusteEntrada(tx, {
        insumoId: d.insumo_id,
        cantidad: diff,
        referencia: 'inventario_fisico',
        referenciaId: inventarioId,
        userId,
      });
    } else {
      registrarAjusteSalida(tx, {
        insumoId: d.insumo_id,
        cantidad: -diff,
        referencia: 'inventario_fisico',
        referenciaId: inventarioId,
        userId,
      });
    }
  }

  tx.run(`UPDATE inventario_fisico SET estado = 'cerrado' WHERE id = ?`, [inventarioId]);
}

/**
 * Produce un transformable: descuenta ingredientes y entra el resultado en un solo paso.
 * Las cantidades de la receta ya están en la unidad base del insumo (igual que la venta).
 */
function ejecutarTransformacion(tx, { recetaId, lotes, userId, motivo, ip }) {
  const lot = Number(lotes);
  if (!(lot > 0) || !Number.isFinite(lot)) throw new Error('Indica cuántos lotes producir (mayor a 0)');
  const rec = tx.queryOne('SELECT * FROM recetas WHERE id = ?', [recetaId]);
  if (!rec || !Number(rec.activo)) throw new Error('Receta no encontrada o inactiva');
  const resultadoId = String(rec.insumo_resultado_id || '').trim();
  const rendimiento = Number(rec.rendimiento || 0);
  if (!resultadoId || !(rendimiento > 0)) {
    throw new Error('Esta receta descuenta insumos al vender. Para producir, indica el transformable y cuánto rinde un lote.');
  }
  if (String(rec.product_id || '').trim()) {
    throw new Error('Esta receta está vinculada a un plato. Crea una receta de producción aparte para no descontar los ingredientes dos veces.');
  }
  const resultado = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [resultadoId]);
  if (!resultado || !Number(resultado.activo)) throw new Error('El transformable a producir no existe o está inactivo');
  const dets = tx.queryAll('SELECT * FROM receta_detalle WHERE receta_id = ?', [rec.id]);
  if (!dets.length) throw new Error('La receta no tiene ingredientes');

  const faltantes = [];
  for (const d of dets) {
    const need = Number(d.cantidad_usada) * lot;
    if (!(need > 0)) continue;
    const ins = tx.queryOne('SELECT nombre, unidad_medida, stock_actual, activo FROM insumos WHERE id = ?', [d.insumo_id]);
    if (!ins || !Number(ins.activo)) {
      faltantes.push(d.insumo_id);
      continue;
    }
    if (Number(ins.stock_actual || 0) + 1e-9 < need) {
      faltantes.push(`${ins.nombre}: hay ${Number(ins.stock_actual || 0)} ${ins.unidad_medida}, se requieren ${need}`);
    }
  }
  if (faltantes.length) {
    throw new Error(`Stock insuficiente para producir. ${faltantes.join(' · ')}`);
  }

  const opId = uuidv4();
  const producido = rendimiento * lot;
  const almacen = resolverAlmacenInsumos(tx);
  const nota = String(motivo || '').trim() || `Producción ${rec.nombre_plato}`;
  let costoTotal = 0;
  for (const d of dets) {
    const need = Number(d.cantidad_usada) * lot;
    if (!(need > 0)) continue;
    const ins = tx.queryOne('SELECT costo_promedio, unidad_medida FROM insumos WHERE id = ?', [d.insumo_id]);
    costoTotal += need * Number(ins?.costo_promedio || 0);
    registrarSalida(tx, {
      insumoId: d.insumo_id,
      cantidad: need,
      referencia: 'transformacion',
      referenciaId: opId,
      userId,
      motivo: nota,
      recetaId: rec.id,
      almacenId: almacen.id,
      unidadOriginal: ins?.unidad_medida || '',
      cantidadOriginal: need,
      ip,
    });
  }
  const costoU = producido > 0 ? costoTotal / producido : 0;
  registrarEntrada(tx, {
    insumoId: resultadoId,
    cantidad: producido,
    costoUnitario: costoU,
    referencia: 'transformacion',
    referenciaId: opId,
    userId,
    motivo: nota,
    recetaId: rec.id,
    almacenId: almacen.id,
    unidadOriginal: resultado.unidad_medida || '',
    cantidadOriginal: producido,
    ip,
  });
  tx.run(
    `INSERT INTO transformaciones (
      id, receta_id, insumo_resultado_id, lotes, cantidad_producida, costo_unitario, costo_total, motivo, estado, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', ?)`,
    [opId, rec.id, resultadoId, lot, producido, costoU, costoTotal, nota, userId || null]
  );
  return {
    id: opId,
    cantidad_producida: producido,
    costo_unitario: costoU,
    costo_total: costoTotal,
    insumo_resultado_id: resultadoId,
  };
}

/** Anula una transformación con movimientos inversos. No borra el kardex original. */
function anularTransformacion(tx, transformacionId, userId, motivo, ip) {
  const t = tx.queryOne('SELECT * FROM transformaciones WHERE id = ?', [transformacionId]);
  if (!t) throw new Error('Transformación no encontrada');
  if (String(t.estado) === 'anulada') throw new Error('Esta transformación ya está anulada');
  const rows = tx.queryAll(
    `SELECT * FROM kardex WHERE referencia = 'transformacion' AND referencia_id = ? ORDER BY datetime(created_at) ASC`,
    [String(transformacionId)]
  );
  if (!rows.length) throw new Error('La transformación no tiene movimientos de kardex');
  const anulaId = uuidv4();
  const nota = String(motivo || '').trim() || 'Anulación de transformación';
  const almacen = resolverAlmacenInsumos(tx);
  for (const k of rows.filter((r) => r.tipo_movimiento === 'entrada')) {
    registrarSalida(tx, {
      insumoId: k.id_insumo,
      cantidad: Number(k.cantidad),
      referencia: 'anulacion_transformacion',
      referenciaId: anulaId,
      userId,
      motivo: nota,
      recetaId: t.receta_id,
      almacenId: almacen.id,
      ip,
    });
  }
  for (const k of rows.filter((r) => r.tipo_movimiento === 'salida')) {
    registrarEntrada(tx, {
      insumoId: k.id_insumo,
      cantidad: Number(k.cantidad),
      costoUnitario: Number(k.costo_unitario || 0),
      referencia: 'anulacion_transformacion',
      referenciaId: anulaId,
      userId,
      motivo: nota,
      recetaId: t.receta_id,
      almacenId: almacen.id,
      ip,
    });
  }
  tx.run(`UPDATE transformaciones SET estado = 'anulada', anulacion_id = ? WHERE id = ?`, [anulaId, t.id]);
  return { anulacion_id: anulaId };
}

/**
 * Compara stock_actual con el último saldo del kardex. No corrige nada.
 */
function auditarConsistenciaKardex(tx) {
  const insumos = tx.queryAll(
    `SELECT id, nombre, unidad_medida, stock_actual, tipo FROM insumos WHERE activo = 1`
  );
  const inconsistencias = [];
  for (const ins of insumos) {
    const movs = tx.queryAll(
      `SELECT tipo_movimiento, cantidad, stock_anterior, stock_resultante
       FROM kardex WHERE id_insumo = ?
       ORDER BY datetime(created_at) ASC, rowid ASC`,
      [ins.id]
    );
    const stock = Number(ins.stock_actual || 0);
    if (!movs.length) {
      if (Math.abs(stock) > 1e-3) {
        inconsistencias.push({
          insumo_id: ins.id,
          nombre: ins.nombre,
          stock_actual: stock,
          saldo_kardex: 0,
          detalle: 'Hay stock sin movimientos de kardex',
        });
      }
      continue;
    }
    let roto = false;
    let prev = null;
    for (const m of movs) {
      if (prev && Math.abs(Number(m.stock_anterior) - Number(prev.stock_resultante)) > 1e-3) {
        inconsistencias.push({
          insumo_id: ins.id,
          nombre: ins.nombre,
          stock_actual: stock,
          saldo_kardex: Number(movs[movs.length - 1].stock_resultante),
          detalle: 'El saldo no encadena con el movimiento anterior',
        });
        roto = true;
        break;
      }
      const delta = String(m.tipo_movimiento) === 'salida' ? -Number(m.cantidad) : Number(m.cantidad);
      const expected = Number(m.stock_anterior) + delta;
      if (Math.abs(expected - Number(m.stock_resultante)) > 1e-3) {
        inconsistencias.push({
          insumo_id: ins.id,
          nombre: ins.nombre,
          stock_actual: stock,
          saldo_kardex: Number(m.stock_resultante),
          detalle: 'La cantidad del movimiento no cuadra con el saldo',
        });
        roto = true;
        break;
      }
      prev = m;
    }
    if (roto) continue;
    const saldo = Number(movs[movs.length - 1].stock_resultante);
    if (Math.abs(saldo - stock) > 1e-3) {
      inconsistencias.push({
        insumo_id: ins.id,
        nombre: ins.nombre,
        stock_actual: stock,
        saldo_kardex: saldo,
        detalle: 'El stock actual no coincide con el último saldo del kardex',
      });
    }
  }
  return { ok: inconsistencias.length === 0, inconsistencias };
}

function resumenKardex(insumo, movimientos) {
  const movs = Array.isArray(movimientos) ? movimientos : [];
  let entradas = 0;
  let salidas = 0;
  for (const m of movs) {
    const q = Number(m.cantidad || 0);
    if (m.tipo_movimiento === 'salida') salidas += q;
    else entradas += q;
  }
  const stockInicial = movs.length ? Number(movs[0].stock_anterior || 0) : Number(insumo?.stock_actual || 0);
  const saldo = stockInicial + entradas - salidas;
  const stockActual = Number(insumo?.stock_actual || 0);
  const valor = stockActual * Number(insumo?.costo_promedio || 0);
  return {
    stock_inicial: stockInicial,
    entradas,
    salidas,
    saldo,
    stock_actual: stockActual,
    valor,
    unidad: insumo?.unidad_medida || '',
    cuadra: Math.abs(saldo - stockActual) <= 1e-3,
  };
}

module.exports = {
  registrarEntrada,
  registrarSalida,
  registrarAjusteSalida,
  registrarAjusteEntrada,
  yaAplicoVentaEnKardex,
  yaRevertioVentaEnKardex,
  aplicarSalidasVentaPedido,
  aplicarSalidasVentasEnTransaccion,
  revertirSalidasVentaPedido,
  registrarCompraInsumos,
  cerrarInventarioFisico,
  ejecutarTransformacion,
  anularTransformacion,
  auditarConsistenciaKardex,
  resumenKardex,
  etiquetaMovimiento,
  resolverAlmacenInsumos,
};
