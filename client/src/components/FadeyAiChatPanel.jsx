import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdSend, MdChatBubbleOutline, MdAutoAwesome, MdPerson, MdSupportAgent } from 'react-icons/md';
import { api } from '../utils/api';
import { getShellModuleTitle } from '../utils/shellModuleTitle';
import FadeyAiReportView from './FadeyAiReportView';
import { exportReportExcel, exportReportPdf } from '../utils/fadeyReportExport';

const REPORT_DOWNLOAD_RE = /^(descargar?\s*|download\s*)?(en\s*|in\s*|as\s*)?(excel|pdf)[.!]*$/i;
import { useAuth } from '../context/AuthContext';
import {
  FADEY_AI_TAGLINE,
  FADEY_AI_CREATOR_MODE,
  FADEY_AI_SUGGESTION_POOL,
  FADEY_AI_SUGGESTION_POOL_EN,
  FADEY_AI_SUGGESTION_VISIBLE,
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

function dayKeyInZone(timeZone) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone });
  } catch (_) {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  }
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

const MARQUEE_PX_PER_SEC = 70;

/** Una sola fila: el grupo de sugerencias cruza de derecha a izquierda y al salir entra el siguiente grupo. */
function SuggestionMarquee({ items, cycleKey, busy, onPick, onCycle }) {
  const approxWidth = items.reduce((s, q) => s + String(q).length * 6.6 + 34, 0) + 360;
  const duration = Math.max(8, Math.round(approxWidth / MARQUEE_PX_PER_SEC));
  return (
    <div className="rf-fadey-ai-marquee" aria-live="polite">
      <div
        key={cycleKey}
        className="rf-fadey-ai-marquee-track"
        style={{ '--rf-marquee-duration': `${duration}s` }}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) onCycle();
        }}
      >
        {items.map((q, idx) => (
          <button
            key={`${cycleKey}-${idx}-${q}`}
            type="button"
            className="rf-fadey-ai-chip"
            disabled={busy}
            onClick={() => onPick(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function SupportContactBlock({ support }) {
  const en = support.lang === 'en';
  return (
    <div className="mt-3 space-y-2">
      <a
        href={support.whatsapp_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5a]"
      >
        <MdSupportAgent className="text-lg" aria-hidden />
        {en ? 'Send to support on WhatsApp' : 'Enviar a soporte por WhatsApp'} ({support.whatsapp_number})
      </a>
      {support.whatsapp_message ? (
        <details className="text-xs text-[#475569]">
          <summary className="cursor-pointer select-none">{en ? 'View prepared message' : 'Ver mensaje preparado'}</summary>
          <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-sans">{support.whatsapp_message.replace(/\*/g, '')}</pre>
        </details>
      ) : null}
    </div>
  );
}

function findReport(sources) {
  return Array.isArray(sources) ? sources.find((s) => s?.title === 'report' && s?.report)?.report || null : null;
}

function AssistantCard({ content, sources = null, onExportReport, exporting = '' }) {
  const support = Array.isArray(sources) ? sources.find((s) => s?.title === 'support_contact' && s?.whatsapp_url) : null;
  const report = findReport(sources);
  const parsed = parseGuideContent(content, sources);
  if (parsed.plain || support || report) {
    return (
      <div className="rf-fadey-ai-card">
        <p className="rf-fadey-ai-card-plain whitespace-pre-wrap">{String(parsed.plain || content || '').replace(/\*\*/g, '')}</p>
        {support ? <SupportContactBlock support={support} /> : null}
        {report ? (
          <FadeyAiReportView
            report={report}
            exporting={exporting}
            onExport={onExportReport ? (format) => onExportReport(report, format) : null}
          />
        ) : null}
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
  const { t: td } = useTranslation('dashboard');
  const creatorMode = isFadeyAiCreatorMode(user);
  const [chatLang, setChatLang] = useState('es');
  const suggestionPool = useMemo(() => {
    if (chatLang === 'en') return FADEY_AI_SUGGESTION_POOL_EN;
    const blocked = /qui[eé]n te cre[oó]/i;
    const fromProp = Array.isArray(suggested)
      ? suggested.map((q) => String(q || '').trim()).filter(Boolean)
      : [];
    const base = creatorMode
      ? [...(FADEY_AI_CREATOR_MODE.suggested || []), ...FADEY_AI_SUGGESTION_POOL]
      : FADEY_AI_SUGGESTION_POOL;
    return [...new Set([...fromProp, ...base])].filter((q) => !blocked.test(q));
  }, [suggested, creatorMode, chatLang]);
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
  const [exporting, setExporting] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /** Opciones rápidas del saludo (aparte de chips de sugerencias fijas). */
  const [replyOptions, setReplyOptions] = useState([]);
  const [optionsOffset, setOptionsOffset] = useState(0);
  const optionChips = useMemo(
    () => pickRotatingSuggestions(replyOptions, optionsOffset, FADEY_AI_SUGGESTION_VISIBLE),
    [replyOptions, optionsOffset],
  );
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

  /** Día del chat según la zona horaria del restaurante (la envía el servidor). */
  const chatDayRef = useRef({ day: '', timezone: 'America/Lima' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const st = await api.get('/fadey-ai/status');
      setStatus(st);
      if (st?.enabled) {
        const hist = await api.get('/fadey-ai/history').catch(() => ({ messages: [] }));
        const timezone = String(hist?.timezone || st?.timezone || 'America/Lima');
        chatDayRef.current = {
          day: String(hist?.day || st?.day || dayKeyInZone(timezone)),
          timezone,
        };
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

  /**
   * Al pasar la medianoche (hora local del restaurante) limpia el chat y recarga.
   * También revisa al volver a la pestaña o despertar el equipo, porque los temporizadores se pausan.
   */
  useEffect(() => {
    if (!isActive) return undefined;
    const check = () => {
      const { day, timezone } = chatDayRef.current;
      if (!day) return;
      if (dayKeyInZone(timezone) !== day) {
        chatDayRef.current = { day: dayKeyInZone(timezone), timezone };
        setMessages([]);
        setReplyOptions([]);
        void load();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const id = setInterval(check, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [isActive, load]);

  useEffect(() => {
    if (isActive) scrollBottom();
  }, [messages, isActive, busy]);

  const exportReport = async (report, format) => {
    if (!report || exporting) return;
    setExporting(format);
    setError('');
    try {
      if (format === 'pdf') exportReportPdf(report);
      else await exportReportExcel(report);
    } catch (err) {
      setError(err?.message || (report.lang === 'en' ? 'Could not generate the file' : 'No se pudo generar el archivo'));
    } finally {
      setExporting('');
    }
  };

  const sendText = async (raw) => {
    const msg = String(raw || '').trim();
    if (!msg || busy) return;
    const downloadMatch = msg.normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(REPORT_DOWNLOAD_RE);
    const lastReport = downloadMatch
      ? [...messages].reverse().map((m) => (m.role === 'assistant' ? findReport(m.sources) : null)).find(Boolean)
      : null;
    if (downloadMatch && lastReport) {
      const format = downloadMatch[3].toLowerCase();
      setInput('');
      setReplyOptions([]);
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: `local-${now}`, role: 'user', content: msg, created_at: new Date().toISOString() },
        {
          id: `asst-${now}`,
          role: 'assistant',
          content: lastReport.lang === 'en'
            ? (format === 'pdf'
              ? `Done. I opened “${lastReport.title}” (${lastReport.subtitle}) with all charts and tables in a new page: use “Print / Save as PDF” and choose “Save as PDF”.`
              : `Done. I'm downloading “${lastReport.title}” (${lastReport.subtitle}) in Excel: a “Summary” sheet with indicators and charts, plus one sheet per detail table.`)
            : (format === 'pdf'
              ? `Listo. Abrí «${lastReport.title}» (${lastReport.subtitle}) con todos los gráficos y tablas en una página nueva: usa «Imprimir / Guardar como PDF» y elige «Guardar como PDF».`
              : `Listo. Estoy descargando «${lastReport.title}» (${lastReport.subtitle}) en Excel: hoja «Resumen» con indicadores y gráficos, y una hoja por cada tabla de detalle.`),
          created_at: new Date().toISOString(),
        },
      ]);
      void exportReport(lastReport, format);
      return;
    }
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
      const res = await api.post('/fadey-ai/chat', {
        message: msg,
        context: {
          host: typeof window !== 'undefined' ? window.location.host : '',
          path: typeof window !== 'undefined' ? window.location.pathname : '',
          module_title: typeof window !== 'undefined'
            ? getShellModuleTitle(window.location.pathname, window.location.search, td)
            : '',
        },
      });
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
      setOptionsOffset(0);
      if (res?.lang === 'en' || res?.lang === 'es') {
        if (res.lang !== chatLang) setSuggestOffset(0);
        setChatLang(res.lang);
      }
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
        <p className="text-sm font-semibold text-[#0f172a]">IA Fadey no disponible</p>
        <p className="text-xs text-[#64748b]">Mejora tu plan para obtener el beneficio.</p>
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
                Pregunta cómo hacer algo en el sistema o elige una sugerencia.
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
                <AssistantCard content={m.content} sources={m.sources} onExportReport={exportReport} exporting={exporting} />
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
        {replyOptions.length > 0 || !isHome || messages.length === 0 ? (
          <div className="rf-fadey-ai-suggest">
            <p className="rf-fadey-ai-suggest-label">
              <MdAutoAwesome className="rf-fadey-ai-suggest-star" />
              {chatLang === 'en' ? 'Suggested questions' : 'Preguntas sugeridas'}
            </p>
            {replyOptions.length > 0 ? (
              <SuggestionMarquee
                items={optionChips}
                cycleKey={`opt-${optionsOffset}-${replyOptions.join('|')}`}
                busy={busy}
                onPick={(q) => void sendText(q)}
                onCycle={() => setOptionsOffset((prev) => prev + FADEY_AI_SUGGESTION_VISIBLE)}
              />
            ) : (
              <SuggestionMarquee
                items={chips}
                cycleKey={`sug-${chatLang}-${suggestOffset}`}
                busy={busy}
                onPick={(q) => void sendText(q)}
                onCycle={() => setSuggestOffset((prev) => (prev + FADEY_AI_SUGGESTION_VISIBLE) % Math.max(1, suggestionPool.length))}
              />
            )}
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
            IA Fadey puede cometer errores. Verifica la información importante en el modulo correspondiente.
          </p>
        ) : null}
      </div>
    </div>
  );
});

export default FadeyAiChatPanel;
