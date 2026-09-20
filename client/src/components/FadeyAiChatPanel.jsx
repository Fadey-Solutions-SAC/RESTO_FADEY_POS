import { useCallback, useEffect, useRef, useState } from 'react';
import { MdSmartToy, MdSend } from 'react-icons/md';
import { api } from '../utils/api';

function renderContent(text) {
  const raw = String(text || '');
  const parts = raw.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[#0f172a]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Chat del asistente IA Fadey — estilo referencia móvil.
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
    return <p className="text-sm text-[#64748b] text-center py-8">Cargando…</p>;
  }

  if (!status?.enabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2">
        <MdSmartToy className="text-3xl text-[#94a3b8]" />
        <p className="text-sm font-medium text-[#0f172a]">IA Fadey desactivada</p>
        <p className="text-xs text-[#64748b]">
          Actívala en Admin Maestro → control del plan.
        </p>
      </div>
    );
  }

  return (
    <div className="rf-fadey-ai-body h-full min-h-0 flex flex-col -m-3 p-3">
      <div className="rf-fadey-ai-scroll flex-1 min-h-0 overflow-y-auto space-y-2.5 pb-2">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 gap-2 py-10">
            <div className="w-12 h-12 rounded-full bg-[#e8eef5] flex items-center justify-center">
              <MdSmartToy className="text-2xl text-[#3b82f6]" />
            </div>
            <p className="text-sm font-semibold text-[#0f172a]">¿En qué te ayudo?</p>
            <p className="text-xs text-[#64748b] max-w-[16rem]">
              Pregunta cómo hacer algo en el POS, por ejemplo crear un área o cerrar caja.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div className={isUser ? 'rf-fadey-ai-bubble-user' : 'rf-fadey-ai-bubble-assistant'}>
                  {renderContent(m.content)}
                </div>
              </div>
            );
          })
        )}
        {busy ? (
          <p className="text-xs text-[#94a3b8] italic px-1">Pensando…</p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="text-[11px] text-rose-600 shrink-0 px-1 pb-1">{error}</p> : null}

      <form
        className="rf-fadey-ai-composer shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="rf-fadey-ai-input"
          value={input}
          disabled={busy}
          placeholder="Escribe tu pregunta..."
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
          className="rf-fadey-ai-send"
          disabled={busy || !String(input).trim()}
          aria-label="Enviar"
        >
          <MdSend className="text-[1.15rem] translate-x-px -translate-y-px" />
        </button>
      </form>
    </div>
  );
}
