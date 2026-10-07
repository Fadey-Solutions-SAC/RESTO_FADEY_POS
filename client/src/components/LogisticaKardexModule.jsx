import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { InlineDateField } from './DateFilterControls';
import {
  INSUMO_UM_OPTIONS,
  isMasaOrLitrajeUm,
  isUnidadUm,
  normalizeInsumoUm,
  insumoStockEnUnidades,
  insumoStockEnMasa,
  insumoEstaBajoMinimo,
  insumoValorInventario,
} from '../utils/insumoUnidadMedida';
import toast from 'react-hot-toast';
import { MdInventory2, MdAdd, MdList, MdExpandMore, MdExpandLess } from 'react-icons/md';
import Modal from './Modal';
import RecetaEditor from './RecetaEditor';

function foldProductName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const TABS = [
  { id: 'insumos', label: 'Insumos' },
  { id: 'compras', label: 'Compras' },
  { id: 'recetas', label: 'Recetas' },
  { id: 'kardex', label: 'Kardex' },
  { id: 'inv_fisico', label: 'Inventario de transformables' },
  { id: 'inv_no_transform', label: 'Inventario de no transformables' },
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

function insumoOptionStockLabel(i) {
  const um = (String(i?.unidad_medida || 'kg').replace(/[0-9]/g, '') || 'kg').trim() || 'kg';
  if (isUnidadUm(um)) return `${i.nombre} (${formatInsumoQty(insumoStockEnUnidades(i))} U)`;
  return `${i.nombre} (${formatInsumoWithUnit(i.stock_actual, um)} · ${formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)`;
}

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
      <span className="ui-text-success">
        Está bien: coincide con kardex ({nb} {nb === 1 ? 'ítem' : 'ítems'})
      </span>
    );
  }
  const parts = [];
  if (nf > 0) parts.push({ key: 'f', node: <span className="ui-text-danger font-medium">Falta: {nf}</span> });
  if (nb > 0) parts.push({ key: 'b', node: <span className="ui-text-success">Bien: {nb}</span> });
  if (ns > 0) parts.push({ key: 's', node: <span className="ui-text-info font-medium">Sobra: {ns}</span> });
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
  const [tab, setTab] = useState('insumos');
  const [insumos, setInsumos] = useState([]);
  /** Área activa en pestaña Insumos (cada lista tiene su propio catálogo en BD vía `insumo_area`). */
  const [insumoAreaTab, setInsumoAreaTab] = useState('cocina');
  /** Formulario de alta/edición de insumo: oculto por defecto; se abre con botón o al pulsar Editar. */
  const [showInsumoAddForm, setShowInsumoAddForm] = useState(false);
  const [compraAreaTab, setCompraAreaTab] = useState('cocina');
  const [invFisicoAreaTab, setInvFisicoAreaTab] = useState('cocina');
  const [products, setProducts] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [invList, setInvList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [insumoForm, setInsumoForm] = useState(EMPTY_INSUMO_FORM);
  const [editingInsumoId, setEditingInsumoId] = useState('');
  const [compraLines, setCompraLines] = useState([{ insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }]);
  const [editingRecetaId, setEditingRecetaId] = useState('');
  const [recetaEditorKey, setRecetaEditorKey] = useState(0);

  const [kardexInsumo, setKardexInsumo] = useState('');
  const [kardexFrom, setKardexFrom] = useState('');
  const [kardexTo, setKardexTo] = useState('');
  const [kardexData, setKardexData] = useState(null);

  const [invDetalles, setInvDetalles] = useState([{ insumo_id: '', stock_real: '' }]);
  const [whProducts, setWhProducts] = useState([]);
  const [whWarehouses, setWhWarehouses] = useState([]);
  const [cuadreWarehouseId, setCuadreWarehouseId] = useState('');
  const [cuadreLetter, setCuadreLetter] = useState('');
  const [logisticsCounted, setLogisticsCounted] = useState({});
  const cuadreListRef = useRef(null);
  const [showReconciliationsModal, setShowReconciliationsModal] = useState(false);
  const [reconciliationHistory, setReconciliationHistory] = useState([]);

  const loadCore = useCallback(async () => {
    const [ins, prods, rec, inv] = await Promise.all([
      api.get(`${BASE}/insumos`),
      api.get('/products').catch(() => []),
      api.get(`${BASE}/recetas`),
      api.get(`${BASE}/inventario-fisico`),
    ]);
    setInsumos(Array.isArray(ins) ? ins : []);
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
  const valorInsumosLista = useMemo(
    () => insumosListaActiva.reduce((s, i) => s + insumoValorInventario(i), 0),
    [insumosListaActiva]
  );
  const insumosCompraFiltrados = compraAreaTab === 'bar' ? insumosBar : insumosCocina;
  const insumosInvFisicoFiltrados = invFisicoAreaTab === 'bar' ? insumosBar : insumosCocina;

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
      cantidad_inicial: String(
        isUnidadUm(um)
          ? insumoStockEnUnidades(row)
          : Number(row.stock_actual || 0)
      ),
      minimo_unidades: masa ? '0' : String(Number(row.minimo_unidades || 0)),
      minimo_kg: und ? '0' : String(Number(row.stock_minimo || 0)),
      activo: Number(row.activo) !== 0,
    });
  };

  const runCompra = async (e) => {
    e.preventDefault();
    const items = [];
    for (const l of compraLines) {
      if (!l.insumo_id) continue;
      const ins = insumos.find((i) => String(i.id) === String(l.insumo_id));
      const porUnidad = Boolean(ins) && isUnidadUm(ins.unidad_medida);
      const costo_unitario = l.costo_unitario === '' ? NaN : parseLocaleNumber(l.costo_unitario);
      if (!Number.isFinite(costo_unitario) || costo_unitario < 0) {
        toast.error(porUnidad ? 'Revisa el costo por uso (S/ de cada porción).' : 'Revisa el costo unitario (S/ por kg, L, etc.).');
        return;
      }
      if (porUnidad) {
        const u = parseLocaleNumber(l.unidades);
        if (!Number.isFinite(u) || u <= 0) {
          toast.error('En insumos por unidad (alitas, etc.) la cantidad va en Cant. (U), mayor a 0.');
          return;
        }
        items.push({ insumo_id: l.insumo_id, cantidad: u, costo_unitario, unidades: u });
        continue;
      }
      if (l.cantidad === '' || l.costo_unitario === '') continue;
      const cantidad = parseLocaleNumber(l.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error('Revisa la cantidad en kg/L (mayor a 0, ej. 10,5 o 10.5).');
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
      toast.success('Compra registrada: stock de almacén actualizado e incluida en informes e indicadores');
      setCompraLines([{ insumo_id: '', cantidad: '', costo_unitario: '', unidades: '' }]);
      loadCore();
    } catch (err) {
      toast.error(err.message);
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
    .sort((a, b) => {
      const an = foldProductName(a.name);
      const bn = foldProductName(b.name);
      const prefix = foldProductName(cuadreLetter);
      if (prefix) {
        const aHit = an.startsWith(prefix) ? 0 : 1;
        const bHit = bn.startsWith(prefix) ? 0 : 1;
        if (aHit !== bHit) return aHit - bHit;
      }
      return an.localeCompare(bn, 'es');
    });

  const setCuadreLetterOnly = (raw) => {
    const letter = String(raw || '').replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g, '').slice(-1).toLocaleUpperCase('es');
    setCuadreLetter(letter);
    cuadreListRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (tab !== 'inv_no_transform' || showReconciliationsModal) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target;
      const tag = target?.tagName;
      if (tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const isLetterBox = target?.dataset?.cuadreLetter != null;
      const isCount = tag === 'INPUT' && target.type === 'number';
      if (tag === 'INPUT' && !isCount && !isLetterBox) return;
      if (e.key === 'Escape') {
        setCuadreLetter('');
        return;
      }
      if (e.key === 'Backspace') {
        if (isCount && String(target.value || '')) return;
        e.preventDefault();
        setCuadreLetter('');
        return;
      }
      if (e.repeat) return;
      if (/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]$/.test(e.key)) {
        e.preventDefault();
        setCuadreLetter(e.key.toLocaleUpperCase('es'));
        cuadreListRef.current?.scrollTo({ top: 0 });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tab, showReconciliationsModal]);

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
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x border-b border-[color:var(--ui-border)] pb-2 -mx-1 px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              tab === t.id
                ? 'bg-[var(--ui-accent)] text-white shadow-sm border border-[color:var(--ui-accent)]'
                : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)] border border-[color:var(--ui-border)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
            <p className="text-sm text-[var(--ui-body-text)] shrink-0">
              Valor insumos:{' '}
              <span className="font-semibold ui-text-success tabular-nums">{formatCurrency(valorInsumosLista)}</span>
            </p>
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
          <p className="text-[var(--ui-body-text)] text-sm max-w-3xl">
            El sistema usará la cantidad en productos (Unidad / Peso / Cantidad) para descontar y obtener el costo de producción total del producto.
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
                  title={
                    normalizeInsumoUm(insumoForm.unidad_medida) === 'g'
                      ? 'Stock en gramos para descontar por receta (ej. 250 g por plato). 1 000 g o más se muestran como kg'
                      : 'Unidad de medida del insumo'
                  }
                >
                  {INSUMO_UM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">
                  {isUnidadUm(insumoForm.unidad_medida) ? 'Costo por uso (C/u.ml.l.g.kg.o)' : 'Precio compra'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input-field text-sm py-1.5 w-24"
                  value={insumoForm.precio_compra}
                  onChange={(e) => setInsumoForm((f) => ({ ...f, precio_compra: e.target.value }))}
                  placeholder="0,00"
                  title={
                    isUnidadUm(insumoForm.unidad_medida)
                      ? 'Costo de cada porción o pieza que se usa (ej. cada alita)'
                      : 'Costo por 1 U.M. (kg, L, etc.)'
                  }
                />
              </div>
              <div className="shrink-0">
                <label className="block text-xs ui-text-muted mb-0.5">
                  {isUnidadUm(insumoForm.unidad_medida) ? 'Cant. inicial (U)' : 'Cant. inicial'}
                </label>
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
                    title="Costo según la cantidad que se usa: unidad, mililitro, litro, gramo o kilogramo"
                  >
                    Costo por uso
                    <span className="block text-[9px] font-normal ui-text-muted whitespace-nowrap">C/u.ml.l.g.kg.o</span>
                  </th>
                  <th className="p-2.5 text-right" title="Stock × costo por uso (valorizado de insumos)">
                    Valor insumos
                  </th>
                  <th className="p-2.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {insumosListaActiva.map((i) => {
                  const umc = String(i.unidad_medida || '').replace(/[0-9]/g, '').trim();
                  const porUnidad = isUnidadUm(umc);
                  const uAct = insumoStockEnUnidades(i);
                  const sAct = insumoStockEnMasa(i);
                  const kpu = Number(i.kg_por_unidad != null ? i.kg_por_unidad : 0) || 0;
                  const low = insumoEstaBajoMinimo(i);
                  const showKg = !porUnidad && sAct > 0;
                  const showU = uAct > 0;
                  return (
                    <tr
                      key={i.id}
                      className="border-b border-slate-600/40"
                      style={low ? { background: 'var(--ui-live-alert-warning-bg)' } : undefined}
                    >
                      <td className="p-2.5 font-medium text-[var(--ui-body-text)]">{i.nombre}</td>
                      <td className="p-2.5 text-[var(--ui-body-text)] tabular-nums">
                        {showKg ? formatInsumoWithUnit(i.stock_actual, umc) : <span className="text-[var(--ui-muted)]">—</span>}
                      </td>
                      <td className="p-2.5 text-[var(--ui-body-text)] tabular-nums">
                        {showU ? `${formatInsumoQty(uAct)} U` : <span className="text-[var(--ui-muted)]">—</span>}
                      </td>
                      <td className="p-2.5 ui-text-warning tabular-nums text-sm">
                        {!porUnidad && kpu > 0 ? (
                          <span title="Usado al vender: por cada kg que descuenta la receta, también bajan las U (p. ej. cuartos de pollo)">
                            {formatInsumoQty(kpu)} {umc}/U
                          </span>
                        ) : (
                          <span className="text-[var(--ui-muted)]">—</span>
                        )}
                      </td>
                      <td className="p-2.5 text-right tabular-nums text-[var(--ui-body-text)]">{formatCurrency(i.costo_promedio || 0)}</td>
                      <td className="p-2.5 text-right ui-text-success tabular-nums">
                        {formatCurrency(insumoValorInventario(i))}
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
              {insumosListaActiva.length > 0 && (
                <tfoot>
                  <tr className="border-t border-[color:var(--ui-border)] font-semibold">
                    <td className="p-2.5" colSpan="5">Total valor insumos</td>
                    <td className="p-2.5 text-right ui-text-success tabular-nums">{formatCurrency(valorInsumosLista)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
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
            Insumos por pieza (alitas, etc.): cantidad en <strong>Cant. (U)</strong> y <strong>costo por uso</strong> (lo que vale cada porción).
            {' '}Insumos por peso/volumen: <strong>Cant. kg / L</strong> y costo por kg o L; <strong>Cant. (U)</strong> es opcional (cajas, pollos).
            Si pones kg y unidades juntas, el sistema promedia kg/U. Formato numérico{' '}
            <span className="whitespace-nowrap">es-PE (coma decimal)</span>.
          </p>
          <form onSubmit={runCompra} className="space-y-2">
            {compraLines.map((row, idx) => {
              const sel = insumosCompraFiltrados.find((i) => String(i.id) === String(row.insumo_id));
              const porUnidad = Boolean(sel) && isUnidadUm(sel.unidad_medida);
              const cq = row.cantidad != null && String(row.cantidad).trim() !== '' ? parseLocaleNumber(row.cantidad) : NaN;
              const uq = row.unidades != null && String(row.unidades).trim() !== '' ? parseLocaleNumber(row.unidades) : NaN;
              const razon =
                !porUnidad && Number.isFinite(cq) && cq > 0 && Number.isFinite(uq) && uq > 0 ? (cq / uq) : null;
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
                    if (isUnidadUm(um)) {
                      return (
                        <option key={i.id} value={i.id}>
                          {i.nombre} ({formatInsumoQty(insumoStockEnUnidades(i))} U)
                        </option>
                      );
                    }
                    return (
                      <option key={i.id} value={i.id}>
                        {i.nombre} ({formatInsumoWithUnit(i.stock_actual, um)} · {formatInsumoQty(i.stock_unidades != null ? i.stock_unidades : 0)} U)
                      </option>
                    );
                  })}
                </select>
                {!porUnidad && (
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
                )}
                <div>
                  <label className="block text-[10px] ui-text-muted">
                    {porUnidad ? 'Costo por uso (C/u.ml.l.g.kg.o)' : 'Costo S/ U.M.'}
                  </label>
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
                    title={porUnidad ? 'Costo de cada porción o pieza que se usa' : 'Costo por kg, L, etc.'}
                  />
                </div>
                <div>
                  <label className="block text-[10px] ui-text-muted">
                    {porUnidad ? 'Cant. (U)' : 'Unid. (opcional)'}
                  </label>
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
                    title={porUnidad ? 'Cantidad en unidades (alitas, piezas)' : 'Suma a unidades (cajas, bultos) si aplica a esta compra'}
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
          <div className="bg-[var(--ui-surface-2)] p-4 rounded-xl border border-[color:var(--ui-border)]">
            <p className="text-sm font-semibold text-[var(--ui-body-text)] mb-3">
              {editingRecetaId ? 'Editar receta' : 'Nueva receta'}
            </p>
            <RecetaEditor
              key={`${editingRecetaId || 'new'}-${recetaEditorKey}`}
              recetaId={editingRecetaId}
              products={products.filter((p) => p.process_type !== 'non_transformed')}
              insumos={insumos}
              onSaved={() => {
                setEditingRecetaId('');
                setRecetaEditorKey((k) => k + 1);
                loadCore();
              }}
              onCancel={editingRecetaId ? () => setEditingRecetaId('') : undefined}
            />
          </div>
          <div className="border border-slate-600/50 rounded-lg overflow-hidden">
            {recetas.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-2 border-b border-slate-600/40 last:border-0"
              >
                <div>
                  <span className="font-medium">{r.nombre_plato}</span>
                  <span className="ui-text-muted text-sm ml-2">· {r.product_name || r.product_id}</span>
                  <span className="ui-text-muted text-xs ml-2">
                    · {Number(r.insumos_count || 0)} insumo(s){Number(r.activo) === 1 ? '' : ' · inactiva'}
                  </span>
                </div>
                <button type="button" className="text-amber-400/90 text-sm" onClick={() => { setEditingRecetaId(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  Editar
                </button>
              </div>
            ))}
            {!recetas.length && <p className="p-4 ui-text-muted text-sm">No hay recetas. Crea una aquí o desde Productos → Editar producto → Agregar receta.</p>}
          </div>
        </div>
      )}

      {tab === 'kardex' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div>
              <label className="block text-xs ui-text-muted mb-1">Insumo</label>
              <select
                className="input-field text-sm h-9 py-0"
                value={kardexInsumo}
                onChange={(e) => setKardexInsumo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {insumosCocina.length > 0 && (
                  <optgroup label="Insumos de cocina">
                    {insumosCocina.map((i) => (
                      <option key={i.id} value={i.id}>{insumoOptionStockLabel(i)}</option>
                    ))}
                  </optgroup>
                )}
                {insumosBar.length > 0 && (
                  <optgroup label="Insumos de bar">
                    {insumosBar.map((i) => (
                      <option key={i.id} value={i.id}>{insumoOptionStockLabel(i)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <InlineDateField
              label="Desde"
              value={kardexFrom}
              onChange={setKardexFrom}
              roundedNone={false}
              className="!rounded-lg"
            />
            <InlineDateField
              label="Hasta"
              value={kardexTo}
              onChange={setKardexTo}
              roundedNone={false}
              className="!rounded-lg"
            />
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
                const porUnidad = isUnidadUm(um);
                const sAct = Number(kardexData.insumo?.stock_actual || 0);
                const uAct = insumoStockEnUnidades(kardexData.insumo);
                return (
                  <span>
                    Stock: {porUnidad
                      ? `${formatInsumoQty(uAct)} U`
                      : (sAct > 0 ? formatInsumoWithUnit(sAct, um) : '—')}
                    {!porUnidad ? ` · U: ${uAct > 0 ? `${formatInsumoQty(uAct)} U` : '—'}` : ''}
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
            <label className="flex items-center gap-2 text-sm text-[var(--ui-muted)]">
              Letra:
              <input
                data-cuadre-letter=""
                value={cuadreLetter}
                onChange={(e) => setCuadreLetterOnly(e.target.value)}
                maxLength={1}
                className="w-10 text-center bg-[var(--ui-surface)] border border-[color:var(--ui-border)] rounded-lg px-2 py-1.5 text-[var(--ui-body-text)] text-sm uppercase"
                aria-label="Una letra: pone primero los productos que empiezan con ella"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowReconciliationsModal(true)}
              className="text-sm px-3 py-1.5 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]"
            >
              Historial de cuadres
            </button>
          </div>
          <div
            ref={cuadreListRef}
            className="overflow-x-auto max-h-[70vh] overflow-y-auto rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]"
          >
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
                  const letterPrefix = foldProductName(cuadreLetter);
                  const matchesLetter = Boolean(letterPrefix) && foldProductName(product.name).startsWith(letterPrefix);
                  return (
                    <tr key={product.id} className={`border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] ${matchesLetter ? 'bg-amber-500/10' : ''}`}>
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
