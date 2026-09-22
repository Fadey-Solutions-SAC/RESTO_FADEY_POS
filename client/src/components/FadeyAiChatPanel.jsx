import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MdSend, MdChatBubbleOutline, MdAutoAwesome, MdPerson } from 'react-icons/md';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  FADEY_AI_TAGLINE,
  FADEY_AI_CREATOR_MODE,
  FADEY_AI_SUGGESTION_POOL,
  FADEY_AI_SUGGESTION_VISIBLE,
  FADEY_AI_SUGGESTION_ROTATE_MS,
  getFadeyAiAvatarSrc,
  resolveFadeyAiMood,
  isFadeyAiCreatorMode,
  pickRotatingSuggestions,
} from '../constants/fadeyAiBranding';

function PixAvatar({ className = '', size = 'sm', mood = 'saludo' }) {
  return (
    <img
      src={getFadeyAiAvatarSrc(mood)}
      alt=""
      className={`rf-fadey-ai-pix ${size === 'lg' ? 'rf-fadey-ai-pix--lg' : size === 'header' ? 'rf-fadey-ai-pix--header' : 'rf-fadey-ai-pix--sm'} ${className}`}
      draggable={false}
    />
  );
}

function stripMd(s) {
  return String(s || '').replace(/\*\*/g, '').trim();
}

/** Parsea respuesta de guía → título + pasos numerados (solo si es guía real). */
function parseGuideContent(text, sources = null) {
  const raw = String(text || '').trim();
  if (!raw) return { title: null, steps: [], notes: [], plain: '' };

  const srcList = Array.isArray(sources) ? sources : [];
  const isGuideSource = srcList.some(
    (s) => s && (s.title === 'search_guides' || s.kind === 'guide' || s.kind === 'config'),
  );
  const hasPasoHeader = /^paso a paso\b/im.test(raw) || /\npaso a paso\b/i.test(raw);

  // Datos operativos (ventas, HR, demoras) NUNCA van como "Paso a paso".
  if (!isGuideSource && !hasPasoHeader) {
    return { title: null, steps: [], notes: [], plain: raw };
  }

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

function AssistantCard({ content, sources = null }) {
  const parsed = parseGuideContent(content, sources);
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
const FadeyAiChatPanel = forwardRef(function FadeyAiChatPanel({
  isActive = false,
  variant = 'popup',
  suggested,
  introMessage = '',
}, ref) {
  const { user } = useAuth();
  const creatorMode = isFadeyAiCreatorMode(user);
  const suggestionPool = useMemo(() => {
    const fromProp = Array.isArray(suggested)
      ? suggested.map((q) => String(q || '').trim()).filter(Boolean)
      : [];
    const base = creatorMode
      ? [...(FADEY_AI_CREATOR_MODE.suggested || []), ...FADEY_AI_SUGGESTION_POOL]
      : FADEY_AI_SUGGESTION_POOL;
    return [...new Set([...fromProp, ...base])];
  }, [suggested, creatorMode]);
  const [suggestOffset, setSuggestOffset] = useState(0);
  const chips = useMemo(
    () => pickRotatingSuggestions(suggestionPool, suggestOffset, FADEY_AI_SUGGESTION_VISIBLE),
    [suggestionPool, suggestOffset],
  );
  const isHome = variant === 'home';
  const emptyGreeting = creatorMode
    ? FADEY_AI_CREATOR_MODE.greeting
    : (introMessage || '');
  const emptyTagline = creatorMode ? FADEY_AI_CREATOR_MODE.tagline : FADEY_AI_TAGLINE;
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /** Opciones rápidas del saludo (aparte de chips de sugerencias fijas). */
  const [replyOptions, setReplyOptions] = useState([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sendTextRef = useRef(null);
  const pendingPromptRef = useRef('');
  const loadingRef = useRef(true);
  const busyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      try {
        inputRef.current?.focus?.();
      } catch (_) {
        /* noop */
      }
    },
    sendPrompt: (raw) => {
      const msg = String(raw || '').trim();
      if (!msg) return;
      if (loadingRef.current || busyRef.current) {
        pendingPromptRef.current = msg;
        return;
      }
      void sendTextRef.current?.(msg);
    },
  }));

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
    if (suggestionPool.length <= FADEY_AI_SUGGESTION_VISIBLE) return undefined;
    const id = setInterval(() => {
      setSuggestOffset((prev) => (prev + 1) % suggestionPool.length);
    }, FADEY_AI_SUGGESTION_ROTATE_MS);
    return () => clearInterval(id);
  }, [isActive, suggestionPool.length]);

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
    setReplyOptions([]);
    const optimistic = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await api.post('/fadey-ai/chat', { message: msg });
      const opts = Array.isArray(res?.options)
        ? res.options.map((o) => String(o || '').trim()).filter(Boolean)
        : [];
      setMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          role: 'assistant',
          content: res?.reply || 'Sin respuesta',
          sources: res?.sources || null,
          options: opts.length ? opts : null,
          created_at: new Date().toISOString(),
        },
      ]);
      setReplyOptions(opts);
      if (res?.status) setStatus(res.status);
    } catch (err) {
      setError(err.message || 'No se pudo enviar');
      setReplyOptions([]);
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

  sendTextRef.current = sendText;
  loadingRef.current = loading;
  busyRef.current = busy;

  useEffect(() => {
    if (loading || busy) return undefined;
    const pending = String(pendingPromptRef.current || '').trim();
    if (!pending) return undefined;
    pendingPromptRef.current = '';
    const t = setTimeout(() => {
      void sendTextRef.current?.(pending);
    }, 50);
    return () => clearTimeout(t);
  }, [loading, busy]);

  if (loading) {
    return <p className="text-sm text-[#64748b] text-center py-8">Cargando…</p>;
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
        <div className="rf-fadey-ai-avatar-lg rf-fadey-ai-avatar-lg--photo">
          <PixAvatar size="lg" mood="saludo" />
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
              <PixAvatar size="lg" mood="saludo" />
            </div>
            <p className="text-sm font-semibold text-[#0f172a]">PIX</p>
            <p className="text-sm font-medium text-[#2563eb]">{emptyTagline}</p>
            {creatorMode ? (
              <p className="text-sm text-[#0f172a] max-w-[18rem] whitespace-pre-wrap leading-snug">
                {FADEY_AI_CREATOR_MODE.greeting}
              </p>
            ) : (
              <p className="text-xs text-[#64748b] max-w-[16rem]">
                Pregunta cómo hacer algo en el POS o elige una sugerencia.
              </p>
            )}
          </div>
        ) : messages.length === 0 && (isHome ? emptyGreeting : false) ? (
          <div className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
            <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
              <PixAvatar size="sm" mood="asesorando" />
            </div>
            <div className="rf-fadey-ai-card">
              <p className="rf-fadey-ai-card-plain whitespace-pre-wrap">{emptyGreeting}</p>
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
            const mood = resolveFadeyAiMood({ sources: m.sources, content: m.content });
            return (
              <div key={m.id} className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
                <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
                  <PixAvatar size="sm" mood={mood} />
                </div>
                <AssistantCard content={m.content} sources={m.sources} />
              </div>
            );
          })
        )}
        {busy ? (
          <div className="rf-fadey-ai-row rf-fadey-ai-row--assistant">
            <div className="rf-fadey-ai-avatar-sm rf-fadey-ai-avatar-sm--photo" aria-hidden>
              <PixAvatar size="sm" mood="pensando" />
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
        {replyOptions.length > 0 ? (
          <div className="rf-fadey-ai-suggest rf-fadey-ai-suggest--options">
            <p className="rf-fadey-ai-suggest-label">
              <MdAutoAwesome className="rf-fadey-ai-suggest-star" />
              En qué puedo ayudarte
            </p>
            <div className="rf-fadey-ai-suggest-chips">
              {replyOptions.map((q) => (
                <button
                  key={`opt-${q}`}
                  type="button"
                  className="rf-fadey-ai-chip rf-fadey-ai-chip--option"
                  disabled={busy}
                  onClick={() => void sendText(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {(!isHome || messages.length === 0) ? (
          <div className="rf-fadey-ai-suggest">
            <p className="rf-fadey-ai-suggest-label">
              <MdAutoAwesome className="rf-fadey-ai-suggest-star" />
              Preguntas sugeridas
            </p>
            <div className="rf-fadey-ai-suggest-chips" aria-live="polite">
              {chips.map((q, idx) => (
                <button
                  key={`${suggestOffset}-${idx}-${q}`}
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
        ) : null}

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

        {!isHome ? (
          <p className="rf-fadey-ai-disclaimer">
            IA Fadey puede cometer errores. Verifica la información importante.
          </p>
        ) : null}
      </div>
    </div>
  );
});

export default FadeyAiChatPanel;
