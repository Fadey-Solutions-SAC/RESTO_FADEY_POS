import { surveyTypeClass, DEFAULT_LOYALTY_TEXT_STYLE } from '../../utils/loyaltySurveyTypography';
import { resolveMediaUrl } from '../../utils/api';

const DEFAULT_SCALE = [
  { value: 5, label: 'Excelente', emoji: '😊' },
  { value: 4, label: 'Bueno', emoji: '🙂' },
  { value: 3, label: 'Regular', emoji: '😐' },
  { value: 2, label: 'Malo', emoji: '☹️' },
  { value: 1, label: 'Muy malo', emoji: '😢' },
];

const AREA_OPTIONS = [
  { id: 'restaurante', label: 'Restaurante' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'ambos', label: 'Ambos' },
];

/**
 * Encuesta en formato hoja crema (mismo look que /encuesta) con datos ya respondidos.
 */
export default function LoyaltySurveyFilledSheet({
  form,
  response,
  restaurantName = 'Resto Fadey App',
  logo = '',
  className = '',
  sheetId,
}) {
  const scale = Array.isArray(form?.rating_scale) && form.rating_scale.length
    ? form.rating_scale
    : DEFAULT_SCALE;
  const questions = Array.isArray(form?.questions) ? form.questions : [];
  const likedOptions = Array.isArray(form?.liked_options) ? form.liked_options : [];
  const improveOptions = Array.isArray(form?.improve_options) ? form.improve_options : [];
  const answers = response?.answers && typeof response.answers === 'object' ? response.answers : {};
  const liked = Array.isArray(response?.liked) ? response.liked : [];
  const improve = Array.isArray(response?.improve) ? response.improve : [];
  const typeClass = surveyTypeClass(form?.text_style || DEFAULT_LOYALTY_TEXT_STYLE);

  return (
    <div
      id={sheetId}
      className={`rf-survey-sheet ${typeClass} ${className}`.trim()}
    >
      <div className="rf-survey-sheet__card">
        <header className="rf-survey-sheet__brand">
          {logo ? (
            <img src={resolveMediaUrl(logo)} alt="" className="rf-survey-sheet__logo" />
          ) : null}
          <h1>{restaurantName}</h1>
          <p>{form?.title || 'Encuesta de satisfacción'}</p>
          {form?.subtitle ? <p className="rf-survey-sheet__sub">{form.subtitle}</p> : null}
        </header>

        <div className="rf-survey-sheet__form space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="rf-survey-field">
              <span>{form?.name_label || 'Tu nombre'}</span>
              <input type="text" readOnly value={response?.customer_name || ''} />
            </label>
            <label className="rf-survey-field">
              <span>{form?.waiter_label || 'Mozo que te atendió'}</span>
              <input type="text" readOnly value={response?.waiter_name || '—'} />
            </label>
          </div>

          <div className="rf-survey-meta">
            <label className="rf-survey-field">
              <span>{form?.visit_date_label || 'Fecha de su visita'}</span>
              <input type="text" readOnly value={response?.visit_date || '—'} />
            </label>
            <fieldset className="rf-survey-field">
              <legend>{form?.area_label || 'Área utilizada'}</legend>
              <div className="rf-survey-check-row">
                {AREA_OPTIONS.map((a) => (
                  <label key={a.id} className="rf-survey-check">
                    <input
                      type="radio"
                      readOnly
                      disabled
                      checked={String(response?.visit_area || '') === a.id}
                    />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="rf-survey-field">
              <span>{form?.party_size_label || 'N° de personas'}</span>
              <input
                type="text"
                readOnly
                value={response?.party_size ? String(response.party_size) : '—'}
              />
            </label>
          </div>

          <section>
            <h2 className="rf-survey-sheet__section-title">
              {form?.experience_title || '1. Califique su experiencia'}
            </h2>
            <div className="rf-survey-likert">
              <div className="rf-survey-likert__head">
                <span className="rf-survey-likert__spacer" />
                {scale.map((s) => (
                  <div key={s.value} className="rf-survey-likert__colhead">
                    <span className="rf-survey-likert__emoji" aria-hidden>{s.emoji}</span>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
              {questions.map((q) => {
                const val = Number(answers[q.id]);
                return (
                  <div key={q.id} className="rf-survey-likert__row">
                    <div className="rf-survey-likert__label">{q.label}</div>
                    {scale.map((s) => (
                      <span
                        key={s.value}
                        className={`rf-survey-likert__cell ${val === s.value ? 'is-on' : ''}`}
                      >
                        <span className="rf-survey-likert__dot" />
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="rf-survey-sheet__section-title">
              {form?.liked_title || '2. ¿Qué fue lo que más le gustó?'}
            </h2>
            {form?.liked_hint ? <p className="rf-survey-sheet__hint">{form.liked_hint}</p> : null}
            <div className="rf-survey-options">
              {likedOptions.map((o) => (
                <label key={o.id} className="rf-survey-check">
                  <input type="checkbox" readOnly disabled checked={liked.includes(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
              <label className="rf-survey-field rf-survey-field--inline">
                <span>Otro:</span>
                <input type="text" readOnly value={response?.liked_other || ''} />
              </label>
            </div>
          </section>

          <section>
            <h2 className="rf-survey-sheet__section-title">
              {form?.improve_title || '3. ¿Qué aspectos podemos mejorar?'}
            </h2>
            {form?.improve_hint ? <p className="rf-survey-sheet__hint">{form.improve_hint}</p> : null}
            <div className="rf-survey-options">
              {improveOptions.map((o) => (
                <label key={o.id} className="rf-survey-check">
                  <input type="checkbox" readOnly disabled checked={improve.includes(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
              <label className="rf-survey-field rf-survey-field--inline">
                <span>Otro:</span>
                <input type="text" readOnly value={response?.improve_other || ''} />
              </label>
            </div>
          </section>

          {form?.show_comment !== false ? (
            <section>
              <h2 className="rf-survey-sheet__section-title">
                {form?.comment_label || '4. Comentarios o sugerencias'}
              </h2>
              <textarea
                className="rf-survey-textarea"
                readOnly
                rows={4}
                value={response?.comment || ''}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
