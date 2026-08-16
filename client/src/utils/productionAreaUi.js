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
 * Ej.: parrilla → grill, bar → copa, pastelería → panadería.
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
    return new RegExp(`(?:^|[^a-z0-9])${f}(?:$|[^a-z0-9])`).test(hay);
  });

  if (has('parrilla', 'grill', 'asador', 'bbq', 'churrasco', 'brasas', 'carbon')) {
    return MdOutdoorGrill;
  }
  if (has('pizza', 'pizzeria')) return MdLocalPizza;
  if (has('ramen', 'fideos', 'pasta', 'tallarin')) return MdRamenDining;
  if (has('sopa', 'sopas', 'caldo', 'caldos')) return MdSoupKitchen;
  if (has('postre', 'postres', 'helado', 'helados', 'dulce', 'dulces', 'reposteria')) {
    return MdIcecream;
  }
  if (has('panaderia', 'pasteleria', 'horno', 'bakery')) return MdBakeryDining;
  if (has('cafe', 'cafeteria', 'coffee', 'espresso', 'te')) return MdCoffee;
  if (has('jugo', 'jugos', 'smoothie', 'licuado', 'blender')) return MdBlender;
  if (has('vino', 'wine', 'vinoteca')) return MdWineBar;
  if (has('licor', 'licores', 'whisky', 'ron', 'tequila', 'destilados')) return MdLiquor;
  if (has('desayuno', 'breakfast', 'brunch')) return MdBreakfastDining;
  if (has('almuerzo', 'cena', 'platos', 'comida')) return MdDinnerDining;
  if (has('fritura', 'frituras', 'fastfood', 'hamburguesa', 'snack')) return MdFastfood;
  if (has('fuego', 'flame')) return MdLocalFireDepartment;
  if (has('bar', 'barra', 'coctel', 'cocktail', 'bebida', 'bebidas', 'tragos')) {
    return MdLocalBar;
  }
  if (has('buffet', 'menu', 'carta')) return MdSetMeal;
  if (has('cocina', 'kitchen', 'chef')) return MdKitchen;
  if (has('restaurante', 'salon', 'comedor')) return MdRestaurant;

  // Por defecto: cocina genérica
  return MdKitchen;
}
