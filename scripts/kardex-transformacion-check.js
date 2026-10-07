/**
 * Caso de producción: tomate/cebolla/otros → salsa, dos lotes, anulación y costo promedio.
 * Usa una base temporal. No toca restaurant.db.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbFile = path.join(os.tmpdir(), `fadey-kardex-${Date.now()}.db`);
process.env.DB_PATH = dbFile;

const { initDatabase, withTransaction, queryOne } = require('../server/database');
const kx = require('../server/services/kardexInventoryService');
const { convertirAUnidadBase } = require('../server/utils/insumoUnidadMedida');

function assertClose(actual, expected, msg) {
  if (Math.abs(Number(actual) - Number(expected)) > 1e-3) {
    throw new Error(`${msg}: esperado ${expected}, obtuvo ${actual}`);
  }
}

function stockDe(id) {
  return Number(queryOne('SELECT stock_actual AS s FROM insumos WHERE id = ?', [id])?.s || 0);
}

async function main() {
  await initDatabase();
  assertClose(convertirAUnidadBase(500, 'ml', 'L'), 0.5, '500 ml a L');
  assertClose(convertirAUnidadBase(7, 'kg', 'kg'), 7, 'kg a kg');

  const ids = {
    tomate: uuidv4(),
    cebolla: uuidv4(),
    otros: uuidv4(),
    salsa: uuidv4(),
    receta: uuidv4(),
    aceite: uuidv4(),
  };

  let op1;
  let op2;
  withTransaction((tx) => {
    const alta = (id, nombre, tipo, costo) => {
      tx.run(
        `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, costo_promedio, tipo, activo)
         VALUES (?, ?, 'kg', 0, ?, ?, 1)`,
        [id, nombre, costo, tipo]
      );
    };
    alta(ids.tomate, 'TEST Tomate', 'insumo', 2);
    alta(ids.cebolla, 'TEST Cebolla', 'insumo', 3);
    alta(ids.otros, 'TEST Otros', 'insumo', 1);
    alta(ids.salsa, 'TEST Salsa', 'transformable', 0);
    kx.registrarEntrada(tx, { insumoId: ids.tomate, cantidad: 50, costoUnitario: 2, referencia: 'inicial', referenciaId: 'ini', userId: 'test' });
    kx.registrarEntrada(tx, { insumoId: ids.cebolla, cantidad: 20, costoUnitario: 3, referencia: 'inicial', referenciaId: 'ini', userId: 'test' });
    kx.registrarEntrada(tx, { insumoId: ids.otros, cantidad: 10, costoUnitario: 1, referencia: 'inicial', referenciaId: 'ini', userId: 'test' });
    tx.run(
      `INSERT INTO recetas (id, nombre_plato, product_id, activo, insumo_resultado_id, rendimiento)
       VALUES (?, 'TEST Salsa', '', 1, ?, 10)`,
      [ids.receta, ids.salsa]
    );
    for (const [insumoId, cant] of [[ids.tomate, 7], [ids.cebolla, 2], [ids.otros, 1]]) {
      tx.run(
        `INSERT INTO receta_detalle (id, receta_id, insumo_id, cantidad_usada) VALUES (?, ?, ?, ?)`,
        [uuidv4(), ids.receta, insumoId, cant]
      );
    }
    op1 = kx.ejecutarTransformacion(tx, { recetaId: ids.receta, lotes: 1, userId: 'test', motivo: 'lote 1' });
    const movs = tx.queryAll(
      `SELECT referencia_id, tipo_movimiento, cantidad, id_insumo FROM kardex WHERE referencia = 'transformacion' AND referencia_id = ?`,
      [op1.id]
    );
    if (movs.length !== 4) throw new Error(`La transformación debe dejar 4 movimientos, dejó ${movs.length}`);
    if (new Set(movs.map((m) => m.referencia_id)).size !== 1) throw new Error('Los movimientos no comparten el id de transformación');
  });

  assertClose(stockDe(ids.tomate), 43, 'tomate tras 10 kg');
  assertClose(stockDe(ids.cebolla), 18, 'cebolla tras 10 kg');
  assertClose(stockDe(ids.otros), 9, 'otros tras 10 kg');
  assertClose(stockDe(ids.salsa), 10, 'salsa tras 10 kg');
  assertClose(op1.costo_unitario, 2.1, 'costo de producción');

  withTransaction((tx) => {
    op2 = kx.ejecutarTransformacion(tx, { recetaId: ids.receta, lotes: 2, userId: 'test', motivo: 'lote 2' });
  });
  assertClose(stockDe(ids.tomate), 29, 'tomate tras 20 kg');
  assertClose(stockDe(ids.cebolla), 14, 'cebolla tras 20 kg');
  assertClose(stockDe(ids.otros), 7, 'otros tras 20 kg');
  assertClose(stockDe(ids.salsa), 30, 'salsa tras 20 kg');

  const antes = stockDe(ids.tomate);
  let fallo = false;
  try {
    withTransaction((tx) => kx.ejecutarTransformacion(tx, { recetaId: ids.receta, lotes: 1000, userId: 'test' }));
  } catch (err) {
    fallo = /insuficiente/i.test(err.message);
  }
  if (!fallo) throw new Error('Una producción sin stock debió rechazarse');
  assertClose(stockDe(ids.tomate), antes, 'rollback de producción fallida');

  withTransaction((tx) => kx.anularTransformacion(tx, op2.id, 'test', 'prueba'));
  assertClose(stockDe(ids.tomate), 43, 'tomate tras anular');
  assertClose(stockDe(ids.cebolla), 18, 'cebolla tras anular');
  assertClose(stockDe(ids.salsa), 10, 'salsa tras anular');
  const originales = queryOne(
    `SELECT COUNT(*) AS n FROM kardex WHERE referencia = 'transformacion' AND referencia_id = ?`,
    [op2.id]
  );
  if (!Number(originales?.n)) throw new Error('La anulación no debe borrar el kardex original');

  withTransaction((tx) => {
    tx.run(
      `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, costo_promedio, tipo, activo)
       VALUES (?, 'TEST Aceite', 'L', 0, 0, 'insumo', 1)`,
      [ids.aceite]
    );
    kx.registrarEntrada(tx, { insumoId: ids.aceite, cantidad: 10, costoUnitario: 10, referencia: 'compra', referenciaId: 'c1', userId: 'test' });
    kx.registrarEntrada(tx, { insumoId: ids.aceite, cantidad: 20, costoUnitario: 14, referencia: 'compra', referenciaId: 'c2', userId: 'test' });
  });
  const aceite = queryOne('SELECT stock_actual, costo_promedio FROM insumos WHERE id = ?', [ids.aceite]);
  assertClose(aceite.stock_actual, 30, 'stock aceite');
  assertClose(aceite.costo_promedio, (10 * 10 + 20 * 14) / 30, 'costo promedio');

  const audit = kx.auditarConsistenciaKardex({
    queryAll: (sql, params) => {
      const { queryAll } = require('../server/database');
      return queryAll(sql, params);
    },
  });
  const propios = (audit.inconsistencias || []).filter((row) => String(row.nombre || '').startsWith('TEST '));
  if (propios.length) throw new Error(`Inconsistencia: ${propios.map((r) => r.detalle).join('; ')}`);

  const doble = {
    tomate: uuidv4(),
    salsa: uuidv4(),
    fab: uuidv4(),
    plato: uuidv4(),
    recetaPlato: uuidv4(),
    pedido: uuidv4(),
  };
  withTransaction((tx) => {
    tx.run(
      `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, costo_promedio, tipo, insumo_clase, activo)
       VALUES (?, 'TEST Tomate directo', 'kg', 0, 2, 'insumo', 'directo', 1)`,
      [doble.tomate]
    );
    tx.run(
      `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, costo_promedio, tipo, insumo_clase, activo)
       VALUES (?, 'TEST Salsa doble', 'L', 0, 0, 'insumo', 'doble', 1)`,
      [doble.salsa]
    );
    kx.registrarEntrada(tx, {
      insumoId: doble.tomate, cantidad: 2, costoUnitario: 2, referencia: 'compra', referenciaId: 'tomate', userId: 'test',
    });
    tx.run(
      `INSERT INTO recetas (id, nombre_plato, product_id, activo, insumo_resultado_id, rendimiento)
       VALUES (?, 'TEST Fabrica salsa', '', 1, ?, 0.5)`,
      [doble.fab, doble.salsa]
    );
    tx.run(
      `INSERT INTO receta_detalle (id, receta_id, insumo_id, cantidad_usada) VALUES (?, ?, ?, 1)`,
      [uuidv4(), doble.fab, doble.tomate]
    );
    kx.ejecutarTransformacion(tx, { recetaId: doble.fab, lotes: 1, userId: 'test', motivo: '1 kg tomate -> 500 ml' });
  });
  assertClose(stockDe(doble.tomate), 1, 'tomate tras fabricar 500 ml');
  assertClose(stockDe(doble.salsa), 0.5, 'salsa fabricada');

  withTransaction((tx) => {
    tx.run(`INSERT INTO products (id, name, price, process_type) VALUES (?, 'TEST Tallarin', 20, 'transformed')`, [doble.plato]);
    tx.run(
      `INSERT INTO recetas (id, nombre_plato, product_id, activo, insumo_resultado_id, rendimiento)
       VALUES (?, 'TEST Tallarin', ?, 1, '', 0)`,
      [doble.recetaPlato, doble.plato]
    );
    tx.run(
      `INSERT INTO receta_detalle (id, receta_id, insumo_id, cantidad_usada) VALUES (?, ?, ?, 0.1)`,
      [uuidv4(), doble.recetaPlato, doble.salsa]
    );
    tx.run(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal)
       VALUES (?, ?, ?, 'TEST Tallarin', 1, 20, 20)`,
      [uuidv4(), doble.pedido, doble.plato]
    );
    kx.aplicarSalidasVentaPedido(tx, doble.pedido, 'test');
  });
  assertClose(stockDe(doble.tomate), 1, 'la venta no vuelve a descontar tomate');
  assertClose(stockDe(doble.salsa), 0.4, 'la venta descuenta 100 ml de salsa');

  withTransaction((tx) => {
    kx.registrarEntrada(tx, {
      insumoId: doble.salsa, cantidad: 1, costoUnitario: 8, referencia: 'compra', referenciaId: 'sobre', userId: 'test',
    });
  });
  assertClose(stockDe(doble.salsa), 1.4, 'compra directa de salsa');
  assertClose(stockDe(doble.tomate), 1, 'comprar salsa no mueve el tomate');

  console.log('kardex-transformacion-check: ok');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try { fs.unlinkSync(dbFile); } catch (_) { /* temporal */ }
  });
