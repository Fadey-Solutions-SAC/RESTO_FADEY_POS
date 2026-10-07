/**
 * API inventario kardex (insumos, recetas, compras, ajustes, inventario físico).
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { queryAll, queryOne, runSql, withTransaction, logAudit } = require('../database');
const kx = require('../services/kardexInventoryService');
const { normalizeCatalogDisplayName } = require('../utils/catalogNameFormat');
const { unlinkInsumoFromProducts, clearProductKardexLines } = require('../utils/productKardexInsumos');
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

function normalizeInsumoTipo(raw) {
  return String(raw || '').trim().toLowerCase() === 'transformable' ? 'transformable' : 'insumo';
}

function normalizeInsumoClase(raw) {
  return String(raw || '').trim().toLowerCase() === 'doble' ? 'doble' : 'directo';
}

function validarFabricacionDoble(resultadoId, detalles) {
  const resultado = queryOne('SELECT id, nombre, insumo_clase, tipo FROM insumos WHERE id = ?', [resultadoId]);
  if (!resultado) throw new Error('El insumo que se fabrica no existe');
  const esDoble = normalizeInsumoClase(resultado.insumo_clase) === 'doble' || String(resultado.tipo || '') === 'transformable';
  if (!esDoble) {
    throw new Error('La fabricación se vincula a un insumo doble, por ejemplo salsa de tomate');
  }
  for (const d of detalles || []) {
    const iid = String(d?.insumo_id || '').trim();
    if (!iid) continue;
    if (iid === String(resultadoId)) throw new Error('El insumo doble no puede ser ingrediente de sí mismo');
    const ing = queryOne('SELECT nombre, insumo_clase FROM insumos WHERE id = ?', [iid]);
    if (!ing) throw new Error('Hay un ingrediente que no existe');
    if (normalizeInsumoClase(ing.insumo_clase) === 'doble') {
      throw new Error(`«${ing.nombre}» es doble. Para fabricar usa insumos directos, como el tomate.`);
    }
  }
}

function requestIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.ip || '');
}

/** GET /insumos — ?area=cocina|bar filtra; sin parámetro devuelve todos (orden por área y nombre). */
router.get('/insumos', (req, res) => {
  try {
    const areaQ = String(req.query.area || '').trim().toLowerCase();
    let sql = `SELECT i.*,
      (SELECT k.fecha FROM kardex k WHERE k.id_insumo = i.id ORDER BY datetime(k.created_at) DESC LIMIT 1) AS ultimo_movimiento,
      (SELECT k.referencia FROM kardex k WHERE k.id_insumo = i.id ORDER BY datetime(k.created_at) DESC LIMIT 1) AS ultimo_movimiento_ref,
      (SELECT t.created_at FROM transformaciones t
        WHERE t.insumo_resultado_id = i.id AND t.estado = 'confirmada'
        ORDER BY datetime(t.created_at) DESC LIMIT 1) AS ultima_produccion
      FROM insumos i`;
    const params = [];
    if (areaQ === 'cocina' || areaQ === 'bar') {
      sql += ' WHERE i.insumo_area = ?';
      params.push(areaQ);
    }
    sql += ' ORDER BY i.insumo_area ASC, i.nombre ASC';
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
    const smax = Math.max(0, Number(req.body?.stock_maximo) || 0);
    const tipo = normalizeInsumoTipo(req.body?.tipo);
    const clase = normalizeInsumoClase(req.body?.insumo_clase);
    const ip = requestIp(req);
    withTransaction((tx) => {
      tx.run(
        `INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_unidades, minimo_unidades, kg_por_unidad, stock_minimo, stock_maximo, costo_promedio, activo, insumo_area, tipo, insumo_clase, created_at, updated_at)
         VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [id, n, umed, mu, smin, smax, costo, activo === false || activo === 0 ? 0 : 1, area, tipo, clase]
      );
      if (sa > 0) {
        kx.registrarEntrada(tx, {
          insumoId: id,
          cantidad: sa,
          costoUnitario: costo,
          referencia: 'inicial',
          referenciaId: id,
          userId: req.user.id,
          unidadesIngreso: porUnidad ? sa : (su > 0 ? su : undefined),
          motivo: 'Inventario inicial',
          ip,
        });
      }
    });
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
    const tipo = req.body?.tipo != null ? normalizeInsumoTipo(req.body.tipo) : null;
    const smax = req.body?.stock_maximo != null ? Math.max(0, Number(req.body.stock_maximo) || 0) : null;
    const motivoStock = String(req.body?.motivo || 'Edición de ficha de insumo').trim() || 'Edición de ficha de insumo';
    withTransaction((tx) => {
      tx.run(
        `UPDATE insumos SET nombre = COALESCE(?, nombre), unidad_medida = COALESCE(?, unidad_medida),
         minimo_unidades = COALESCE(?, minimo_unidades),
         stock_minimo = COALESCE(?, stock_minimo),
         stock_maximo = COALESCE(?, stock_maximo),
         costo_promedio = COALESCE(?, costo_promedio),
         activo = COALESCE(?, activo),
         insumo_area = COALESCE(?, insumo_area),
         tipo = COALESCE(?, tipo),
         insumo_clase = COALESCE(?, insumo_clase),
         updated_at = datetime('now') WHERE id = ?`,
        [
          nombre != null ? normalizeCatalogDisplayName(nombre) : null,
          unidad_medida != null ? umed : null,
          minimo_unidades != null ? Math.max(0, Number(minimo_unidades)) : null,
          porUnidad ? 0 : (stock_minimo != null ? Math.max(0, Number(stock_minimo)) : null),
          smax,
          costo_promedio != null ? Math.max(0, Number(costo_promedio)) : null,
          activo != null ? (activo ? 1 : 0) : null,
          insumo_area != null ? normalizeInsumoArea(insumo_area) : null,
          tipo,
          req.body?.insumo_clase != null ? normalizeInsumoClase(req.body.insumo_clase) : null,
          req.params.id,
        ]
      );
      if (saVal != null && Math.abs(saVal - Number(cur.stock_actual || 0)) > 1e-6) {
        const diff = saVal - Number(cur.stock_actual || 0);
        const comun = {
          insumoId: req.params.id,
          referencia: 'ajuste',
          referenciaId: req.params.id,
          userId: req.user.id,
          motivo: motivoStock,
          ip: requestIp(req),
        };
        if (diff > 0) kx.registrarAjusteEntrada(tx, { ...comun, cantidad: diff });
        else kx.registrarAjusteSalida(tx, { ...comun, cantidad: -diff });
      }
    });
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
    let sql = `SELECT k.*, u.full_name AS usuario_nombre
      FROM kardex k
      LEFT JOIN users u ON u.id = k.created_by
      WHERE k.id_insumo = ?`;
    const p = [req.params.insumoId];
    if (from) {
      sql += ` AND date(k.fecha) >= date(?)`;
      p.push(from);
    }
    if (to) {
      sql += ` AND date(k.fecha) <= date(?)`;
      p.push(to);
    }
    const ref = String(req.query.movimiento || '').trim().toLowerCase();
    if (ref && ref !== 'todos') {
      sql += ` AND lower(k.referencia) = ?`;
      p.push(ref);
    }
    sql += ` ORDER BY datetime(k.created_at) ASC`;
    const movs = queryAll(sql, p).map((m) => ({
      ...m,
      movimiento_label: kx.etiquetaMovimiento(m.referencia, m.tipo_movimiento),
    }));
    const last = queryOne(
      `SELECT stock_resultante FROM kardex WHERE id_insumo = ? ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 1`,
      [req.params.insumoId]
    );
    const resumen = kx.resumenKardex(insumo, movs);
    const stock = Number(insumo.stock_actual || 0);
    resumen.cuadra = last
      ? Math.abs(Number(last.stock_resultante) - stock) <= 1e-3
      : Math.abs(stock) <= 1e-3;
    const almacen = kx.resolverAlmacenInsumos({ queryOne });
    res.json({
      insumo,
      movimientos: movs,
      resumen,
      almacen,
      valor_inventario: Number(resumen.valor.toFixed(4)),
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
    const productId = String(req.query.product_id || '').trim();
    const rows = queryAll(
      `SELECT r.*, p.name as product_name, ir.nombre AS resultado_nombre,
              (SELECT COUNT(*) FROM receta_detalle rd WHERE rd.receta_id = r.id) AS insumos_count
       FROM recetas r
       LEFT JOIN products p ON p.id = r.product_id
       LEFT JOIN insumos ir ON ir.id = r.insumo_resultado_id
       ${productId ? 'WHERE r.product_id = ?' : ''}
       ORDER BY r.nombre_plato ASC`,
      productId ? [productId] : [],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar recetas' });
  }
});

/** POST /recetas */
router.post('/recetas', (req, res) => {
  try {
    const { nombre_plato, product_id, activo, detalles, insumo_resultado_id, rendimiento } = req.body || {};
    const n = String(nombre_plato || '').trim();
    if (!n) return res.status(400).json({ error: 'nombre_plato requerido' });
    const pid = String(product_id || '').trim();
    const resultadoId = String(insumo_resultado_id || '').trim();
    const rend = Number(rendimiento || 0);
    const esProduccion = Boolean(resultadoId);
    if (esProduccion) {
      if (!(rend > 0)) return res.status(400).json({ error: 'Indica cuánto rinde un lote del transformable' });
      if (pid) {
        return res.status(400).json({
          error: 'Una receta de producción no se vincula a un plato. Así la venta no vuelve a descontar los ingredientes.',
        });
      }
    } else if (!pid) {
      return res.status(400).json({ error: 'product_id requerido para vincular a un plato del menú' });
    }
    if (esProduccion) validarFabricacionDoble(resultadoId, detalles);
    const existing = pid
      ? queryOne('SELECT id FROM recetas WHERE product_id = ? ORDER BY activo DESC, created_at ASC LIMIT 1', [pid])
      : queryOne(
        `SELECT id FROM recetas WHERE insumo_resultado_id = ? AND TRIM(IFNULL(product_id, '')) = '' ORDER BY created_at ASC LIMIT 1`,
        [resultadoId],
      );
    const id = existing?.id || uuidv4();
    withTransaction((tx) => {
      if (existing) {
        tx.run(
          'UPDATE recetas SET nombre_plato = ?, activo = ?, insumo_resultado_id = ?, rendimiento = ? WHERE id = ?',
          [n, activo === false ? 0 : 1, resultadoId, esProduccion ? rend : 0, id]
        );
        tx.run('DELETE FROM receta_detalle WHERE receta_id = ?', [id]);
      } else {
        tx.run(
          `INSERT INTO recetas (id, nombre_plato, product_id, activo, insumo_resultado_id, rendimiento) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, n, pid, activo === false ? 0 : 1, resultadoId, esProduccion ? rend : 0]
        );
      }
      if (pid) clearProductKardexLines(tx, pid);
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
    res.status(existing ? 200 : 201).json(queryOne('SELECT * FROM recetas WHERE id = ?', [id]));
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
    const { nombre_plato, product_id, activo, detalles, insumo_resultado_id, rendimiento } = req.body || {};
    const nextPid = product_id != null ? String(product_id).trim() : String(cur.product_id || '').trim();
    const nextResultado = insumo_resultado_id != null
      ? String(insumo_resultado_id).trim()
      : String(cur.insumo_resultado_id || '').trim();
    const nextRend = rendimiento != null ? Number(rendimiento) : Number(cur.rendimiento || 0);
    if (nextResultado && nextPid) {
      return res.status(400).json({
        error: 'Una receta de producción no se vincula a un plato. Así la venta no vuelve a descontar los ingredientes.',
      });
    }
    if (nextResultado && !(nextRend > 0)) {
      return res.status(400).json({ error: 'Indica cuánto rinde un lote del insumo doble' });
    }
    if (nextResultado) validarFabricacionDoble(nextResultado, Array.isArray(detalles) ? detalles : []);
    withTransaction((tx) => {
      tx.run(
        `UPDATE recetas SET nombre_plato = COALESCE(?, nombre_plato), product_id = ?, activo = COALESCE(?, activo),
         insumo_resultado_id = ?, rendimiento = ? WHERE id = ?`,
        [
          nombre_plato != null ? String(nombre_plato).trim() : null,
          nextPid,
          activo != null ? (activo ? 1 : 0) : null,
          nextResultado,
          nextResultado ? nextRend : 0,
          req.params.id,
        ]
      );
      if (nextPid) clearProductKardexLines(tx, nextPid);
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

/** DELETE /recetas/:id */
router.delete('/recetas/:id', (req, res) => {
  try {
    const cur = queryOne('SELECT id FROM recetas WHERE id = ?', [req.params.id]);
    if (!cur) return res.status(404).json({ error: 'Receta no encontrada' });
    withTransaction((tx) => {
      tx.run('DELETE FROM receta_detalle WHERE receta_id = ?', [req.params.id]);
      tx.run('DELETE FROM recetas WHERE id = ?', [req.params.id]);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al eliminar receta' });
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
    const { insumo_id, cantidad, tipo, referencia, motivo } = req.body || {};
    const t = String(tipo || 'salida').toLowerCase();
    if (!insumo_id) return res.status(400).json({ error: 'insumo_id requerido' });
    const c = Number(cantidad);
    if (c <= 0) return res.status(400).json({ error: 'cantidad > 0 requerida' });
    const nota = String(motivo || '').trim();
    if (!nota) return res.status(400).json({ error: 'El ajuste o la merma necesitan un motivo' });
    const ref = String(referencia || (t === 'entrada' ? 'ajuste' : 'merma'));
    const opId = uuidv4();
    withTransaction((tx) => {
      const comun = {
        insumoId: insumo_id,
        cantidad: c,
        referencia: ref,
        referenciaId: opId,
        userId: req.user.id,
        motivo: nota,
        ip: requestIp(req),
      };
      if (t === 'entrada') {
        const ins = tx.queryOne('SELECT * FROM insumos WHERE id = ?', [insumo_id]);
        if (!ins) throw new Error('Insumo no encontrado');
        kx.registrarAjusteEntrada(tx, comun);
      } else {
        kx.registrarAjusteSalida(tx, comun);
      }
    });
    res.status(201).json({ ok: true, operacion_id: opId });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error en ajuste' });
  }
});

/** POST /transformaciones — produce un transformable y mueve el kardex de ingredientes y resultado. */
router.post('/transformaciones', (req, res) => {
  try {
    const { receta_id, lotes, motivo } = req.body || {};
    if (!receta_id) return res.status(400).json({ error: 'receta_id requerido' });
    const result = withTransaction((tx) => kx.ejecutarTransformacion(tx, {
      recetaId: receta_id,
      lotes,
      userId: req.user.id,
      motivo,
      ip: requestIp(req),
    }));
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || '',
      action: 'kardex.transformacion',
      resourceType: 'transformacion',
      resourceId: result.id,
      details: result,
    });
    emitInventoryUpdate({});
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo producir' });
  }
});

/** POST /transformaciones/:id/anular — movimientos inversos, sin borrar el kardex. */
router.post('/transformaciones/:id/anular', (req, res) => {
  try {
    const motivo = String(req.body?.motivo || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Indica el motivo de la anulación' });
    const result = withTransaction((tx) => kx.anularTransformacion(
      tx,
      req.params.id,
      req.user.id,
      motivo,
      requestIp(req),
    ));
    logAudit({
      actorUserId: req.user.id,
      actorName: req.user.full_name || '',
      action: 'kardex.transformacion.anular',
      resourceType: 'transformacion',
      resourceId: req.params.id,
      details: result,
    });
    emitInventoryUpdate({});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo anular' });
  }
});

/** GET /consistencia — stock vs último saldo del kardex. No corrige diferencias. */
router.get('/consistencia', (req, res) => {
  try {
    const report = kx.auditarConsistenciaKardex({ queryAll });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo revisar la consistencia' });
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
