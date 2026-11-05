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
export function PizzaDomeOvenIcon({ className = '', ...props }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3.2 15.2C3.6 9.6 7.4 6 12 6s8.4 3.6 8.8 9.2H3.2z" />
      <path d="M2.4 16.1h19.2v1.15c0 1.15-.9 2.05-2.05 2.05H4.45c-1.15 0-2.05-.9-2.05-2.05V16.1z" />
      <path d="M9.1 15.15h5.8V18.4H9.1z" opacity="0.35" />
      <circle cx="8.2" cy="11.3" r="0.7" opacity="0.45" />
      <circle cx="12" cy="10.2" r="0.7" opacity="0.45" />
      <circle cx="15.8" cy="11.3" r="0.7" opacity="0.45" />
    </svg>
  );
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
