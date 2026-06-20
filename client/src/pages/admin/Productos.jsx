import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, formatCurrency, formatInsumoQty, formatInsumoWithUnit } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { showStockInOrderingUI } from '../../utils/productStockDisplay';
import { formatCatalogNameInput } from '../../utils/catalogNameFormat';
import toast from 'react-hot-toast';
import Modal from '../../components/Modal';
import ContextMenu from '../../components/ContextMenu';
import {
  MdAdd, MdEdit, MdDelete, MdSearch, MdRestaurantMenu, MdLunchDining,
  MdTune, MdClose, MdCheck, MdToggleOn, MdToggleOff, MdDownload, MdSchedule, MdAutoAwesome
} from 'react-icons/md';
import {
  DAY_KEYS,
  SCHEDULE_PRESETS,
  normalizeAvailableDays,
  applySchedulePreset,
  validateScheduleAgainstRestaurant,
  evaluateProductSchedule,
  scheduleTypeLabel,
  parseTimeToMinutes,
} from '../../utils/productSchedule';

const HIDDEN_PRODUCT_CATEGORY_NAMES = new Set(['PRODUCTOS ALMACEN', 'INSUMOS']);

function isProductInactive(p) {
  return Number(p?.is_active ?? 1) === 0;
}

const EMPTY_PRODUCT_FORM = {
  name: '',
  description: '',
  price: '',
  purchase_price: '',
  category_id: '',
  stock: 0,
  is_active: 1,
  process_type: 'transformed',
  stock_warehouse_id: '',
  production_area: 'cocina',
  tax_type: 'inafecto',
  modifier_id: '',
  note_required: 0,
  kardex_insumo_id: '',
  kardex_insumo_num: '1',
  kardex_insumo_den: '1',
  kardex_insumo_modo: '',
  kardex_insumo_gramos: '0',
  schedule_enabled: 0,
  available_from: '',
  available_to: '',
  available_days: [],
  schedule_type: 'personalizado',
};

export default function Productos() {
  const { t } = useTranslation('inventory');
  const [searchParams] = useSearchParams();
  const highlightSlowMoving = searchParams.get('sin_ventas') === '1';
  const TABS = useMemo(() => [
    { id: 'platos', label: t('tabs.dishes'), icon: MdRestaurantMenu },
    { id: 'combos', label: t('tabs.combos'), icon: MdLunchDining },
    { id: 'modificadores', label: t('tabs.modifiers'), icon: MdTune },
  ], [t]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('platos');
  const [selectedCat, setSelectedCat] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [expandedCats, setExpandedCats] = useState({});

  const [showProductModal, setShowProductModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [productForm, setProductForm] = useState({ ...EMPTY_PRODUCT_FORM });

  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [catForm, setCatForm] = useState({ name: '', description: '' });
  const [categoryMergeSourceId, setCategoryMergeSourceId] = useState(null);
  const [catContextMenu, setCatContextMenu] = useState(null);

  const [combos, setCombos] = useState([]);
  const [showComboModal, setShowComboModal] = useState(false);
  const [comboForm, setComboForm] = useState({ name: '', description: '', price: '', items: [] });
  const [comboSuggestions, setComboSuggestions] = useState(null);
  const [comboSuggestLoading, setComboSuggestLoading] = useState(false);
  const comboSuggestTimerRef = useRef(null);
  const comboSuggestRequestRef = useRef(0);

  const [modifiers, setModifiers] = useState([]);
  const [showModModal, setShowModModal] = useState(false);
  const [modForm, setModForm] = useState({ name: '', options: '', required: false });
  const [insumosKardex, setInsumosKardex] = useState([]);
  const [restaurantSchedule, setRestaurantSchedule] = useState({});
  const [scheduleWarnings, setScheduleWarnings] = useState([]);
  const [slowMovingProductIds, setSlowMovingProductIds] = useState(new Set());
  const [slowMovingDays, setSlowMovingDays] = useState(14);

  const defaultWarehouseId =
    warehouses.find(w => (w.name || '').toLowerCase() === 'almacen principal')?.id ||
    warehouses[0]?.id ||
    '';

  const load = useCallback(() => {
    Promise.all([
      api.get('/products'),
      api.get('/categories'),
      api.get('/inventory/warehouses'),
      api.get('/admin-modules/combos'),
      api.get('/admin-modules/modifiers'),
      api.get('/kardex-inventory/insumos').catch(() => []),
      api.get('/restaurant').catch(() => ({})),
      api.get('/reports/slow-moving-products').catch(() => ({ product_ids: [], days: 14 })),
    ])
      .then(([p, c, w, combosData, modifiersData, ins, restaurant, slowMoving]) => {
        setProducts(p);
        setRestaurantSchedule(restaurant?.schedule || {});
        setCategories(c);
        setWarehouses(w || []);
        setCombos(combosData || []);
        setModifiers(modifiersData || []);
        setInsumosKardex(Array.isArray(ins) ? ins : []);
        setSlowMovingProductIds(new Set((slowMoving?.product_ids || []).map(String)));
        setSlowMovingDays(Number(slowMoving?.days || 14));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket('inventory-update', () => {
    void load();
  });
  useSocket('staff-data-update', (p) => {
    const d = p?.domain;
    if (['combos', 'modifiers', 'discounts', 'offers', 'catalog'].includes(d)) void load();
  });

  const selectedComboProducts = useMemo(
    () => comboForm.items
      .map((id) => products.find((p) => String(p.id) === String(id)))
      .filter(Boolean),
    [comboForm.items, products],
  );

  const selectedComboProductIdsKey = useMemo(
    () => comboForm.items.map(String).sort().join('|'),
    [comboForm.items],
  );

  const selectedComboTotal = useMemo(
    () => selectedComboProducts.reduce((sum, p) => sum + Number(p.price || 0), 0),
    [selectedComboProducts],
  );

  const openComboModal = () => {
    setComboForm({ name: '', description: '', price: '', items: [] });
    setComboSuggestions(null);
    setComboSuggestLoading(false);
    setShowComboModal(true);
  };

  const applyComboSuggestions = () => {
    if (!comboSuggestions) return;
    setComboForm((prev) => ({
      ...prev,
      name: comboSuggestions.name || prev.name,
      description: comboSuggestions.description || prev.description,
      price: comboSuggestions.suggested_price != null ? String(comboSuggestions.suggested_price) : prev.price,
    }));
    toast.success(comboSuggestions.source === 'ai' ? 'Sugerencias de IA aplicadas' : 'Sugerencias aplicadas');
  };

  useEffect(() => {
    if (!showComboModal) return undefined;

    if (comboSuggestTimerRef.current) {
      clearTimeout(comboSuggestTimerRef.current);
    }

    if (selectedComboProducts.length === 0) {
      comboSuggestRequestRef.current += 1;
      setComboSuggestions(null);
      setComboSuggestLoading(false);
      return undefined;
    }

    const requestId = ++comboSuggestRequestRef.current;
    const productIds = selectedComboProducts.map((p) => p.id);

    setComboSuggestions(null);
    setComboSuggestLoading(true);

    comboSuggestTimerRef.current = setTimeout(() => {
      api.post('/admin-modules/combos/suggest', { product_ids: productIds })
        .then((data) => {
          if (requestId !== comboSuggestRequestRef.current) return;
          const responseIds = (data?.product_ids || []).map(String).sort().join('|');
          const currentIds = productIds.map(String).sort().join('|');
          if (responseIds !== currentIds) return;
          setComboSuggestions(data);
        })
        .catch(() => {
          if (requestId !== comboSuggestRequestRef.current) return;
          setComboSuggestions(null);
        })
        .finally(() => {
          if (requestId !== comboSuggestRequestRef.current) return;
          setComboSuggestLoading(false);
        });
    }, 350);

    return () => {
      if (comboSuggestTimerRef.current) clearTimeout(comboSuggestTimerRef.current);
    };
  }, [showComboModal, selectedComboProductIdsKey, selectedComboProducts]);

  const hiddenCategoryIds = new Set(
    categories
      .filter(c => HIDDEN_PRODUCT_CATEGORY_NAMES.has((c.name || '').toUpperCase()))
      .map(c => c.id)
  );
  const visibleCategories = categories
    .filter(c => !hiddenCategoryIds.has(c.id))
    .filter(c => !categoryFilter || (c.name || '').toLowerCase().includes(categoryFilter.toLowerCase()));
  const visibleProducts = products.filter(p => !hiddenCategoryIds.has(p.category_id) && !!p.category_id);

  useEffect(() => {
    if (!selectedCat) return;
    const exists = visibleCategories.some(c => c.id === selectedCat);
    if (!exists) setSelectedCat('');
  }, [selectedCat, visibleCategories]);

  const filtered = visibleProducts.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCat || p.category_id === selectedCat;
    const matchActive = showInactive ? isProductInactive(p) : !isProductInactive(p);
    const matchSlowMoving = !highlightSlowMoving || slowMovingProductIds.has(String(p.id));
    return matchSearch && matchCat && matchActive && matchSlowMoving;
  });

  useEffect(() => {
    if (highlightSlowMoving) setActiveTab('platos');
  }, [highlightSlowMoving]);

  const openNewProduct = () => {
    setEditProduct(null);
    setProductForm({
      ...EMPTY_PRODUCT_FORM,
      category_id: selectedCat || (visibleCategories[0]?.id || ''),
      stock_warehouse_id: defaultWarehouseId,
    });
    setScheduleWarnings([]);
    setShowProductModal(true);
  };

  const toggleScheduleDay = (dayKey) => {
    setProductForm((prev) => {
      const days = normalizeAvailableDays(prev.available_days);
      const next = days.includes(dayKey)
        ? days.filter((d) => d !== dayKey)
        : [...days, dayKey];
      return { ...prev, available_days: next };
    });
  };

  const onScheduleTypeChange = (type) => {
    setProductForm((prev) => {
      const next = applySchedulePreset(type, { ...prev, schedule_type: type, schedule_enabled: 1 });
      return next;
    });
  };

  useEffect(() => {
    if (!productForm.schedule_enabled) {
      setScheduleWarnings([]);
      return;
    }
    setScheduleWarnings(
      validateScheduleAgainstRestaurant(productForm, restaurantSchedule, t),
    );
  }, [
    productForm.schedule_enabled,
    productForm.available_from,
    productForm.available_to,
    productForm.available_days,
    restaurantSchedule,
    t,
  ]);

  const openEditProduct = (p) => {
    setEditProduct(p);
    setProductForm({
      name: p.name,
      description: p.description || '',
      price: p.price,
      purchase_price:
        p.purchase_price != null && Number(p.purchase_price) > 0
          ? String(p.purchase_price)
          : '',
      category_id: p.category_id || '',
      stock: p.stock,
      is_active: p.is_active,
      process_type: p.process_type === 'non_transformed' ? 'non_transformed' : 'transformed',
      stock_warehouse_id: p.stock_warehouse_id || defaultWarehouseId,
      production_area: p.production_area === 'bar' ? 'bar' : 'cocina',
      tax_type: ['igv', 'exonerado', 'inafecto'].includes(String(p.tax_type || '').toLowerCase())
        ? String(p.tax_type).toLowerCase()
        : 'igv',
      modifier_id: p.modifier_id || '',
      note_required: Number(p.note_required || 0) === 1 ? 1 : 0,
      kardex_insumo_id: p.kardex_insumo_id || '',
      kardex_insumo_num: p.kardex_insumo_num != null && p.kardex_insumo_num !== '' ? String(p.kardex_insumo_num) : '1',
      kardex_insumo_den: p.kardex_insumo_den != null && p.kardex_insumo_den !== '' ? String(p.kardex_insumo_den) : '1',
      kardex_insumo_modo: (p.kardex_insumo_id && String(p.kardex_insumo_id).trim()
        ? (String(p.kardex_insumo_modo || 'unidad').toLowerCase() === 'peso' ? 'peso' : 'unidad')
        : ''),
      kardex_insumo_gramos: p.kardex_insumo_gramos != null && p.kardex_insumo_gramos !== ''
        ? String(p.kardex_insumo_gramos)
        : '0',
      schedule_enabled: Number(p.schedule_enabled || 0) === 1 ? 1 : 0,
      available_from: p.available_from || '',
      available_to: p.available_to || '',
      available_days: normalizeAvailableDays(p.available_days),
      schedule_type: p.schedule_type || 'personalizado',
    });
    setScheduleWarnings([]);
    setShowProductModal(true);
  };

  useEffect(() => {
    if (!showProductModal) return;
    if (productForm.process_type !== 'non_transformed') return;
    if (productForm.stock_warehouse_id) return;
    if (!defaultWarehouseId) return;
    setProductForm(prev => ({ ...prev, stock_warehouse_id: defaultWarehouseId }));
  }, [showProductModal, productForm.process_type, productForm.stock_warehouse_id, defaultWarehouseId]);

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    try {
      const isNonTransformed = productForm.process_type === 'non_transformed';
      const stockAmount = Math.max(0, Number(productForm.stock || 0));
      const warehouseId = productForm.stock_warehouse_id || '';

      if (isNonTransformed && !warehouseId) {
        toast.error(t('validation.selectWarehouse'));
        return;
      }
      if (!String(productForm.category_id || '').trim()) {
        toast.error(t('validation.selectCategory'));
        return;
      }
      if (
        !isNonTransformed
        && (productForm.kardex_insumo_modo === 'unidad' || productForm.kardex_insumo_modo === 'peso')
        && !String(productForm.kardex_insumo_id || '').trim()
      ) {
        toast.error(t('products.kardexInsumo'));
        return;
      }

      const rawPurchase = String(productForm.purchase_price ?? '').trim();
      if (rawPurchase !== '') {
        const pp = parseFloat(rawPurchase);
        if (!Number.isFinite(pp) || pp < 0) {
          toast.error(t('products.invalidPurchasePrice'));
          return;
        }
      }

      if (Number(productForm.schedule_enabled) === 1) {
        if (parseTimeToMinutes(productForm.available_from) == null || parseTimeToMinutes(productForm.available_to) == null) {
          toast.error(t('products.schedule.invalidTimes'));
          return;
        }
      }

      const kn = parseFloat(productForm.kardex_insumo_num) || 1;
      const kd = parseFloat(productForm.kardex_insumo_den) || 1;
      const kg = parseFloat(productForm.kardex_insumo_gramos) || 0;
      const hasK = !isNonTransformed && String(productForm.kardex_insumo_id || '').trim();
      const modoPeso = hasK && productForm.kardex_insumo_modo === 'peso';
      if (modoPeso && kg <= 0) {
        toast.error(t('products.gramsPositive'));
        return;
      }
      const payload = {
        ...productForm,
        purchase_price: rawPurchase === '' ? null : parseFloat(rawPurchase),
        schedule_enabled: Number(productForm.schedule_enabled) === 1 ? 1 : 0,
        available_days: normalizeAvailableDays(productForm.available_days),
        stock: isNonTransformed ? stockAmount : 0,
        stock_warehouse_id: isNonTransformed ? warehouseId : '',
        kardex_insumo_id: !isNonTransformed ? (productForm.kardex_insumo_id || '').trim() : '',
        kardex_insumo_num: !isNonTransformed && hasK && !modoPeso ? kn : 1,
        kardex_insumo_den: !isNonTransformed && hasK && !modoPeso ? kd : 1,
        kardex_insumo_modo: hasK ? (modoPeso ? 'peso' : 'unidad') : 'unidad',
        kardex_insumo_gramos: hasK && modoPeso ? kg : 0,
      };
      if (editProduct) {
        const updated = await api.put(`/products/${editProduct.id}`, payload);
        if (isNonTransformed) {
          await api.post('/inventory/warehouse-stock', {
            product_id: updated.id,
            warehouse_id: warehouseId,
            quantity: stockAmount,
          });
        }
        if (updated?.schedule_warnings?.length) {
          updated.schedule_warnings.forEach((w) => toast(w, { icon: '⚠️' }));
        }
        toast.success(t('toast.productUpdated'));
      } else {
        const created = await api.post('/products', payload);
        if (isNonTransformed) {
          await api.post('/inventory/warehouse-stock', {
            product_id: created.id,
            warehouse_id: warehouseId,
            quantity: stockAmount,
          });
        }
        if (created?.schedule_warnings?.length) {
          created.schedule_warnings.forEach((w) => toast(w, { icon: '⚠️' }));
        }
        toast.success(t('toast.productCreated'));
      }
      setShowProductModal(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const toggleProductActive = async (p) => {
    try {
      await api.put(`/products/${p.id}`, { is_active: p.is_active ? 0 : 1 });
      toast.success(p.is_active ? t('toast.productDeactivated') : t('toast.productActivated'));
      load();
    } catch (err) { toast.error(err.message); }
  };

  const deleteProduct = async (p) => {
    if (!confirm(t('products.deleteConfirm', { name: p.name }))) return;
    try { await api.delete(`/products/${p.id}`); toast.success(t('toast.deleted')); load(); } catch (err) { toast.error(err.message); }
  };

  const openNewCat = () => { setEditCat(null); setCatForm({ name: '', description: '' }); setShowCatModal(true); };
  const openEditCat = (c) => { setEditCat(c); setCatForm({ name: c.name, description: c.description || '' }); setShowCatModal(true); };

  const handleCatSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editCat) {
        await api.put(`/categories/${editCat.id}`, catForm);
        toast.success(t('toast.categoryUpdated'));
      } else {
        await api.post('/categories', catForm);
        toast.success(t('toast.categoryCreated'));
      }
      setShowCatModal(false);
      load();
    } catch (err) {
      const msg = String(err?.message || '').trim();
      toast.error(
        msg && !/^internal server error$/i.test(msg)
          ? msg
          : t('toast.categorySaveError'),
      );
    }
  };

  const deleteCat = async (c) => {
    if (!confirm(`¿Eliminar categoría "${c.name}"?`)) return;
    try { await api.delete(`/categories/${c.id}`); toast.success('Eliminada'); load(); } catch (err) { toast.error(err.message); }
  };

  const openCatContextMenu = (e, cat) => {
    e.preventDefault();
    e.stopPropagation();
    setCatContextMenu({ x: e.clientX, y: e.clientY, cat });
  };

  const startCategoryMerge = (cat) => {
    setCategoryMergeSourceId(cat.id);
    toast('Seleccione la categoría destino (clic en otra categoría)', { icon: '↪️' });
  };

  const cancelCategoryMerge = () => setCategoryMergeSourceId(null);

  const mergeCategoryInto = async (targetCat) => {
    const sourceId = categoryMergeSourceId;
    if (!sourceId || sourceId === targetCat.id) {
      if (sourceId === targetCat.id) toast.error('Elija una categoría distinta');
      return;
    }
    const sourceName = categories.find((c) => c.id === sourceId)?.name || 'origen';
    if (!confirm(`¿Unificar "${sourceName}" en "${targetCat.name}"? Los productos pasarán a esta categoría.`)) {
      return;
    }
    try {
      const res = await api.post(`/categories/${sourceId}/merge`, {
        target_category_id: targetCat.id,
      });
      toast.success(
        `Categorías unificadas en "${res.target_category_name}" (${res.products_moved} producto(s))`,
      );
      setCategoryMergeSourceId(null);
      setSelectedCat(targetCat.id);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo unificar la categoría');
    }
  };

  const onCategoryClick = (cat) => {
    if (categoryMergeSourceId) {
      mergeCategoryInto(cat);
      return;
    }
    setSelectedCat((prev) => (prev === cat.id ? '' : cat.id));
  };

  const getCatName = (id) => visibleCategories.find(c => c.id === id)?.name || '-';
  const getCatProductCount = (catId) => visibleProducts.filter((p) => {
    if (p.category_id !== catId) return false;
    return showInactive ? isProductInactive(p) : !isProductInactive(p);
  }).length;

  const handleModSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin-modules/modifiers', {
        name: modForm.name,
        options: modForm.options.split(',').map(o => o.trim()).filter(Boolean),
        required: modForm.required,
        active: true,
      });
      setShowModModal(false);
      setModForm({ name: '', options: '', required: false });
      toast.success(t('toast.modifierCreated'));
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[var(--ui-body-text)]">{t('categories.title')}</h1>
        <div />
      </div>

      <div className="flex gap-3 mb-5">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-1 px-6 py-3 rounded-xl border-2 transition-all ${
                activeTab === tab.id
                  ? 'bg-gold-500 border-gold-500 text-white shadow-md shadow-gold-500/20'
                  : 'bg-[var(--ui-surface)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-gold-300 hover:text-gold-600'
              }`}
            >
              <Icon className="text-2xl" />
              <span className="text-xs font-medium">{tab.label}</span>
              {tab.id !== activeTab && <MdAdd className="text-sm opacity-50" />}
            </button>
          );
        })}
      </div>

      {activeTab === 'platos' && (
        <>
          {highlightSlowMoving ? (
            <div className="mb-4 rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-900">
              Mostrando productos con stock sin ventas cobradas desde hace al menos {slowMovingDays} días (desde alta o última venta).
            </div>
          ) : null}
          {categoryMergeSourceId ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <span>
                Moviendo categoría: elija la categoría destino (los productos se unificarán con el nombre de la destino).
              </span>
              <button type="button" onClick={cancelCategoryMerge} className="btn-secondary text-xs py-1.5 px-3">
                Cancelar
              </button>
            </div>
          ) : null}
        <div className="flex gap-5">
          <div className="w-56 flex-shrink-0">
            <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface)] overflow-hidden">
              <div className="p-2.5 border-b border-[color:var(--ui-border)]">
                <input
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  placeholder={t('categories.filter')}
                  className="input-field w-full text-sm py-1.5 px-3"
                />
              </div>
              <div className="p-2">
                <button
                  type="button"
                  onClick={openNewCat}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm btn-primary mb-1 justify-center"
                >
                  <MdAdd className="text-base" /> {t('categories.add')}
                </button>
              </div>
              <nav
                className="max-h-[60vh] overflow-y-auto overscroll-y-contain pr-0.5 [-webkit-overflow-scrolling:touch] touch-pan-y"
                style={{ touchAction: 'pan-y' }}
                onWheel={(e) => e.stopPropagation()}
              >
                {visibleCategories.map(cat => (
                  <div key={cat.id} className="m-1 border border-[color:var(--ui-border)] rounded-lg bg-[var(--ui-surface-2)] overflow-hidden">
                    <div className="flex items-center group">
                      <button
                        type="button"
                        onClick={() => onCategoryClick(cat)}
                        onContextMenu={(e) => openCatContextMenu(e, cat)}
                        className={`flex-1 text-left px-3 py-1.5 text-sm transition-colors ${
                          categoryMergeSourceId === cat.id
                            ? 'bg-amber-500 text-white font-semibold ring-2 ring-amber-300'
                            : selectedCat === cat.id
                              ? 'bg-[var(--ui-accent)] text-white font-semibold'
                              : categoryMergeSourceId
                                ? 'text-[var(--ui-body-text)] hover:bg-amber-100'
                                : 'text-[var(--ui-body-text)] hover:bg-[var(--ui-sidebar-hover)]'
                        }`}
                      >
                        {cat.name}
                        <span className={`text-xs ml-1 ${selectedCat === cat.id ? 'text-white/90' : 'text-[var(--ui-muted)]'}`}>
                          ({getCatProductCount(cat.id)})
                        </span>
                      </button>
                      <div className="hidden group-hover:flex items-center pr-2 gap-0.5">
                        <button type="button" onClick={() => openEditCat(cat)} className="p-1 hover:bg-[var(--ui-sidebar-hover)] rounded text-[var(--ui-accent)] text-xs" title={t('table.edit')}>
                          <MdEdit />
                        </button>
                        <button type="button" onClick={() => deleteCat(cat)} className="p-1 hover:bg-[var(--ui-sidebar-hover)] rounded text-[var(--ui-accent)] hover:text-red-500 text-xs" title={t('table.delete')}>
                          <MdDelete />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </nav>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <button type="button" onClick={openNewProduct} className="w-full py-3.5 btn-primary font-semibold rounded-xl mb-4 flex items-center justify-center gap-2 transition-colors shadow-sm">
              <MdAdd className="text-xl" /> {t('categories.newProduct')}
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-1">
                <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)]" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('categories.filterProduct')} className="input-field pl-9 py-2" />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--ui-body-text)] cursor-pointer whitespace-nowrap">
                {t('categories.showCancelled')}
                <button type="button" onClick={() => setShowInactive(!showInactive)} className="text-2xl">
                  {showInactive ? <MdToggleOn className="text-gold-500" /> : <MdToggleOff className="text-[var(--ui-muted)]" />}
                </button>
              </label>
            </div>

            <p className="text-sm text-[var(--ui-muted)] mb-3 font-medium">
              {showInactive
                ? `Anulados · ${selectedCat ? getCatName(selectedCat) : t('categories.noCategory')} · ${filtered.length} producto(s)`
                : t('categories.showing', {
                  category: selectedCat ? getCatName(selectedCat) : t('categories.noCategory'),
                  count: filtered.length,
                })}
            </p>

            <div className="bg-[var(--ui-surface)] rounded-xl border border-[color:var(--ui-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--ui-border)] bg-[var(--ui-surface-2)]">
                    <th className="text-left p-3 font-semibold text-[var(--ui-body-text)]">{t('table.product')}</th>
                    <th className="text-left p-3 font-semibold text-[var(--ui-body-text)] w-20">{t('table.code')}</th>
                    <th className="text-left p-3 font-semibold text-[var(--ui-body-text)] w-28">{t('table.category')}</th>
                    <th className="text-right p-3 font-semibold text-[var(--ui-body-text)] w-24">{t('table.salePrice')}</th>
                    <th className="text-right p-3 font-semibold text-[var(--ui-body-text)] w-24">{t('table.purchasePrice')}</th>
                    <th className="text-center p-3 font-semibold text-[var(--ui-body-text)] w-24">{t('table.stock')}</th>
                    <th className="text-center p-3 font-semibold text-[var(--ui-body-text)] w-24">{t('table.active')}</th>
                    <th className="text-center p-3 font-semibold text-[var(--ui-body-text)] w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, idx) => (
                    <tr key={p.id} className={`border-b border-[color:var(--ui-border)] hover:bg-[var(--ui-sidebar-hover)] transition-colors ${!p.is_active ? 'opacity-50' : ''}`}>
                      <td className="p-3">
                        <p className="font-medium text-[var(--ui-body-text)] hover:text-gold-600 cursor-pointer flex items-center gap-2" onClick={() => openEditProduct(p)}>
                          {slowMovingProductIds.has(String(p.id)) ? (
                            <span
                              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-600"
                              title={`Sin ventas cobradas desde hace ${slowMovingDays} días o más`}
                              aria-label="Producto sin ventas recientes"
                            />
                          ) : null}
                          <span>{p.name}</span>
                        </p>
                        {Number(p.schedule_enabled) === 1 && (() => {
                          const st = evaluateProductSchedule(p);
                          const label = scheduleTypeLabel(p.schedule_type, t);
                          return (
                            <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              st.available ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'
                            }`}>
                              <MdSchedule className="text-xs" />
                              {st.available
                                ? t('products.schedule.badgeNow', { label, from: p.available_from, to: p.available_to })
                                : t('products.schedule.badgeOff')}
                            </span>
                          );
                        })()}
                        {p.description && <p className="text-xs text-[var(--ui-muted)] mt-0.5 line-clamp-1">{p.description}</p>}
                      </td>
                      <td className="p-3 text-[var(--ui-muted)]">#{String(idx + 1).padStart(2, '0')}</td>
                      <td className="p-3"><span className="text-xs px-2 py-0.5 bg-[var(--ui-surface-2)] rounded-full text-[var(--ui-body-text)] border border-[color:var(--ui-border)]">{getCatName(p.category_id)}</span></td>
                      <td className="p-3 text-right font-bold text-[var(--ui-body-text)]">{formatCurrency(p.price)}</td>
                      <td className="p-3 text-right text-[var(--ui-muted)]">
                        {p.purchase_price != null && Number(p.purchase_price) > 0
                          ? formatCurrency(p.purchase_price)
                          : '—'}
                      </td>
                      <td className="p-3 text-center">
                        {showStockInOrderingUI(p) ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.stock > 10 ? 'bg-emerald-100 text-emerald-700' : p.stock > 0 ? 'bg-gold-100 text-gold-700' : 'bg-red-100 text-red-700'}`}>{p.stock}</span>
                        ) : null}
                      </td>
                      <td className="p-3 text-center">
                        <button onClick={() => toggleProductActive(p)}>
                          {p.is_active ? (
                            <span className="text-emerald-600 flex items-center justify-center gap-1 text-xs font-medium"><MdCheck /> {t('table.yes')}</span>
                          ) : (
                            <span className="text-red-500 flex items-center justify-center gap-1 text-xs font-medium"><MdClose /> {t('table.no')}</span>
                          )}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEditProduct(p)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1"
                          >
                            <MdEdit className="text-sm" /> {t('table.edit')}
                          </button>
                          <button
                            onClick={() => deleteProduct(p)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                          >
                            <MdDelete className="text-sm" /> {t('table.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan="8" className="p-8 text-center text-[var(--ui-muted)]">
                      <MdRestaurantMenu className="text-4xl mx-auto mb-2 opacity-30" />
                      <p>{t('table.noProducts')}</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        </>
      )}

      {activeTab === 'combos' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm ui-text-muted">{combos.length} combos registrados</p>
            <button onClick={openComboModal} className="btn-primary flex items-center gap-2 text-sm"><MdAdd /> Nuevo Combo</button>
          </div>
          {combos.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-[var(--ui-muted)]">
              <MdLunchDining className="text-5xl mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay combos creados</p>
              <p className="text-sm mt-1">Crea combos para ofrecer paquetes de productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {combos.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="font-bold rf-section-title">{c.name}</h3>
                  <p className="text-sm ui-text-muted mt-1">{c.description}</p>
                  <p className="text-xl font-bold text-gold-600 mt-2">{formatCurrency(c.price)}</p>
                  <p className="text-xs text-[var(--ui-muted)] mt-2">Incluye: {(Array.isArray(c.items) ? c.items.map(i => i.product_name || i.name).filter(Boolean).join(', ') : '') || '-'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'modificadores' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm ui-text-muted">{modifiers.length} modificadores</p>
            <button onClick={() => { setModForm({ name: '', options: '', required: false }); setShowModModal(true); }} className="btn-primary flex items-center gap-2 text-sm"><MdAdd /> Nuevo Modificador</button>
          </div>
          <div className="space-y-3">
            {modifiers.map(m => (
              <div key={m.id} className={`bg-white rounded-xl border border-slate-200 p-5 ${!m.active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold rf-section-title">{m.name}</h3>
                    {m.required && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Obligatorio</span>}
                    <span className={`px-2 py-0.5 text-xs rounded-full ${m.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 ui-text-muted'}`}>{m.active ? 'Activo' : 'Inactivo'}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      try {
                        await api.put(`/admin-modules/modifiers/${m.id}`, { active: m.active ? 0 : 1 });
                        load();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }} className="text-xs px-3 py-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 text-[var(--ui-muted)]">{m.active ? 'Desactivar' : 'Activar'}</button>
                    <button onClick={async () => {
                      try {
                        await api.delete(`/admin-modules/modifiers/${m.id}`);
                        load();
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }} className="p-1.5 hover:bg-red-50 rounded-lg text-[var(--ui-muted)] hover:text-red-600"><MdDelete /></button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.options.map((opt, i) => (
                    <span key={i} className="px-3 py-1 bg-slate-100 text-slate-700 text-sm rounded-lg">{opt}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal isOpen={showProductModal} onClose={() => setShowProductModal(false)} title={editProduct ? t('products.editTitle') : t('products.newTitle')} size="lg">
        <form onSubmit={handleProductSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2"><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('products.name')}</label><input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: formatCatalogNameInput(e.target.value) })} className="input-field" required placeholder={t('products.namePlaceholder')} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setProductForm({
                ...productForm,
                process_type: 'transformed',
                stock: 0,
                stock_warehouse_id: '',
                kardex_insumo_id: productForm.kardex_insumo_id || '',
                kardex_insumo_num: productForm.kardex_insumo_num || '1',
                kardex_insumo_den: productForm.kardex_insumo_den || '1',
                kardex_insumo_modo: (productForm.kardex_insumo_id && productForm.kardex_insumo_modo) ? productForm.kardex_insumo_modo : '',
                kardex_insumo_gramos: productForm.kardex_insumo_gramos || '0',
              })}
              className={`py-2 rounded-lg border text-sm font-medium ${
                productForm.process_type === 'transformed'
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 text-[var(--ui-muted)]'
              }`}
            >
              {t('products.transformed')}
            </button>
            <button
              type="button"
              onClick={() => setProductForm({
                ...productForm,
                process_type: 'non_transformed',
                stock_warehouse_id: productForm.stock_warehouse_id || defaultWarehouseId,
                kardex_insumo_id: '',
                kardex_insumo_num: '1',
                kardex_insumo_den: '1',
                kardex_insumo_modo: '',
                kardex_insumo_gramos: '0',
              })}
              className={`py-2 rounded-lg border text-sm font-medium ${
                productForm.process_type === 'non_transformed'
                  ? 'bg-sky-600 border-sky-600 text-white'
                  : 'bg-white border-slate-200 text-[var(--ui-muted)]'
              }`}
            >
              {t('products.nonTransformed')}
            </button>
          </div>
          {productForm.process_type === 'non_transformed' && (
            <p className="text-xs ui-text-muted -mt-2">
              {t('products.nonTransformedHint')}
            </p>
          )}
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('products.description')}</label><textarea value={productForm.description} onChange={e => setProductForm({ ...productForm, description: e.target.value })} className="input-field" rows="2" placeholder={t('products.descriptionPlaceholder')} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('products.salePrice')}</label>
              <input type="number" step="0.01" min="0" value={productForm.price} onChange={e => setProductForm({ ...productForm, price: e.target.value })} className="input-field" required placeholder="0.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('products.purchasePrice')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={productForm.purchase_price}
                onChange={e => setProductForm({ ...productForm, purchase_price: e.target.value })}
                className="input-field"
                placeholder={t('products.purchasePricePlaceholder')}
              />
              <p className="text-xs ui-text-muted mt-1">{t('products.purchasePriceHint')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {productForm.process_type === 'non_transformed' ? (
                <>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">{t('products.initialStock')}</label>
                  <input
                    type="number"
                    value={productForm.stock}
                    onChange={e => setProductForm({ ...productForm, stock: e.target.value })}
                    className="input-field"
                    placeholder="0"
                    min="0"
                  />
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Insumo a descontar</label>
                  <select
                    className="input-field text-sm"
                    value={
                      productForm.kardex_insumo_modo === 'unidad' || productForm.kardex_insumo_modo === 'peso'
                        ? productForm.kardex_insumo_modo
                        : ''
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        setProductForm({
                          ...productForm,
                          kardex_insumo_modo: '',
                          kardex_insumo_id: '',
                          kardex_insumo_num: '1',
                          kardex_insumo_den: '1',
                          kardex_insumo_gramos: '0',
                        });
                        return;
                      }
                      setProductForm({
                        ...productForm,
                        kardex_insumo_modo: v,
                        kardex_insumo_id: '',
                        kardex_insumo_num: v === 'unidad' ? '1' : '1',
                        kardex_insumo_den: v === 'unidad' ? '1' : '1',
                        kardex_insumo_gramos: v === 'peso' ? (productForm.kardex_insumo_gramos && productForm.kardex_insumo_gramos !== '0' ? productForm.kardex_insumo_gramos : '') : '0',
                      });
                    }}
                  >
                    <option value="">&nbsp;</option>
                    <option value="unidad">Fracción por unidad</option>
                    <option value="peso">Peso fijo</option>
                  </select>
                  {(productForm.kardex_insumo_modo === 'unidad' || productForm.kardex_insumo_modo === 'peso') && (
                    <>
                      <label className="block text-xs ui-text-muted mt-2 mb-0.5">Insumo</label>
                      <select
                        value={productForm.kardex_insumo_id}
                        onChange={e => setProductForm({ ...productForm, kardex_insumo_id: e.target.value })}
                        className="input-field text-sm"
                      >
                        <option value="">— Elija insumo —</option>
                        {insumosKardex.filter((i) => {
                          if (Number(i.activo) === 0) return false;
                          const area = String(i.insumo_area || 'cocina').toLowerCase() === 'bar' ? 'bar' : 'cocina';
                          const prodArea = String(productForm.production_area || 'cocina').toLowerCase() === 'bar' ? 'bar' : 'cocina';
                          return area === prodArea;
                        }).map((i) => {
                          const um = String(i.unidad_medida || 'kg')
                            .replace(/[0-9]/g, '')
                            .trim() || 'kg';
                          if (productForm.kardex_insumo_modo === 'peso') {
                            return (
                              <option key={i.id} value={i.id}>
                                {i.nombre} (U.M. {um})
                              </option>
                            );
                          }
                          const uS = i.stock_unidades != null ? Number(i.stock_unidades) : 0;
                          return (
                            <option key={i.id} value={i.id}>
                              {i.nombre} — {formatInsumoQty(uS)} U, {formatInsumoWithUnit(i.stock_actual, um)}
                            </option>
                          );
                        })}
                      </select>
                    </>
                  )}
                  {productForm.kardex_insumo_id && productForm.kardex_insumo_modo === 'unidad' ? (
                    <div className="mt-2">
                      <label className="block text-xs ui-text-muted mb-0.5">Fracción (a / b) por plato</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={productForm.kardex_insumo_num}
                          onChange={e => setProductForm({ ...productForm, kardex_insumo_num: e.target.value })}
                          className="input-field w-16 text-sm py-1.5"
                        />
                        <span className="ui-text-muted font-medium">/</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={productForm.kardex_insumo_den}
                          onChange={e => setProductForm({ ...productForm, kardex_insumo_den: e.target.value })}
                          className="input-field w-16 text-sm py-1.5"
                        />
                      </div>
                    </div>
                  ) : null}
                  {productForm.kardex_insumo_id && productForm.kardex_insumo_modo === 'peso' ? (
                    <div className="mt-2">
                      <label className="block text-xs ui-text-muted mb-0.5">Gramos por plato</label>
                      <input
                        type="number"
                        min="0.1"
                        step="1"
                        value={productForm.kardex_insumo_gramos}
                        onChange={e => setProductForm({ ...productForm, kardex_insumo_gramos: e.target.value })}
                        className="input-field text-sm py-1.5 w-full"
                        placeholder="ej. 250"
                        title="Gramos de insumo (descuento en kg al cobrar)"
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Categoría *</label>
              <select
                required
                value={productForm.category_id}
                onChange={e => setProductForm({ ...productForm, category_id: e.target.value })}
                className="input-field"
              >
                <option value="" disabled>
                  {visibleCategories.length ? '— Elija categoría —' : 'Cree una categoría primero'}
                </option>
                {visibleCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Área de producción</label>
              <select
                value={productForm.production_area}
                onChange={e => setProductForm({ ...productForm, production_area: e.target.value })}
                className="input-field"
              >
                <option value="cocina">Cocina</option>
                <option value="bar">Bar</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Impuesto</label>
              <select
                value={productForm.tax_type}
                onChange={e => setProductForm({ ...productForm, tax_type: e.target.value })}
                className="input-field"
              >
                <option value="igv">IGV</option>
                <option value="exonerado">Exonerado</option>
                <option value="inafecto">Inafecto</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Modificador</label>
              <select
                value={productForm.modifier_id}
                onChange={e => setProductForm({ ...productForm, modifier_id: e.target.value })}
                className="input-field"
              >
                <option value="">Sin modificador</option>
                {(modifiers || [])
                  .filter(m => Number(m.active ?? 1) === 1)
                  .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          {productForm.process_type === 'non_transformed' && (
            <div>
              <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Almacén destino</label>
              <select
                value={productForm.stock_warehouse_id}
                onChange={e => setProductForm({ ...productForm, stock_warehouse_id: e.target.value })}
                className="input-field"
              >
                {warehouses.length === 0 && <option value="">No hay almacenes disponibles</option>}
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
          <div className="rounded-xl border border-[color:var(--ui-border)] bg-[var(--ui-surface-2)] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--ui-body-text)] flex items-center gap-2">
                  <MdSchedule className="text-gold-600" />
                  {t('products.schedule.sectionTitle')}
                </p>
                <p className="text-xs ui-text-muted mt-1">{t('products.schedule.enableHint')}</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={Number(productForm.schedule_enabled) === 1}
                  onChange={(e) => setProductForm({
                    ...productForm,
                    schedule_enabled: e.target.checked ? 1 : 0,
                  })}
                />
                <span className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:bg-gold-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full relative" />
              </label>
            </div>
            {Number(productForm.schedule_enabled) === 1 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">{t('products.schedule.type')}</label>
                  <select
                    value={productForm.schedule_type}
                    onChange={(e) => onScheduleTypeChange(e.target.value)}
                    className="input-field text-sm"
                  >
                    {Object.keys(SCHEDULE_PRESETS).map((key) => (
                      <option key={key} value={key}>{t(`products.schedule.types.${key}`)}</option>
                    ))}
                    <option value="personalizado">{t('products.schedule.types.personalizado')}</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">{t('products.schedule.from')}</label>
                    <input
                      type="time"
                      value={productForm.available_from || ''}
                      onChange={(e) => setProductForm({ ...productForm, available_from: e.target.value, schedule_type: 'personalizado' })}
                      className="input-field text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ui-muted)] mb-1">{t('products.schedule.to')}</label>
                    <input
                      type="time"
                      value={productForm.available_to || ''}
                      onChange={(e) => setProductForm({ ...productForm, available_to: e.target.value, schedule_type: 'personalizado' })}
                      className="input-field text-sm"
                      required
                    />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--ui-muted)] mb-2">{t('products.schedule.days')}</p>
                  <div className="flex flex-wrap gap-2">
                    {DAY_KEYS.map((dayKey) => {
                      const selected = normalizeAvailableDays(productForm.available_days).includes(dayKey);
                      return (
                        <button
                          key={dayKey}
                          type="button"
                          onClick={() => toggleScheduleDay(dayKey)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                            selected
                              ? 'bg-gold-500 border-gold-500 text-white'
                              : 'bg-white border-slate-200 text-[var(--ui-muted)] hover:border-gold-300'
                          }`}
                        >
                          {dayKey.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] ui-text-muted mt-1">{t('products.schedule.daysAll')}</p>
                </div>
                {scheduleWarnings.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                    {scheduleWarnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={productForm.is_active === 1 || productForm.is_active === true} onChange={e => setProductForm({ ...productForm, is_active: e.target.checked ? 1 : 0 })} className="rounded text-gold-500" />
              <span className="font-medium text-slate-700">Producto activo</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={Number(productForm.note_required || 0) === 1}
                onChange={e => setProductForm({ ...productForm, note_required: e.target.checked ? 1 : 0 })}
                className="rounded text-gold-500"
              />
              <span className="font-medium text-slate-700">Nota obligatoria al pedir</span>
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowProductModal(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" className="btn-primary flex-1">{editProduct ? 'Guardar Cambios' : 'Crear Producto'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showCatModal} onClose={() => setShowCatModal(false)} title={editCat ? 'Editar Categoría' : 'Nueva Categoría'} size="sm">
        <form onSubmit={handleCatSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre</label><input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: formatCatalogNameInput(e.target.value) })} className="input-field" required placeholder="Ej: Entradas" /></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descripción</label><textarea value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} className="input-field" rows="2" placeholder="Descripción..." /></div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowCatModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">{editCat ? 'Guardar' : 'Crear'}</button></div>
        </form>
      </Modal>

      <Modal isOpen={showComboModal} onClose={() => setShowComboModal(false)} title="Nuevo Combo" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/admin-modules/combos', {
              name: comboForm.name,
              description: comboForm.description,
              price: parseFloat(comboForm.price),
              items: comboForm.items
                .map((id) => products.find((p) => String(p.id) === String(id)))
                .filter(Boolean)
                .map((p) => ({ product_id: p.id, quantity: 1 })),
            });
            setShowComboModal(false);
            setComboSuggestions(null);
            toast.success('Combo creado');
            load();
          } catch (err) {
            toast.error(err.message);
          }
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Productos incluidos</label>
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
              {products.filter(p => p.is_active).map(p => (
                <label key={p.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-sm">
                  <input type="checkbox" checked={comboForm.items.includes(p.id)} onChange={e => {
                    if (e.target.checked) {
                      setComboForm((prev) => (
                        prev.items.includes(p.id)
                          ? prev
                          : { ...prev, items: [...prev.items, p.id] }
                      ));
                    } else {
                      setComboForm((prev) => ({ ...prev, items: prev.items.filter((i) => i !== p.id) }));
                    }
                  }} className="rounded text-gold-500" />
                  {p.name} <span className="text-[var(--ui-muted)] ml-auto">{formatCurrency(p.price)}</span>
                </label>
              ))}
            </div>
            {selectedComboProducts.length > 0 ? (
              <p className="text-xs text-[var(--ui-muted)] mt-2">
                {selectedComboProducts.length} producto{selectedComboProducts.length === 1 ? '' : 's'} seleccionado{selectedComboProducts.length === 1 ? '' : 's'} · Total:{' '}
                <span className="font-semibold text-[var(--ui-body-text)]">{formatCurrency(selectedComboTotal)}</span>
              </p>
            ) : null}
          </div>

          {selectedComboProducts.length > 0 ? (
            <div className="rounded-xl border border-[color:var(--ui-accent)]/25 bg-[color-mix(in_srgb,var(--ui-accent)_8%,transparent)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-body-text)]">
                  <MdAutoAwesome className="text-[var(--ui-accent)] text-lg shrink-0" />
                  Sugerencias {comboSuggestions?.source === 'ai' ? 'con IA' : 'inteligentes'}
                </div>
                {comboSuggestLoading ? (
                  <span className="text-xs text-[var(--ui-muted)]">Calculando…</span>
                ) : comboSuggestions?.source === 'ai' ? (
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--ui-accent)] text-white">IA</span>
                ) : null}
              </div>

              {comboSuggestLoading ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ui-muted)]">
                  <div className="animate-spin w-4 h-4 border-2 border-[var(--ui-accent)] border-t-transparent rounded-full" />
                  Analizando {selectedComboProducts.length} producto{selectedComboProducts.length === 1 ? '' : 's'}…
                </div>
              ) : comboSuggestions ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-white/70 dark:bg-black/20 px-3 py-2 border border-slate-200/80">
                      <p className="text-xs text-[var(--ui-muted)]">Total individual</p>
                      <p className="font-bold text-[var(--ui-body-text)]">{formatCurrency(comboSuggestions.total)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 dark:bg-black/20 px-3 py-2 border border-[var(--ui-accent)]/30">
                      <p className="text-xs text-[var(--ui-muted)]">Precio sugerido</p>
                      <p className="font-bold text-[var(--ui-accent)]">{formatCurrency(comboSuggestions.suggested_price)}</p>
                      {comboSuggestions.discount_pct > 0 ? (
                        <p className="text-[11px] text-emerald-600 mt-0.5">
                          Ahorro {formatCurrency(comboSuggestions.savings)} ({comboSuggestions.discount_pct}%)
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-sm space-y-2">
                    <div>
                      <p className="text-xs text-[var(--ui-muted)] mb-0.5">Productos en el combo</p>
                      <p className="text-[var(--ui-body-text)] leading-snug">
                        {(comboSuggestions.products || []).map((p) => p.name).join(' · ') || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--ui-muted)] mb-0.5">Nombre sugerido</p>
                      <p className="font-medium text-[var(--ui-body-text)]">{comboSuggestions.name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--ui-muted)] mb-0.5">Descripción sugerida</p>
                      <p className="text-[var(--ui-body-text)] leading-snug">{comboSuggestions.description || '—'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={applyComboSuggestions}
                    disabled={comboSuggestLoading}
                    className="w-full btn-primary text-sm py-2.5 flex items-center justify-center gap-2"
                  >
                    <MdAutoAwesome /> Aplicar sugerencias
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre del Combo</label><input value={comboForm.name} onChange={e => setComboForm({ ...comboForm, name: e.target.value })} className="input-field" required placeholder="Ej: Duo Arroz Chaufa + Lomo Fino" /></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Descripción</label><textarea value={comboForm.description} onChange={e => setComboForm({ ...comboForm, description: e.target.value })} className="input-field" rows="2" placeholder="Describe qué incluye el combo y el beneficio para el cliente" /></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Precio</label><input type="number" step="0.01" min="0" value={comboForm.price} onChange={e => setComboForm({ ...comboForm, price: e.target.value })} className="input-field" required placeholder="Precio final del combo" /></div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowComboModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">Crear Combo</button></div>
        </form>
      </Modal>

      <Modal isOpen={showModModal} onClose={() => setShowModModal(false)} title="Nuevo Modificador" size="sm">
        <form onSubmit={handleModSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Nombre del Grupo</label><input value={modForm.name} onChange={e => setModForm({ ...modForm, name: e.target.value })} className="input-field" required placeholder="Ej: Tamaño, Cocción, Extras" /></div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Opciones (separadas por coma)</label><textarea value={modForm.options} onChange={e => setModForm({ ...modForm, options: e.target.value })} className="input-field" rows="2" required placeholder="Pequeño, Mediano, Grande" /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={modForm.required} onChange={e => setModForm({ ...modForm, required: e.target.checked })} className="rounded text-gold-500" /><span>Selección obligatoria</span></label>
          <div className="flex gap-3"><button type="button" onClick={() => setShowModModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">Crear</button></div>
        </form>
      </Modal>

      <ContextMenu
        open={!!catContextMenu}
        x={catContextMenu?.x ?? 0}
        y={catContextMenu?.y ?? 0}
        onClose={() => setCatContextMenu(null)}
        items={catContextMenu ? [
          {
            id: 'merge-cat',
            label: 'Mover categoría',
            onClick: () => startCategoryMerge(catContextMenu.cat),
          },
        ] : []}
      />

    </div>
  );
}
