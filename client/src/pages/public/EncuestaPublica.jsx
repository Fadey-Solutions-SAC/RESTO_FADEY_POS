import { useEffect, useState } from 'react';
import { api, resolveMediaUrl } from '../../utils/api';
import toast from 'react-hot-toast';

const FALLBACK_NAME = 'Resto Fadey App';

function StarPick({ value, onChange, name }) {
  return (
    <div className="rf-survey-stars" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'is-on' : ''}
          aria-label={`${n} de 5`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function EncuestaPublica() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    restaurant_name: FALLBACK_NAME,
    logo: '',
    cover_image: '',
    title: 'Tu experiencia',
    subtitle: 'Cuéntanos cómo te fue en tu visita.',
    name_label: 'Tu nombre',
    rating_label: 'Calificación general',
    comment_label: 'Comentario (opcional)',
    comment_placeholder: '',
    show_comment: true,
    submit_label: 'Enviar encuesta',
    thanks_title: 'Gracias',
    thanks_message: '',
    questions: [],
  });
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState(0);
  const [answers, setAnswers] = useState({});

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
        setForm((prev) => ({
          ...prev,
          ...data,
          restaurant_name: String(data?.restaurant_name || '').trim() || FALLBACK_NAME,
          questions: Array.isArray(data?.questions) ? data.questions : [],
          show_comment: data?.show_comment !== false,
        }));
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
    if (!rating) {
      toast.error(`Elige ${String(form.rating_label || 'una calificación').toLowerCase()}`);
      return;
    }
    for (const q of form.questions) {
      if (!answers[q.id]) {
        toast.error('Completa todas las opciones de la experiencia');
        return;
      }
    }
    setSending(true);
    try {
      await api.post('/public/loyalty', {
        customer_name: name.trim(),
        comment: form.show_comment ? comment.trim() : '',
        rating,
        answers,
      });
      setDone(true);
    } catch (err) {
      toast.error(err.message || 'No se pudo enviar');
    } finally {
      setSending(false);
    }
  };

  const cover = form.cover_image;

  return (
    <div className="rf-login-shell rf-login-page rf-login-page--survey">
      <div
        className={`rf-login-cover-bg${cover ? ' rf-login-cover-bg--has-image' : ' rf-login-cover-bg--empty'}`}
        aria-hidden="true"
      >
        {cover ? <img src={resolveMediaUrl(cover)} alt="" /> : null}
      </div>
      <div className="rf-login-page__content rf-login-page__content--visible">
        <div className="rf-login-center w-full max-w-md relative z-10 px-4">
          <div className="rf-login-brand text-center">
            {form.logo ? (
              <img
                src={resolveMediaUrl(form.logo)}
                alt=""
                className="rf-login-brand-logo mx-auto rounded-full"
              />
            ) : null}
            <h1 className="rf-font-display text-3xl font-bold text-[#e8f4fc] tracking-tight px-1">
              {form.restaurant_name}
            </h1>
          </div>

          <div className="rf-login-form">
            {loading ? (
              <p className="rf-login-subtitle">Cargando encuesta…</p>
            ) : done ? (
              <>
                <h2 className="rf-login-title">{form.thanks_title || 'Gracias'}</h2>
                <p className="rf-login-subtitle">
                  {form.thanks_message
                    || `Recibimos tu opinión. Nos ayuda a mejorar tu experiencia en ${form.restaurant_name}.`}
                </p>
              </>
            ) : (
              <>
                <h2 className="rf-login-title">{form.title}</h2>
                {form.subtitle ? <p className="rf-login-subtitle">{form.subtitle}</p> : null}
                <form onSubmit={submit} className="rf-login-fields space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">{form.name_label}</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="rf-login-input"
                      maxLength={80}
                      required
                      autoComplete="name"
                    />
                  </div>

                  {form.questions.map((q) => (
                    <div key={q.id}>
                      <label className="block text-sm font-medium mb-1.5">{q.label}</label>
                      <StarPick
                        name={q.label}
                        value={Number(answers[q.id] || 0)}
                        onChange={(n) => setAnswer(q.id, n)}
                      />
                    </div>
                  ))}

                  <div>
                    <label className="block text-sm font-medium mb-1.5">{form.rating_label}</label>
                    <StarPick name={form.rating_label} value={rating} onChange={setRating} />
                  </div>

                  {form.show_comment ? (
                    <div>
                      <label className="block text-sm font-medium mb-1.5">{form.comment_label}</label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="rf-login-input min-h-[5.5rem] py-2"
                        maxLength={500}
                        rows={3}
                        placeholder={form.comment_placeholder || ''}
                      />
                    </div>
                  ) : null}

                  <button type="submit" className="rf-login-submit" disabled={sending}>
                    {sending ? 'Enviando…' : (form.submit_label || 'Enviar encuesta')}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
