import { useEffect, useRef, useState } from 'react';
import { MdClose, MdSearch, MdVisibility } from 'react-icons/md';
import { api } from '../utils/api';
import GitCardVisual from './GitCardVisual';

function validityLabel(card) {
  const expires = card?.cycle?.expires_at;
  if (card?.status === 'expired') return 'Vencida';
  if (!expires) return 'Sin fecha de vencimiento';
  const ts = Date.parse(expires);
  if (!Number.isFinite(ts)) return 'Vigencia no disponible';
  return ts > Date.now()
    ? `Vigente hasta ${new Date(ts).toLocaleDateString('es-PE')}`
    : 'Vencida';
}

export default function GitClientesCajaModal({
  open,
  onClose,
  onSelect,
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [programOpen, setProgramOpen] = useState(true);
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef(null);
  const searchGen = useRef(0);

  useEffect(() => {
    if (!open) return;
    setPreviewId('');
    setPreview(null);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const gen = ++searchGen.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await api.get(`/git-cards/caja/clients?q=${encodeURIComponent(query)}`);
        if (searchGen.current !== gen) return;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setProgramOpen(data?.program_open !== false);
      } catch (err) {
        if (searchGen.current !== gen) return;
        setRows([]);
        setError(err.message || 'No se pudieron cargar los clientes GIT Cards');
      } finally {
        if (searchGen.current === gen) setLoading(false);
      }
    }, query.trim() ? 180 : 0);
    return () => clearTimeout(handle);
  }, [open, query]);

  if (!open) return null;

  const openPreview = async (event, customerId) => {
    event.preventDefault();
    event.stopPropagation();
    if (previewId === customerId) {
      setPreviewId('');
      setPreview(null);
      return;
    }
    setPreviewId(customerId);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const data = await api.get(`/git-cards/caja/clients/${encodeURIComponent(customerId)}/preview`);
      setPreview(data);
    } catch (err) {
      setPreview({ error: err.message || 'No se pudo consultar la tarjeta' });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 border-0 bg-black/50"
        aria-label="Cerrar selector GIT Clientes"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-clientes-caja-title"
        className="relative z-10 flex max-h-[min(86vh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] px-4 py-3">
          <div className="min-w-0">
            <h2 id="git-clientes-caja-title" className="text-base font-bold text-[var(--ui-body-text)]">
              GIT Clientes
            </h2>
            <p className="text-xs text-[var(--ui-muted)]">
              Busque por nombre, inicial o DNI. Solo se listan tarjetas activas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] hover:text-[var(--ui-body-text)]"
            aria-label="Cerrar"
          >
            <MdClose className="text-xl" />
          </button>
        </div>

        <div className="border-b border-[color:var(--ui-border)] px-4 py-3">
          <label className="relative block">
            <MdSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre, inicial o DNI"
              className="input-field w-full pl-10"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!programOpen ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--ui-muted)]">
              El programa GIT Cards no está vigente.
            </p>
          ) : loading ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--ui-muted)]">Buscando clientes…</p>
          ) : error ? (
            <p className="px-2 py-8 text-center text-sm text-rose-600">{error}</p>
          ) : !rows.length ? (
            <p className="px-2 py-8 text-center text-sm text-[var(--ui-muted)]">
              {query.trim()
                ? 'No hay clientes elegibles con ese criterio.'
                : 'No hay clientes con GIT Card activa.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((row) => {
                const open = previewId === row.id;
                return (
                  <li key={row.id} className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                    <div className="flex items-center gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => onSelect({ id: row.id, name: row.name, discount_reward: row.discount_reward || null })}
                        className="min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--ui-sidebar-hover)]"
                      >
                        <p className="truncate font-semibold text-[var(--ui-body-text)]">{row.name}</p>
                        <p className="truncate text-xs text-[var(--ui-muted)]">
                          {row.doc_masked ? `DNI ${row.doc_masked}` : 'Sin documento'}
                          {' · '}
                          {row.progress?.confirmed || 0}/{row.progress?.goal || 0} avances
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => void openPreview(event, row.id)}
                        className={`shrink-0 rounded-lg p-2 ${open ? 'bg-amber-100 text-amber-800' : 'text-[var(--ui-muted)] hover:bg-[var(--ui-sidebar-hover)] hover:text-[var(--ui-body-text)]'}`}
                        title="Ver GIT Card"
                        aria-label={`Ver GIT Card de ${row.name}`}
                      >
                        <MdVisibility className="text-lg" />
                      </button>
                    </div>
                    {open ? (
                      <div className="border-t border-[color:var(--ui-border)] px-3 py-3">
                        {previewLoading ? (
                          <p className="text-sm text-[var(--ui-muted)]">Consultando tarjeta…</p>
                        ) : preview?.error ? (
                          <p className="text-sm text-rose-600">{preview.error}</p>
                        ) : preview?.card ? (
                          <div className="space-y-2">
                            <GitCardVisual card={preview.card} compact />
                            <p className="text-xs text-[var(--ui-muted)]">
                              {validityLabel(preview.card)}
                              {preview.card.progress?.pending
                                ? ` · ${preview.card.progress.pending} avance(s) pendiente(s)`
                                : ''}
                              {preview.card.status === 'reward_available'
                                ? ' · Recompensa disponible'
                                : ''}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-[var(--ui-muted)]">Sin datos de tarjeta.</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
