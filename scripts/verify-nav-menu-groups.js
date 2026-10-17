#!/usr/bin/env node
/**
 * Verifica agrupación visual del menú y orden de áreas de producción.
 * Ejecutar: node scripts/verify-nav-menu-groups.js
 */
const assert = require('assert');

async function main() {
  const { groupNavLinks, sortProductionAreasForNav, NAV_MENU_GROUPS } = await import(
    '../client/src/utils/navMenuGroups.js'
  );
  const fs = require('fs');
  const path = require('path');
  const accessSrc = fs.readFileSync(
    path.join(__dirname, '../client/src/utils/staffModuleAccess.js'),
    'utf8',
  );
  const block = accessSrc.slice(
    accessSrc.indexOf('export const ADMIN_MODULE_PATHS'),
    accessSrc.indexOf('export const PRIMARY_MODULE_BY_ROLE'),
  );
  const ids = [...block.matchAll(/moduleId: '([^']+)'/g)].map((m) => m[1]);
  const expected = [
    'escritorio', 'caja', 'mesas', 'produccion', 'cocina', 'bar', 'delivery',
    'reservas', 'auto_pedido', 'ventas', 'clientes', 'fidelizacion', 'creditos', 'ofertas',
    'productos', 'almacen', 'indicadores', 'informes',
    'mi_restaurant', 'tiempo_trabajado', 'configuracion',
  ];
  assert.deepStrictEqual(ids, expected, 'ADMIN_MODULE_PATHS debe conservar todos los módulos y el orden visual');
  assert.ok(block.includes("path: '/admin/caja'"));
  assert.ok(block.includes("path: '/admin/productos'"));
  assert.ok(block.includes("path: '/admin/almacen'"));
  assert.ok(block.includes("path: '/admin/mi-restaurant'"));

  const grouped = groupNavLinks(expected.map((moduleId) => ({
    to: `/${moduleId}`,
    moduleId,
  })));
  assert.deepStrictEqual(grouped.map((g) => g.id), NAV_MENU_GROUPS.map((g) => g.id));
  assert.strictEqual(grouped.find((g) => g.id === 'inicio').items[0].moduleId, 'escritorio');
  assert.deepStrictEqual(
    grouped.find((g) => g.id === 'operacion').items.map((i) => i.moduleId),
    ['caja', 'mesas', 'produccion', 'cocina', 'bar', 'delivery', 'reservas', 'auto_pedido'],
  );
  assert.deepStrictEqual(
    grouped.find((g) => g.id === 'comercial').items.map((i) => i.moduleId),
    ['ventas', 'clientes', 'fidelizacion', 'creditos', 'ofertas'],
  );
  assert.deepStrictEqual(
    grouped.find((g) => g.id === 'catalogo').items.map((i) => i.moduleId),
    ['productos'],
  );
  assert.deepStrictEqual(
    grouped.find((g) => g.id === 'control').items.map((i) => i.moduleId),
    ['almacen', 'indicadores', 'informes'],
  );
  assert.deepStrictEqual(
    grouped.find((g) => g.id === 'administracion').items.map((i) => i.moduleId),
    ['mi_restaurant', 'tiempo_trabajado', 'configuracion'],
  );

  const cashierOnly = groupNavLinks([
    { to: '/admin/caja', moduleId: 'caja' },
  ]);
  assert.strictEqual(cashierOnly.length, 1);
  assert.strictEqual(cashierOnly[0].id, 'operacion');

  const sorted = sortProductionAreasForNav([
    { id: 'parrilla', name: 'Parrilla' },
    { id: 'cocina', name: 'Cocina' },
    { id: 'horno', name: 'Horno' },
    { id: 'bar', name: 'Bar' },
  ]);
  assert.deepStrictEqual(sorted.map((a) => a.id), ['cocina', 'bar', 'parrilla', 'horno']);

  const extrasCreatedOrder = sortProductionAreasForNav([
    { id: 'cocina', name: 'Cocina' },
    { id: 'bar', name: 'Bar' },
    { id: 'zumo', name: 'Zumo' },
    { id: 'alpha', name: 'Alpha' },
  ]);
  assert.deepStrictEqual(
    extrasCreatedOrder.map((a) => a.id),
    ['cocina', 'bar', 'zumo', 'alpha'],
    'áreas extra deben seguir el orden de creación, no alfabético',
  );

  console.log('verify-nav-menu-groups: ok');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
