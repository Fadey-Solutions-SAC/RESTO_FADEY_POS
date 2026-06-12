import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import Modal from './Modal';
import { MdSearch, MdPerson } from 'react-icons/md';

export default function PosCustomerPickerModal({ isOpen, onClose, onSelect }) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);

  const load = useCallback(async (term) => {
    setLoading(true);
    try {
      const q = String(term || '').trim();
      const data = await api.get(`/admin-modules/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (_) {
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    load('');
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = setTimeout(() => load(search), 280);
    return () => clearTimeout(timer);
  }, [search, isOpen, load]);

  const pick = (customer) => {
    if (!customer) return;
    onSelect(customer);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Mis clientes" size="md">
      <div className="space-y-3">
        <div className="relative">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
          <input
            className="input-field pl-10"
            placeholder="Buscar por nombre, teléfono o documento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="max-h-[min(50vh,360px)] overflow-y-auto rounded-lg border border-[color:var(--ui-border)] divide-y divide-[color:var(--ui-border)]">
          {loading ? (
            <p className="p-4 text-center text-sm text-[var(--ui-muted)]">Buscando...</p>
          ) : customers.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--ui-muted)]">No hay clientes guardados.</p>
          ) : (
            customers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="flex w-full items-start gap-3 p-3 text-left hover:bg-[var(--ui-sidebar-hover)] transition-colors"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ui-sidebar-active-bg)] text-[var(--ui-accent-muted)]">
                  <MdPerson />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--ui-body-text)] truncate">{c.name}</span>
                  <span className="block text-xs text-[var(--ui-muted)] truncate">
                    {[c.phone, c.doc_number, c.email].filter(Boolean).join(' · ') || 'Sin contacto'}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
