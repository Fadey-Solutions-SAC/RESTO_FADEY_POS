const { v4: uuidv4 } = require('uuid');
const { normalizeTextStyle, DEFAULT_TEXT_STYLE, LOYALTY_TEXT_STYLES } = require('./loyaltySurveyTypography');
const { queryOne, runSql } = require('./database');

const SETTINGS_KEY = 'loyalty_survey_form';
const FORM_VERSION = 2;

/** Escala: 5 Excelente … 1 Muy malo (mismo orden visual de izquierda a derecha). */
const RATING_SCALE = Object.freeze([
  { value: 5, label: 'Excelente', emoji: '😊' },
  { value: 4, label: 'Bueno', emoji: '🙂' },
  { value: 3, label: 'Regular', emoji: '😐' },
  { value: 2, label: 'Malo', emoji: '☹️' },
  { value: 1, label: 'Muy malo', emoji: '😢' },
]);

const DEFAULT_QUESTIONS = Object.freeze([
  { id: 'comida_bebidas', label: 'Calidad de la comida / bebidas' },
  { id: 'variedad_menu', label: 'Variedad del menú' },
  { id: 'atencion', label: 'Atención del personal' },
  { id: 'ambiente', label: 'Ambiente / Instalaciones' },
  { id: 'limpieza', label: 'Limpieza' },
  { id: 'precio', label: 'Relación calidad - precio' },
  { id: 'experiencia_general', label: 'Experiencia en general' },
]);

const DEFAULT_LIKED = Object.freeze([
  { id: 'comida_bebidas', label: 'La comida / bebidas' },
  { id: 'atencion', label: 'La atención del personal' },
  { id: 'ambiente', label: 'El ambiente / instalaciones' },
  { id: 'limpieza', label: 'La limpieza' },
  { id: 'precio', label: 'Relación calidad - precio' },
]);

const DEFAULT_IMPROVE = Object.freeze([
  { id: 'comida_bebidas', label: 'Calidad de la comida / bebidas' },
  { id: 'tiempo_atencion', label: 'Tiempo de atención' },
  { id: 'variedad_menu', label: 'Variedad del menú' },
  { id: 'instalaciones', label: 'Instalaciones / comodidad' },
  { id: 'limpieza', label: 'Limpieza' },
]);

/** @deprecated usar readLoyaltySurveyForm().questions */
const LOYALTY_SURVEY_QUESTIONS = DEFAULT_QUESTIONS;

function defaultForm() {
  return {
    form_version: FORM_VERSION,
    title: 'Encuesta de satisfacción',
    subtitle: 'Su opinión nos ayuda a mejorar.',
    name_label: 'Tu nombre',
    waiter_label: 'Mozo que te atendió',
    visit_date_label: 'Fecha de su visita',
    area_label: 'Área utilizada',
    party_size_label: 'N° de personas',
    experience_title: '1. Califique su experiencia',
    liked_title: '2. ¿Qué fue lo que más le gustó?',
    liked_hint: '(Puede seleccionar más de una opción)',
    improve_title: '3. ¿Qué aspectos podemos mejorar?',
    improve_hint: '(Puede seleccionar más de una opción)',
    comment_label: '4. Comentarios o sugerencias',
    comment_placeholder: 'Cuéntenos cómo podemos mejorar su próxima visita:',
    show_comment: true,
    submit_label: 'Enviar encuesta',
    thanks_title: 'Gracias',
    thanks_message: 'Recibimos tu opinión. Nos ayuda a mejorar tu experiencia.',
    text_style: DEFAULT_TEXT_STYLE,
    questions: DEFAULT_QUESTIONS.map((q) => ({ ...q })),
    liked_options: DEFAULT_LIKED.map((o) => ({ ...o })),
    improve_options: DEFAULT_IMPROVE.map((o) => ({ ...o })),
    rating_scale: RATING_SCALE.map((s) => ({ ...s })),
  };
}

function sanitizeLabel(value, fallback, max = 80) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  if (!s) return fallback;
  return s.slice(0, max);
}

function normalizeOptionList(raw, fallbackList, max = 12) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (out.length >= max) break;
    const label = sanitizeLabel(item?.label, '', 80);
    if (!label) continue;
    let id = String(item?.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seen.has(id)) id = `o_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    seen.add(id);
    out.push({ id, label });
  }
  if (!out.length) return fallbackList.map((o) => ({ ...o }));
  return out;
}

function normalizeQuestions(raw) {
  return normalizeOptionList(raw, DEFAULT_QUESTIONS, 12);
}

function normalizeForm(raw) {
  const d = defaultForm();
  const o = raw && typeof raw === 'object' ? raw : {};
  const version = Number(o.form_version || 0);
  const upgrade = version < FORM_VERSION;
  return {
    form_version: FORM_VERSION,
    title: sanitizeLabel(o.title, d.title, 60),
    subtitle: sanitizeLabel(o.subtitle, d.subtitle, 160),
    name_label: sanitizeLabel(o.name_label, d.name_label, 60),
    waiter_label: sanitizeLabel(o.waiter_label, d.waiter_label, 60),
    visit_date_label: sanitizeLabel(o.visit_date_label, d.visit_date_label, 60),
    area_label: sanitizeLabel(o.area_label, d.area_label, 60),
    party_size_label: sanitizeLabel(o.party_size_label, d.party_size_label, 60),
    experience_title: sanitizeLabel(o.experience_title, d.experience_title, 80),
    liked_title: sanitizeLabel(o.liked_title, d.liked_title, 80),
    liked_hint: sanitizeLabel(o.liked_hint, d.liked_hint, 80),
    improve_title: sanitizeLabel(o.improve_title, d.improve_title, 80),
    improve_hint: sanitizeLabel(o.improve_hint, d.improve_hint, 80),
    comment_label: sanitizeLabel(o.comment_label, d.comment_label, 80),
    comment_placeholder: sanitizeLabel(o.comment_placeholder, d.comment_placeholder, 160),
    show_comment: o.show_comment !== false && o.show_comment !== 0 && o.show_comment !== '0',
    submit_label: sanitizeLabel(o.submit_label, d.submit_label, 40),
    thanks_title: sanitizeLabel(o.thanks_title, d.thanks_title, 40),
    thanks_message: sanitizeLabel(o.thanks_message, d.thanks_message, 220),
    text_style: normalizeTextStyle(o.text_style),
    questions: upgrade ? DEFAULT_QUESTIONS.map((q) => ({ ...q })) : normalizeQuestions(o.questions),
    liked_options: upgrade ? DEFAULT_LIKED.map((x) => ({ ...x })) : normalizeOptionList(o.liked_options, DEFAULT_LIKED),
    improve_options: upgrade
      ? DEFAULT_IMPROVE.map((x) => ({ ...x }))
      : normalizeOptionList(o.improve_options, DEFAULT_IMPROVE),
    rating_scale: RATING_SCALE.map((s) => ({ ...s })),
  };
}

function readLoyaltySurveyForm() {
  const row = queryOne('SELECT value FROM app_settings WHERE key = ?', [SETTINGS_KEY]);
  if (!row?.value) return defaultForm();
  try {
    return normalizeForm(JSON.parse(row.value));
  } catch {
    return defaultForm();
  }
}

function saveLoyaltySurveyForm(input) {
  const next = normalizeForm({ ...(input || {}), form_version: FORM_VERSION });
  runSql(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return next;
}

function loyaltyQuestionIds(form) {
  const f = form && Array.isArray(form.questions) ? form : readLoyaltySurveyForm();
  return f.questions.map((q) => q.id);
}

module.exports = {
  SETTINGS_KEY,
  FORM_VERSION,
  RATING_SCALE,
  LOYALTY_SURVEY_QUESTIONS,
  DEFAULT_QUESTIONS,
  DEFAULT_LIKED,
  DEFAULT_IMPROVE,
  defaultForm,
  normalizeForm,
  readLoyaltySurveyForm,
  saveLoyaltySurveyForm,
  loyaltyQuestionIds,
  LOYALTY_TEXT_STYLES,
  DEFAULT_TEXT_STYLE,
};
