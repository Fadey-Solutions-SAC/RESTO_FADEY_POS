/**
 * API inventario kardex (insumos, recetas, compras, ajustes, inventario físico).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('../database');
const kx = require('../services/kardexInventoryService');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');
const { unlinkInsumoFromProducts } = require('../utils/productKardexInsumos');
const { emitInventoryUpdate, emitStaffDataUpdate } = require('../socketBroadcast');
const { resolvePurchaseDate } = require('../utils/inventoryPurchaseDate');
const { insumoEstaBajoMinimo } = require('../utils/insumoUnidadMedida');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));

/** U.M. (unidad, kg, L, …) sin números accidentales p. ej. "kg5". Por defecto: unidad. */
function sanitizeUnidadMasa(raw) {
  const s = String(raw || '')
    .replace(/[0-9]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
  if (!s || s === 'und' || s === 'u' || s === 'unidades' || s === 'unidad') return 'unidad';
  if (s === 'oz' || s === 'onz' || s === 'ounce' || s === 'onza') return 'onza';
  if (s === 'litro' || s === 'litros' || s === 'lt' || s === 'l') return 'L';
  if (s === 'kilogramo' || s === 'kilogramos' || s === 'kg') return 'kg';
  if (s === 'gramo' || s === 'gramos' || s === 'g') return 'g';
  if (s === 'mililitro' || s === 'mililitros' || s === 'ml') return 'ml';
  if (s === 'mg') return 'mg';
  if (s === 't' || s === 'tonelada' || s === 'toneladas') return 'onza';
  return 'unidad';
}

/** Área de costeo / almacén lógico: cocina vs bar (misma tabla `insumos`, kardex compartido por id). */
function normalizeInsumoArea(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'bar' ? 'bar' : 'cocina';
}

/** GET /insumos — ?area=cocina|bar filtra; sin parámetro devuelve todos (orden por área y nombre). */
router.get('/insumos', (req, res) => {
  try {
    const areaQ = String(req.query.area || '').trim().toLowerCase();
    let sql = 'SELECT * FROM insumos';
    const params = [];
    if (areaQ === 'cocina' || areaQ === 'bar') {
      sql += ' WHERE insumo_area = ?';
      params.push(areaQ);
    }
    sql += ' ORDER BY insumo_area ASC, nombre ASC';
    const rows = queryAll(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar insumos' });
  }
});

/** POST /insumos */
router.post('/insumos', (req, res) => {
  try {
    const {
      nombre,
      unidad_medida,
      stock_unidades,
      minimo_unidades,
      costo_promedio,
      precio_compra,
      activo,
      cantidad_inicial,
      stock_inicial_masa,
      stock_actual,
      stock_minimo,
      minimo_masa,
      minimo_kg,
    } = req.body || {};
    const n = normalizeCatalogDisplayName(nombre);
    if (!n) return res.status(400).json({ error: 'Nombre es requerido' });
    const area = normalizeInsumoArea(req.body?.insumo_area);
    const umed = sanitizeUnidadMasa(unidad_medida);
    const pc = costo_promedio != null ? Number(costo_promedio) : precio_compra != null ? Number(precio_compra) : 0;
    const costo = !Number.isFinite(pc) || pc < 0 ? 0 : pc;
    const id = uuidv4();
    const porUnidad = umed === 'unidad';
    let sa = Math.max(
      0,
      Number(
        cantidad_inicial != null
          ? cantidad_inicial
          : stock_inicial_masa != null
            ? stock_inicial_masa
            : stock_actual
      ) || 0
    );
    let su = Math.max(0, Number(stock_unidades) || 0);
    if (porUnidad) {
      const units = su > 0 ? su : sa;
      sa = units;
      su = units;
    }
    const mu = Math.max(0, Number(minimo_unidades) || 0);
    const smin = porUnidad
      ? 0
      : Math.max(
          0,
          Number(
            stock_minimo != null
              ? stock_minimo
              : minimo_masa != null
                ? minimo_masa
                : minimo_kg
          ) || 0
        );
    runSql(
      `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_unidades, minimo_unidades, kg_por_unidad, stock_minimo, costo_promedio, activo, insumo_area, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, n, umed, sa, su, mu, smin, costo, activo === false || activo === 0 ? 0 : 1, area]
    );
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || '',
      action: 'kardex.insumo.create',
      resourceType: 'insumo',
      resourceId: id,
      details: { nombre: n, insumo_area: area },
    });
    res.status(201).json(queryOne('SELECT * FROM insumos WHERE id = ?', [id]));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al crear insumo' });
  }
});

/** PUT /insumos/:id */
router.put('/insumos/:id', (req, res) => {
  try {
    const cur = queryOne('SELECT * FROM insumos WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Insumo no encontrado' });
    const {
      nombre,
      unidad_medida,
      stock_unidades,
      minimo_unidades,
      stock_minimo,
      costo_promedio,
      cantidad_inicial,
      stock_actual,
      activo,
      insumo_area,
    } = req.body || {};
    const umed = unidad_medida != null ? sanitizeUnidadMasa(unidad_medida) : sanitizeUnidadMasa(cur.unidad_medida);
    const porUnidad = umed === 'unidad';
    const qty = cantidad_inicial != null
      ? Math.max(0, Number(cantidad_inicial))
      : (stock_actual != null ? Math.max(0, Number(stock_actual)) : null);
    let suVal = stock_unidades != null ? Math.max(0, Number(stock_unidades)) : null;
    let saVal = qty;
    if (porUnidad) {
      const units = suVal != null ? suVal : qty;
      suVal = units;
      saVal = units;
    }
    runSql(
      `UPDATE insumos SET nombre = COALESCE(?, nombre), unidad_medida = COALESCE(?, unidad_medida),
       stock_unidades = COALESCE(?, stock_unidades), minimo_unidades = COALESCE(?, minimo_unidades),
       stock_minimo = COALESCE(?, stock_minimo), costo_promedio = COALESCE(?, costo_promedio),
       stock_actual = COALESCE(?, stock_actual),
       activo = COALESCE(?, activo),
       insumo_area = COALESCE(?, insumo_area),
       updated_at = datetime('now') WHERE id = ?`,
      [
        nombre != null ? normalizeCatalogDisplayName(nombre) : null,
        unidad_medida != null ? umed : null,
        suVal,
        minimo_unidades != null ? Math.max(0, Number(minimo_unidades)) : null,
        porUnidad ? 0 : (stock_minimo != null ? Math.max(0, Number(stock_minimo)) : null),
        costo_promedio != null ? Math.max(0, Number(costo_promedio)) : null,
        saVal,
        activo != null ? (activo ? 1 : 0) : null,
        insumo_area != null ? normalizeInsumoArea(insumo_area) : null,
        req.params.id,
      ]
    );
    res.json(queryOne('SELECT * FROM insumos WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar insumo' });
  }
});

/** DELETE /insumos/:id — elimina insumo y filas relacionadas (kardex, recetas, requerimientos, etc.) */
router.delete('/insumos/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id requerido' });
    const cur = queryOne('SELECT * FROM insumos WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ error: 'Insumo no encontrado' });
    withTransaction((tx) => {
      tx.run('DELETE FROM receta_detalle WHERE insumo_id = ?', [id]);
      tx.run('DELETE FROM kardex WHERE id_insumo = ?', [id]);
      tx.run('DELETE FROM inventario_fisico_detalle WHERE insumo_id = ?', [id]);
      tx.run(
        `DELETE FROM inventory_requirement_items WHERE insumo_id = ? OR (item_type = 'insumo' AND product_id = ?)`,
        [id, id]
      );
      tx.run('DELETE FROM inventory_expenses WHERE product_id = ?', [id]);
      unlinkInsumoFromProducts(tx, id);
      tx.run('DELETE FROM insumos WHERE id = ?', [id]);
    });
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || '',
      action: 'kardex.insumo.delete',
      resourceType: 'insumo',
      resourceId: id,
      details: { nombre: cur.nombre },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo eliminar el insumo' });
  }
});

/** GET /kardex/:insumoId — kardex valorizado por insumo */
router.get('/kardex/:insumoId', (req, res) => {
  try {
    const { from, to } = req.query;
    const insumo = queryOne('SELECT * FROM insumos WHERE id = ?', [req.params.insumoId]);
    if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });
    let sql = `SELECT * FROM kardex WHERE id_insumo = ?`;
    const p = [req.params.insumoId];
    if (from) {
      sql += ` AND date(fecha) >= date(?)`;
      p.push(from);
    }
    if (to) {
      sql += ` AND date(fecha) <= date(?)`;
      p.push(to);
    }
    sql += ` ORDER BY datetime(created_at) ASC`;
    const movs = queryAll(sql, p);
    const valorInv = Number(insumo.stock_actual || 0) * Number(insumo.costo_promedio || 0);
    res.json({
      insumo,
      movimientos: movs,
      valor_inventario: Number(valorInv.toFixed(4)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al leer kardex' });
  }
});

/** POST /compras */
router.post('/compras', (req, res) => {
  try {
    const { items, purchase_date } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items[] requerido: insumo_id, cantidad, costo_unitario' });
    }
    const purchaseDate = resolvePurchaseDate(purchase_date);
    const opId = withTransaction((tx) => {
      const id = kx.registrarCompraInsumos(tx, items, req.user.id);
      const wh = tx.queryOne(
        `SELECT id FROM warehouse_locations
         WHERE is_active = 1
           AND (linked_insumos = 1 OR LOWER(name) = LOWER('Almacen de insumos'))
         ORDER BY linked_insumos DESC
         LIMIT 1`
      );
      const warehouseId = wh?.id || '';
      for (const it of items) {
        const iid = String(it.insumo_id || '').trim();
        const cant = Number(it.cantidad);
        const cu = Number(it.costo_unitario);
        if (!iid || !(cant > 0) || Number.isNaN(cu) || cu < 0) continue;
        const totalCost = Math.round(cant * cu * 100) / 100;
        tx.run(
          `INSERT INTO inventory_expenses (id, requirement_id, product_id, warehouse_id, quantity, unit_cost, total_cost, notes, created_by, purchase_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, iid, warehouseId, cant, cu, totalCost, 'Compra kardex (insumo)', req.user.id, purchaseDate]
        );
      }
      return id;
    });
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || '',
      action: 'kardex.compra',
      resourceType: 'kardex_compra',
      resourceId: opId,
      details: { items: items.length },
    });
    emitInventoryUpdate({});
    emitStaffDataUpdate({ domain: 'finance_ops' });
    res.status(201).json({ ok: true, operacion_id: opId });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error en compra de insumos' });
  }
});

/** GET /recetas */
router.get('/recetas', (req, res) => {
  try {
    const rows = queryAll(
      `SELECT r.*, p.name as product_name
       FROM recetas r
       LEFT JOIN products p ON p.id = r.product_id
       ORDER BY r.nombre_plato ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar recetas' });
  }
});

/** POST /recetas */
router.post('/recetas', (req, res) => {
  try {
    const { nombre_plato, product_id, activo, detalles } = req.body || {};
    const n = String(nombre_plato || '').trim();
    if (!n) return res.status(400).json({ error: 'nombre_plato requerido' });
    if (!String(product_id || '').trim()) return res.status(400).json({ error: 'product_id requerido para vincular a un plato del menú' });
    const id = uuidv4();
    withTransaction((tx) => {
      tx.run(
        `INSERT INTO recetas (id, nombre_plato, product_id, activo) VALUES (?, ?, ?, ?)`,
        [id, n, String(product_id).trim(), activo === false ? 0 : 1]
      );
      if (Array.isArray(detalles)) {
        detalles.forEach((d) => {
          if (!d.insumo_id || d.cantidad_usada == null) return;
          tx.run(
            `INSERT INTO receta_detalle (id, receta_id, insumo_id, cantidad_usada) VALUES (?, ?, ?, ?)`,
            [uuidv4(), id, d.insumo_id, Number(d.cantidad_usada)]
          );
        });
      }
    });
    res.status(201).json(queryOne('SELECT * FROM recetas WHERE id = ?', [id]));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al crear receta' });
  }
});

/** GET /recetas/:id */
router.get('/recetas/:id', (req, res) => {
  try {
    const r = queryOne('SELECT * FROM recetas WHERE id = ?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Receta no encontrada' });
    const dets = queryAll(
      `SELECT rd.*, i.nombre as insumo_nombre, i.unidad_medida
       FROM receta_detalle rd
       JOIN insumos i ON i.id = rd.insumo_id
       WHERE rd.receta_id = ?`,
      [req.params.id]
    );
    res.json({ ...r, detalles: dets });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error' });
  }
});

/** PUT /recetas/:id */
router.put('/recetas/:id', (req, res) => {
  try {
    const cur = queryOne('SELECT * FROM recetas WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Receta no encontrada' });
    const { nombre_plato, product_id, activo, detalles } = req.body || {};
    withTransaction((tx) => {
      tx.run(
        `UPDATE recetas SET nombre_plato = COALESCE(?, nombre_plato), product_id = COALESCE(?, product_id), activo = COALESCE(?, activo) WHERE id = ?`,
        [
          nombre_plato != null ? String(nombre_plato).trim() : null,
          product_id != null ? String(product_id).trim() : null,
          activo != null ? (activo ? 1 : 0) : null,
          req.params.id,
        ]
      );
      if (Array.isArray(detalles)) {
        tx.run('DELETE FROM receta_detalle WHERE receta_id = ?', [req.params.id]);
        detalles.forEach((d) => {
          if (!d.insumo_id || d.cantidad_usada == null) return;
          tx.run(
            `INSERT INTO receta_detalle (id, receta_id, insumo_id, cantidad_usada) VALUES (?, ?, ?, ?)`,
            [uuidv4(), req.params.id, d.insumo_id, Number(d.cantidad_usada)]
          );
        });
      }
    });
    res.json(queryOne('SELECT * FROM recetas WHERE id = ?', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar receta' });
  }
});

/** POST /inventario-fisico (crea cabecera + detalle) */
router.post('/inventario-fisico', (req, res) => {
  try {
    const { detalles } = req.body || {};
    if (!Array.isArray(detalles) || !detalles.length) {
      return res.status(400).json({ error: 'detalles[] requerido: insumo_id, stock_real' });
    }
    const id = uuidv4();
    withTransaction((tx) => {
      tx.run(
        `INSERT INTO inventario_fisico (id, fecha, estado, created_by) VALUES (?, datetime('now'), 'pendiente', ?)`,
        [id, req.user.id]
      );
      detalles.forEach((d) => {
        if (!d.insumo_id) return;
        const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [d.insumo_id]);
        if (!ins) throw new Error(`Insumo ${d.insumo_id} no encontrado`);
        const sys = Number(ins.stock_actual || 0);
        const real = Number(d.stock_real);
        if (Number.isNaN(real) || real < 0) throw new Error('stock_real inválido');
        const dif = real - sys;
        tx.run(
          `INSERT INTO inventario_fisico_detalle (id, inventario_id, insumo_id, stock_sistema, stock_real, diferencia) VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), id, d.insumo_id, sys, real, dif]
        );
      });
    });
    const meta = queryOne(
      `SELECT
         (SELECT COUNT(*) FROM inventario_fisico f2
          WHERE datetime(f2.created_at) < datetime(f1.created_at)
            OR (datetime(f2.created_at) = datetime(f1.created_at) AND f2.id < f1.id)
         ) + 1 AS cuadre_num
       FROM inventario_fisico f1 WHERE f1.id = ?`,
      [id]
    );
    res.status(201).json({ id, estado: 'pendiente', cuadre_num: Number(meta?.cuadre_num) || 1 });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al registrar inventario físico' });
  }
});

/** POST /inventario-fisico/:id/cerrar */
router.post('/inventario-fisico/:id/cerrar', (req, res) => {
  try {
    withTransaction((tx) => kx.cerrarInventarioFisico(tx, req.params.id, req.user.id));
    logAudit({
      actorUserId: req.user.id,
      action: 'kardex.inventario_fisico.cerrar',
      resourceId: req.params.id,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error al cerrar inventario' });
  }
});

/** GET /inventario-fisico (con número de cuadre y resumen por diferencias) */
router.get('/inventario-fisico', (req, res) => {
  try {
    const rows = queryAll(
      `SELECT
        f.id,
        f.fecha,
        f.estado,
        f.created_at,
        f.created_by,
        (
          SELECT COUNT(*) FROM inventario_fisico f2
          WHERE datetime(f2.created_at) < datetime(f.created_at)
            OR (datetime(f2.created_at) = datetime(f.created_at) AND f2.id < f.id)
        ) + 1 AS cuadre_num,
        COALESCE(d.cnt_falta, 0) AS resumen_falta,
        COALESCE(d.cnt_bien, 0) AS resumen_bien,
        COALESCE(d.cnt_sobra, 0) AS resumen_sobra
      FROM inventario_fisico f
      LEFT JOIN (
        SELECT inventario_id,
          SUM(CASE WHEN COALESCE(diferencia, 0) < -1e-6 THEN 1 ELSE 0 END) AS cnt_falta,
          SUM(CASE WHEN ABS(COALESCE(diferencia, 0)) <= 1e-6 THEN 1 ELSE 0 END) AS cnt_bien,
          SUM(CASE WHEN COALESCE(diferencia, 0) > 1e-6 THEN 1 ELSE 0 END) AS cnt_sobra
        FROM inventario_fisico_detalle
        GROUP BY inventario_id
      ) d ON d.inventario_id = f.id
      ORDER BY datetime(f.created_at) DESC
      LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /ajustes — merma o entrada manual (sin compra) */
router.post('/ajustes', (req, res) => {
  try {
    const { insumo_id, cantidad, tipo, referencia } = req.body || {};
    const t = String(tipo || 'salida').toLowerCase();
    if (!insumo_id) return res.status(400).json({ error: 'insumo_id requerido' });
    const c = Number(cantidad);
    if (c <= 0) return res.status(400).json({ error: 'cantidad > 0 requerida' });
    const ref = String(referencia || (t === 'entrada' ? 'ajuste' : 'merma'));
    const opId = uuidv4();
    withTransaction((tx) => {
      if (t === 'entrada') {
        const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [insumo_id]);
        if (!ins) throw new Error('Insumo no encontrado');
        kx.registrarAjusteEntrada(tx, {
          insumoId: insumo_id,
          cantidad: c,
          referencia: ref,
          referenciaId: opId,
          userId: req.user.id,
        });
      } else {
        kx.registrarAjusteSalida(tx, {
          insumoId: insumo_id,
          cantidad: c,
          referencia: ref,
          referenciaId: opId,
          userId: req.user.id,
        });
      }
    });
    res.status(201).json({ ok: true, operacion_id: opId });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error en ajuste' });
  }
});

/** GET /dashboard — resumen y alertas stock mínimo (por área cocina / bar). */
router.get('/dashboard', (req, res) => {
  try {
    const insumos = queryAll('SELECT * FROM insumos WHERE activo = 1 ORDER BY insumo_area ASC, nombre ASC');
    const bajo = insumos.filter((i) => insumoEstaBajoMinimo(i));
    const valor = insumos.reduce(
      (s, i) => s + Number(i.stock_actual || 0) * Number(i.costo_promedio || 0),
      0
    );
    const byArea = (area) => {
      const list = insumos.filter((i) => normalizeInsumoArea(i.insumo_area) === area);
      const val = list.reduce((s, i) => s + Number(i.stock_actual || 0) * Number(i.costo_promedio || 0), 0);
      const b = bajo.filter((i) => normalizeInsumoArea(i.insumo_area) === area);
      return {
        total_insumos: list.length,
        valor_inventario: Number(val.toFixed(2)),
        bajo_minimo_count: b.length,
      };
    };
    res.json({
      total_insumos: insumos.length,
      valor_inventario_total: Number(valor.toFixed(2)),
      insumos_bajo_minimo: bajo,
      por_area: {
        cocina: byArea('cocina'),
        bar: byArea('bar'),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /export/kardex/:insumoId — CSV simple */
router.get('/export/kardex/:insumoId', (req, res) => {
  try {
    const ins = queryOne('SELECT * FROM insumos WHERE id = ?', [req.params.insumoId]);
    if (!ins) return res.status(404).json({ error: 'Insumo no encontrado' });
    const movs = queryAll(
      `SELECT * FROM kardex WHERE id_insumo = ? ORDER BY datetime(created_at) ASC`,
      [req.params.insumoId]
    );
    const kpu = Number(ins.kg_por_unidad || 0);
    const um = String(ins.unidad_medida || '').replace(/[0-9]/g, '').trim() || 'kg';
    const header = [
      'fecha',
      'tipo',
      `cantidad_${um}`,
      'cantidad_u',
      'costo_unitario',
      'costo_total',
      `stock_ant_${um}`,
      'stock_ant_u',
      `stock_res_${um}`,
      'stock_res_u',
    ];
    const lines = [header.join(',')];
    const totals = {
      entrada: { qtyKg: 0, qtyU: 0, cost: 0 },
      salida: { qtyKg: 0, qtyU: 0, cost: 0 },
    };
    movs.forEach((m) => {
      const qtyKg = Number(m.cantidad || 0);
      const qtyU = kpu > 1e-12 ? (qtyKg / kpu) : null;
      const stockAntKg = Number(m.stock_anterior || 0);
      const stockResKg = Number(m.stock_resultante || 0);
      const stockAntU = kpu > 1e-12 ? (stockAntKg / kpu) : null;
      const stockResU = kpu > 1e-12 ? (stockResKg / kpu) : null;
      const t = String(m.tipo_movimiento || '').toLowerCase();
      if (t === 'entrada' || t === 'salida') {
        totals[t].qtyKg += qtyKg;
        totals[t].qtyU += qtyU != null ? qtyU : 0;
        totals[t].cost += Number(m.costo_total || 0);
      }
      lines.push(
        [
          m.fecha,
          t === 'entrada' ? 'Entrada' : t === 'salida' ? 'Salida' : 'Ajuste',
          qtyKg,
          qtyU == null ? '—' : qtyU,
          m.costo_unitario,
          m.costo_total,
          stockAntKg,
          stockAntU == null ? '—' : stockAntU,
          stockResKg,
          stockResU == null ? '—' : stockResU,
        ]
          .map((x) => `"${String(x).replace(/"/g, '""')}"`)
          .join(',')
      );
    });
    lines.push('');
    lines.push(`"RESUMEN","","","","","","","","",""`);
    lines.push(
      [
        'Total Entradas',
        '',
        totals.entrada.qtyKg,
        kpu > 1e-12 ? totals.entrada.qtyU : '—',
        '',
        totals.entrada.cost,
        '',
        '',
        '',
        '',
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(',')
    );
    lines.push(
      [
        'Total Salidas',
        '',
        totals.salida.qtyKg,
        kpu > 1e-12 ? totals.salida.qtyU : '—',
        '',
        totals.salida.cost,
        '',
        '',
        '',
        '',
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(',')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kardex-${ins.nombre.slice(0, 40).replace(/[^\w]/g, '_')}.csv"`);
    res.send('\uFEFF' + lines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
