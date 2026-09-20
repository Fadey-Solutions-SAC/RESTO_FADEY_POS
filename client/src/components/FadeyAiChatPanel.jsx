import { useCallback, useEffect, useRef, useState } from 'react';
import { MdPsychology, MdSend } from 'react-icons/md';
import { api } from '../utils/api';

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
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
              m.role === 'user'
                ? 'bg-[var(--ui-accent)]/15 ml-6'
                : 'bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] mr-4'
            }`}
          >
            {m.content}
          </div>
        ))}
        {busy ? (
          <p className="text-xs text-[var(--ui-muted)] italic px-1">…</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-[11px] text-rose-600 shrink-0">{error}</p> : null}

      <form
        className="shrink-0 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="input-field flex-1 min-h-[40px] max-h-24 text-sm resize-y py-2"
          rows={1}
          value={input}
          disabled={busy}
          placeholder="Escribe tu pregunta…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="btn-primary p-2.5 shrink-0"
          disabled={busy || !String(input).trim()}
          aria-label="Enviar"
        >
          <MdSend className="text-lg" />
        </button>
      </form>
    </div>
  );
}
