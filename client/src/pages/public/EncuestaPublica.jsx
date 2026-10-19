import { useEffect, useMemo, useState } from 'react';
import { api, resolveMediaUrl } from '../../utils/api';
import { surveyTypeClass, DEFAULT_LOYALTY_TEXT_STYLE } from '../../utils/loyaltySurveyTypography';
import GitCardVisual from '../../components/GitCardVisual';
import toast from 'react-hot-toast';

const CONTINUE_KEY = 'rf_git_cards_continue';

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
  const [screen, setScreen] = useState('home');
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
    area_options: [],
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
  const [continueToken, setContinueToken] = useState('');
  const [continueData, setContinueData] = useState(null);
  const [identity, setIdentity] = useState({ name: '', phone: '', doc_number: '' });
  const [linking, setLinking] = useState(false);
  const [registerNotice, setRegisterNotice] = useState('');

  const scale = useMemo(
    () => (Array.isArray(form.rating_scale) && form.rating_scale.length ? form.rating_scale : DEFAULT_SCALE),
    [form.rating_scale],
  );
  const gitCardsEnabled = form?.git_cards?.enabled !== false;

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
          area_options: Array.isArray(data?.area_options) ? data.area_options : [],
          rating_scale: Array.isArray(data?.rating_scale) && data.rating_scale.length
            ? data.rating_scale
            : DEFAULT_SCALE,
          show_comment: data?.show_comment !== false,
          waiters,
        }));
        if (waiters.length === 1) setWaiterId(String(waiters[0].id || ''));
        const areas = Array.isArray(data?.area_options) ? data.area_options : [];
        if (areas.length === 1) setVisitArea(String(areas[0].id || ''));
      })
      .catch((e) => toast.error(e.message || 'No se pudo cargar la encuesta'))
      .finally(() => setLoading(false));
  }, []);

  const goHome = () => {
    setScreen('home');
    setRegisterNotice('');
  };

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
      const result = await api.post('/public/loyalty', {
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
      if (!result?.success) {
        toast.error('La encuesta no se registró. Intente de nuevo.');
        return;
      }
      if (result.continue_token) {
        sessionStorage.setItem(CONTINUE_KEY, result.continue_token);
        setContinueToken(result.continue_token);
      }
      setScreen('thanks');
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar');
    } finally {
      setSending(false);
    }
  };

  const startRegister = async () => {
    setSending(true);
    setRegisterNotice('');
    try {
      const result = await api.post('/public/loyalty/git-cards/start', {});
      if (!result?.continue_token) throw new Error('No se pudo iniciar el registro');
      sessionStorage.setItem(CONTINUE_KEY, result.continue_token);
      setContinueToken(result.continue_token);
      setIdentity((prev) => ({ ...prev, name: prev.name || name }));
      setScreen('register');
    } catch (err) {
      toast.error(err.message || 'No se pudo continuar');
    } finally {
      setSending(false);
    }
  };

  const lookupCard = async (e) => {
    e.preventDefault();
    setLinking(true);
    try {
      const data = await api.post('/public/loyalty/git-cards/lookup', {
        name: identity.name,
        doc_number: identity.doc_number,
      });
      setContinueData(data);
      setRegisterNotice('');
      setScreen('card');
    } catch (err) {
      toast.error(err.message || 'No encontramos una GIT Card con esos datos.');
    } finally {
      setLinking(false);
    }
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    if (!continueToken) {
      toast.error('No hay una sesión válida para registrar la tarjeta.');
      return;
    }
    setLinking(true);
    try {
      const data = await api.post(`/public/loyalty/continue/${encodeURIComponent(continueToken)}/link`, {
        name: identity.name,
        phone: identity.phone,
        doc_number: identity.doc_number,
      });
      setContinueData(data);
      setRegisterNotice(data.created_customer
        ? 'Su GIT Card quedó registrada. Ya puede consultarla.'
        : 'Ya tenía una GIT Card. Mostramos la tarjeta existente.');
      setScreen('card');
    } catch (err) {
      toast.error(err.message || 'No se pudo registrar la tarjeta');
    } finally {
      setLinking(false);
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
              <p className="rf-survey-sheet__sub text-center py-8">Cargando…</p>
            ) : screen === 'home' ? (
              <nav className="rf-survey-actions" aria-label="Opciones de fidelización">
                <button type="button" className="rf-survey-action" onClick={() => setScreen('survey')}>
                  <strong>Enviar encuesta</strong>
                  <span>Comparte tu experiencia.</span>
                </button>
                {gitCardsEnabled ? (
                  <>
                    <button type="button" className="rf-survey-action" onClick={() => setScreen('lookup')}>
                      <strong>Ver mi GIT Card</strong>
                      <span>Consulta tu progreso y tus recompensas.</span>
                    </button>
                    <button type="button" className="rf-survey-action" onClick={startRegister} disabled={sending}>
                      <strong>Registrar mi GIT Card</strong>
                      <span>Regístrate para participar en el programa.</span>
                    </button>
                  </>
                ) : null}
              </nav>
            ) : screen === 'lookup' ? (
              <form onSubmit={lookupCard} className="rf-survey-sheet__form space-y-4 py-2">
                <button type="button" className="rf-survey-back" onClick={goHome}>Volver</button>
                <h2 className="rf-survey-sheet__section-title !border-0 !pb-0">Ver mi GIT Card</h2>
                <p className="rf-survey-sheet__sub">Ingrese el nombre y el DNI con los que se registró.</p>
                <label className="rf-survey-field">
                  <span>Nombre</span>
                  <input value={identity.name} onChange={(e) => setIdentity((p) => ({ ...p, name: e.target.value }))} required autoComplete="name" />
                </label>
                <label className="rf-survey-field">
                  <span>DNI</span>
                  <input value={identity.doc_number} onChange={(e) => setIdentity((p) => ({ ...p, doc_number: e.target.value }))} inputMode="numeric" required />
                </label>
                <button type="submit" className="rf-survey-submit" disabled={linking}>
                  {linking ? 'Consultando…' : 'Consultar'}
                </button>
              </form>
            ) : screen === 'register' ? (
              <form onSubmit={submitRegister} className="rf-survey-sheet__form space-y-4 py-2">
                <button type="button" className="rf-survey-back" onClick={goHome}>Volver</button>
                <h2 className="rf-survey-sheet__section-title !border-0 !pb-0">Registrar mi GIT Card</h2>
                <p className="rf-survey-sheet__sub">
                  Si ya está registrado, mostraremos su tarjeta existente. El registro no suma avances ni recompensas.
                </p>
                <label className="rf-survey-field">
                  <span>Nombre</span>
                  <input value={identity.name} onChange={(e) => setIdentity((p) => ({ ...p, name: e.target.value }))} required autoComplete="name" />
                </label>
                <label className="rf-survey-field">
                  <span>Teléfono</span>
                  <input value={identity.phone} onChange={(e) => setIdentity((p) => ({ ...p, phone: e.target.value }))} inputMode="tel" />
                </label>
                <label className="rf-survey-field">
                  <span>DNI o RUC</span>
                  <input value={identity.doc_number} onChange={(e) => setIdentity((p) => ({ ...p, doc_number: e.target.value }))} inputMode="numeric" required />
                </label>
                <button type="submit" className="rf-survey-submit" disabled={linking}>
                  {linking ? 'Registrando…' : 'Registrar'}
                </button>
              </form>
            ) : screen === 'card' && continueData?.card ? (
              <div className="space-y-4 py-2">
                <button type="button" className="rf-survey-back" onClick={goHome}>Volver</button>
                <h2 className="rf-survey-sheet__section-title !border-0 !pb-0">Su {continueData.program_name || 'GIT Cards'}</h2>
                {registerNotice ? <p className="rf-survey-sheet__sub">{registerNotice}</p> : null}
                <GitCardVisual card={continueData.card} />
                <p className="rf-survey-sheet__sub">{continueData.next_step}</p>
                {(continueData.rewards || []).length ? (
                  <ul className="space-y-1 text-sm opacity-80">
                    {continueData.rewards.map((r, i) => (
                      <li key={`${r.title}-${i}`}>{r.title} · {r.status}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : screen === 'thanks' ? (
              <div className="text-center py-8 space-y-4">
                <h2 className="rf-survey-sheet__section-title !border-0 !pb-0">{form.thanks_title || 'Gracias'}</h2>
                <p className="rf-survey-sheet__sub">
                  {form.thanks_message
                    || `Recibimos tu opinión. Nos ayuda a mejorar tu experiencia en ${form.restaurant_name}.`}
                </p>
                <button type="button" className="rf-survey-submit" onClick={goHome}>Volver al inicio</button>
              </div>
            ) : (
              <form onSubmit={submit} className="rf-survey-sheet__form space-y-5">
                <button type="button" className="rf-survey-back" onClick={goHome}>Volver</button>
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
                      {(Array.isArray(form.area_options) && form.area_options.length
                        ? form.area_options
                        : [
                            { id: 'restaurante', label: 'Restaurante' },
                            { id: 'hotel', label: 'Hotel' },
                            { id: 'ambos', label: 'Ambos' },
                          ]
                      ).map((a) => (
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
