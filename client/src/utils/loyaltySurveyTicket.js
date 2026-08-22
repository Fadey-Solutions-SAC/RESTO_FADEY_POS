const AREA_LABEL = {
  restaurante: 'Restaurante',
  hotel: 'Hotel',
  ambos: 'Ambos',
};

const DEFAULT_SCALE = [
  { value: 5, label: 'Excelente' },
  { value: 4, label: 'Bueno' },
  { value: 3, label: 'Regular' },
  { value: 2, label: 'Malo' },
  { value: 1, label: 'Muy malo' },
];

function scaleLabel(form, value) {
  const scale = Array.isArray(form?.rating_scale) && form.rating_scale.length
    ? form.rating_scale
    : DEFAULT_SCALE;
  const hit = scale.find((s) => Number(s.value) === Number(value));
  return hit?.label || String(value || '—');
}

/**
 * Texto térmico de encuesta respondida (impresora de caja).
 */
export function buildLoyaltySurveyTicketText(form, response, restaurantName = 'Resto Fadey') {
  const lines = [];
  const brand = String(restaurantName || 'Resto Fadey').trim() || 'Resto Fadey';
  lines.push(brand.toUpperCase());
  lines.push(String(form?.title || 'Encuesta de satisfaccion').trim());
  lines.push('-'.repeat(32));
  lines.push(`${form?.name_label || 'Nombre'}: ${response?.customer_name || '—'}`);
  lines.push(`${form?.waiter_label || 'Mozo'}: ${response?.waiter_name || '—'}`);
  lines.push(`${form?.visit_date_label || 'Visita'}: ${response?.visit_date || '—'}`);
  lines.push(
    `${form?.area_label || 'Area'}: ${AREA_LABEL[response?.visit_area] || response?.visit_area || '—'}`,
  );
  lines.push(`${form?.party_size_label || 'Personas'}: ${response?.party_size || '—'}`);
  lines.push('-'.repeat(32));
  lines.push(String(form?.experience_title || '1. Experiencia').trim());
  const questions = Array.isArray(form?.questions) ? form.questions : [];
  const answers = response?.answers && typeof response.answers === 'object' ? response.answers : {};
  for (const q of questions) {
    const v = answers[q.id];
    lines.push(`* ${q.label}`);
    lines.push(`  ${scaleLabel(form, v)}`);
  }
  lines.push('-'.repeat(32));
  lines.push(String(form?.liked_title || '2. Lo que mas gusto').trim());
  const likedById = Object.fromEntries(
    (Array.isArray(form?.liked_options) ? form.liked_options : []).map((o) => [o.id, o.label]),
  );
  const likedLabels = Array.isArray(response?.liked_labels) && response.liked_labels.length
    ? response.liked_labels
    : (Array.isArray(response?.liked) ? response.liked : []).map((id) => likedById[id] || id);
  if (likedLabels.length) {
    likedLabels.forEach((l) => lines.push(`- ${l}`));
  } else {
    lines.push('- (sin seleccion)');
  }
  if (String(response?.liked_other || '').trim()) {
    lines.push(`Otro: ${String(response.liked_other).trim()}`);
  }
  lines.push('-'.repeat(32));
  lines.push(String(form?.improve_title || '3. Por mejorar').trim());
  const improveById = Object.fromEntries(
    (Array.isArray(form?.improve_options) ? form.improve_options : []).map((o) => [o.id, o.label]),
  );
  const improveLabels = Array.isArray(response?.improve_labels) && response.improve_labels.length
    ? response.improve_labels
    : (Array.isArray(response?.improve) ? response.improve : []).map((id) => improveById[id] || id);
  if (improveLabels.length) {
    improveLabels.forEach((l) => lines.push(`- ${l}`));
  } else {
    lines.push('- (sin seleccion)');
  }
  if (String(response?.improve_other || '').trim()) {
    lines.push(`Otro: ${String(response.improve_other).trim()}`);
  }
  if (form?.show_comment !== false) {
    lines.push('-'.repeat(32));
    lines.push(String(form?.comment_label || '4. Comentarios').trim());
    const comment = String(response?.comment || '').trim() || '—';
    comment.split(/\n/).forEach((part) => lines.push(part));
  }
  lines.push('-'.repeat(32));
  lines.push(`Nota general: ${Number(response?.rating || 0).toFixed(0)}/5`);
  lines.push('');
  return lines.join('\n');
}
