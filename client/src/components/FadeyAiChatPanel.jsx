import { useCallback, useEffect, useRef, useState } from 'react';
import { MdPsychology, MdSend } from 'react-icons/md';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const SUGGESTIONS = [
  'Cómo cerrar caja',
  'Cómo generar un requerimiento',
  'Cómo hacer una recepción',
  'Cómo cargar una carta al auto pedido',
  'Cómo mostrar productos o cartas en el QR',
  'Cómo crear un usuario',
  'Cómo configurar impresora',
  'Cómo configurar salones y mesas',
  'Resume mis ventas del mes',
  'Qué plato se vendió más hoy',
];

/**
 * Chat del asistente IA Fadey (instancia local).
 */
export default function FadeyAiChatPanel({ isActive = false }) {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const role = String(user?.role || '').toLowerCase();

  const chips = SUGGESTIONS.filter((s) => {
    if (role === 'cocina' || role === 'bar' || role === 'produccion') {
      return !/ventas del mes|vendió más/i.test(s);
    }
    if (role === 'mozo') {
      return !/requerimiento|recepción|impresora/i.test(s);
    }
    return true;
  }).slice(0, 6);

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

  const send = async (text) => {
    const msg = String(text || input || '').trim();
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
    return <p className="text-sm text-[var(--ui-muted)] text-center py-8">Cargando IA Fadey…</p>;
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
        <MdPsychology className="text-3xl text-[var(--ui-muted)]" />
        <p className="text-sm font-medium text-[var(--ui-body-text)]">IA Fadey desactivada</p>
        <p className="text-xs text-[var(--ui-muted)]">
          El administrador maestro debe activar «Asistente IA Fadey» en el control del plan.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="shrink-0 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-2.5 py-1.5">
        <p className="text-[11px] text-[var(--ui-muted)]">
          {status.learning
            ? 'Aprendiendo el local (primera semana) · '
            : 'Monitoreo activo · '}
          {status.mode === 'guides_only'
            ? 'Modo guías (sin clave LLM)'
            : 'Respuestas con datos del sistema'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5">
        {messages.length === 0 ? (
          <p className="text-xs text-[var(--ui-muted)] text-center py-6">
            Pregúntame por ventas, platos más vendidos o cómo operar el sistema.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-[var(--ui-accent)]/15 ml-6'
                  : 'bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] mr-4'
              }`}
            >
              {m.role === 'assistant' ? (
                <p className="text-[10px] font-semibold text-[var(--ui-accent)] mb-1 flex items-center gap-1">
                  <MdPsychology /> IA Fadey
                </p>
              ) : null}
              {m.content}
            </div>
          ))
        )}
        {busy ? (
          <p className="text-xs text-[var(--ui-muted)] italic px-1">Pensando…</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-[11px] text-rose-600 shrink-0">{error}</p> : null}

      <div className="shrink-0 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy}
            onClick={() => void send(c)}
            className="text-[10px] px-2 py-1 rounded-full border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] hover:bg-[var(--ui-sidebar-hover)] disabled:opacity-50"
          >
            {c}
          </button>
        ))}
      </div>

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
