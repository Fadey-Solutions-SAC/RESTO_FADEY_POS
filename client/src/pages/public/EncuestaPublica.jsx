import { useEffect, useMemo, useState } from 'react';
import { api, resolveMediaUrl } from '../../utils/api';
import { surveyTypeClass, DEFAULT_LOYALTY_TEXT_STYLE } from '../../utils/loyaltySurveyTypography';
import toast from 'react-hot-toast';

const FALLBACK_NAME = 'Resto Fadey App';

const DEFAULT_SCALE = [
  { value: 5, label: 'Excelente', emoji: '😊' },
  { value: 4, label: 'Bueno', emoji: '🙂' },
  { value: 3, label: 'Regular', emoji: '😐' },
  { value: 2, label: 'Malo', emoji: '☹️' },
  { value: 1, label: 'Muy malo', emoji: '😢' },
];

function toggleId(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function EncuestaPublica() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    restaurant_name: FALLBACK_NAME,
    logo: '',
    cover_image: '',
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
    thanks_message: '',
    text_style: DEFAULT_LOYALTY_TEXT_STYLE,
    questions: [],
    liked_options: [],
    improve_options: [],
    rating_scale: DEFAULT_SCALE,
    waiters: [],
  });

  const [name, setName] = useState('');
  const [waiterId, setWaiterId] = useState('');
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visitArea, setVisitArea] = useState('');
  const [partySize, setPartySize] = useState('');
  const [answers, setAnswers] = useState({});
  const [liked, setLiked] = useState([]);
  const [improve, setImprove] = useState([]);
  const [likedOther, setLikedOther] = useState('');
  const [improveOther, setImproveOther] = useState('');
  const [comment, setComment] = useState('');

  const scale = useMemo(
    () => (Array.isArray(form.rating_scale) && form.rating_scale.length ? form.rating_scale : DEFAULT_SCALE),
    [form.rating_scale],
  );

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('rf-login-lock');
    body.classList.add('rf-login-lock');
    return () => {
      html.classList.remove('rf-login-lock');
      body.classList.remove('rf-login-lock');
    };
  }, []);

  useEffect(() => {
    api
      .get('/public/loyalty/form')
      .then((data) => {
        const waiters = Array.isArray(data?.waiters) ? data.waiters : [];
        setForm((prev) => ({
          ...prev,
          ...data,
          restaurant_name: String(data?.restaurant_name || '').trim() || FALLBACK_NAME,
          questions: Array.isArray(data?.questions) ? data.questions : [],
          liked_options: Array.isArray(data?.liked_options) ? data.liked_options : [],
          improve_options: Array.isArray(data?.improve_options) ? data.improve_options : [],
          rating_scale: Array.isArray(data?.rating_scale) && data.rating_scale.length
            ? data.rating_scale
            : DEFAULT_SCALE,
          show_comment: data?.show_comment !== false,
          waiters,
        }));
        if (waiters.length === 1) setWaiterId(String(waiters[0].id || ''));
      })
      .catch((e) => toast.error(e.message || 'No se pudo cargar la encuesta'))
      .finally(() => setLoading(false));
  }, []);

  const setAnswer = (id, value) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error(`Escribe ${String(form.name_label || 'tu nombre').toLowerCase()}`);
      return;
    }
    if (form.waiters.length > 0 && !waiterId) {
      toast.error(`Selecciona ${String(form.waiter_label || 'el mozo').toLowerCase()}`);
      return;
    }
    if (!visitArea) {
      toast.error(`Selecciona ${String(form.area_label || 'el área').toLowerCase()}`);
      return;
    }
    const people = Number(partySize);
    if (!Number.isFinite(people) || people < 1) {
      toast.error(`Indica ${String(form.party_size_label || 'el número de personas').toLowerCase()}`);
      return;
    }
    for (const q of form.questions) {
      if (!answers[q.id]) {
        toast.error('Complete todas las calificaciones de experiencia');
        return;
      }
    }
    setSending(true);
    try {
      await api.post('/public/loyalty', {
        customer_name: name.trim(),
        waiter_user_id: waiterId || undefined,
        visit_date: visitDate,
        visit_area: visitArea,
        party_size: people,
        answers,
        liked,
        improve,
        liked_other: likedOther.trim(),
        improve_other: improveOther.trim(),
        comment: form.show_comment ? comment.trim() : '',
      });
      setDone(true);
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`rf-login-shell rf-login-page rf-login-page--survey rf-survey-sheet ${surveyTypeClass(form.text_style)}`}>
      <div className="rf-login-cover-bg rf-login-cover-bg--empty" aria-hidden="true" />
      <div className="rf-login-page__content rf-login-page__content--visible">
        <div className="rf-login-center rf-survey-sheet__wrap relative z-10 px-3">
          <div className="rf-survey-sheet__card">
            <header className="rf-survey-sheet__brand">
              {form.logo ? (
                <img src={resolveMediaUrl(form.logo)} alt="" className="rf-survey-sheet__logo" />
              ) : null}
              <h1>{form.restaurant_name}</h1>
              <p>{form.title}</p>
              {form.subtitle ? <p className="rf-survey-sheet__sub">{form.subtitle}</p> : null}
            </header>

            {loading ? (
              <p className="rf-survey-sheet__sub text-center py-8">Cargando encuesta…</p>
            ) : done ? (
              <div className="text-center py-8 space-y-2">
                <h2 className="rf-survey-sheet__section-title !border-0 !pb-0">{form.thanks_title || 'Gracias'}</h2>
                <p className="rf-survey-sheet__sub">
                  {form.thanks_message
                    || `Recibimos tu opinión. Nos ayuda a mejorar tu experiencia en ${form.restaurant_name}.`}
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="rf-survey-sheet__form space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="rf-survey-field">
                    <span>{form.name_label}</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      required
                      autoComplete="name"
                    />
                  </label>
                  {form.waiters.length > 0 ? (
                    <label className="rf-survey-field">
                      <span>{form.waiter_label}</span>
                      <select value={waiterId} onChange={(e) => setWaiterId(e.target.value)} required>
                        <option value="">Selecciona un mozo…</option>
                        {form.waiters.map((w) => (
                          <option key={w.id} value={w.id}>{w.full_name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>

                <div className="rf-survey-meta">
                  <label className="rf-survey-field">
                    <span>{form.visit_date_label}</span>
                    <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} required />
                  </label>
                  <fieldset className="rf-survey-field">
                    <legend>{form.area_label}</legend>
                    <div className="rf-survey-check-row">
                      {[
                        { id: 'restaurante', label: 'Restaurante' },
                        { id: 'hotel', label: 'Hotel' },
                        { id: 'ambos', label: 'Ambos' },
                      ].map((a) => (
                        <label key={a.id} className="rf-survey-check">
                          <input
                            type="radio"
                            name="visit_area"
                            value={a.id}
                            checked={visitArea === a.id}
                            onChange={() => setVisitArea(a.id)}
                          />
                          <span>{a.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="rf-survey-field">
                    <span>{form.party_size_label}</span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={partySize}
                      onChange={(e) => setPartySize(e.target.value)}
                      required
                    />
                  </label>
                </div>

                <section>
                  <h2 className="rf-survey-sheet__section-title">{form.experience_title}</h2>
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
                    {form.questions.map((q) => (
                      <div key={q.id} className="rf-survey-likert__row" role="radiogroup" aria-label={q.label}>
                        <div className="rf-survey-likert__label">{q.label}</div>
                        {scale.map((s) => (
                          <label key={s.value} className={`rf-survey-likert__cell ${answers[q.id] === s.value ? 'is-on' : ''}`}>
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              value={s.value}
                              checked={answers[q.id] === s.value}
                              onChange={() => setAnswer(q.id, s.value)}
                            />
                            <span className="rf-survey-likert__dot" />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h2 className="rf-survey-sheet__section-title">{form.liked_title}</h2>
                  {form.liked_hint ? <p className="rf-survey-sheet__hint">{form.liked_hint}</p> : null}
                  <div className="rf-survey-options">
                    {form.liked_options.map((o) => (
                      <label key={o.id} className="rf-survey-check">
                        <input
                          type="checkbox"
                          checked={liked.includes(o.id)}
                          onChange={() => setLiked((prev) => toggleId(prev, o.id))}
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                    <label className="rf-survey-field rf-survey-field--inline">
                      <span>Otro:</span>
                      <input
                        type="text"
                        value={likedOther}
                        onChange={(e) => setLikedOther(e.target.value)}
                        maxLength={120}
                      />
                    </label>
                  </div>
                </section>

                <section>
                  <h2 className="rf-survey-sheet__section-title">{form.improve_title}</h2>
                  {form.improve_hint ? <p className="rf-survey-sheet__hint">{form.improve_hint}</p> : null}
                  <div className="rf-survey-options">
                    {form.improve_options.map((o) => (
                      <label key={o.id} className="rf-survey-check">
                        <input
                          type="checkbox"
                          checked={improve.includes(o.id)}
                          onChange={() => setImprove((prev) => toggleId(prev, o.id))}
                        />
                        <span>{o.label}</span>
                      </label>
                    ))}
                    <label className="rf-survey-field rf-survey-field--inline">
                      <span>Otro:</span>
                      <input
                        type="text"
                        value={improveOther}
                        onChange={(e) => setImproveOther(e.target.value)}
                        maxLength={120}
                      />
                    </label>
                  </div>
                </section>

                {form.show_comment ? (
                  <section>
                    <h2 className="rf-survey-sheet__section-title">{form.comment_label}</h2>
                    <p className="rf-survey-sheet__hint">{form.comment_placeholder}</p>
                    <textarea
                      className="rf-survey-textarea"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      maxLength={800}
                      rows={4}
                    />
                  </section>
                ) : null}

                <button type="submit" className="rf-survey-submit" disabled={sending}>
                  {sending ? 'Enviando…' : (form.submit_label || 'Enviar encuesta')}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
