import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatDateTime, getApiBase } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import {
  LOYALTY_TEXT_STYLES,
  DEFAULT_LOYALTY_TEXT_STYLE,
  surveyTypeClass,
} from '../../utils/loyaltySurveyTypography';
import {
  MdAdd,
  MdChatBubbleOutline,
  MdContentCopy,
  MdDashboard,
  MdDelete,
  MdDownload,
  MdPeople,
  MdSave,
  MdSettings,
  MdStars,
} from 'react-icons/md';

const VIEWS = [
  { id: 'panel', label: 'Panel', icon: MdDashboard },
  { id: 'configuracion', label: 'Configuración', icon: MdSettings },
];

function surveyUrl() {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/encuesta`;
}

function qrPreviewSrc(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
}

function emptyForm() {
  return {
    title: 'Tu experiencia',
    subtitle: 'Cuéntanos cómo te fue en tu visita.',
    name_label: 'Tu nombre',
    rating_label: 'Calificación general',
    comment_label: 'Comentario (opcional)',
    comment_placeholder: '¿Qué te gustó o qué podemos mejorar?',
    show_comment: true,
    submit_label: 'Enviar encuesta',
    thanks_title: 'Gracias',
    thanks_message: 'Recibimos tu opinión. Nos ayuda a mejorar tu experiencia.',
    text_style: DEFAULT_LOYALTY_TEXT_STYLE,
    questions: [],
  };
}

function StarPreview() {
  return (
    <div className="flex gap-0.5 text-amber-400 text-lg leading-none" aria-hidden>
      {'★★★★★'.split('').map((s, i) => (
        <span key={i}>{s}</span>
      ))}
    </div>
  );
}

export default function Fidelizacion() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'master_admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = String(searchParams.get('view') || '').trim();
  const view = viewParam === 'configuracion' ? 'configuracion' : 'panel';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formLoading, setFormLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const url = useMemo(() => surveyUrl(), []);

  const setView = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'configuracion') next.set('view', 'configuracion');
    else next.delete('view');
    setSearchParams(next, { replace: true });
  };

  const loadSummary = useCallback(() => {
    api
      .get('/loyalty/summary')
      .then((row) => setData(row))
      .catch((e) => toast.error(e.message || 'No se pudo cargar fidelización'))
      .finally(() => setLoading(false));
  }, []);

  const loadForm = useCallback(() => {
    setFormLoading(true);
    api
      .get('/loyalty/form')
      .then((row) => setForm({ ...emptyForm(), ...row, questions: Array.isArray(row?.questions) ? row.questions : [] }))
      .catch((e) => toast.error(e.message || 'No se pudo cargar el formato'))
      .finally(() => setFormLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
    loadForm();
  }, [loadSummary, loadForm]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'loyalty') loadSummary();
  });

  const patchForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const patchQuestion = (index, label) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, label } : q)),
    }));
  };

  const addQuestion = () => {
    setForm((prev) => {
      if (prev.questions.length >= 12) return prev;
      return {
        ...prev,
        questions: [...prev.questions, { id: '', label: 'Nueva pregunta' }],
      };
    });
  };

  const removeQuestion = (index) => {
    setForm((prev) => {
      if (prev.questions.length <= 1) {
        toast.error('Deja al menos una pregunta');
        return prev;
      }
      return { ...prev, questions: prev.questions.filter((_, i) => i !== index) };
    });
  };

  const saveForm = async () => {
    if (!canEdit) return;
    const questions = form.questions
      .map((q) => ({ id: q.id, label: String(q.label || '').trim() }))
      .filter((q) => q.label);
    if (!questions.length) {
      toast.error('Añade al menos una pregunta');
      return;
    }
    setSaving(true);
    try {
      const saved = await api.put('/loyalty/form', { ...form, questions });
      setForm({ ...emptyForm(), ...saved, questions: saved.questions || questions });
      toast.success('Formato guardado. El cliente ya verá este cuadro.');
      loadSummary();
    } catch (e) {
      toast.error(e.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar');
    }
  };

  const downloadQrPng = async () => {
    setDownloadingQr(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
      const endpoint = `${getApiBase()}/loyalty/qr-png?data=${encodeURIComponent(url)}`;
      const res = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error('No se pudo generar el PNG');
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'qr-encuesta-fidelizacion.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success('QR descargado en PNG');
    } catch (e) {
      toast.error(e.message || 'No se pudo descargar el QR');
    } finally {
      setDownloadingQr(false);
    }
  };

  const avg = Number(data?.average || 0);
  const count = Number(data?.count || 0);
  const questionsAvg = Array.isArray(data?.questions) ? data.questions : [];
  const responses = Array.isArray(data?.responses) ? data.responses : [];
  const withComment = responses.filter((r) => String(r.comment || '').trim());

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`rf-tab-btn inline-flex items-center gap-1.5 ${view === t.id ? 'rf-tab-btn--active' : ''}`}
            >
              <Icon className="text-lg" />
              {t.label}
            </button>
          );
        })}
      </div>

      {view === 'panel' ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-5 flex flex-col items-center text-center">
              <p className="text-sm ui-text-muted mb-1">Promedio general</p>
              <div className="flex items-center gap-2 text-4xl font-semibold rf-section-title">
                <MdStars className="text-amber-500" />
                {loading ? '—' : avg.toFixed(1)}
              </div>
              <p className="text-xs ui-text-muted mt-1">sobre 5 · {count} encuesta{count === 1 ? '' : 's'}</p>
            </div>
            <div className="card p-5 flex flex-col items-center text-center">
              <p className="text-sm ui-text-muted mb-1">Respuestas</p>
              <div className="flex items-center gap-2 text-4xl font-semibold rf-section-title">
                <MdPeople />
                {loading ? '—' : count}
              </div>
              <p className="text-xs ui-text-muted mt-1">clientes que opinaron</p>
            </div>
            <div className="card p-5 flex flex-col items-center text-center">
              <p className="text-sm ui-text-muted mb-1">Con comentario</p>
              <div className="flex items-center gap-2 text-4xl font-semibold rf-section-title">
                <MdChatBubbleOutline />
                {loading ? '—' : withComment.length}
              </div>
              <p className="text-xs ui-text-muted mt-1">mensajes de clientes</p>
            </div>
          </div>

          {questionsAvg.length > 0 && (
            <div className="card p-5">
              <h2 className="text-lg font-semibold rf-section-title mb-3">Promedio por experiencia</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {questionsAvg.map((q) => (
                  <div key={q.id} className="rounded-xl border border-[var(--ui-border)] p-3">
                    <p className="text-xs ui-text-muted mb-1">{q.label}</p>
                    <p className="text-xl font-semibold rf-section-title">{Number(q.average || 0).toFixed(1)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-5 overflow-x-auto">
            <h2 className="text-lg font-semibold rf-section-title mb-3">Comentarios y calificaciones</h2>
            {loading ? (
              <p className="text-sm ui-text-muted">Cargando…</p>
            ) : responses.length === 0 ? (
              <p className="text-sm ui-text-muted">Aún no hay encuestas. Ve a Configuración, arma el cuadro y descarga el QR.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left ui-text-muted border-b border-[var(--ui-border)]">
                    <th className="py-2 pr-3 font-medium">Cliente</th>
                    <th className="py-2 pr-3 font-medium">Calificación</th>
                    <th className="py-2 pr-3 font-medium">Comentario</th>
                    <th className="py-2 font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--ui-border)] align-top">
                      <td className="py-2.5 pr-3 font-medium">{r.customer_name}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{'★'.repeat(Math.max(0, Math.min(5, Number(r.rating) || 0)))} {Number(r.rating || 0).toFixed(0)}</td>
                      <td className="py-2.5 pr-3">{String(r.comment || '').trim() || '—'}</td>
                      <td className="py-2.5 whitespace-nowrap ui-text-muted">{formatDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold rf-section-title">Formato del cuadro</h2>
                <p className="text-sm ui-text-muted">Así verá el cliente los campos al escanear el QR.</p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="btn-primary text-sm inline-flex items-center gap-1.5"
                  onClick={saveForm}
                  disabled={saving || formLoading}
                >
                  <MdSave />
                  {saving ? 'Guardando…' : 'Guardar formato'}
                </button>
              ) : (
                <p className="text-xs ui-text-muted">Solo el administrador puede editar el formato.</p>
              )}
            </div>

            {formLoading ? (
              <p className="text-sm ui-text-muted">Cargando formato…</p>
            ) : (
              <>
                <div>
                  <h3 className="font-medium rf-section-title mb-1">Tipo de texto</h3>
                  <p className="text-xs ui-text-muted mb-3">Elige un estilo tipográfico para el cuadro de la encuesta.</p>
                  <div className="rf-survey-type-picker">
                    {LOYALTY_TEXT_STYLES.map((style) => (
                      <button
                        key={style.id}
                        type="button"
                        disabled={!canEdit}
                        className={`${form.text_style === style.id ? 'is-active' : ''} ${surveyTypeClass(style.id)}`}
                        onClick={() => patchForm('text_style', style.id)}
                      >
                        <span className="type-label">{style.label}</span>
                        <span className="type-hint">{style.hint}</span>
                        <span className="type-sample rf-login-title">Aa</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="ui-text-muted">Título</span>
                    <input className="input-field mt-1" value={form.title} onChange={(e) => patchForm('title', e.target.value)} disabled={!canEdit} maxLength={60} />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="ui-text-muted">Texto de ayuda</span>
                    <input className="input-field mt-1" value={form.subtitle} onChange={(e) => patchForm('subtitle', e.target.value)} disabled={!canEdit} maxLength={160} />
                  </label>
                  <label className="block text-sm">
                    <span className="ui-text-muted">Campo nombre</span>
                    <input className="input-field mt-1" value={form.name_label} onChange={(e) => patchForm('name_label', e.target.value)} disabled={!canEdit} maxLength={60} />
                  </label>
                  <label className="block text-sm">
                    <span className="ui-text-muted">Campo calificación</span>
                    <input className="input-field mt-1" value={form.rating_label} onChange={(e) => patchForm('rating_label', e.target.value)} disabled={!canEdit} maxLength={60} />
                  </label>
                  <label className="block text-sm">
                    <span className="ui-text-muted">Texto del botón</span>
                    <input className="input-field mt-1" value={form.submit_label} onChange={(e) => patchForm('submit_label', e.target.value)} disabled={!canEdit} maxLength={40} />
                  </label>
                  <label className="block text-sm">
                    <span className="ui-text-muted">Título al enviar</span>
                    <input className="input-field mt-1" value={form.thanks_title} onChange={(e) => patchForm('thanks_title', e.target.value)} disabled={!canEdit} maxLength={40} />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="ui-text-muted">Mensaje de agradecimiento</span>
                    <input className="input-field mt-1" value={form.thanks_message} onChange={(e) => patchForm('thanks_message', e.target.value)} disabled={!canEdit} maxLength={220} />
                  </label>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h3 className="font-medium rf-section-title">Opciones de experiencia</h3>
                    {canEdit ? (
                      <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={addQuestion} disabled={form.questions.length >= 12}>
                        <MdAdd /> Añadir pregunta
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {form.questions.map((q, i) => (
                      <div key={q.id || `new-${i}`} className="flex items-center gap-2">
                        <span className="text-xs ui-text-muted w-5 shrink-0">{i + 1}</span>
                        <input
                          className="input-field flex-1"
                          value={q.label}
                          onChange={(e) => patchQuestion(i, e.target.value)}
                          disabled={!canEdit}
                          maxLength={80}
                        />
                        {canEdit ? (
                          <button type="button" className="p-2 rounded-lg text-red-500 hover:bg-red-50" onClick={() => removeQuestion(i)} aria-label="Quitar">
                            <MdDelete />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.show_comment}
                    onChange={(e) => patchForm('show_comment', e.target.checked)}
                    disabled={!canEdit}
                  />
                  Incluir comentario
                </label>
                {form.show_comment ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-sm">
                      <span className="ui-text-muted">Campo comentario</span>
                      <input className="input-field mt-1" value={form.comment_label} onChange={(e) => patchForm('comment_label', e.target.value)} disabled={!canEdit} maxLength={60} />
                    </label>
                    <label className="block text-sm">
                      <span className="ui-text-muted">Ayuda del comentario</span>
                      <input className="input-field mt-1" value={form.comment_placeholder} onChange={(e) => patchForm('comment_placeholder', e.target.value)} disabled={!canEdit} maxLength={120} />
                    </label>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="text-lg font-semibold rf-section-title mb-3">Vista del cuadro</h2>
              <div className={`rf-survey-preview-shell rf-login-page--survey ${surveyTypeClass(form.text_style)}`}>
                <p className="text-xs opacity-70 mb-2">Restaurante</p>
                <h2 className="rf-login-title">{form.title || 'Título'}</h2>
                {form.subtitle ? <p className="rf-login-subtitle">{form.subtitle}</p> : null}
                <div className="rf-login-form space-y-3 !p-0">
                  <div>
                    <label className="block text-sm font-medium mb-1">{form.name_label}</label>
                    <div className="h-9 rf-login-input opacity-80" />
                  </div>
                  {form.questions.slice(0, 2).map((q, i) => (
                    <div key={q.id || `pv-${i}`}>
                      <label className="block text-sm font-medium mb-1">{q.label || 'Pregunta'}</label>
                      <StarPreview />
                    </div>
                  ))}
                  <button type="button" className="rf-login-submit w-full py-2 text-sm" disabled>
                    {form.submit_label || 'Enviar'}
                  </button>
                </div>
              </div>
            </div>

            <div className="card p-5 flex flex-col items-center text-center">
              <h2 className="text-lg font-semibold rf-section-title mb-2">QR de la encuesta</h2>
              <p className="text-xs ui-text-muted mb-3">Descárgalo en PNG e imprímelo o colócalo en mesa, caja o redes.</p>
              <img src={qrPreviewSrc(url)} alt="QR encuesta" className="w-52 h-52 bg-white p-2 rounded-xl mb-3" />
              <p className="text-[11px] break-all ui-text-muted mb-3">{url}</p>
              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={downloadQrPng}
                  disabled={downloadingQr}
                  className="btn-primary text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <MdDownload />
                  {downloadingQr ? 'Preparando PNG…' : 'Descargar QR en PNG'}
                </button>
                <button
                  type="button"
                  onClick={copyLink}
                  className="btn-secondary text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <MdContentCopy /> Copiar enlace
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
