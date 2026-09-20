import { useCallback, useEffect, useRef, useState } from 'react';
import { MdSend, MdChatBubbleOutline, MdAutoAwesome, MdPerson } from 'react-icons/md';
import { api } from '../utils/api';
import { FADEY_AI_AVATAR_SRC, FADEY_AI_TAGLINE } from '../constants/fadeyAiBranding';

const SUGGESTED = [
  '¿Cómo cerrar caja?',
  '¿Cómo cambiar una mesa?',
  '¿Cómo registrar una venta?',
];

function PixAvatar({ className = '', size = 'sm' }) {
  return (
    <img
      src={FADEY_AI_AVATAR_SRC}
      alt=""
      className={`rf-fadey-ai-pix ${size === 'lg' ? 'rf-fadey-ai-pix--lg' : size === 'header' ? 'rf-fadey-ai-pix--header' : 'rf-fadey-ai-pix--sm'} ${className}`}
      draggable={false}
    />
  );
}

const HOME_SUGGESTED = [
  '¿Qué vendimos hoy?',
  '¿Qué productos se venden más?',
  'Genera un resumen de ventas',
  '¿Qué me recomiendas hoy?',
];

function stripMd(s) {
  return String(s || '').replace(/\*\*/g, '').trim();
}

/** Parsea respuesta de guía → título + pasos numerados (estilo referencia). */
function parseGuideContent(text) {
  const raw = String(text || '').trim();
  if (!raw) return { title: null, steps: [], notes: [], plain: '' };

  const lines = raw.split(/\n/).map((l) => l.trimEnd());
  let title = null;
  const steps = [];
  const notes = [];
  let i = 0;

  while (i < lines.length) {
    const line = String(lines[i] || '').trim();
    if (!line) {
      i += 1;
      continue;
    }

    const bold = line.match(/^\*\*(.+?)\*\*$/);
    if (bold && !title) {
      title = stripMd(bold[1]);
      i += 1;
      continue;
    }

    if (/^paso a paso/i.test(line)) {
      if (!title) {
        title = stripMd(line.replace(/^paso a paso\s*[—\-–:]?\s*/i, '').replace(/:$/, ''));
      }
      i += 1;
      continue;
    }

    if (/^(nota|importante)\b/i.test(line)) {
      const head = stripMd(line.replace(/^(nota|importante)\s*[—\-–:]?\s*/i, ''));
      if (head) notes.push(head);
      let j = i + 1;
      while (j < lines.length) {
        const nxt = String(lines[j] || '').trim();
        if (!nxt) {
          j += 1;
          continue;
        }
        if (/^(\d+)\.\s+/.test(nxt) || /^\*\*/.test(nxt) || /^(nota|importante)\b/i.test(nxt)) break;
        if (/^[-•*]/.test(nxt)) {
          notes.push(stripMd(nxt.replace(/^[-•*]\s*/, '')));
          j += 1;
          continue;
        }
        notes.push(stripMd(nxt));
        j += 1;
      }
      i = j;
      continue;
    }

    const stepMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (stepMatch) {
      let rest = stripMd(stepMatch[2]);
      let stepTitle = rest;
      let detail = '';
      const paren = rest.match(/^(.+?)\s*\((.+)\)\.?$/);
      const dash = rest.match(/^(.+?)\s*[—\-–:]\s*(.+)$/);
      if (paren) {
        stepTitle = paren[1].trim();
        detail = paren[2].trim().replace(/\.$/, '');
        detail = detail.charAt(0).toUpperCase() + detail.slice(1);
      } else if (dash && !/^\d/.test(dash[2])) {
        stepTitle = dash[1].trim();
        detail = dash[2].trim();
      } else if (rest.endsWith(':')) {
        stepTitle = rest.replace(/:$/, '').trim();
        detail = '';
      }

      const bullets = [];
      let j = i + 1;
      while (j < lines.length) {
        const nxt = String(lines[j] || '').trim();
        if (!nxt) {
          j += 1;
          continue;
        }
        if (/^(\d+)\.\s+/.test(nxt) || /^(nota|importante)\b/i.test(nxt) || /^\*\*/.test(nxt)) break;
        if (/^[-•*]/.test(nxt)) {
          bullets.push(stripMd(nxt.replace(/^[-•*]\s*/, '').replace(/,\s*o$/i, '').replace(/,$/, '')));
          j += 1;
          continue;
        }
        break;
      }
      steps.push({ n: Number(stepMatch[1]), title: stepTitle, detail, bullets });
      i = j;
      continue;
    }

    if (/^[-•*]/.test(line) && steps.length) {
      steps[steps.length - 1].bullets.push(stripMd(line.replace(/^[-•*]\s*/, '')));
      i += 1;
      continue;
    }

    if (!title && !/^\d+\./.test(line)) {
      title = stripMd(line);
      i += 1;
      continue;
    }

    notes.push(stripMd(line));
    i += 1;
  }

  if (steps.length === 0) {
    return { title: null, steps: [], notes: [], plain: raw };
  }
  return { title, steps, notes, plain: null };
}

function AssistantCard({ content }) {
  const parsed = parseGuideContent(content);
  if (parsed.plain) {
    return (
      <div className="rf-fadey-ai-card">
        <p className="rf-fadey-ai-card-plain whitespace-pre-wrap">{parsed.plain.replace(/\*\*/g, '')}</p>
      </div>
    );
  }
  return (
    <div className="rf-fadey-ai-card">
      {parsed.title ? <h3 className="rf-fadey-ai-card-title">{parsed.title}</h3> : null}
      <p className="rf-fadey-ai-card-label">Paso a paso</p>
      <ol className="rf-fadey-ai-steps">
        {parsed.steps.map((s) => (
          <li key={s.n} className="rf-fadey-ai-step">
            <span className="rf-fadey-ai-step-num" aria-hidden>
              {s.n}
            </span>
            <div className="rf-fadey-ai-step-body">
              <p className="rf-fadey-ai-step-title">{s.title}</p>
              {s.detail ? <p className="rf-fadey-ai-step-detail">{s.detail}</p> : null}
              {s.bullets?.length ? (
                <ul className="rf-fadey-ai-step-bullets">
                  {s.bullets.map((b, idx) => (
                    <li key={idx}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {parsed.notes.length ? (
        <div className="rf-fadey-ai-notes">
          {parsed.notes.map((n, idx) => (
            <p key={idx}>{n}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Chat IA Fadey — UI alineada a la referencia (avatar, pasos, chips, disclaimer).
 * variant "home": sede general dentro de Indicadores → IA Fadey.
 */
export default function FadeyAiChatPanel({
  isActive = false,
  variant = 'popup',
  suggested,
  introMessage = '',
}) {
  const chips = suggested || (variant === 'home' ? HOME_SUGGESTED : SUGGESTED);
  const isHome = variant === 'home';
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const scrollBottom = () => {
    try {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (_) {
      /* noop */
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const st = await api.get('/fadey-ai/status');
      setStatus(st);
      if (st?.enabled) {
        const hist = await api.get('/fadey-ai/history').catch(() => ({ messages: [] }));
        setMessages(Array.isArray(hist?.messages) ? hist.messages : []);
      } else {
        setMessages([]);
      }
    } catch (err) {
      setError(err.message || 'No se pudo cargar IA Fadey');
      setStatus({ enabled: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;
    void load();
    return undefined;
  }, [isActive, load]);

  /** Si cruza medianoche con el panel abierto, recarga (servidor ya borró el historial). */
  useEffect(() => {
    if (!isActive) return undefined;
    let lastDay = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
    const tick = () => {
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
      if (day !== lastDay) {
        lastDay = day;
        setMessages([]);
        void load();
      }
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [isActive, load]);

  useEffect(() => {
    if (isActive) scrollBottom();
  }, [messages, isActive, busy]);

  const sendText = async (raw) => {
    const msg = String(raw || '').trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);
    setError('');
    const optimistic = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await api.post('/fadey-ai/chat', { message: msg });
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: res?.reply || 'Sin respuesta',
          sources: res?.sources || null,
          created_at: new Date().toISOString(),
        },
      ]);
      if (res?.status) setStatus(res.status);
    } catch (err) {
      setError(err.message || 'No se pudo enviar');
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: err.message || 'Error al consultar la IA.',
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus?.());
    }
  };

  if (loading) {
    return <p className="text-sm text-[#64748b] text-center py-8">Cargando…</p>;
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
        <div className="rf-fadey-ai-avatar-lg rf-fadey-ai-avatar-lg--photo">
          <PixAvatar size="lg" />
        </div>
        <p className="text-sm font-semibold text-[#0f172a]">IA Fadey desactivada</p>
        <p className="text-xs text-[#64748b]">Actívala en Admin Maestro → control del plan.</p>
      </div>
    );
  }

  return (
    <div className={`rf-fadey-ai-body h-full min-h-0 flex flex-col ${isHome ? 'rf-fadey-ai-body--home' : ''}`}>
      <div className="rf-fadey-ai-scroll flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-2 space-y-3">
        {messages.length === 0 && !isHome ? (
          <div className="flex flex-col items-center justify-center text-center px-4 gap-2 py-8">
            <div className="rf-fadey-ai-avatar-lg rf-fadey-ai-avatar-lg--photo">
              <PixAvatar size="lg" />
            </div>
            <p className="text-sm font-semibold text-[#0f172a]">PIX</p>
            <p className="text-sm font-medium text-[#2563eb]">{FADEY_AI_TAGLINE}</p>
            <p className="text-xs text-[#64748b] max-w-[16rem]">
              Pregunta cómo hacer algo en el POS o elige una sugerencia.
            </p>
          </div>
        ) : messages.length === 0 && isHome && introMessage ? (
          <div className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
            <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
              <PixAvatar size="sm" />
            </div>
            <div className="rf-fadey-ai-card">
              <p className="rf-fadey-ai-card-plain whitespace-pre-wrap">{introMessage}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-[#64748b] text-center py-4">Escribe una consulta o elige una sugerencia.</p>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            if (isUser) {
              return (
                <div key={m.id} className="rf-fadey-ai-row rf-fadey-ai-row--user">
                  <div className="rf-fadey-ai-bubble-user">{m.content}</div>
                  <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--user" aria-hidden>
                    <MdPerson />
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
                <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
                  <PixAvatar size="sm" />
                </div>
                <AssistantCard content={m.content} />
              </div>
            );
          })
        )}
        {busy ? (
          <div className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
            <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
              <PixAvatar size="sm" />
            </div>
            <div className="rf-fadey-ai-card rf-fadey-ai-card--typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="rf-fadey-ai-footer shrink-0">
        <div className="rf-fadey-ai-suggest">
          <p className="rf-fadey-ai-suggest-label">
            <MdAutoAwesome className="rf-fadey-ai-suggest-star" />
            Preguntas sugeridas
          </p>
          <div className="rf-fadey-ai-suggest-chips">
            {chips.map((q) => (
              <button
                key={q}
                type="button"
                className="rf-fadey-ai-chip"
                disabled={busy}
                onClick={() => void sendText(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-[11px] text-rose-600 px-1 pb-1">{error}</p> : null}

        <form
          className="rf-fadey-ai-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendText(input);
          }}
        >
          <div className="rf-fadey-ai-input-wrap">
            <MdChatBubbleOutline className="rf-fadey-ai-input-icon" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              className="rf-fadey-ai-input"
              value={input}
              disabled={busy}
              placeholder={isHome ? 'Escribe tu consulta…' : 'Escribe tu pregunta...'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void sendText(input);
                }
              }}
            />
          </div>
          <button
            type="submit"
            className="rf-fadey-ai-send"
            disabled={busy || !String(input).trim()}
            aria-label="Enviar"
          >
            <MdSend className="text-[1.15rem] translate-x-px -translate-y-px" />
          </button>
        </form>

        <p className="rf-fadey-ai-disclaimer">
          IA Fadey puede cometer errores. Verifica la información importante.
        </p>
      </div>
    </div>
  );
}
