import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MdAdd, MdDelete, MdEdit } from 'react-icons/md';
import { api } from '../../utils/api';
import { getProductionAreaIcon, toProductionAreaTitleCase } from '../../utils/productionAreaUi';

/**
 * Configuración → Áreas de producción (encima de Cajas).
 */
export default function ProductionAreasSection() {
  const [areas, setAreas] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editArea, setEditArea] = useState(null);
  const [form, setForm] = useState({
    name: '',
    active: 1,
    encargado_user_ids: [],
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api.get('/production-areas'),
        api.get('/production-areas/candidates/users').catch(() => []),
      ]);
      setAreas(Array.isArray(a) ? a : []);
      setCandidates(Array.isArray(c) ? c : []);
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar las áreas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditArea(null);
    setForm({ name: '', active: 1, encargado_user_ids: [] });
    setShowModal(true);
  };

  const openEdit = (area) => {
    setEditArea(area);
    setForm({
      name: area.name || '',
      active: Number(area.active) === 0 ? 0 : 1,
      encargado_user_ids: Array.isArray(area.encargado_user_ids) ? [...area.encargado_user_ids] : [],
    });
    setShowModal(true);
  };

  const toggleId = (key, id) => {
    setForm((prev) => {
      const set = new Set(prev[key] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [key]: [...set] };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const name = toProductionAreaTitleCase(String(form.name || '').trim());
    if (!name) return toast.error('Ingresa el nombre del área');
    if (!form.encargado_user_ids.length) {
      return toast.error('Debe vincular al menos un encargado de producción');
    }
    setSaving(true);
    try {
      if (editArea) {
        await api.put(`/production-areas/${editArea.id}`, {
          name,
          active: form.active,
          encargado_user_ids: form.encargado_user_ids,
        });
        toast.success('Área actualizada');
      } else {
        await api.post('/production-areas', {
          name,
          encargado_user_ids: form.encargado_user_ids,
        });
        toast.success('Área creada');
      }
      setShowModal(false);
      await load();
      try {
        window.dispatchEvent(new CustomEvent('production-areas-updated'));
      } catch (_) { /* noop */ }
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (area) => {
    if (areas.length <= 1) {
      toast.error('Debe quedar al menos un área de producción');
      return;
    }
    const others = areas.filter((a) => a.id !== area.id);
    const target = others.find((a) => Number(a.active) === 1) || others[0];
    const isDefault = area.id === 'cocina' || area.id === 'bar';
    const msg = [
      `¿Eliminar el área «${area.name}»?`,
      isDefault ? 'Cocina y Bar se pueden eliminar; ya no aparecerán en el menú.' : '',
      target
        ? `Los productos de esta área se reasignarán a «${target.name || target.id}».`
        : '',
      'Siempre debe quedar al menos un área de producción.',
    ].filter(Boolean).join('\n\n');
    if (!confirm(msg)) return;
    try {
      await api.delete(`/production-areas/${area.id}`, {
        reassignTo: target?.id,
      });
      toast.success(
        target
          ? `Área eliminada. Productos reasignados a «${target.name || target.id}».`
          : 'Área eliminada'
      );
      await load();
      try {
        window.dispatchEvent(new CustomEvent('production-areas-updated'));
      } catch (_) { /* noop */ }
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  /** Usuarios ya asignados como encargado a alguna área (id → areaId). */
  const encargadoAssignedTo = useMemo(() => {
    const map = new Map();
    for (const area of areas || []) {
      const areaId = String(area?.id || '').trim();
      for (const uid of area?.encargado_user_ids || []) {
        const id = String(uid || '').trim();
        if (id && areaId) map.set(id, areaId);
      }
    }
    for (const u of candidates || []) {
      const role = String(u.role || '').toLowerCase();
      if (!['produccion', 'cocina', 'bar'].includes(role)) continue;
      const uid = String(u.id || '').trim();
      const aid = String(u.production_area_id || '').trim()
        || (role === 'bar' ? 'bar' : role === 'cocina' ? 'cocina' : '');
      if (uid && aid && !map.has(uid)) map.set(uid, aid);
    }
    return map;
  }, [areas, candidates]);

  const currentAreaId = editArea ? String(editArea.id || '').trim() : '';

  const encargados = useMemo(() => {
    return (candidates || []).filter((u) => {
      if (Number(u.is_active) === 0) return false;
      const role = String(u.role || '').toLowerCase();
      if (!['produccion', 'cocina', 'bar'].includes(role)) return false;
      const uid = String(u.id || '').trim();
      const linkedArea = encargadoAssignedTo.get(uid);
      // Libre, o ya vinculado a esta misma área (edición)
      if (!linkedArea) return true;
      return Boolean(currentAreaId) && linkedArea === currentAreaId;
    });
  }, [candidates, encargadoAssignedTo, currentAreaId]);

  if (loading) return <p className="text-sm ui-text-muted">Cargando áreas…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h3 className="font-bold text-[var(--ui-body-text)]">Áreas de producción</h3>
          <p className="text-sm ui-text-muted">
            Solo se vinculan usuarios de producción. Los pedidos llegan por el área del producto; el mozo opera mesas de su caja.
          </p>
        </div>
        <button type="button" onClick={openNew} className="btn-primary flex items-center gap-2 text-sm">
          <MdAdd /> Nueva área
        </button>
      </div>

      <div className="space-y-2">
        {!areas.length && (
          <p className="text-sm ui-text-muted text-center py-6">No hay áreas configuradas.</p>
        )}
        {areas.map((area) => {
          const AreaIcon = getProductionAreaIcon(area);
          return (
          <div
            key={area.id}
            className="card flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[var(--ui-surface-2)] flex items-center justify-center shrink-0">
                <AreaIcon className="text-xl text-[var(--ui-accent)]" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--ui-body-text)] truncate">{area.name}</p>
                <p className="text-xs ui-text-muted">
                  id: {area.id} · {Number(area.active) === 1 ? 'Activa' : 'Inactiva'} ·{' '}
                  {(area.encargado_user_ids || []).length} encargado(s)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => openEdit(area)}
                className="p-2 hover:bg-slate-100 rounded-lg text-[var(--ui-muted)]"
                title="Editar"
              >
                <MdEdit />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(area)}
                disabled={areas.length <= 1}
                className="p-2 hover:bg-[var(--ui-sidebar-hover)] rounded-lg text-[var(--ui-muted)] hover:text-[var(--ui-accent)] disabled:opacity-40 disabled:cursor-not-allowed"
                title={areas.length <= 1 ? 'Debe quedar al menos un área' : 'Eliminar'}
              >
                <MdDelete />
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <form
            onSubmit={handleSave}
            className="bg-[var(--ui-surface)] rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3"
          >
            <h4 className="font-bold text-lg text-[var(--ui-body-text)]">
              {editArea ? 'Editar área' : 'Nueva área'}
            </h4>
            <div>
              <label className="block text-sm font-medium mb-1">Nombre</label>
              {(() => {
                const PreviewIcon = getProductionAreaIcon({
                  id: editArea?.id || '',
                  name: form.name,
                });
                return (
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <PreviewIcon className="text-xl text-[var(--ui-accent)]" />
                    </div>
                    <input
                      className="input-field w-full pl-11"
                      value={form.name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, name: toProductionAreaTitleCase(e.target.value) }))
                      }
                      placeholder="Ej. Parrilla, Cocina Techo"
                      required
                    />
                  </div>
                );
              })()}
              <p className="text-[11px] ui-text-muted mt-1">
                El icono cambia con el nombre (Parrilla, Bar, Cocina, Pizza…).
              </p>
            </div>
            {editArea && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Number(form.active) === 1}
                  onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked ? 1 : 0 }))}
                />
                Área activa
              </label>
            )}
            <div>
              <p className="text-sm font-semibold mb-1">Encargados (obligatorio)</p>
              <p className="text-[11px] ui-text-muted mb-2">
                Un usuario de producción solo puede estar en un área. Los ya vinculados a otra no aparecen aquí.
              </p>
              <div className="max-h-36 overflow-y-auto border border-[color:var(--ui-border)] rounded-lg p-2 space-y-1">
                {encargados.length === 0 && (
                  <p className="text-xs ui-text-muted">
                    No hay encargados disponibles. Crea un usuario Producción libre o desvincúlalo de otra área.
                  </p>
                )}
                {encargados.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.encargado_user_ids.includes(u.id)}
                      onChange={() => toggleId('encargado_user_ids', u.id)}
                    />
                    <span>{u.full_name} <span className="ui-text-muted">(@{u.username})</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
