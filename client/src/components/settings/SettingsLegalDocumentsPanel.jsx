import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  MdDescription,
  MdGavel,
  MdHistory,
  MdCheckCircle,
  MdPendingActions,
  MdOpenInNew,
  MdVerifiedUser,
} from 'react-icons/md';
import { api, formatDateTime } from '../../utils/api';
import Modal from '../Modal';

const TABS = [
  { id: 'documentos', label: 'Documentos de Fadey Solutions SAC', icon: MdGavel },
  { id: 'aceptacion', label: 'Gestión de aceptación', icon: MdVerifiedUser },
];

export default function SettingsLegalDocumentsPanel() {
  const [tab, setTab] = useState('documentos');
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [pending, setPending] = useState([]);
  const [versions, setVersions] = useState([]);
  const [acceptances, setAcceptances] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);
  const [docLoading, setDocLoading] = useState(false);
  const [acceptBusy, setAcceptBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, hist] = await Promise.all([
        api.get('/legal-documents'),
        api.get('/legal-documents/acceptances?limit=200').catch(() => ({ acceptances: [] })),
      ]);
      setDocuments(Array.isArray(catalog?.documents) ? catalog.documents : []);
      setPending(Array.isArray(catalog?.pending) ? catalog.pending : []);
      setVersions(Array.isArray(catalog?.versions) ? catalog.versions : []);
      setAcceptances(Array.isArray(hist?.acceptances) ? hist.acceptances : []);
    } catch (err) {
      toast.error(err?.message || 'No se pudieron cargar los documentos legales');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDocument = async (id) => {
    setDocLoading(true);
    try {
      const doc = await api.get(`/legal-documents/${encodeURIComponent(id)}`);
      setViewDoc(doc);
    } catch (err) {
      toast.error(err?.message || 'No se pudo abrir el documento');
    } finally {
      setDocLoading(false);
    }
  };

  const acceptDocument = async () => {
    if (!viewDoc?.id || acceptBusy) return;
    setAcceptBusy(true);
    try {
      const result = await api.post(`/legal-documents/${encodeURIComponent(viewDoc.id)}/accept`, {});
      toast.success(
        result?.already_accepted
          ? 'Ya había aceptado esta versión'
          : 'Aceptación registrada',
      );
      setViewDoc((prev) => (prev ? { ...prev, accepted_current: true, pending_acceptance: false } : prev));
      await load();
    } catch (err) {
      toast.error(err?.message || 'No se pudo registrar la aceptación');
    } finally {
      setAcceptBusy(false);
    }
  };

  const acceptanceByDoc = useMemo(() => {
    const map = {};
    for (const row of acceptances) {
      const key = String(row.document_id || '');
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(row);
    }
    return map;
  }, [acceptances]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
          <MdGavel className="text-[var(--ui-accent)]" /> Legal y documentos
        </h2>
        <p className="text-sm text-[var(--ui-muted)] mt-1">
          Documentos oficiales de Fadey Solutions S.A.C. y registro de aceptaciones del restaurante.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rf-tab-btn inline-flex items-center gap-1.5 ${tab === t.id ? 'rf-tab-btn--active' : ''}`}
            >
              <Icon className="text-lg" />
              <span className="text-left leading-tight">{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ui-muted)] py-8 text-center">Cargando documentos…</p>
      ) : null}

      {!loading && tab === 'documentos' ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Documentos de Fadey Solutions SAC
          </p>
          <div className="grid gap-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4 flex flex-wrap items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <MdDescription className="text-[var(--ui-accent)] shrink-0" />
                    <p className="font-semibold text-[var(--ui-body-text)]">{doc.title}</p>
                    {doc.pending_acceptance ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold">
                        <MdPendingActions /> Pendiente
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold">
                        <MdCheckCircle /> Aceptado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ui-muted)] mt-1">{doc.summary}</p>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Versión {doc.version} · Actualizado {doc.updated_at}
                    {doc.last_acceptance?.accepted_at
                      ? ` · Última aceptación: ${formatDateTime(doc.last_acceptance.accepted_at)} (${doc.last_acceptance.user_name || 'usuario'})`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0"
                  onClick={() => void openDocument(doc.id)}
                  disabled={docLoading}
                >
                  <MdOpenInNew /> Ver / aceptar
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && tab === 'aceptacion' ? (
        <div className="space-y-5">
          <section className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2 mb-3">
              <MdPendingActions className="text-amber-600" /> Documentos pendientes de aceptar
            </h3>
            {pending.length === 0 ? (
              <p className="text-sm text-[var(--ui-muted)]">No hay documentos pendientes para su usuario.</p>
            ) : (
              <ul className="space-y-2">
                {pending.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-slate-800">{d.title}</span>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => void openDocument(d.id)}
                    >
                      Revisar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2 mb-3">
              <MdHistory className="text-sky-600" /> Versiones y fechas de actualización
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Documento</th>
                    <th className="py-2 pr-3">Versión</th>
                    <th className="py-2">Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-medium text-slate-800">{v.title}</td>
                      <td className="py-2.5 pr-3 tabular-nums">{v.version}</td>
                      <td className="py-2.5 text-slate-600">{v.updated_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-4">
            <h3 className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2 mb-3">
              <MdHistory className="text-violet-600" /> Historial de aceptaciones
            </h3>
            <p className="text-xs text-[var(--ui-muted)] mb-3">
              Usuario que aceptó y fecha de aceptación (todas las versiones registradas en este local).
            </p>
            {acceptances.length === 0 ? (
              <p className="text-sm text-[var(--ui-muted)]">Aún no hay aceptaciones registradas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3">Documento</th>
                      <th className="py-2 pr-3">Versión</th>
                      <th className="py-2 pr-3">Usuario</th>
                      <th className="py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acceptances.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="py-2.5 pr-3 font-medium text-slate-800">
                          {row.document_title || row.document_id}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums">{row.document_version}</td>
                        <td className="py-2.5 pr-3">
                          <span className="block text-slate-800">{row.user_name || row.user_id}</span>
                          {row.user_role ? (
                            <span className="block text-[11px] text-slate-500">{row.user_role}</span>
                          ) : null}
                        </td>
                        <td className="py-2.5 text-slate-600 whitespace-nowrap">
                          {formatDateTime(row.accepted_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Última aceptación por documento
              </p>
              {documents.map((doc) => {
                const hist = acceptanceByDoc[doc.id] || [];
                const last = hist[0];
                return (
                  <div
                    key={`last-${doc.id}`}
                    className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-700"
                  >
                    <span className="font-semibold">{doc.title}</span>
                    {last ? (
                      <span className="block mt-0.5">
                        v{last.document_version} · {last.user_name || last.user_id} ·{' '}
                        {formatDateTime(last.accepted_at)}
                      </span>
                    ) : (
                      <span className="block mt-0.5 text-amber-700">Sin aceptaciones</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      <Modal
        isOpen={Boolean(viewDoc)}
        onClose={() => setViewDoc(null)}
        title={viewDoc?.title || 'Documento'}
        size="lg"
        variant="light"
      >
        {viewDoc ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">Versión {viewDoc.version}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">Actualizado {viewDoc.updated_at}</span>
              {viewDoc.accepted_current ? (
                <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 inline-flex items-center gap-1">
                  <MdCheckCircle /> Versión aceptada
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 text-amber-800 px-2.5 py-1">Pendiente de aceptar</span>
              )}
            </div>
            <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                {viewDoc.body}
              </pre>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setViewDoc(null)}>
                Cerrar
              </button>
              {!viewDoc.accepted_current ? (
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={acceptBusy}
                  onClick={() => void acceptDocument()}
                >
                  <MdCheckCircle />
                  {acceptBusy ? 'Registrando…' : 'Aceptar esta versión'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
