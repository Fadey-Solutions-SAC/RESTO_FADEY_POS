import { useCallback, useEffect, useRef, useState } from 'react';
import { MdPsychology, MdSend } from 'react-icons/md';
import { api } from '../utils/api';

function renderContent(text) {
  const raw = String(text || '');
  const parts = raw.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--ui-body-text)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Chat del asistente IA Fadey (instancia local). Separado de avisos y mensajes del equipo.
 */
export default function FadeyAiChatPanel({ isActive = false }) {
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

  useEffect(() => {
    if (isActive) scrollBottom();
  }, [messages, isActive, busy]);

  const send = async () => {
    const msg = String(input || '').trim();
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
    return <p className="text-sm text-[var(--ui-muted)] text-center py-8">Cargando…</p>;
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
        <MdPsychology className="text-3xl text-[var(--ui-muted)]" />
        <p className="text-sm font-medium text-[var(--ui-body-text)]">IA Fadey desactivada</p>
        <p className="text-xs text-[var(--ui-muted)]">
          Actívala en Admin Maestro → control del plan.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-0.5 pb-2">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2 py-10">
            <div className="w-12 h-12 rounded-full bg-[color-mix(in_srgb,var(--ui-accent)_14%,var(--ui-surface))] flex items-center justify-center">
              <MdPsychology className="text-2xl text-[var(--ui-accent)]" />
            </div>
            <p className="text-sm font-medium text-[var(--ui-body-text)]">¿En qué te ayudo?</p>
            <p className="text-xs text-[var(--ui-muted)] max-w-[16rem]">
              Pregunta cómo hacer algo en el POS, por ejemplo crear un área o cerrar caja.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                    isUser
                      ? 'bg-[color-mix(in_srgb,var(--ui-accent)_16%,var(--ui-surface))] text-[var(--ui-body-text)] rounded-br-md'
                      : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border border-[color:var(--ui-border)] rounded-bl-md'
                  }`}
                >
                  {renderContent(m.content)}
                </div>
              </div>
            );
          })
        )}
        {busy ? (
          <p className="text-xs text-[var(--ui-muted)] italic px-1">Pensando…</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-[11px] text-rose-600 shrink-0 px-1 pb-1">{error}</p> : null}

      <form
        className="shrink-0 flex gap-2 items-center pt-1 border-t border-[color:var(--ui-border)] mt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="input-field flex-1 min-h-[44px] h-11 text-sm rounded-full px-4"
          value={input}
          disabled={busy}
          placeholder="Escribe tu pregunta…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="shrink-0 w-11 h-11 rounded-full bg-[var(--ui-accent)] text-white flex items-center justify-center shadow-md disabled:opacity-45 hover:opacity-95 transition-opacity"
          disabled={busy || !String(input).trim()}
          aria-label="Enviar"
        >
          <MdSend className="text-lg translate-x-px" />
        </button>
      </form>
    </div>
  );
}
