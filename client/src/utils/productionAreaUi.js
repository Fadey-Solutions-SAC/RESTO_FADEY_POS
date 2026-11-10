import { createElement } from 'react';
import {
  MdBakeryDining,
  MdBlender,
  MdBreakfastDining,
  MdCoffee,
  MdDinnerDining,
  MdFastfood,
  MdIcecream,
  MdKitchen,
  MdLiquor,
  MdLocalBar,
  MdLocalFireDepartment,
  MdLocalPizza,
  MdOutdoorGrill,
  MdRamenDining,
  MdRestaurant,
  MdSetMeal,
  MdSoupKitchen,
  MdWineBar,
} from 'react-icons/md';

/** Horno de pizza de cúpula (el set Material no trae este símbolo). */
export function PizzaDomeOvenIcon({ className = '', size, ...props }) {
  const dim = size || '1em';
  return createElement(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: dim,
      height: dim,
      className,
      fill: 'currentColor',
      'aria-hidden': 'true',
      focusable: 'false',
      ...props,
    },
    createElement('path', { d: 'M3.2 15.2C3.6 9.6 7.4 6 12 6s8.4 3.6 8.8 9.2H3.2z' }),
    createElement('path', { d: 'M2.4 16.1h19.2v1.15c0 1.15-.9 2.05-2.05 2.05H4.45c-1.15 0-2.05-.9-2.05-2.05V16.1z' }),
    createElement('path', { d: 'M9.1 15.15h5.8V18.4H9.1z', opacity: '0.35' }),
    createElement('circle', { cx: '8.2', cy: '11.3', r: '0.7', opacity: '0.45' }),
    createElement('circle', { cx: '12', cy: '10.2', r: '0.7', opacity: '0.45' }),
    createElement('circle', { cx: '15.8', cy: '11.3', r: '0.7', opacity: '0.45' }),
  );
}

/** Debe coincidir con `PRODUCTION_AREA_COLORS` en server/services/productionAreasService.js. */
export const PRODUCTION_AREA_SKINS = {
  orange: { card: 'border-orange-100 bg-orange-50', icon: 'bg-white text-orange-500', title: 'text-orange-950', value: 'text-orange-950', sub: 'text-orange-900/80', btn: 'bg-orange-500 hover:bg-orange-600' },
  violet: { card: 'border-violet-100 bg-violet-50', icon: 'bg-white text-violet-600', title: 'text-violet-900', value: 'text-violet-950', sub: 'text-violet-800/80', btn: 'bg-violet-600 hover:bg-violet-700' },
  rose: { card: 'border-rose-100 bg-rose-50', icon: 'bg-white text-rose-600', title: 'text-rose-950', value: 'text-rose-950', sub: 'text-rose-800/80', btn: 'bg-rose-600 hover:bg-rose-700' },
  amber: { card: 'border-amber-100 bg-amber-50', icon: 'bg-white text-amber-600', title: 'text-amber-950', value: 'text-amber-950', sub: 'text-amber-800/80', btn: 'bg-amber-600 hover:bg-amber-700' },
  indigo: { card: 'border-indigo-100 bg-indigo-50', icon: 'bg-white text-indigo-600', title: 'text-indigo-950', value: 'text-indigo-950', sub: 'text-indigo-800/80', btn: 'bg-indigo-600 hover:bg-indigo-700' },
  fuchsia: { card: 'border-fuchsia-100 bg-fuchsia-50', icon: 'bg-white text-fuchsia-600', title: 'text-fuchsia-950', value: 'text-fuchsia-950', sub: 'text-fuchsia-800/80', btn: 'bg-fuchsia-600 hover:bg-fuchsia-700' },
  lime: { card: 'border-lime-100 bg-lime-50', icon: 'bg-white text-lime-700', title: 'text-lime-950', value: 'text-lime-950', sub: 'text-lime-800/80', btn: 'bg-lime-600 hover:bg-lime-700' },
  pink: { card: 'border-pink-100 bg-pink-50', icon: 'bg-white text-pink-600', title: 'text-pink-950', value: 'text-pink-950', sub: 'text-pink-800/80', btn: 'bg-pink-600 hover:bg-pink-700' },
  red: { card: 'border-red-100 bg-red-50', icon: 'bg-white text-red-600', title: 'text-red-950', value: 'text-red-950', sub: 'text-red-800/80', btn: 'bg-red-600 hover:bg-red-700' },
  purple: { card: 'border-purple-100 bg-purple-50', icon: 'bg-white text-purple-600', title: 'text-purple-950', value: 'text-purple-950', sub: 'text-purple-800/80', btn: 'bg-purple-600 hover:bg-purple-700' },
  yellow: { card: 'border-yellow-100 bg-yellow-50', icon: 'bg-white text-yellow-600', title: 'text-yellow-950', value: 'text-yellow-950', sub: 'text-yellow-800/80', btn: 'bg-yellow-500 hover:bg-yellow-600' },
  teal: { card: 'border-teal-100 bg-teal-50', icon: 'bg-white text-teal-600', title: 'text-teal-950', value: 'text-teal-950', sub: 'text-teal-800/80', btn: 'bg-teal-600 hover:bg-teal-700' },
};

export function getProductionAreaSkin(area) {
  const color = String(area?.color || '').trim().toLowerCase();
  if (PRODUCTION_AREA_SKINS[color]) return PRODUCTION_AREA_SKINS[color];
  const id = String(area?.id || '').trim();
  if (id === 'cocina') return PRODUCTION_AREA_SKINS.orange;
  if (id === 'bar') return PRODUCTION_AREA_SKINS.violet;
  return PRODUCTION_AREA_SKINS.teal;
}

/** Quita tildes para comparar palabras clave. */
function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Primera letra de cada palabra en mayúscula (Title Case).
 * Conserva espacios mientras se escribe.
 */
export function toProductionAreaTitleCase(raw) {
  return String(raw ?? '').replace(/[^\s]+/g, (word) => {
    if (!word) return word;
    return word.charAt(0).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es');
  });
}

/**
 * Icono según id/nombre del área (palabras clave).
 * Ej.: parrilla / parilla → grill, bar → copa, pastelería → panadería.
 */
export function getProductionAreaIcon(areaOrName) {
  const id = typeof areaOrName === 'object' ? String(areaOrName?.id || '') : '';
  const name = typeof areaOrName === 'object'
    ? String(areaOrName?.name || '')
    : String(areaOrName || '');
  const hay = fold(`${id} ${name}`);

  const has = (...words) => words.some((w) => {
    const f = fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!f) return false;
    if (hay.includes(fold(w))) return true;
    return new RegExp(`(?:^|[^a-z0-9])${f}(?:$|[^a-z0-9])`).test(hay);
  });

  if (has(
    'parrilla', 'parilla', 'parrila', 'grill', 'asador', 'bbq', 'churrasco',
    'brasas', 'carbon', 'plancha',
  )) {
    return MdOutdoorGrill;
  }
  if (has('pizza', 'pizzeria')) return MdLocalPizza;
  if (has('ramen', 'fideos', 'pasta', 'tallarin', 'sushi', 'nikkei')) return MdRamenDining;
  if (has('sopa', 'sopas', 'caldo', 'caldos')) return MdSoupKitchen;
  if (has('postre', 'postres', 'helado', 'helados', 'dulce', 'dulces', 'reposteria')) {
    return MdIcecream;
  }
  if (has('horno', 'hornos', 'pizza oven', 'horno de pizza')) return PizzaDomeOvenIcon;
  if (has('panaderia', 'pasteleria', 'bakery')) return MdBakeryDining;
  if (has('cafe', 'cafeteria', 'coffee', 'espresso')) return MdCoffee;
  if (has('jugo', 'jugos', 'smoothie', 'licuado', 'blender', 'jugueria')) return MdBlender;
  if (has('vino', 'wine', 'vinoteca')) return MdWineBar;
  if (has('licor', 'licores', 'whisky', 'ron', 'tequila', 'destilados')) return MdLiquor;
  if (has('desayuno', 'breakfast', 'brunch')) return MdBreakfastDining;
  if (has('almuerzo', 'cena', 'platos', 'comida')) return MdDinnerDining;
  if (has('fritura', 'frituras', 'fastfood', 'hamburguesa', 'snack')) return MdFastfood;
  if (has('fuego', 'flame')) return MdLocalFireDepartment;
  if (has('ceviche', 'cevicheria', 'mariscos', 'pescado')) return MdSetMeal;
  if (has('bar', 'barra', 'coctel', 'cocktail', 'bebida', 'bebidas', 'tragos')) {
    return MdLocalBar;
  }
  if (has('buffet', 'menu', 'carta')) return MdSetMeal;
  if (has('cocina', 'kitchen', 'chef')) return MdKitchen;
  if (has('restaurante', 'salon', 'comedor')) return MdRestaurant;

  return MdRestaurant;
}
