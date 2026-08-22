import { useEffect, useState, useRef, useCallback } from 'react';
import { api, formatDateTime } from '../utils/api';
import { getSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { MdSend, MdGroup, MdPerson } from 'react-icons/md';

const ROLE_LABEL = {
  admin: 'Admin',
  cajero: 'Caja',
  mozo: 'Mozo',
  cocina: 'Cocina',
  bar: 'Bar',
  delivery: 'Delivery',
  produccion: 'Producción',
};

/**
 * Chat grupal (todos) o privado entre dos usuarios staff. Ciclo de mensajes en servidor.
 * @param {boolean} isActive — panel de mensajes visible (no sumar no leídos)
 * @param {(n:number)=>void} onUnreadDelta
 * @param {boolean} [suppressExternalNotify] — si el padre ya notifica campana/toast
 */
export default function StaffTeamChat({ isActive, onUnreadDelta, suppressExternalNotify = false }) {
  const { user } = useAuth();
  const meId = String(user?.id || '');
  const [mode, setMode] = useState('group');
  const [recipients, setRecipients] = useState([]);
  const [privateUserId, setPrivateUserId] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatMeta, setChatMeta] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };

  const loadMeta = useCallback(async () => {
    try {
      const s = await api.get('/staff-chat/state');
      setChatMeta(s);
    } catch {
      setChatMeta(null);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      if (mode === 'group') {
        const data = await api.get('/staff-chat/messages?mode=group');
        setMessages(data.messages || []);
      } else if (privateUserId) {
        const data = await api.get(
          `/staff-chat/messages?mode=private&with_user=${encodeURIComponent(privateUserId)}`
        );
        setMessages(data.messages || []);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error('staff-chat loadMessages', err);
      toast.error(err?.message || 'No se pudieron cargar los mensajes');
      setMessages([]);
    }
  }, [mode, privateUserId]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    api.get('/staff-chat/recipients')
      .then((data) => setRecipients(Array.isArray(data) ? data : []))
      .catch((err) => {
        setRecipients([]);
        toast.error(err?.message || 'No se pudo cargar la lista de compañeros');
      });
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadMessages();
    }, 20000);
    return () => clearInterval(id);
  }, [loadMessages]);

  useEffect(() => {
    if (isActive) loadMessages();
  }, [isActive, loadMessages]);

  useEffect(() => {
    const s = getSocket();
    const token = localStorage.getItem('token');
    if (token) s.emit('join-staff', { token });

    const onMsg = (msg) => {
      if (!meId || !msg?.id) return;

      const sender = String(msg.sender_id || '');
      const recipient = msg.recipient_id == null || msg.recipient_id === ''
        ? ''
        : String(msg.recipient_id);

      const append = (row) => {
        setMessages((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
        scrollToBottom();
      };

      const notify = () => {
        if (suppressExternalNotify) return;
        if (!isActive && sender !== meId) {
          onUnreadDelta?.(1);
          toast(`${msg.sender_name || 'Equipo'}`, {
            icon: '💬',
            description: String(msg.body || '').slice(0, 140),
          });
        }
      };

      if (!recipient) {
        if (mode === 'group') append(msg);
        notify();
        return;
      }

      const inThread = sender === meId || recipient === meId;
      if (!inThread) return;

      const peer = sender === meId ? recipient : sender;
      if (mode === 'private' && String(privateUserId) === peer) append(msg);

      if (!suppressExternalNotify && !isActive && sender !== meId) {
        onUnreadDelta?.(1);
        toast(`${msg.sender_name || 'Privado'}`, {
          icon: '✉️',
          description: String(msg.body || '').slice(0, 140),
        });
      }
    };

    s.on('staff-chat-message', onMsg);
    return () => s.off('staff-chat-message', onMsg);
  }, [meId, mode, privateUserId, isActive, onUnreadDelta, suppressExternalNotify]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, mode, privateUserId]);

  const send = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    if (mode === 'private' && !privateUserId) {
      toast.error('Seleccione un compañero');
      return;
    }
    setSending(true);
    try {
      const saved = await api.post('/staff-chat/messages', {
        body: t,
        recipient_id: mode === 'private' ? privateUserId : undefined,
      });
      setText('');
      if (saved?.id) {
        setMessages((prev) => (prev.some((x) => x.id === saved.id) ? prev : [...prev, saved]));
      }
      await loadMessages();
      await loadMeta();
      scrollToBottom();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[280px]">
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => { setMode('group'); setPrivateUserId(''); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            mode === 'group'
              ? 'bg-[var(--ui-accent)] border-[color:var(--ui-accent)] text-[#fff]'
              : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
          }`}
        >
          <MdGroup className="text-base" /> Chat de grupo
        </button>
        <button
          type="button"
          onClick={() => setMode('private')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            mode === 'private'
              ? 'bg-[var(--ui-accent)] border-[color:var(--ui-accent)] text-[#fff]'
              : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-muted)] hover:text-[var(--ui-body-text)]'
          }`}
        >
          <MdPerson className="text-base" /> Mensaje privado
        </button>
      </div>

      {mode === 'private' && (
        <div className="mb-3">
          <label className="block text-[10px] uppercase tracking-wide text-[var(--ui-muted)] mb-1">Enviar a</label>
          <select
            value={privateUserId}
            onChange={(e) => setPrivateUserId(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">— Seleccione usuario —</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name} (@{r.username}) · {ROLE_LABEL[r.role] || r.role}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-3 space-y-2 mb-3">
        {messages.length === 0 ? (
          <p className="text-sm text-[var(--ui-muted)] text-center py-8">
            {mode === 'private' && !privateUserId
              ? 'Seleccione un compañero para ver el historial.'
              : 'Sin mensajes en este ciclo. Escriba el primero.'}
          </p>
        ) : (
          messages.map((m) => {
            const mine = String(m.sender_id || '') === meId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm text-[var(--ui-body-text)] ${
                    mine
                      ? 'rounded-br-sm border border-[color:var(--ui-accent)] bg-[color-mix(in_srgb,var(--ui-accent)_20%,var(--ui-surface))]'
                      : 'bg-[var(--ui-surface)] border border-[color:var(--ui-border)] rounded-bl-sm'
                  }`}
                >
                  {!mine && (
                    <p className="text-[10px] font-semibold text-[var(--ui-accent-muted)] mb-0.5">
                      {m.sender_name || m.sender_username || 'Usuario'}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="text-[10px] mt-1 text-[var(--ui-muted)]">
                    {formatDateTime(m.created_at)}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'private' && !privateUserId ? 'Seleccione destinatario…' : 'Escribir mensaje…'}
          disabled={mode === 'private' && !privateUserId}
          className="input-field flex-1 text-sm disabled:opacity-50"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={sending || !text.trim() || (mode === 'private' && !privateUserId)}
          className="shrink-0 px-4 py-2 rounded-lg btn-primary disabled:opacity-50 flex items-center gap-1"
        >
          <MdSend className="text-lg" />
        </button>
      </form>

      {chatMeta && (
        <p className="text-[10px] text-[var(--ui-muted)] mt-2 leading-snug">
          Ciclo #{chatMeta.cycle_id}. El historial se renueva cuando nadie tiene sesión abierta y han pasado 24 h desde ese momento (al iniciar sesión se aplica el cambio).
        </p>
      )}
    </div>
  );
}
