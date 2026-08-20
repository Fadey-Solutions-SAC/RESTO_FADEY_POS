const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('./database');

const SETTINGS_KEY = 'loyalty_survey_form';

const DEFAULT_QUESTIONS = Object.freeze([
  { id: 'atencion', label: 'Atención del personal' },
  { id: 'comida', label: 'Calidad de la comida o productos' },
  { id: 'tiempo', label: 'Tiempo de espera' },
  { id: 'ambiente', label: 'Limpieza y ambiente' },
  { id: 'precio', label: 'Relación calidad-precio' },
]);

/** @deprecated usar readLoyaltySurveyForm().questions */
const LOYALTY_SURVEY_QUESTIONS = DEFAULT_QUESTIONS;

function defaultForm() {
  return {
    title: 'Tu experiencia',
    subtitle: 'Cuéntanos cómo te fue en tu visita.',
    name_label: 'Tu nombre',
    rating_label: 'Calificación general',
    comment_label: 'Comentario (opcional)',
    comment_placeholder: '¿Qué te gustó o qué podemos mejorar?',
    show_comment: true,
    submit_label: 'Enviar encuesta',
    thanks_title: 'Gracias',
    thanks_message: 'Recibimos tu opinión. Nos ayuda a mejorar tu experiencia.',
    questions: DEFAULT_QUESTIONS.map((q) => ({ ...q })),
  };
}

function sanitizeLabel(value, fallback, max = 80) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  if (!s) return fallback;
  return s.slice(0, max);
}

function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (out.length >= 12) break;
    const label = sanitizeLabel(item?.label, '', 80);
    if (!label) continue;
    let id = String(item?.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id || seen.has(id)) id = `q_${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    seen.add(id);
    out.push({ id, label });
  }
  if (!out.length) return DEFAULT_QUESTIONS.map((q) => ({ ...q }));
  return out;
}

function normalizeForm(raw) {
  const d = defaultForm();
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    title: sanitizeLabel(o.title, d.title, 60),
    subtitle: sanitizeLabel(o.subtitle, d.subtitle, 160),
    name_label: sanitizeLabel(o.name_label, d.name_label, 60),
    rating_label: sanitizeLabel(o.rating_label, d.rating_label, 60),
    comment_label: sanitizeLabel(o.comment_label, d.comment_label, 60),
    comment_placeholder: sanitizeLabel(o.comment_placeholder, d.comment_placeholder, 120),
    show_comment: o.show_comment !== false && o.show_comment !== 0 && o.show_comment !== '0',
    submit_label: sanitizeLabel(o.submit_label, d.submit_label, 40),
    thanks_title: sanitizeLabel(o.thanks_title, d.thanks_title, 40),
    thanks_message: sanitizeLabel(o.thanks_message, d.thanks_message, 220),
    questions: normalizeQuestions(o.questions),
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
  const next = normalizeForm(input);
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
  LOYALTY_SURVEY_QUESTIONS,
  defaultForm,
  normalizeForm,
  readLoyaltySurveyForm,
  saveLoyaltySurveyForm,
  loyaltyQuestionIds,
};
