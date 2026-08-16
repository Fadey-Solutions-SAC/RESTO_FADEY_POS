import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  api,
  formatCurrency,
  formatDate,
  API_BASE,
  formatDateTime,
  parseLocaleNumber,
  formatInsumoQty,
  formatInsumoWithUnit,
} from '../utils/api';
import { formatCatalogNameInput } from '../utils/catalogNameFormat';
import { downloadReconciliationRecord, downloadBlobFile, downloadExcelFile } from '../utils/inventoryCuadreExport';
import DownloadExcelTxtButtons from './admin/DownloadExcelTxtButtons';
import {
  INSUMO_UM_OPTIONS,
  isMasaOrLitrajeUm,
  isUnidadUm,
  normalizeInsumoUm,
} from '../utils/insumoUnidadMedida';
import toast from 'react-hot-toast';
import { MdWarning, MdInventory2, MdAdd, MdList, MdExpandMore, MdExpandLess } from 'react-icons/md';
import Modal from './Modal';

const TABS = [
  { id: 'dashboard', label: 'Resumen' },
  { id: 'insumos', label: 'Insumos' },
  { id: 'compras', label: 'Compras' },
  { id: 'recetas', label: 'Recetas' },
  { id: 'kardex', label: 'Kardex' },
  { id: 'inv_fisico', label: 'Inventario de transformables' },
  { id: 'inv_no_transform', label: 'Inventario de no transformables' },
  { id: 'ajustes', label: 'Ajustes / mermas' },
];

const BASE = '/kardex-inventory';

const EMPTY_INSUMO_FORM = () => ({
  nombre: '',
  unidad_medida: 'unidad',
  precio_compra: '',
  cantidad_inicial: '0',
  minimo_unidades: '0',
  minimo_kg: '0',
  activo: true,
});

function parseWarehouseMeta(description, fallbackStock) {
  const raw = description || '';
  const transformedMatch = raw.match(/\[WAREHOUSE_PROCESS:(transformed|non_transformed)\]/);
  const mainMatch = raw.match(/\[STOCK_MAIN:(-?\d+)\]/);
  const kitchenMatch = raw.match(/\[STOCK_KITCHEN:(-?\d+)\]/);
  const notes = raw.replace(/\[(WAREHOUSE_PROCESS|STOCK_MAIN|STOCK_KITCHEN):[^\]]+\]\s*/g, '').trim();
  const fallback = Math.max(0, Number(fallbackStock || 0));
  let stockMain = mainMatch ? Math.max(0, parseInt(mainMatch[1], 10) || 0) : fallback;
  let stockKitchen = kitchenMatch ? Math.max(0, parseInt(kitchenMatch[1], 10) || 0) : 0;
  if (!mainMatch && kitchenMatch) stockMain = Math.max(0, fallback - stockKitchen);
  if (!mainMatch && !kitchenMatch) {
    stockMain = fallback;
    stockKitchen = 0;
  }
  return {
    process: transformedMatch ? transformedMatch[1] : 'non_transformed',
    stockMain,
    stockKitchen,
    notes,
  };
}

const sameWarehouseId = (a, b) => String(a || '') === String(b || '');

/** Línea de resumen: contado vs kardex al crear la toma. */
function InventarioFisicoResumenLine({ f, b, s }) {
  const nf = Number(f) || 0;
  const nb = Number(b) || 0;
  const ns = Number(s) || 0;
  const total = nf + nb + ns;
  if (total === 0) {
    return <span className="ui-text-muted">Sin líneas</span>;
  }
  if (nf === 0 && ns === 0) {
    return (
      <span className="text-emerald-400/95">
        Está bien: coincide con kardex ({nb} {nb === 1 ? 'ítem' : 'ítems'})
      </span>
    );
  }
  const parts = [];
  if (nf > 0) parts.push({ key: 'f', node: <span className="text-rose-400 font-medium">Falta: {nf}</span> });
  if (nb > 0) parts.push({ key: 'b', node: <span className="text-emerald-400/90">Bien: {nb}</span> });
  if (ns > 0) parts.push({ key: 's', node: <span className="text-sky-400/95 font-medium">Sobra: {ns}</span> });
  return (
    <span className="text-[var(--ui-body-text)]">
      {parts.map((p, i) => (
        <span key={p.key}>
          {i > 0 && <span className="text-[var(--ui-muted)]"> · </span>}
          {p.node}
        </span>
      ))}
    </span>
  );
}

export default function LogisticaKardexModule() {
  const [tab, setTab] = useState('dashboard');
  const [insumos, setInsumos] = useState([]);
  /** Área activa en pestaña Insumos (cada lista tiene su propio catálogo en BD vía `insumo_area`). */
  const [insumoAreaTab, setInsumoAreaTab] = useState('cocina');
  /** Formulario de alta/edición de insumo: oculto por defecto; se abre con botón o al pulsar Editar. */
  const [showInsumoAddForm, setShowInsumoAddForm] = useState(false);
  const [compraAreaTab, setCompraAreaTab] = useState('cocina');
  const [invFisicoAreaTab, setInvFisicoAreaTab] = useState('cocina');
  const [ajusteAreaTab, setAjusteAreaTab] = useState('cocina');
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [invList, setInvList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [insumoForm, setInsumoForm] = useState(EMPTY_INSUMO_FORM);
  const [editingInsumoId, setEditingInsumoId] = useState('');
  const [compraLines, setCompraLines] = useState([{ insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }]);
  const [recetaForm, setRecetaForm] = useState({
    nombre_plato: '', product_id: '', activo: true, detalles: [{ insumo_id: '', cantidad_usada: '' }],
  });
  const [editingRecetaId, setEditingRecetaId] = useState('');

  const [kardexInsumo, setKardexInsumo] = useState('');
  const [kardexFrom, setKardexFrom] = useState('');
  const [kardexTo, setKardexTo] = useState('');
  const [kardexData, setKardexData] = useState(null);

  const [invDetalles, setInvDetalles] = useState([{ insumo_id: '', stock_real: '' }]);
  const [ajusteForm, setAjusteForm] = useState({
    insumo_id: '', cantidad: '', tipo: 'salida', referencia: 'merma',
  });

  const [whProducts, setWhProducts] = useState([]);
  const [whWarehouses, setWhWarehouses] = useState([]);
  const [cuadreWarehouseId, setCuadreWarehouseId] = useState('');
  const [logisticsCounted, setLogisticsCounted] = useState({});
  const [showReconciliationsModal, setShowReconciliationsModal] = useState(false);
  const [reconciliationHistory, setReconciliationHistory] = useState([]);

  const loadCore = useCallback(async () => {
    const [ins, dash, prods, rec, inv] = await Promise.all([
      api.get(`${BASE}/insumos`),
      api.get(`${BASE}/dashboard`),
      api.get('/products').catch(() => []),
      api.get(`${BASE}/recetas`),
      api.get(`${BASE}/inventario-fisico`),
    ]);
    setInsumos(Array.isArray(ins) ? ins : []);
    setDashboard(dash);
    setProducts(Array.isArray(prods) ? prods : []);
    setRecetas(Array.isArray(rec) ? rec : []);
    setInvList(Array.isArray(inv) ? inv : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadCore();
      } catch (e) {
        toast.error(e.message || 'No se pudo cargar inventario kardex');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCore]);

  const insumosCocina = useMemo(
    () => insumos.filter((i) => (i.insumo_area || 'cocina') === 'cocina'),
    [insumos]
  );
  const insumosBar = useMemo(
    () => insumos.filter((i) => (i.insumo_area || 'cocina') === 'bar'),
    [insumos]
  );
  const insumosListaActiva = insumoAreaTab === 'bar' ? insumosBar : insumosCocina;
  const insumosCompraFiltrados = compraAreaTab === 'bar' ? insumosBar : insumosCocina;
  const insumosInvFisicoFiltrados = invFisicoAreaTab === 'bar' ? insumosBar : insumosCocina;
  const insumosAjusteFiltrados = ajusteAreaTab === 'bar' ? insumosBar : insumosCocina;

  const selectedProductForReceta = useMemo(
    () => products.find((p) => String(p.id) === String(recetaForm.product_id)),
    [products, recetaForm.product_id]
  );
  const insumosParaReceta = useMemo(() => {
    if (!recetaForm.product_id) return insumos;
    const pa = String(selectedProductForReceta?.production_area || '').toLowerCase() === 'bar' ? 'bar' : 'cocina';
    return insumos.filter((i) => (i.insumo_area || 'cocina') === pa);
  }, [insumos, recetaForm.product_id, selectedProductForReceta]);

  const loadWhData = useCallback(async () => {
    const data = await api.get('/inventory/warehouse-stock');
    const wh = data.warehouses || [];
    const list = (data.products || [])
      .map((p) => {
        const parsed = parseWarehouseMeta(p.description, p.stock);
        return {
          ...p,
          process:
            p.process_type === 'non_transformed'
              ? 'non_transformed'
              : p.process_type === 'transformed'
                ? 'transformed'
                : parsed.process,
          warehouse_stocks: p.warehouse_stocks || [],
          stock: Number(p.total_stock || 0),
        };
      })
      .filter((p) => p.process === 'non_transformed');
    setWhWarehouses(wh);
    setWhProducts(list);
    setCuadreWarehouseId((prev) => {
      if (prev) return prev;
      const pr = wh.find((w) => w.name === 'Almacen Principal') || wh[0];
      return pr ? String(pr.id) : '';
    });
  }, []);

  useEffect(() => {
    if (tab !== 'inv_no_transform') return;
    loadWhData().catch((e) => toast.error(e.message || 'No se pudo cargar almacén'));
  }, [tab, loadWhData]);

  useEffect(() => {
    setCompraLines([{ insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }]);
  }, [compraAreaTab]);

  useEffect(() => {
    setInvDetalles([{ insumo_id: '', stock_real: '' }]);
  }, [invFisicoAreaTab]);

  useEffect(() => {
    setAjusteForm((f) => ({ ...f, insumo_id: '' }));
  }, [ajusteAreaTab]);

  useEffect(() => {
    if (tab !== 'inv_no_transform') return;
    (async () => {
      try {
        const reconciliations = await api.get('/inventory/reconciliations');
        setReconciliationHistory(reconciliations || []);
      } catch (_) {}
    })();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'kardex' || !kardexInsumo) {
      setKardexData(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const q = new URLSearchParams();
        if (kardexFrom) q.set('from', kardexFrom);
        if (kardexTo) q.set('to', kardexTo);
        const r = await api.get(`${BASE}/kardex/${kardexInsumo}${q.toString() ? `?${q}` : ''}`);
        if (!cancel) setKardexData(r);
      } catch (e) {
        if (!cancel) toast.error(e.message);
      }
    })();
    return () => { cancel = true; };
  }, [tab, kardexInsumo, kardexFrom, kardexTo]);

  const addInsumo = async (e) => {
    e.preventDefault();
    try {
      const ci = parseLocaleNumber(insumoForm.cantidad_inicial);
      const mu = parseLocaleNumber(insumoForm.minimo_unidades);
      const mk = parseLocaleNumber(insumoForm.minimo_kg);
      const rawPrecio = String(insumoForm.precio_compra ?? '').trim();
      const pCompra = rawPrecio === '' ? 0 : parseLocaleNumber(rawPrecio);
      if (rawPrecio !== '' && !Number.isFinite(pCompra)) {
        toast.error('Precio de compra: número no válido (S/ por kg, L, etc.)');
        return;
      }
      if (pCompra < 0) {
        toast.error('El precio de compra no puede ser negativo');
        return;
      }
      const umed = normalizeInsumoUm(insumoForm.unidad_medida);
      const masa = isMasaOrLitrajeUm(umed);
      const und = isUnidadUm(umed);
      const payload = {
        nombre: insumoForm.nombre.trim(),
        unidad_medida: umed,
        costo_promedio: pCompra,
        cantidad_inicial: Number.isFinite(ci) && ci >= 0 ? ci : 0,
        minimo_unidades: masa ? 0 : (Number.isFinite(mu) && mu >= 0 ? mu : 0),
        stock_minimo: und ? 0 : (Number.isFinite(mk) && mk >= 0 ? mk : 0),
        activo: insumoForm.activo,
        insumo_area: insumoAreaTab,
      };
      if (editingInsumoId) {
        await api.put(`${BASE}/insumos/${editingInsumoId}`, payload);
        toast.success('Insumo actualizado');
      } else {
        await api.post(`${BASE}/insumos`, payload);
        toast.success('Insumo creado');
      }
      setInsumoForm(EMPTY_INSUMO_FORM());
      setEditingInsumoId('');
      setShowInsumoAddForm(false);
      loadCore();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const editInsumo = (row) => {
    setShowInsumoAddForm(true);
    setEditingInsumoId(row.id || '');
    setInsumoAreaTab((row.insumo_area || 'cocina') === 'bar' ? 'bar' : 'cocina');
    const um = normalizeInsumoUm(row.unidad_medida);
    const masa = isMasaOrLitrajeUm(um);
    const und = isUnidadUm(um);
    setInsumoForm({
      nombre: String(row.nombre || ''),
      unidad_medida: um,
      precio_compra: String(Number(row.costo_promedio || 0)),
      cantidad_inicial: String(Number(row.stock_actual || 0)),
      minimo_unidades: masa ? '0' : String(Number(row.minimo_unidades || 0)),
      minimo_kg: und ? '0' : String(Number(row.stock_minimo || 0)),
      activo: Number(row.activo) !== 0,
    });
  };

  const runCompra = async (e) => {
    e.preventDefault();
    const items = [];
    for (const l of compraLines) {
      if (!l.insumo_id || l.cantidad === '' || l.costo_unitario === '') continue;
      const cantidad = parseLocaleNumber(l.cantidad);
      const costo_unitario = parseLocaleNumber(l.costo_unitario);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error('Revisa la cantidad en kg/L (mayor a 0, ej. 10,5 o 10.5).');
        return;
      }
      if (!Number.isFinite(costo_unitario) || costo_unitario < 0) {
        toast.error('Revisa el costo unitario (S/ por kg, L, etc. según el insumo).');
        return;
      }
      const row = { insumo_id: l.insumo_id, cantidad, costo_unitario };
      if (l.unidades != null && String(l.unidades).trim() !== '') {
        const u = parseLocaleNumber(l.unidades);
        if (!Number.isFinite(u) || u < 0) {
          toast.error('Unidades: número ≥ 0 (opcional; suma a Cantidad (U) del insumo).');
          return;
        }
        if (u > 0) row.unidades = u;
      }
      items.push(row);
    }
    if (!items.length) {
      toast.error('Agrega líneas con insumo, cantidad y costo unitario');
      return;
    }
    try {
      await api.post(`${BASE}/compras`, { items });
      toast.success('Compra registrada en kardex');
      setCompraLines([{ insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }]);
      loadCore();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveReceta = async (e) => {
    e.preventDefault();
    if (!recetaForm.nombre_plato.trim() || !recetaForm.product_id) {
      toast.error('Nombre de plato y producto del menú son obligatorios');
      return;
    }
    const detalles = [];
    for (const d of recetaForm.detalles) {
      if (!d.insumo_id || d.cantidad_usada === '') continue;
      const q = parseLocaleNumber(d.cantidad_usada);
      if (!Number.isFinite(q) || q < 0) {
        toast.error('Revisa la cantidad usada en recetas (número en la U.M. del insumo, ej. 0,1 o 0.1).');
        return;
      }
      detalles.push({ insumo_id: d.insumo_id, cantidad_usada: q });
    }
    const body = {
      nombre_plato: recetaForm.nombre_plato.trim(),
      product_id: recetaForm.product_id,
      activo: recetaForm.activo,
      detalles,
    };
    try {
      if (editingRecetaId) {
        await api.put(`${BASE}/recetas/${editingRecetaId}`, body);
        toast.success('Receta actualizada');
      } else {
        await api.post(`${BASE}/recetas`, body);
        toast.success('Receta creada');
      }
      setEditingRecetaId('');
      setRecetaForm({
        nombre_plato: '', product_id: '', activo: true, detalles: [{ insumo_id: '', cantidad_usada: '' }],
      });
      loadCore();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadRecetaEdit = async (id) => {
    try {
      const r = await api.get(`${BASE}/recetas/${id}`);
      setEditingRecetaId(id);
      setRecetaForm({
        nombre_plato: r.nombre_plato || '',
        product_id: r.product_id || '',
        activo: Number(r.activo) === 1,
        detalles: (r.detalles && r.detalles.length
          ? r.detalles.map((d) => ({ insumo_id: d.insumo_id, cantidad_usada: String(d.cantidad_usada) }))
          : [{ insumo_id: '', cantidad_usada: '' }]),
      });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const crearInventarioFisico = async (e) => {
    e.preventDefault();
    const detalles = [];
    for (const d of invDetalles) {
      if (!d.insumo_id || d.stock_real === '') continue;
      const stock_real = parseLocaleNumber(d.stock_real);
      if (!Number.isFinite(stock_real) || stock_real < 0) {
        toast.error('Revisa el stock contado (número en U.M. del insumo).');
        return;
      }
      detalles.push({ insumo_id: d.insumo_id, stock_real });
    }
    if (!detalles.length) {
      toast.error('Agrega al menos un insumo con stock real contado');
      return;
    }
    try {
      const res = await api.post(`${BASE}/inventario-fisico`, { detalles });
      const cn = res.cuadre_num;
      toast.success(
        Number.isFinite(Number(cn)) && Number(cn) > 0
          ? `CUADRE ${cn} creado (pendiente de cierre)`
          : 'Toma de inventario creada (pendiente de cierre)'
      );
      setInvDetalles([{ insumo_id: '', stock_real: '' }]);
      loadCore();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const cerrarInventario = async (id) => {
    if (!confirm('¿Cerrar este inventario? Se generarán entradas/salidas en kardex según las diferencias.')) return;
    try {
      await api.post(`${BASE}/inventario-fisico/${id}/cerrar`, {});
      toast.success('Inventario cerrado y kardex actualizado');
      loadCore();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const enviarAjuste = async (e) => {
    e.preventDefault();
    if (!ajusteForm.insumo_id || !ajusteForm.cantidad) {
      toast.error('Insumo y cantidad requeridos');
      return;
    }
    try {
      const cantidadAjuste = parseLocaleNumber(ajusteForm.cantidad);
      if (!Number.isFinite(cantidadAjuste) || cantidadAjuste <= 0) {
        toast.error('La cantidad del ajuste debe ser un número mayor a 0 (en kg/L según U.M. del insumo).');
        return;
      }
      await api.post(`${BASE}/ajustes`, {
        insumo_id: ajusteForm.insumo_id,
        cantidad: cantidadAjuste,
        tipo: ajusteForm.tipo,
        referencia: ajusteForm.referencia || (ajusteForm.tipo === 'entrada' ? 'ajuste' : 'merma'),
      });
      toast.success('Ajuste registrado');
      setAjusteForm({ insumo_id: '', cantidad: '', tipo: 'salida', referencia: 'merma' });
      loadCore();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const descargarKardex = async (format = 'excel') => {
    if (!kardexInsumo) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}${BASE}/export/kardex/${kardexInsumo}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const t = await res.text();
      let message = 'No se pudo exportar';
      try {
        const j = JSON.parse(t);
        if (j?.error) message = j.error;
        else if (t) message = t;
      } catch (_) {
        if (t) message = t;
      }
      throw new Error(message);
    }
    const text = await res.text();
    const baseName = `kardex-${kardexInsumo}`;
    if (format === 'txt') {
      downloadBlobFile(`${baseName}.txt`, text);
      toast.success('Kardex descargado (TXT)');
      return;
    }
    downloadExcelFile(baseName, text);
    toast.success('Kardex descargado (Excel)');
  };

  const logisticsProductsFiltered = whProducts
    .filter((product) => {
      if (!cuadreWarehouseId) return true;
      return (product.warehouse_stocks || []).some((ws) => sameWarehouseId(ws.warehouse_id, cuadreWarehouseId));
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const getLogisticsCurrentStock = (product) => {
    if (!cuadreWarehouseId) return Number(product.stock || 0);
    return Number(
      (product.warehouse_stocks || []).find((ws) => sameWarehouseId(ws.warehouse_id, cuadreWarehouseId))?.quantity || 0
    );
  };

  const getLogisticsDiff = (product) => {
    const current = getLogisticsCurrentStock(product);
    const raw = logisticsCounted[product.id];
    if (raw === '' || raw === undefined) return null;
    const counted = Number(raw);
    if (Number.isNaN(counted)) return null;
    return counted - current;
  };

  const saveWarehouseReconciliation = async () => {
    if (!cuadreWarehouseId) {
      toast.error('Selecciona un almacén');
      return;
    }
    const selectedWarehouse = whWarehouses.find((w) => sameWarehouseId(w.id, cuadreWarehouseId));
    if (!selectedWarehouse) {
      toast.error('Almacén no válido');
      return;
    }
    const items = logisticsProductsFiltered
      .filter((product) => logisticsCounted[product.id] !== '' && logisticsCounted[product.id] !== undefined)
      .map((product) => {
        const current = getLogisticsCurrentStock(product);
        const counted = Number(logisticsCounted[product.id] || 0);
        const diff = counted - current;
        return {
          product_id: product.id,
          product_name: product.name,
          current_stock: current,
          counted_stock: counted,
          difference: diff,
          unit_cost: Number(product.price || 0),
          valuation: Number(product.price || 0) * current,
        };
      });
    if (!items.length) {
      toast.error('Ingresa cantidades contadas antes de guardar');
      return;
    }
    try {
      await api.post('/inventory/reconciliations', {
        warehouse_id: selectedWarehouse.id,
        items,
      });
      const history = await api.get('/inventory/reconciliations');
      setReconciliationHistory(history || []);
      setLogisticsCounted({});
      await loadWhData();
      toast.success('Cuadre de almacén guardado');
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el cuadre');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500/80 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="logistica-kardex-module space-y-4 text-[var(--ui-body-text)]">
      <p className="text-sm text-[var(--ui-body-text)]">
        Insumos, compras, recetas, kardex, inventario de transformables (insumos) y no transformables (cuadre en almacén).
        Las ventas en caja descuentan según recetas.
      </p>
      <div className="flex flex-wrap gap-1.5 border-b border-[color:var(--ui-border)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              tab === t.id
                ? 'bg-[var(--ui-accent)] text-white shadow-sm border border-[color:var(--ui-accent)]'
                : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] border border-[color:var(--ui-border)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && dashboard && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
          <div className="bg-[var(--ui-surface)] rounded-xl border border-[color:var(--ui-border)] p-4">
            <p className="text-[var(--ui-muted)] text-sm">Valor total del inventario (insumos)</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(dashboard.valor_inventario_total)}</p>
            <p className="text-xs text-[var(--ui-muted)] mt-2">{dashboard.total_insumos} insumos activos</p>
          </div>
          <div className="bg-[var(--ui-surface)] rounded-xl border border-[color:var(--ui-border)] p-4">
            <p className="text-amber-300/90 text-sm flex items-center gap-1.5">
              <MdWarning className="inline" /> Bajo mínimo (U o kg/L según creación)
            </p>
            <p className="text-xl font-bold text-amber-400 mt-1">{dashboard.insumos_bajo_minimo?.length || 0}</p>
            <ul className="mt-2 max-h-28 overflow-y-auto text-sm space-y-0.5">
              {(dashboard.insumos_bajo_minimo || []).map((i) => {
                const uMin = Number(i.minimo_unidades) || 0;
                const um = String(i.unidad_medida || 'kg').replace(/[0-9]/g, '').trim() || 'kg';
                const sMin = Number(i.stock_minimo) || 0;
                const uAct = Number(i.stock_unidades) || 0;
                const sAct = Number(i.stock_actual) || 0;
                const bajoU = uMin > 0 && uAct < uMin;
                const detail = bajoU
                  ? `${formatInsumoQty(uAct)} U / mín. ${formatInsumoQty(uMin)} U`
                  : `${formatInsumoWithUnit(sAct, um)} / mín. ${formatInsumoQty(sMin)} ${um}`;
                const tag = (i.insumo_area || 'cocina') === 'bar' ? 'Bar' : 'Cocina';
                return (
                  <li key={i.id} className="flex justify-between text-[var(--ui-body-text)] gap-2">
                    <span>
                      <span className="text-[10px] uppercase text-sky-400/90 mr-1">{tag}</span>
                      {i.nombre}
                    </span>
                    <span className="text-red-400 text-right">{detail}</span>
                  </li>
                );
              })}
            </ul>
            {(!dashboard.insumos_bajo_minimo || !dashboard.insumos_bajo_minimo.length) && (
              <p className="ui-text-muted text-sm mt-1">Ninguno por debajo del mínimo configurado.</p>
            )}
          </div>
          </div>
          {dashboard.por_area && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-sky-500/30 bg-[var(--ui-surface-2)] p-3 text-sm">
                <p className="font-semibold text-sky-300 mb-1">Insumos de cocina</p>
                <p className="text-[var(--ui-body-text)]">
                  {dashboard.por_area.cocina?.total_insumos ?? 0} activos · valor{' '}
                  <span className="text-emerald-400 font-medium">{formatCurrency(dashboard.por_area.cocina?.valor_inventario ?? 0)}</span>
                  {' · '}
                  <span className="text-amber-300">{dashboard.por_area.cocina?.bajo_minimo_count ?? 0}</span> bajo mínimo
                </p>
              </div>
              <div className="rounded-xl border border-indigo-500/30 bg-[var(--ui-surface-2)] p-3 text-sm">
                <p className="font-semibold text-indigo-300 mb-1">Insumos de bar</p>
                <p className="text-[var(--ui-body-text)]">
                  {dashboard.por_area.bar?.total_insumos ?? 0} activos · valor{' '}
                  <span className="text-emerald-400 font-medium">{formatCurrency(dashboard.por_area.bar?.valor_inventario ?? 0)}</span>
                  {' · '}
                  <span className="text-amber-300">{dashboard.por_area.bar?.bajo_minimo_count ?? 0}</span> bajo mínimo
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'insumos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--ui-border)] pb-2">
            <button
              type="button"
              onClick={() => {
                setInsumoAreaTab('cocina');
                setEditingInsumoId('');
                setInsumoForm(EMPTY_INSUMO_FORM());
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                insumoAreaTab === 'cocina'
                  ? 'bg-sky-600/90 text-white border-sky-500'
                  : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              Insumos de cocina
            </button>
            <button
              type="button"
              onClick={() => {
                setInsumoAreaTab('bar');
                setEditingInsumoId('');
                setInsumoForm(EMPTY_INSUMO_FORM());
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                insumoAreaTab === 'bar'
                  ? 'bg-indigo-600/90 text-white border-indigo-500'
                  : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
              }`}
            >
              Insumos de bar
            </button>
            <div className="flex-1 min-w-[8px]" aria-hidden="true" />
            <button
              type="button"
              onClick={() => setShowInsumoAddForm((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition shrink-0 ${
                showInsumoAddForm
                  ? 'bg-[var(--ui-surface)] text-[var(--ui-body-text)] border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]'
                  : 'bg-emerald-700/90 text-white border-emerald-600 hover:bg-emerald-600'
              }`}
            >
              {showInsumoAddForm ? (
                <>
                  <MdExpandLess className="text-lg" /> Ocultar formulario
                </>
              ) : (
                <>
                  <MdExpandMore className="text-lg" /> Agregar insumo
                </>
              )}
            </button>
          </div>
          <p className="text-[var(--ui-muted)] text-xs -mt-2">
            Catálogos separados en base de datos (`insumo_area`); mismo kardex y ventas.
          </p>
          <p className="text-[var(--ui-body-text)] text-xs max-w-3xl">
            <strong className="text-[var(--ui-body-text)]">Kardex y recetas usan cantidad en kg/L (o ml).</strong>{' '}
            <strong>Cant. (U)</strong> y el promedio kg/U se alimentan con la compra; las ventas por receta descontarán
            <strong> kg</strong> y <strong>U</strong> si aplica. Los mínimos (U y kg/L) definen alerta y requisición según
            rellenes cada uno (0 = no aplicar); no se listan en la tabla de abajo.
          </p>
          {showInsumoAddForm ? (
          <form
            onSubmit={addInsumo}
            className="bg-[var(--ui-surface-2)] p-3 rounded-lg border border-[color:var(--ui-border)]"
          >
            <div className="flex flex-nowrap gap-2 items-end overflow-x-auto pb-0.5 min-h-[3rem]">
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">Insumo</label>
                <input
                  className="input-field text-sm py-1.5 w-40"
                  value={insumoForm.nombre}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, nombre: formatCatalogNameInput(e.target.value) }))}
                  required
                />
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">U.M.</label>
                <select
                  className="input-field text-sm py-1.5 w-[8.5rem]"
                  value={normalizeInsumoUm(insumoForm.unidad_medida)}
                  onChange={(e) => {
                    const um = normalizeInsumoUm(e.target.value);
                    setInsumoForm((f) => ({
                      ...f,
                      unidad_medida: um,
                      minimo_unidades: isMasaOrLitrajeUm(um) ? '0' : f.minimo_unidades,
                      minimo_kg: isUnidadUm(um) ? '0' : f.minimo_kg,
                    }));
                  }}
                  title="Unidad de medida del insumo"
                >
                  {INSUMO_UM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">Precio compra</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm py-1.5 w-24"
                  value={insumoForm.precio_compra}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, precio_compra: e.target.value }))}
                  placeholder="0,00"
                  title="Costo por 1 U.M. (ej. por cada alita)"
                />
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">Cant. inicial</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm py-1.5 w-20"
                  value={insumoForm.cantidad_inicial}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, cantidad_inicial: e.target.value }))}
                  title="Stock inicial en la U.M. elegida"
                />
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">Mín. (U)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm py-1.5 w-20 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={isMasaOrLitrajeUm(insumoForm.unidad_medida) ? '0' : insumoForm.minimo_unidades}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, minimo_unidades: e.target.value }))}
                  disabled={isMasaOrLitrajeUm(insumoForm.unidad_medida)}
                  title={
                    isMasaOrLitrajeUm(insumoForm.unidad_medida)
                      ? 'Con U.M. de peso o litraje, use solo Mín. cantidad'
                      : '0 = sin alerta por unidades'
                  }
                />
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">Mín. cantidad</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm py-1.5 w-20 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={isUnidadUm(insumoForm.unidad_medida) ? '0' : insumoForm.minimo_kg}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, minimo_kg: e.target.value }))}
                  disabled={isUnidadUm(insumoForm.unidad_medida)}
                  title={
                    isUnidadUm(insumoForm.unidad_medida)
                      ? 'Con U.M. Unidad, use solo Mín. (U)'
                      : '0 = sin alerta por cantidad en peso/litraje'
                  }
                />
              </div>
              <label className="flex items-center gap-1.5 text-sm shrink-0 pb-0.5 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={insumoForm.activo}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, activo: e.target.checked }))}
                />
                Activo
              </label>
              <button type="submit" className="btn-primary flex items-center gap-1 text-sm shrink-0">
                <MdAdd /> {editingInsumoId ? 'Guardar' : 'Agregar'}
              </button>
              {editingInsumoId ? (
                <button
                  type="button"
                  className="text-sm px-3 py-1.5 rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-body-text)] shrink-0"
                  onClick={() => {
                    setEditingInsumoId('');
                    setShowInsumoAddForm(false);
                    setInsumoForm(EMPTY_INSUMO_FORM());
                  }}
                >
                  Cancelar
                </button>
              ) : null}
            </div>
          </form>
          ) : null}
          <div className="overflow-x-auto border border-slate-600/50 rounded-lg">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-[var(--ui-surface)] text-[var(--ui-body-text)] text-left border-b border-[color:var(--ui-border)]">
                  <th className="p-2.5">Insumo</th>
                  <th className="p-2.5">Cant. (kg / L)</th>
                  <th className="p-2.5">Cant. (U)</th>
                  <th
                    className="p-2.5"
                    title="Peso o volumen medio por 1 U (carnes, aves), actualizado con cada compra que indique kg y unidades"
                  >
                    Prom. (kg / L por U)
                  </th>
                  <th
                    className="p-2.5 text-right"
                    title="S/ por kg, L, ml, etc. según la U.M. de masa (costo promedio del kardex; mismo criterio que al comprar)"
                  >
                    Costo
                  </th>
                  <th className="p-2.5 text-right" title="Cant. kg/L × costo (valorizado)">
                    Valor inv.
                  </th>
                  <th className="p-2.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {insumosListaActiva.map((i) => {
                  const uAct = Number(i.stock_unidades != null ? i.stock_unidades : 0);
                  const uMin = Number(i.minimo_unidades != null ? i.minimo_unidades : 0);
                  const sAct = Number(i.stock_actual != null ? i.stock_actual : 0);
                  const sMin = Number(i.stock_minimo != null ? i.stock_minimo : 0);
                  const kpu = Number(i.kg_por_unidad != null ? i.kg_por_unidad : 0) || 0;
                  const lowU = uMin > 0 && uAct < uMin;
                  const lowM = sMin > 0 && sAct < sMin;
                  const low = lowU || lowM;
                  const umc = String(i.unidad_medida || '').replace(/[0-9]/g, '').trim();
                  const showKg = sAct > 0;
                  const showU = uAct > 0;
                  return (
                    <tr key={i.id} className={`border-b border-slate-600/40 ${low ? 'bg-red-950/30' : ''}`}>
                      <td className="p-2.5 font-medium text-[var(--ui-body-text)]">{i.nombre}</td>
                      <td className="p-2.5 text-[var(--ui-body-text)] tabular-nums">
                        {showKg ? formatInsumoWithUnit(i.stock_actual, umc) : <span className="text-[var(--ui-muted)]">—</span>}
                      </td>
                      <td className="p-2.5 text-[var(--ui-body-text)] tabular-nums">
                        {showU ? `${formatInsumoQty(uAct)} U` : <span className="text-[var(--ui-muted)]">—</span>}
                      </td>
                      <td className="p-2.5 text-amber-200/90 tabular-nums text-sm">
                        {kpu > 0 ? (
                          <span title="Usado al vender: por cada kg que descuenta la receta, también bajan las U (p. ej. cuartos de pollo)">
                            {formatInsumoQty(kpu)} {umc}/U
                          </span>
                        ) : (
                          <span className="text-[var(--ui-muted)]">—</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right tabular-nums text-[var(--ui-body-text)]">{formatCurrency(i.costo_promedio || 0)}</td>
                      <td className="p-2.5 text-right text-emerald-400/90 tabular-nums">
                        {formatCurrency((Number(i.stock_actual) * Number(i.costo_promedio)) || 0)}
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10"
                          onClick={() => editInsumo(i)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {insumosListaActiva.length === 0 && (
                  <tr>
                    <td colSpan="7" className="p-6 text-center text-[var(--ui-muted)] text-sm">
                      No hay insumos de {insumoAreaTab === 'bar' ? 'bar' : 'cocina'} todavía. Pulse{' '}
                      <strong className="text-[var(--ui-body-text)]">Agregar insumo</strong> arriba a la derecha, complete el
                      formulario y pulse Agregar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'compras' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-[var(--ui-muted)]">Comprar para:</span>
            <button
              type="button"
              onClick={() => setCompraAreaTab('cocina')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                compraAreaTab === 'cocina'
                  ? 'bg-sky-600/90 text-white border-sky-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Cocina
            </button>
            <button
              type="button"
              onClick={() => setCompraAreaTab('bar')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                compraAreaTab === 'bar'
                  ? 'bg-indigo-600/90 text-white border-indigo-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Bar
            </button>
          </div>
          <p className="text-[var(--ui-body-text)] text-sm">
            <strong className="text-[var(--ui-body-text)]">Cant. kg / L</strong> y <strong className="text-[var(--ui-body-text)]">costo</strong> = peso/volumen comprado (S/ por kg, L, etc.).
            <strong> Unid.</strong> = pollos, cajas, bultos, etc. Si pones <strong>kg y unidades</strong>, el sistema
            promedia <strong>kg / U</strong> (p. ej. 50 kg ÷ 20 piezas = 2,5 kg por unidad) y al <strong>vender por receta</strong> (cuartos, octavos) descuenta
            a la vez el <strong>kg</strong> y la parte de <strong>U</strong> que corresponda. Solo kg (sin U) sigue yendo al kardex de masa. Formato numérico{' '}
            <span className="whitespace-nowrap">es-PE (coma decimal)</span>.
          </p>
          <form onSubmit={runCompra} className="space-y-2">
            {compraLines.map((row, idx) => {
              const cq = row.cantidad != null && String(row.cantidad).trim() !== '' ? parseLocaleNumber(row.cantidad) : NaN;
              const uq = row.unidades != null && String(row.unidades).trim() !== '' ? parseLocaleNumber(row.unidades) : NaN;
              const razon =
                Number.isFinite(cq) && cq > 0 && Number.isFinite(uq) && uq > 0 ? (cq / uq) : null;
              return (
                <div key={idx} className="space-y-0.5">
              <div className="flex flex-wrap gap-2 items-end">
                <select
                  className="input-field text-sm py-1.5 min-w-[180px]"
                  value={row.insumo_id}
                  onChange={(e) => {
                    const n = [...compraLines];
                    n[idx] = { ...n[idx], insumo_id: e.target.value };
                    setCompraLines(n);
                  }}
                >
                  <option value="">— Insumo —</option>
                  {insumosCompraFiltrados.map((i) => {
                    const um = String(i.unidad_medida || 'kg')
                      .replace(/[0-9]/g, '')
                      .trim() || 'kg';
                    return (
                      <option key={i.id} value={i.id}>
                        {i.nombre} ({formatInsumoWithUnit(i.stock_actual, um)} · {formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)
                      </option>
                    );
                  })}
                </select>
                <div>
                  <label className="block text-[10px] ui-text-muted">Cant. kg / L</label>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder="0"
                    className="input-field text-sm py-1.5 w-24"
                    value={row.cantidad}
                    onChange={(e) => {
                      const n = [...compraLines];
                      n[idx] = { ...n[idx], cantidad: e.target.value };
                      setCompraLines(n);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] ui-text-muted">Costo S/ U.M.</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    className="input-field text-sm py-1.5 w-24"
                    value={row.costo_unitario}
                    onChange={(e) => {
                      const n = [...compraLines];
                      n[idx] = { ...n[idx], costo_unitario: e.target.value };
                      setCompraLines(n);
                    }}
                  />
                </div>
                <div>
                  <label className="block text-[10px] ui-text-muted">Unid. (opcional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    className="input-field text-sm py-1.5 w-24"
                    value={row.unidades}
                    onChange={(e) => {
                      const n = [...compraLines];
                      n[idx] = { ...n[idx], unidades: e.target.value };
                      setCompraLines(n);
                    }}
                    title="Suma a unidades (cajas, bultos) si aplica a esta compra"
                  />
                </div>
                {compraLines.length > 1 && (
                  <button
                    type="button"
                    className="text-red-400 text-sm mb-1"
                    onClick={() => setCompraLines((l) => l.filter((_, j) => j !== idx))}
                  >
                    Quitar
                  </button>
                )}
              </div>
                {razon != null && (
                  <p className="text-[10px] text-amber-400/85 pl-0.5">
                    Estos valores implican <strong>≈ {formatInsumoQty(razon)}</strong> (kg o L) por 1 U en esta
                    línea; al guardar se promedia con el stock en U.
                  </p>
                )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <button
                type="button"
                className="text-sm text-amber-400/90"
                onClick={() =>
                  setCompraLines((l) => [...l, { insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }])
                }
              >
                + Línea
              </button>
              <button type="submit" className="btn-primary">Registrar compra</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'recetas' && (
        <div className="space-y-4">
          <p className="text-[var(--ui-body-text)] text-sm">
            Vincula un plato al menú. Cada <strong>cantidad usada</strong> es en la U.M. del insumo (kg, L, ml). Con pollo
            o carnes, si el insumo tiene promedio kg / U, al vender se descuentan <strong>kg y unidades en proporción</strong> (p. ej. 0,5 kg
            = 0,2 U si 1 U = 2,5 kg).
            {recetaForm.product_id ? (
              <span className="block mt-1 text-sky-300/90 text-xs">
                Solo se listan insumos de{' '}
                <strong>{String(selectedProductForReceta?.production_area || '').toLowerCase() === 'bar' ? 'bar' : 'cocina'}</strong>
                {' '}(según el área de preparación del producto elegido).
              </span>
            ) : null}
          </p>
          <form onSubmit={saveReceta} className="bg-[var(--ui-surface-2)] p-4 rounded-xl border border-[color:var(--ui-border)] space-y-3">
            <div className="flex flex-wrap gap-2">
              <div>
                <label className="block text-xs ui-text-muted">Nombre receta / plato</label>
                <input
                  className="input-field text-sm py-1.5 w-48"
                  value={recetaForm.nombre_plato}
                  onChange={(e) => setRecetaForm((f) => ({ ...f, nombre_plato: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs ui-text-muted">Producto menú</label>
                <select
                  className="input-field text-sm py-1.5 min-w-[200px]"
                  value={recetaForm.product_id}
                  onChange={(e) => setRecetaForm((f) => ({ ...f, product_id: e.target.value }))}
                >
                  <option value="">— Seleccionar —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-end gap-2 h-full pb-1 text-sm">
                <input
                  type="checkbox"
                  checked={recetaForm.activo}
                  onChange={(e) => setRecetaForm((f) => ({ ...f, activo: e.target.checked }))}
                />
                Activo
              </label>
            </div>
            <div className="space-y-2">
              <p className="ui-text-muted text-xs">Insumos por unidad de plato (1 servicio)</p>
              {recetaForm.detalles.map((d, di) => (
                <div key={di} className="flex flex-wrap gap-2 items-center">
                  <select
                    className="input-field text-sm py-1.5"
                    value={d.insumo_id}
                    onChange={(e) => {
                      const n = [...recetaForm.detalles];
                      n[di] = { ...n[di], insumo_id: e.target.value };
                      setRecetaForm((f) => ({ ...f, detalles: n }));
                    }}
                  >
                    <option value="">— Insumo —</option>
                    {insumosParaReceta.map((i) => (
                      <option key={i.id} value={i.id}>{i.nombre}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    placeholder="Cant. usada"
                    className="input-field text-sm py-1.5 w-32"
                    value={d.cantidad_usada}
                    onChange={(e) => {
                      const n = [...recetaForm.detalles];
                      n[di] = { ...n[di], cantidad_usada: e.target.value };
                      setRecetaForm((f) => ({ ...f, detalles: n }));
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="text-amber-400/90 text-sm"
                onClick={() => setRecetaForm((f) => ({
                  ...f,
                  detalles: [...f.detalles, { insumo_id: '', cantidad_usada: '' }],
                }))}
              >
                + Insumo
              </button>
            </div>
            <div className="flex gap-2">
              {editingRecetaId && (
                <button
                  type="button"
                  className="px-3 py-1.5 border border-slate-500 rounded-lg text-[var(--ui-muted)]"
                  onClick={() => {
                    setEditingRecetaId('');
                    setRecetaForm({
                      nombre_plato: '', product_id: '', activo: true, detalles: [{ insumo_id: '', cantidad_usada: '' }],
                    });
                  }}
                >
                  Cancelar edición
                </button>
              )}
              <button type="submit" className="btn-primary">
                {editingRecetaId ? 'Guardar receta' : 'Crear receta'}
              </button>
            </div>
          </form>
          <div className="border border-slate-600/50 rounded-lg overflow-hidden">
            {recetas.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-2 border-b border-slate-600/40 last:border-0"
              >
                <div>
                  <span className="font-medium">{r.nombre_plato}</span>
                  <span className="ui-text-muted text-sm ml-2">· {r.product_name || r.product_id}</span>
                </div>
                <button type="button" className="text-amber-400/90 text-sm" onClick={() => loadRecetaEdit(r.id)}>
                  Editar
                </button>
              </div>
            ))}
            {!recetas.length && <p className="p-4 ui-text-muted text-sm">No hay recetas. Crea una y vincúlala a un plato.</p>}
          </div>
        </div>
      )}

      {tab === 'kardex' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs ui-text-muted">Insumo</label>
              <select
                className="input-field text-sm py-1.5"
                value={kardexInsumo}
                onChange={(e) => setKardexInsumo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {insumosCocina.length > 0 && (
                  <optgroup label="Insumos de cocina">
                    {insumosCocina.map((i) => {
                      const umc = (String(i.unidad_medida || 'kg').replace(/[0-9]/g, '') || 'kg').trim() || 'kg';
                      return (
                        <option key={i.id} value={i.id}>
                          {i.nombre} ({formatInsumoWithUnit(i.stock_actual, umc)} · {formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {insumosBar.length > 0 && (
                  <optgroup label="Insumos de bar">
                    {insumosBar.map((i) => {
                      const umc = (String(i.unidad_medida || 'kg').replace(/[0-9]/g, '') || 'kg').trim() || 'kg';
                      return (
                        <option key={i.id} value={i.id}>
                          {i.nombre} ({formatInsumoWithUnit(i.stock_actual, umc)} · {formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs ui-text-muted">Desde</label>
              <input
                type="date"
                className="input-field text-sm py-1.5"
                value={kardexFrom}
                onChange={(e) => setKardexFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs ui-text-muted">Hasta</label>
              <input
                type="date"
                className="input-field text-sm py-1.5"
                value={kardexTo}
                onChange={(e) => setKardexTo(e.target.value)}
              />
            </div>
            {kardexInsumo && (
              <DownloadExcelTxtButtons
                onExcel={() => descargarKardex('excel').catch((e) => toast.error(e.message))}
                onTxt={() => descargarKardex('txt').catch((e) => toast.error(e.message))}
              />
            )}
          </div>
          {kardexData && (
            <div className="text-sm text-[var(--ui-body-text)] mb-2">
              <MdInventory2 className="inline mr-1" />
              Valor inventario actual: <span className="text-emerald-400 font-medium">{formatCurrency(kardexData.valor_inventario)}</span>
              {' · '}
              {(() => {
                const um = String(kardexData.insumo?.unidad_medida || '').replace(/[0-9]/g, '').trim();
                const sAct = Number(kardexData.insumo?.stock_actual || 0);
                const uAct = Number(kardexData.insumo?.stock_unidades || 0);
                const hasKg = sAct > 0;
                const hasU = uAct > 0;
                return (
                  <span>
                    Stock: {hasKg ? formatInsumoWithUnit(sAct, um) : '—'}
                    {' · '}
                    U: {hasU ? `${formatInsumoQty(uAct)} U` : '—'}
                  </span>
                );
              })()}
            </div>
          )}
          <div className="overflow-x-auto border border-slate-600/50 rounded-lg max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="sticky top-0 z-10 bg-[var(--ui-surface)] border-b border-[color:var(--ui-border)] shadow-sm">
                <tr className="text-left text-[var(--ui-body-text)] border-b border-[color:var(--ui-border)]">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2 text-right">Cant. (kg/L)</th>
                  <th className="p-2 text-right">Cant. (U)</th>
                  <th className="p-2 text-right">C. unit.</th>
                  <th className="p-2 text-right">C. total</th>
                  <th className="p-2 text-right">Stock res. (kg/L)</th>
                  <th className="p-2 text-right">Stock res. (U)</th>
                </tr>
              </thead>
              <tbody>
                {(kardexData?.movimientos || []).map((m) => {
                  const ins = kardexData?.insumo || {};
                  const um = String(ins.unidad_medida || '').replace(/[0-9]/g, '').trim();
                  const kpu = Number(ins.kg_por_unidad || 0);
                  const qtyKg = Number(m.cantidad || 0);
                  const stockKg = Number(m.stock_resultante || 0);
                  const canShowU = kpu > 1e-12;
                  const qtyU = canShowU ? (qtyKg / kpu) : 0;
                  const stockU = canShowU ? (stockKg / kpu) : 0;
                  return (
                    <tr key={m.id} className="border-b border-slate-600/40">
                      <td className="p-2 text-[var(--ui-body-text)]">{formatDateTime(m.fecha || m.created_at)}</td>
                      <td className="p-2">
                        <span
                          className={
                            m.tipo_movimiento === 'entrada'
                              ? 'text-emerald-400'
                              : m.tipo_movimiento === 'salida'
                                ? 'text-red-400'
                                : 'text-amber-300'
                          }
                        >
                          {m.tipo_movimiento === 'entrada'
                            ? 'Entrada'
                            : m.tipo_movimiento === 'salida'
                              ? 'Salida'
                              : 'Ajuste'}
                        </span>
                      </td>
                      <td className="p-2 text-right tabular-nums text-[var(--ui-body-text)]">
                        {formatInsumoQty(qtyKg)} {um || 'kg'}
                      </td>
                      <td className="p-2 text-right tabular-nums text-[var(--ui-body-text)]">
                        {canShowU ? `${formatInsumoQty(qtyU)} U` : '—'}
                      </td>
                      <td className="p-2 text-right text-[var(--ui-body-text)]">{formatCurrency(m.costo_unitario)}</td>
                      <td className="p-2 text-right text-[var(--ui-body-text)]">{formatCurrency(m.costo_total)}</td>
                      <td className="p-2 text-right font-medium text-[var(--ui-body-text)] tabular-nums">
                        {formatInsumoQty(stockKg)} {um || 'kg'}
                      </td>
                      <td className="p-2 text-right font-medium text-[var(--ui-body-text)] tabular-nums">
                        {canShowU ? `${formatInsumoQty(stockU)} U` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {kardexInsumo && kardexData && !(kardexData.movimientos || []).length && (
              <p className="p-6 ui-text-muted text-center">Sin movimientos en el rango.</p>
            )}
          </div>
          {kardexData && (kardexData.movimientos || []).length > 0 && (
            <div className="flex justify-end gap-3 flex-wrap">
              {(() => {
                const ins = kardexData.insumo || {};
                const um = String(ins.unidad_medida || '').replace(/[0-9]/g, '').trim() || 'kg';
                const kpu = Number(ins.kg_por_unidad || 0);
                const totals = (kardexData.movimientos || []).reduce(
                  (acc, m) => {
                    const qtyKg = Number(m.cantidad || 0);
                    const qtyU = kpu > 1e-12 ? (qtyKg / kpu) : 0;
                    const cost = Number(m.costo_total || 0);
                    if (m.tipo_movimiento === 'entrada') {
                      acc.entradas.kg += qtyKg;
                      acc.entradas.u += qtyU;
                      acc.entradas.cost += cost;
                    } else if (m.tipo_movimiento === 'salida') {
                      acc.salidas.kg += qtyKg;
                      acc.salidas.u += qtyU;
                      acc.salidas.cost += cost;
                    }
                    return acc;
                  },
                  {
                    entradas: { kg: 0, u: 0, cost: 0 },
                    salidas: { kg: 0, u: 0, cost: 0 },
                  }
                );
                const Card = ({ title, data, accent }) => (
                  <div className={`min-w-[220px] rounded-lg border p-3 bg-[var(--ui-surface-2)] ${accent}`}>
                    <p className="text-sm font-semibold mb-2">{title}</p>
                    <div className="space-y-1 text-sm">
                      <p className="text-[var(--ui-body-text)]">
                        Cantidad: <span className="font-semibold text-[var(--ui-body-text)]">{formatInsumoQty(data.kg)} {um}</span>
                      </p>
                      <p className="text-[var(--ui-body-text)]">
                        Cantidad U: <span className="font-semibold text-[var(--ui-body-text)]">{kpu > 1e-12 ? `${formatInsumoQty(data.u)} U` : '—'}</span>
                      </p>
                      <p className="text-[var(--ui-body-text)]">
                        Precio total: <span className="font-semibold text-[var(--ui-body-text)]">{formatCurrency(data.cost)}</span>
                      </p>
                    </div>
                  </div>
                );
                return (
                  <>
                    <Card
                      title="Total Entradas"
                      data={totals.entradas}
                      accent="border-emerald-500/40 text-emerald-300"
                    />
                    <Card
                      title="Total Salidas"
                      data={totals.salidas}
                      accent="border-rose-500/40 text-rose-300"
                    />
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {tab === 'inv_fisico' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-[var(--ui-muted)]">Conteo de:</span>
            <button
              type="button"
              onClick={() => setInvFisicoAreaTab('cocina')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                invFisicoAreaTab === 'cocina'
                  ? 'bg-sky-600/90 text-white border-sky-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Cocina
            </button>
            <button
              type="button"
              onClick={() => setInvFisicoAreaTab('bar')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                invFisicoAreaTab === 'bar'
                  ? 'bg-indigo-600/90 text-white border-indigo-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Bar
            </button>
          </div>
          <p className="text-[var(--ui-muted)] text-sm">
            <strong className="text-[var(--ui-body-text)]">Inventario de transformables (insumos):</strong>{' '}
            conteo físico de materiales del kardex. Registra el conteo (pendiente) y luego <strong>cierra</strong> para generar movimientos valorizados.
          </p>
          <form onSubmit={crearInventarioFisico} className="space-y-2">
            {invDetalles.map((d, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <select
                  className="input-field text-sm py-1.5"
                  value={d.insumo_id}
                  onChange={(e) => {
                    const n = [...invDetalles];
                    n[i] = { ...n[i], insumo_id: e.target.value };
                    setInvDetalles(n);
                  }}
                >
                  <option value="">— Insumo —</option>
                  {insumosInvFisicoFiltrados.map((x) => (
                    <option key={x.id} value={x.id}>{x.nombre}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Stock contado (real)"
                  className="input-field text-sm py-1.5 w-44"
                  value={d.stock_real}
                  onChange={(e) => {
                    const n = [...invDetalles];
                    n[i] = { ...n[i], stock_real: e.target.value };
                    setInvDetalles(n);
                  }}
                />
              </div>
            ))}
            <button type="button" className="text-amber-400/90 text-sm" onClick={() => setInvDetalles((l) => [...l, { insumo_id: '', stock_real: '' }])}>
              + Fila
            </button>
            <button type="submit" className="btn-primary block">Crear toma (pendiente)</button>
          </form>
          <div className="mt-4 space-y-2">
            <p className="ui-text-muted text-xs flex items-center gap-1"><MdList /> Últimos inventarios</p>
            {invList.map((iv) => {
              const n = Number(iv.cuadre_num);
              const label = Number.isFinite(n) && n > 0 ? `CUADRE ${n}` : `Inventario ${(iv.id || '').slice(0, 8)}`;
              return (
                <div
                  key={iv.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-[var(--ui-surface-2)] border border-[color:var(--ui-border)] rounded-lg px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[var(--ui-body-text)] font-semibold tracking-tight">{label}</span>
                      <span className="ui-text-muted text-sm">{formatDateTime(iv.fecha || iv.created_at)}</span>
                      <span
                        className={`text-xs uppercase tracking-wide ${
                          iv.estado === 'cerrado' ? 'ui-text-muted' : 'text-amber-400'
                        }`}
                      >
                        {iv.estado}
                      </span>
                    </div>
                    <p
                      className="text-sm mt-1"
                      title="Conteo físico vs stock del kardex al guardar la toma (cada insumo: falta, bien o sobra)"
                    >
                      <InventarioFisicoResumenLine
                        f={iv.resumen_falta}
                        b={iv.resumen_bien}
                        s={iv.resumen_sobra}
                      />
                    </p>
                  </div>
                  {iv.estado === 'pendiente' && (
                    <button
                      type="button"
                      onClick={() => cerrarInventario(iv.id)}
                      className="text-sm text-amber-400/90 shrink-0 self-end sm:self-center"
                    >
                      Cerrar y ajustar kardex
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'inv_no_transform' && (
        <div className="space-y-4">
          <p className="text-[var(--ui-muted)] text-sm">
            <strong className="text-[var(--ui-body-text)]">Inventario de no transformables:</strong>{' '}
            productos de almacén (sin transformar) para cuadre físico por ubicación. Alinea el stock del almacén con el conteo real.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-[var(--ui-muted)]">
              Almacén:
              <select
                value={cuadreWarehouseId}
                onChange={(e) => {
                  setCuadreWarehouseId(e.target.value);
                  setLogisticsCounted({});
                }}
                className="bg-[var(--ui-surface)] border border-[color:var(--ui-border)] rounded-lg px-2 py-1.5 text-[var(--ui-body-text)] text-sm"
              >
                {whWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setShowReconciliationsModal(true)}
              className="text-sm px-3 py-1.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
            >
              Historial de cuadres
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-[var(--ui-surface)] border-b border-[color:var(--ui-border)] text-left text-[var(--ui-body-text)]">
                  <th className="p-2.5 font-medium w-20">#</th>
                  <th className="p-2.5 font-medium">Producto</th>
                  <th className="p-2.5 font-medium">Categoría</th>
                  <th className="p-2.5 font-medium text-right">Stock sistema</th>
                  <th className="p-2.5 font-medium text-right">Cantidad contada</th>
                  <th className="p-2.5 font-medium text-right">Diferencia</th>
                  <th className="p-2.5 font-medium text-right">Costo UM</th>
                  <th className="p-2.5 font-medium text-right">Valorización</th>
                </tr>
              </thead>
              <tbody>
                {logisticsProductsFiltered.map((product, idx) => {
                  const diff = getLogisticsDiff(product);
                  const unitCost = Number(product.price || 0);
                  const stock = getLogisticsCurrentStock(product);
                  const valuation = unitCost * stock;
                  return (
                    <tr key={product.id} className="border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)]">
                      <td className="p-2.5 text-[var(--ui-muted)]">#{String(idx + 1).padStart(3, '0')}</td>
                      <td className="p-2.5 font-medium text-[var(--ui-body-text)]">{product.name}</td>
                      <td className="p-2.5 text-[var(--ui-muted)]">{product.category_name || '—'}</td>
                      <td className="p-2.5 text-right">{stock}</td>
                      <td className="p-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          value={logisticsCounted[product.id] ?? ''}
                          onChange={(e) => setLogisticsCounted((prev) => ({ ...prev, [product.id]: e.target.value }))}
                          className="w-24 ml-auto rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] py-1.5 px-2 text-right text-sm text-[var(--ui-body-text)]"
                          placeholder="0"
                        />
                      </td>
                      <td
                        className={`p-2.5 text-right font-medium ${
                          diff === null ? 'text-[var(--ui-muted)]' : diff === 0 ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-sky-400'
                        }`}
                      >
                        {diff === null ? '—' : diff}
                      </td>
                      <td className="p-2.5 text-right">{formatCurrency(unitCost)}</td>
                      <td className="p-2.5 text-right">{formatCurrency(valuation)}</td>
                    </tr>
                  );
                })}
                {logisticsProductsFiltered.length === 0 && (
                  <tr>
                    <td colSpan="8" className="p-8 text-center text-[var(--ui-muted)]">
                      No hay productos no transformados en este almacén. Usa Movimiento interno en Almacén para stock.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={saveWarehouseReconciliation} className="btn-primary">
              Guardar cuadre de almacén
            </button>
          </div>
        </div>
      )}

      {tab === 'ajustes' && (
        <form onSubmit={enviarAjuste} className="max-w-md space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-[var(--ui-muted)]">Ajuste en:</span>
            <button
              type="button"
              onClick={() => setAjusteAreaTab('cocina')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                ajusteAreaTab === 'cocina'
                  ? 'bg-sky-600/90 text-white border-sky-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Cocina
            </button>
            <button
              type="button"
              onClick={() => setAjusteAreaTab('bar')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                ajusteAreaTab === 'bar'
                  ? 'bg-indigo-600/90 text-white border-indigo-500'
                  : 'border-[color:var(--ui-border)] text-[var(--ui-body-text)]'
              }`}
            >
              Bar
            </button>
          </div>
          <p className="text-[var(--ui-body-text)] text-sm">Entrada manual o salida por merma (al costo promedio al salir).</p>
          <div>
            <label className="block text-xs ui-text-muted">Insumo</label>
            <select
              className="input-field text-sm py-1.5 w-full"
              value={ajusteForm.insumo_id}
              onChange={(e) => setAjusteForm((f) => ({ ...f, insumo_id: e.target.value }))}
            >
              <option value="">—</option>
              {insumosAjusteFiltrados.map((i) => {
                const umc = (String(i.unidad_medida || 'kg').replace(/[0-9]/g, '') || 'kg').trim() || 'kg';
                return (
                <option key={i.id} value={i.id}>
                  {i.nombre} ({formatInsumoWithUnit(i.stock_actual, umc)} · {formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)
                </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs ui-text-muted">Cantidad (kg / L) &gt; 0</label>
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              className="input-field text-sm py-1.5 w-full"
              value={ajusteForm.cantidad}
              onChange={(e) => setAjusteForm((f) => ({ ...f, cantidad: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs ui-text-muted">Tipo</label>
            <select
              className="input-field text-sm py-1.5 w-full"
              value={ajusteForm.tipo}
              onChange={(e) => setAjusteForm((f) => ({ ...f, tipo: e.target.value }))}
            >
              <option value="salida">Salida (merma / pérdida)</option>
              <option value="entrada">Entrada (ajuste a favor)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs ui-text-muted">Referencia (merma, ajuste, etc.)</label>
            <input
              className="input-field text-sm py-1.5 w-full"
              value={ajusteForm.referencia}
              onChange={(e) => setAjusteForm((f) => ({ ...f, referencia: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn-primary">Registrar ajuste</button>
        </form>
      )}

      <Modal
        isOpen={showReconciliationsModal}
        onClose={() => setShowReconciliationsModal(false)}
        title="Historial de cuadres de almacén"
        size="lg"
      >
        <div className="modal-sheet-body space-y-3 max-h-[70vh] overflow-y-auto">
          {reconciliationHistory.length === 0 && (
            <p className="text-sm text-[var(--ui-muted)]">No hay cuadres guardados.</p>
          )}
          {reconciliationHistory.map((rec) => (
            <div key={rec.id} className="border border-[color:var(--ui-border)] rounded-lg p-3 bg-[var(--ui-surface-2)]">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-[var(--ui-body-text)]">{rec.warehouse_name || 'Almacén'}</p>
                  <p className="text-xs text-[var(--ui-muted)]">{formatDateTime(rec.created_at)}</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <DownloadExcelTxtButtons
                    onExcel={() => downloadReconciliationRecord(rec, { format: 'excel', formatDate, formatDateTime, toastFn: toast })}
                    onTxt={() => downloadReconciliationRecord(rec, { format: 'txt', formatDate, formatDateTime, toastFn: toast })}
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--ui-muted)] mb-2">
                Items: {rec.total_items} · Faltante: {rec.total_shortage} · Sobrante: {rec.total_surplus}
              </p>
              <div className="space-y-1">
                {(rec.items || []).map((item) => (
                  <div key={item.id} className="text-sm flex items-center justify-between border-b border-[color:var(--ui-border)] pb-1 text-[var(--ui-body-text)]">
                    <span>{item.product_name}</span>
                    <span
                      className={`font-medium ${
                        Number(item.difference || 0) < 0
                          ? 'text-red-400'
                          : Number(item.difference || 0) > 0
                            ? 'text-sky-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {Number(item.difference || 0) === 0
                        ? 'Cuadrado'
                        : Number(item.difference || 0) < 0
                          ? `Falta ${Math.abs(Number(item.difference || 0))}`
                          : `Sobra ${Number(item.difference || 0)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
