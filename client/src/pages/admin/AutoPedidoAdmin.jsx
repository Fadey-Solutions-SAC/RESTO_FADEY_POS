import { useState, useEffect, useRef, useCallback } from 'react';
import { api, resolveMediaUrl } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { MdAdd, MdDelete, MdSave, MdContentCopy, MdUploadFile, MdRestaurantMenu, MdEdit, MdVisibility, MdVisibilityOff, MdFolderOpen, MdDownload, MdPrint, MdFullscreen, MdFullscreenExit, MdOpenInFull, MdCloseFullscreen } from 'react-icons/md';
import QRCode from 'qrcode';
import { downloadTableQrA5, normalizeQrSlot, printTableQrA5Sheets, suggestFormatQrSlot } from '../../utils/tableQrPrint';
import { QR_PRINT_FORMATS, qrPrintFormatBySrc } from '../../data/qrPrintFormats';
import { CartaPreviewMedia } from '../../components/CartasHorizontalCarousel';
import Modal from '../../components/Modal';
import {
  parseMenuLines,
  buildMenuCartaSvgBlob,
  DEFAULT_MENU_CARTA_COLORS,
  DEFAULT_CARTA_STYLE,
  normalizeCartaStyle,
  normalizeHex,
} from '../../utils/generateMenuCartaSvg';
import { CARTA_BACKGROUND_PRESETS, DEFAULT_CARTA_PRESET_ID, cartaPresetById, resolvePresetBackgroundHref } from '../../data/cartaBackgroundPresets';
import { CARTA_MAX_PRODUCTS, buildCartaTextFromCategory } from '../../utils/cartaFromCatalog';
import { buildGeneratedCartaPayload, cartaHasDisplayableContent, isGeneratedCarta } from '../../utils/autoPedidoCartaShape';
import { downloadMenuCartaPngA4, buildMenuCartaPngBlob } from '../../utils/downloadCartaPngA4';
import { formatCatalogNameInput } from '../../utils/catalogNameFormat';
import { isImageFile, matchImageFilesToProducts } from '../../utils/productImageFolderMatch';
import {
  extractPdfPageImages,
  buildCartasFromPdfPages,
  isPdfFile,
} from '../../utils/splitPdfCartaPages';

/** Editor con resaltado: líneas que empiezan (tras espacios) con # usan color de sección. */
function MenuCartaSyntaxEditor({ value, onChange, bgColor, textColor, sectionColor }) {
  const innerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.style.transform = `translateY(-${scrollTop}px)`;
    }
  }, [scrollTop, value, bgColor, textColor, sectionColor]);

  const lines = String(value ?? '').split(/\r?\n/);
  const hashLine = (line) => line.trimStart().startsWith('#');

  return (
    <div
      className="relative rounded-lg border border-slate-600/80 overflow-hidden shadow-inner flex flex-col h-[min(72vh,860px)] min-h-[min(56vh,620px)] max-h-[min(82vh,960px)]"
      style={{ backgroundColor: bgColor }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none min-h-0" aria-hidden>
        <div ref={innerRef} className="p-3 font-mono text-sm leading-6 text-left will-change-transform min-h-full">
          {lines.map((line, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap break-words min-h-[1.5rem]"
              style={{ color: hashLine(line) ? sectionColor : textColor }}
            >
              {line || '\u00a0'}
            </div>
          ))}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        spellCheck={false}
        className="relative z-10 block w-full flex-1 min-h-0 p-3 font-mono text-sm leading-6 bg-transparent text-transparent resize-y overflow-auto border-0 outline-none focus:ring-2 focus:ring-sky-400/40 rounded-lg"
        style={{ caretColor: textColor }}
        placeholder=""
      />
    </div>
  );
}

const MENU_GEN_PLACEHOLDER = `# Entradas
Ceviche clásico | Pescado fresco al limón  28
Wantán frito | Crujiente con salsa tamarindo  18
Lomo saltado | Carne, papas y arroz  38`;

function selfOrderUrlForTable(number) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/auto-pedido?mesa=${encodeURIComponent(String(number))}`;
}

const LOGO_SHAPES = [
  { id: 'ellipse', label: 'Óvalo' },
  { id: 'circle', label: 'Círculo' },
  { id: 'roundrect', label: 'Redondeado' },
  { id: 'rect', label: 'Rectángulo' },
];

const DEFAULT_LOGO_SLOT = { x: 0.32, y: 0.05, w: 0.36, h: 0.13 };

function logoStateForFormat(formatSrc, saved) {
  const preset = qrPrintFormatBySrc(formatSrc);
  const knownShape = LOGO_SHAPES.some((item) => item.id === saved?.shape);
  return {
    enabled: saved ? Boolean(saved.enabled) : Boolean(preset),
    slot: normalizeQrSlot(saved?.slot) || preset?.logo || { ...DEFAULT_LOGO_SLOT },
    shape: knownShape ? saved.shape : (preset?.logoShape || 'ellipse'),
  };
}

function logoClipStyle(shape) {
  if (shape === 'circle') return { borderRadius: 0, clipPath: 'circle(50% at 50% 50%)' };
  if (shape === 'ellipse') return { borderRadius: 0, clipPath: 'ellipse(50% 50% at 50% 50%)' };
  if (shape === 'roundrect') return { borderRadius: '12%', clipPath: 'none' };
  return { borderRadius: 0, clipPath: 'none' };
}

function QrSlotEditor({
  imageUrl,
  slot,
  sampleNumber,
  onDragStart,
  onChange,
  onCommit,
  onUseFrame,
  placing,
  logoUrl,
  logoEnabled,
  logoSlot,
  logoShape,
  onLogoEnabledChange,
  onLogoChange,
  onLogoCommit,
  onLogoShapeChange,
}) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const onLogoChangeRef = useRef(onLogoChange);
  const onLogoCommitRef = useRef(onLogoCommit);
  const [preview, setPreview] = useState('');
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  onLogoChangeRef.current = onLogoChange;
  onLogoCommitRef.current = onLogoCommit;

  useEffect(() => {
    let cancel = false;
    QRCode.toDataURL('mesa', {
      margin: 0,
      width: 240,
      errorCorrectionLevel: 'H',
      color: { dark: '#111827', light: '#ffffff' },
    }).then((url) => {
      if (!cancel) setPreview(url);
    }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.px) / drag.rect.width;
      const dy = (event.clientY - drag.py) / drag.rect.height;
      const start = drag.slot;
      const next = drag.mode === 'resize'
        ? normalizeQrSlot({ ...start, w: start.w + dx, h: start.h + dy })
        : normalizeQrSlot({ ...start, x: start.x + dx, y: start.y + dy });
      if (!next) return;
      drag.current = next;
      if (drag.kind === 'logo') onLogoChangeRef.current(next);
      else onChangeRef.current(next);
    };
    const up = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const done = drag.current || drag.slot;
      if (drag.kind === 'logo') onLogoCommitRef.current(done);
      else onCommitRef.current(done);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const start = (event, mode, kind) => {
    const current = kind === 'logo' ? logoSlot : slot;
    if (!current || !frameRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'move') event.currentTarget.focus();
    onDragStart?.(kind);
    dragRef.current = {
      kind,
      mode,
      px: event.clientX,
      py: event.clientY,
      slot: { ...current },
      current: { ...current },
      rect: frameRef.current.getBoundingClientRect(),
    };
  };

  const nudge = (event, kind) => {
    const current = kind === 'logo' ? logoSlot : slot;
    if (!current) return;
    const step = event.shiftKey ? 0.02 : 0.004;
    let next = null;
    if (event.key === 'ArrowLeft') next = normalizeQrSlot({ ...current, x: current.x - step });
    if (event.key === 'ArrowRight') next = normalizeQrSlot({ ...current, x: current.x + step });
    if (event.key === 'ArrowUp') next = normalizeQrSlot({ ...current, y: current.y - step });
    if (event.key === 'ArrowDown') next = normalizeQrSlot({ ...current, y: current.y + step });
    if (!next) return;
    event.preventDefault();
    if (kind === 'logo') {
      onLogoChange(next);
      onLogoCommit(next);
    } else {
      onChange(next);
      onCommit(next);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          ref={frameRef}
          className="relative mx-auto w-full max-w-[260px] shrink-0 bg-white rounded-lg border border-slate-200"
        >
          <img src={imageUrl} alt="Formato de impresión" className="block w-full h-auto select-none" draggable={false} />
          {logoEnabled && logoSlot ? (
            <div
              tabIndex={0}
              aria-label="Lugar del logo. Arrastre para moverlo."
              className="absolute z-10 cursor-move touch-none border-2 border-amber-500 outline-none focus:ring-2 focus:ring-amber-400"
              style={{
                left: `${logoSlot.x * 100}%`,
                top: `${logoSlot.y * 100}%`,
                width: `${logoSlot.w * 100}%`,
                height: `${logoSlot.h * 100}%`,
              }}
              onPointerDown={(e) => start(e, 'move', 'logo')}
              onKeyDown={(e) => nudge(e, 'logo')}
            >
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ ...logoClipStyle(logoShape), background: logoUrl ? '#f6ead2' : 'transparent' }}
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                  />
                ) : null}
              </div>
              <span
                className="absolute -right-1.5 -bottom-1.5 h-4 w-4 rounded-sm border-2 border-white bg-amber-500 cursor-nwse-resize"
                onPointerDown={(e) => start(e, 'resize', 'logo')}
                aria-hidden
              />
            </div>
          ) : null}
          {slot ? (
            <div
              tabIndex={0}
              aria-label="Lugar del código QR. Arrastre para moverlo."
              className="absolute z-20 border-2 border-violet-600 cursor-move touch-none outline-none focus:ring-2 focus:ring-violet-400"
              style={{
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
              }}
              onPointerDown={(e) => start(e, 'move', 'qr')}
              onKeyDown={(e) => nudge(e, 'qr')}
            >
              {preview ? (
                <img src={preview} alt="" className="absolute inset-0 w-full h-full object-contain bg-white/80 pointer-events-none" />
              ) : null}
              <span
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-white border-2 border-slate-900 font-bold text-slate-900 pointer-events-none"
                style={{ width: '29%', height: '29%', fontSize: '0.65rem' }}
              >
                {sampleNumber}
              </span>
              <span
                className="absolute -right-1.5 -bottom-1.5 h-4 w-4 rounded-sm border-2 border-white bg-violet-600 cursor-nwse-resize"
                onPointerDown={(e) => start(e, 'resize', 'qr')}
                aria-hidden
              />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-medium rf-section-title">Lugar del QR</p>
          <p className="mt-1 text-xs text-[var(--ui-muted)]">
            Arrastre el recuadro violeta hasta el marco del diseño. La esquina cambia el tamaño. Con el recuadro seleccionado, las flechas lo mueven con más precisión.
          </p>
          <label className="mt-3 flex items-start gap-2 text-sm text-[var(--ui-body-text)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(logoEnabled)}
              onChange={(e) => onLogoEnabledChange(e.target.checked)}
            />
            <span>
              Logo automático
              <span className="mt-0.5 block text-xs text-[var(--ui-muted)]">
                {logoEnabled
                  ? 'El recuadro ámbar es el logo de Mi Restaurante. Muévalo, cambie su tamaño y elija la forma. Si el diseño ya trae logo, desactive esta opción.'
                  : 'Desactivado: la hoja solo lleva el QR. El logo del diseño se deja como está.'}
              </span>
            </span>
          </label>
          {logoEnabled ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LOGO_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    logoShape === shape.id
                      ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-slate-200 text-slate-600'
                  }`}
                  onClick={() => onLogoShapeChange(shape.id)}
                >
                  {shape.label}
                </button>
              ))}
            </div>
          ) : null}
          {logoEnabled && !logoUrl ? (
            <p className="mt-2 text-xs text-amber-700">Configure el logo en Mi Restaurante para verlo en el recuadro.</p>
          ) : null}
          <button
            type="button"
            className="btn-secondary mt-3 text-sm"
            disabled={placing}
            onClick={onUseFrame}
          >
            {placing ? 'Buscando recuadro…' : 'Usar el recuadro del diseño'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AutoPedidoAdmin() {
  const { user } = useAuth();
  const canSave = user?.role === 'admin' || user?.role === 'master_admin';
  const [cartas, setCartas] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({ name: '', price: '', category_id: '' });
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [genOpenIndex, setGenOpenIndex] = useState(null);
  const [genTitle, setGenTitle] = useState('Nuestra carta');
  const [genText, setGenText] = useState(MENU_GEN_PLACEHOLDER);
  const [genPreviewUrl, setGenPreviewUrl] = useState('');
  const [genPreviewMode, setGenPreviewMode] = useState('split');
  const [genPreviewFull, setGenPreviewFull] = useState(false);
  const [cartaFullIndex, setCartaFullIndex] = useState(null);
  const [genColors, setGenColors] = useState(() => ({ ...DEFAULT_MENU_CARTA_COLORS }));
  const [genStyle, setGenStyle] = useState(() => ({ ...DEFAULT_CARTA_STYLE }));
  const [genPresetId, setGenPresetId] = useState(DEFAULT_CARTA_PRESET_ID);
  const [genCategoryId, setGenCategoryId] = useState('');
  const [genExporting, setGenExporting] = useState(false);
  const [showProductCatalog, setShowProductCatalog] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [folderImportResult, setFolderImportResult] = useState(null);
  const [showFolderImportModal, setShowFolderImportModal] = useState(false);
  const [assigningPendingKey, setAssigningPendingKey] = useState('');
  const [printingQrTableId, setPrintingQrTableId] = useState('');
  const [qrHome, setQrHome] = useState('productos');
  const [qrFormat, setQrFormat] = useState('');
  const [qrSlot, setQrSlot] = useState(null);
  const [logoAuto, setLogoAuto] = useState(false);
  const [logoSlot, setLogoSlot] = useState(null);
  const [logoShape, setLogoShape] = useState('ellipse');
  const [restaurantLogo, setRestaurantLogo] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [qrDataReady, setQrDataReady] = useState(false);
  const [placingQrSlot, setPlacingQrSlot] = useState(false);
  const [uploadingQrFormat, setUploadingQrFormat] = useState(false);
  const draggingSlotRef = useRef(false);
  const draggingLogoRef = useRef(false);
  const [savingQrHome, setSavingQrHome] = useState(false);
  const cartasDirtyRef = useRef(false);
  const loadSeqRef = useRef(0);
  const bootedRef = useRef(false);
  const qrEchoUntilRef = useRef(0);

  const markCartasEdited = () => {
    cartasDirtyRef.current = true;
  };

  const load = useCallback((opts = {}) => {
    const seq = ++loadSeqRef.current;
    const silent = opts.silent === true || bootedRef.current;
    if (!silent) setLoading(true);
    Promise.all([
      api.get('/admin-modules/auto-pedido/cartas'),
      api.get('/tables'),
      api.get('/products'),
      api.get('/categories'),
      api.get('/restaurant').catch(() => ({})),
    ])
      .then(([cData, tData, pData, catData, restaurantData]) => {
        if (seq !== loadSeqRef.current) return;
        if (!cartasDirtyRef.current) {
          setCartas(Array.isArray(cData.cartas) ? cData.cartas : []);
        }
        const home = String(cData?.qr_home || '').trim().toLowerCase();
        setQrHome(home === 'cartas' || home === 'ambos' ? home : 'productos');
        if (Date.now() >= qrEchoUntilRef.current) {
          const formatSrc = String(cData?.qr_format || '').trim();
          setQrFormat(formatSrc);
          if (!draggingSlotRef.current) setQrSlot(normalizeQrSlot(cData?.qr_slot));
          if (!draggingLogoRef.current) {
            const logo = logoStateForFormat(formatSrc, cData?.qr_logo);
            setLogoAuto(logo.enabled);
            setLogoSlot(logo.slot);
            setLogoShape(logo.shape);
          }
        }
        setTables(Array.isArray(tData) ? tData : []);
        setProducts(Array.isArray(pData) ? pData : []);
        setCategories(Array.isArray(catData) ? catData : []);
        setRestaurantLogo(String(restaurantData?.logo || '').trim());
        setRestaurantName(String(restaurantData?.name || '').trim());
      })
      .catch((e) => {
        if (seq === loadSeqRef.current) toast.error(e.message);
      })
      .finally(() => {
        if (seq === loadSeqRef.current) {
          bootedRef.current = true;
          setLoading(false);
          setQrDataReady(true);
        }
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!qrDataReady || !qrFormat || qrSlot) return undefined;
    const preset = qrPrintFormatBySrc(qrFormat);
    if (preset) {
      setQrSlot(preset.qr);
      void saveQrSlot(preset.qr, { silent: true });
      return undefined;
    }
    let cancel = false;
    setPlacingQrSlot(true);
    suggestFormatQrSlot(resolveMediaUrl(qrFormat))
      .then((suggested) => {
        if (cancel || !suggested) return;
        setQrSlot((current) => current || suggested);
        return saveQrSlot(suggested, { silent: true });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancel) setPlacingQrSlot(false);
      });
    return () => { cancel = true; };
  }, [qrDataReady, qrFormat, qrSlot]);

  useSocket('staff-data-update', (p) => {
    const d = p?.domain;
    if (['auto_pedido_qr_format', 'auto_pedido_qr_slot', 'auto_pedido_qr_logo'].includes(d) && Date.now() < qrEchoUntilRef.current) return;
    if (['auto_pedido_cartas', 'auto_pedido_qr_home', 'auto_pedido_qr_format', 'auto_pedido_qr_slot', 'auto_pedido_qr_logo', 'modifiers', 'discounts', 'offers', 'combos', 'catalog'].includes(d)) {
      void load({ silent: true });
    }
  });
  useSocket('inventory-update', () => {
    void load({ silent: true });
  });

  useEffect(() => {
    if (genOpenIndex === null) return undefined;
    let cancel = false;
    let createdUrl = '';
    const rows = parseMenuLines(genText);
    (async () => {
      let backgroundHref = '';
      try {
        backgroundHref = await resolvePresetBackgroundHref(genPresetId);
      } catch {
        backgroundHref = cartaPresetById(genPresetId).src || '';
      }
      if (cancel) return;
      const blob = buildMenuCartaSvgBlob({
        rows,
        title: genTitle.trim() || 'Nuestra carta',
        colors: genColors,
        style: genStyle,
        presetId: genPresetId,
        page: 'a4',
        backgroundHref,
      });
      const url = URL.createObjectURL(blob);
      createdUrl = url;
      if (cancel) {
        URL.revokeObjectURL(url);
        return;
      }
      setGenPreviewUrl((prev) => {
        if (prev && prev !== url) URL.revokeObjectURL(prev);
        return url;
      });
    })();
    return () => {
      cancel = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [genOpenIndex, genText, genTitle, genColors, genStyle, genPresetId]);

  const addRow = () => {
    markCartasEdited();
    setCartas((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, name: `Carta ${prev.length + 1}`, url: '', sort: prev.length },
    ]);
  };

  const updateRow = (index, field, value) => {
    markCartasEdited();
    setCartas((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const removeRow = async (index) => {
    const target = cartas[index];
    if (!target || !canSave) return;
    const isPersisted = !String(target.id || '').startsWith('tmp-');
    if (isPersisted && !window.confirm(`¿Eliminar «${target.name || 'esta carta'}»?`)) return;
    const next = cartas.filter((_, i) => i !== index);
    markCartasEdited();
    setCartas(next);
    if (!isPersisted) return;
    if (next.some((c) => !cartaHasDisplayableContent(c))) {
      toast('Carta quitada. Complete las demás y pulse Guardar para confirmar.');
      return;
    }
    await persistCartas(next, 'Carta eliminada');
  };

  const openGenerator = (index) => {
    const current = cartas[index];
    const generated = current?.generated;
    const firstCat = categories[0];
    if (generated && (generated.text || generated.title)) {
      const nextStyle = normalizeCartaStyle(generated.style);
      if (!nextStyle.sectionLabel) {
        const firstSection = parseMenuLines(generated.text).find((row) => row.kind === 'section');
        if (firstSection?.label) nextStyle.sectionLabel = firstSection.label;
      }
      setGenTitle(generated.title || current.name || firstCat?.name || 'Nuestra carta');
      setGenText(generated.text || MENU_GEN_PLACEHOLDER);
      setGenPresetId(generated.presetId || DEFAULT_CARTA_PRESET_ID);
      setGenColors({ ...DEFAULT_MENU_CARTA_COLORS, ...generated.colors });
      setGenStyle(nextStyle);
    } else {
      setGenTitle(current?.name || firstCat?.name || 'Nuestra carta');
      setGenText(MENU_GEN_PLACEHOLDER);
      setGenPresetId(DEFAULT_CARTA_PRESET_ID);
      setGenColors({ ...DEFAULT_MENU_CARTA_COLORS });
      setGenStyle({ ...DEFAULT_CARTA_STYLE });
    }
    setGenCategoryId(firstCat?.id || '');
    setGenOpenIndex(index);
  };

  const applyCartaPreset = (presetId) => {
    const preset = cartaPresetById(presetId);
    setGenPresetId(preset.id);
    setGenColors({ ...preset.colors });
  };

  const loadProductsIntoCarta = () => {
    const category = categories.find((row) => String(row.id) === String(genCategoryId));
    if (!category) {
      toast.error('Elija una categoría');
      return;
    }
    const packed = buildCartaTextFromCategory({ category, products });
    if (!packed.used) {
      toast.error('Esa categoría no tiene productos activos');
      return;
    }
    setGenTitle(packed.title);
    setGenStyle((s) => ({ ...s, sectionLabel: packed.title }));
    setGenText(packed.text);
    if (packed.omitted) {
      toast(`Se cargaron ${packed.used} productos (máximo ${CARTA_MAX_PRODUCTS} por carta).`, { icon: 'ℹ️' });
    } else {
      toast.success(`${packed.used} producto(s) cargados en la carta`);
    }
  };

  const closeGenerator = () => {
    setGenOpenIndex(null);
    setGenPreviewUrl('');
    setGenPreviewMode('split');
    setGenPreviewFull(false);
  };

  useEffect(() => {
    if (!genPreviewFull && cartaFullIndex == null) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setGenPreviewFull(false);
      setCartaFullIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [genPreviewFull, cartaFullIndex]);

  const cartaGeneratorPayload = () => ({
    rows: parseMenuLines(genText),
    title: genTitle.trim() || 'Nuestra carta',
    colors: genColors,
    style: normalizeCartaStyle(genStyle),
    presetId: genPresetId,
  });

  const downloadGeneratedCartaPng = async () => {
    const payload = cartaGeneratorPayload();
    if (!payload.rows.some((r) => r.kind === 'item')) {
      toast.error('Escribe o carga al menos un producto');
      return;
    }
    setGenExporting(true);
    const tid = toast.loading('Preparando PNG A4…');
    try {
      await downloadMenuCartaPngA4(payload);
      toast.success('Carta descargada en PNG A4', { id: tid });
    } catch (err) {
      toast.error(err.message || 'No se pudo descargar el PNG', { id: tid });
    } finally {
      setGenExporting(false);
    }
  };

  const applyGeneratedCarta = async () => {
    if (!canSave || genOpenIndex === null) return;
    const payload = cartaGeneratorPayload();
    if (!payload.rows.some((r) => r.kind === 'item')) {
      toast.error('Escribe o carga al menos un producto');
      return;
    }
    const generated = buildGeneratedCartaPayload({
      title: payload.title,
      text: genText,
      presetId: payload.presetId,
      colors: payload.colors,
      style: payload.style,
    });
    const tid = toast.loading('Guardando carta generada…');
    try {
      let url = String(cartas[genOpenIndex]?.url || '').trim();
      try {
        const blob = await buildMenuCartaPngBlob(payload);
        const file = new File([blob], `carta-${Date.now()}.png`, { type: 'image/png' });
        const uploaded = await api.upload(file);
        url = String(uploaded?.url || url).trim();
      } catch {
        url = '';
      }
      const next = cartas.map((c, i) => (
        i === genOpenIndex
          ? {
              ...c,
              name: generated.title || c.name || `Carta ${i + 1}`,
              url,
              source: 'generated',
              generated,
            }
          : c
      ));
      markCartasEdited();
      setCartas(next);
      closeGenerator();
      const saved = await persistCartas(next, 'Carta generada guardada en carta QR', tid);
      if (!saved) {
        toast.error('No se pudo guardar la carta generada', { id: tid });
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar la carta generada', { id: tid });
    }
  };

  const uploadCartaFile = async (index, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canSave) return;

    const tid = toast.loading(isPdfFile(file) ? 'Procesando PDF…' : 'Subiendo…');
    try {
      const pageBlobs = await extractPdfPageImages(file);
      if (pageBlobs && pageBlobs.length > 1) {
        toast.loading(`Subiendo ${pageBlobs.length} cartas…`, { id: tid });
        const urls = [];
        for (let p = 0; p < pageBlobs.length; p++) {
          const uploadFile = new File(
            [pageBlobs[p]],
            `carta-pag-${p + 1}-${Date.now()}.jpg`,
            { type: 'image/jpeg' },
          );
          const { url } = await api.upload(uploadFile);
          urls.push(url || '');
        }
        const baseName = cartas[index]?.name;
        markCartasEdited();
        setCartas((prev) => buildCartasFromPdfPages(prev, index, urls, baseName));
        toast.success(
          `${urls.length} cartas creadas desde el PDF. Pulsa Guardar para persistir.`,
          { id: tid },
        );
        return;
      }

      const { url } = await api.upload(file);
      markCartasEdited();
      updateRow(index, 'url', url || '');
      toast.success('Archivo aplicado a la carta', { id: tid });
    } catch (err) {
      toast.error(err.message || 'No se pudo subir', { id: tid });
    }
  };

  const save = () => persistCartas(cartas, 'Cartas guardadas');

  const persistCartas = async (list, successMessage, toastId) => {
    if (!canSave) return false;
    const tid = toastId || toast.loading('Guardando…');
    try {
      const ready = list.filter((c) => cartaHasDisplayableContent(c));
      if (!ready.length) {
        toast.error('Genere una carta, suba un archivo o indique una URL', { id: tid });
        return false;
      }
      const normalized = ready.map((c, i) => ({
        id: String(c.id || '').startsWith('tmp-') ? '' : c.id,
        name: c.name || `Carta ${i + 1}`,
        url: String(c.url || '').trim(),
        source: isGeneratedCarta(c) ? 'generated' : c.url ? 'upload' : '',
        generated: isGeneratedCarta(c)
          ? buildGeneratedCartaPayload(c.generated || {
              title: c.name,
              text: '',
              presetId: '',
              colors: {},
              style: {},
            })
          : undefined,
        sort: i,
      }));
      const data = await api.put('/admin-modules/auto-pedido/cartas', { cartas: normalized });
      loadSeqRef.current += 1;
      cartasDirtyRef.current = false;
      setCartas(data.cartas || normalized);
      toast.success(successMessage, { id: tid });
      return true;
    } catch (e) {
      toast.error(e.message || 'No se pudo guardar', { id: tid });
      return false;
    }
  };

  const saveQrHome = async (mode) => {
    const next = mode === 'cartas' || mode === 'ambos' ? mode : 'productos';
    if (!canSave) {
      setQrHome(next);
      return;
    }
    if (next === qrHome || savingQrHome) return;
    const prev = qrHome;
    setQrHome(next);
    setSavingQrHome(true);
    try {
      const data = await api.put('/admin-modules/auto-pedido/qr-home', { qr_home: next });
      const saved = String(data?.qr_home || next).trim().toLowerCase();
      setQrHome(saved === 'cartas' || saved === 'ambos' ? saved : 'productos');
      toast.success(
        saved === 'cartas'
          ? 'Al escanear el QR se mostrarán primero las cartas'
          : saved === 'ambos'
            ? 'Al escanear el QR se mostrarán cartas y productos'
            : 'Al escanear el QR se mostrarán primero los productos'
      );
    } catch (e) {
      setQrHome(prev);
      toast.error(e.message || 'No se pudo guardar la vista del QR');
    } finally {
      setSavingQrHome(false);
    }
  };

  const copyLink = (num) => {
    const url = selfOrderUrlForTable(num);
    navigator.clipboard.writeText(url).then(() => toast.success('Enlace copiado')).catch(() => toast.error('No se pudo copiar'));
  };

  const requireQrFormat = () => {
    const url = resolveMediaUrl(qrFormat);
    if (!url) {
      toast.error('Elija un formato de la fila antes de armar la hoja');
      return '';
    }
    return url;
  };

  const saveQrLogo = async (next, { silent } = {}) => {
    if (!canSave || !next) return;
    try {
      const data = await api.put('/admin-modules/auto-pedido/qr-logo', { qr_logo: next });
      if (!draggingLogoRef.current && data?.qr_logo) {
        const logo = logoStateForFormat(qrFormat, data.qr_logo);
        setLogoAuto(logo.enabled);
        setLogoSlot(logo.slot);
        setLogoShape(logo.shape);
      }
    } catch (err) {
      if (!silent) toast.error(err.message || 'No se pudo guardar el logo del formato');
    }
  };

  const saveQrSlot = async (slot, { silent } = {}) => {
    const clean = normalizeQrSlot(slot);
    if (!clean || !canSave) return;
    try {
      const data = await api.put('/admin-modules/auto-pedido/qr-slot', { qr_slot: clean });
      if (!draggingSlotRef.current && data?.qr_slot) setQrSlot(normalizeQrSlot(data.qr_slot));
    } catch (err) {
      if (!silent) toast.error(err.message || 'No se pudo guardar el lugar del QR');
    }
  };

  const placeQrOnFrame = async () => {
    const url = requireQrFormat();
    if (!url || placingQrSlot) return;
    setPlacingQrSlot(true);
    try {
      const suggested = await suggestFormatQrSlot(url);
      if (!suggested) {
        toast.error('No se encontró el recuadro. Arrástrelo usted mismo.');
        return;
      }
      draggingSlotRef.current = false;
      setQrSlot(suggested);
      await saveQrSlot(suggested, { silent: true });
      toast.success('QR colocado en el recuadro');
    } catch (err) {
      toast.error(err.message || 'No se pudo ubicar el recuadro');
    } finally {
      setPlacingQrSlot(false);
    }
  };

  const uploadQrFormat = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canSave || uploadingQrFormat) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('El formato debe ser una imagen');
      return;
    }
    setUploadingQrFormat(true);
    const tid = toast.loading('Subiendo formato…');
    try {
      const { url } = await api.upload(file);
      const data = await api.put('/admin-modules/auto-pedido/qr-format', { qr_format: url || '' });
      const formatSrc = String(data?.qr_format || url || '').trim();
      const logo = logoStateForFormat(formatSrc, null);
      logo.enabled = false;
      setQrFormat(formatSrc);
      setQrSlot(normalizeQrSlot(data?.qr_slot));
      setLogoAuto(false);
      setLogoSlot(logo.slot);
      setLogoShape(logo.shape);
      await saveQrLogo(logo, { silent: true });
      toast.success('Formato de impresión cargado', { id: tid });
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el formato', { id: tid });
    } finally {
      setUploadingQrFormat(false);
    }
  };

  const clearQrFormat = async () => {
    if (!canSave || uploadingQrFormat) return;
    setUploadingQrFormat(true);
    try {
      await api.put('/admin-modules/auto-pedido/qr-format', { qr_format: '' });
      setQrFormat('');
      setQrSlot(null);
      setLogoAuto(false);
      setLogoSlot(null);
      toast.success('Formato quitado');
    } catch (err) {
      toast.error(err.message || 'No se pudo quitar el formato');
    } finally {
      setUploadingQrFormat(false);
    }
  };

  const logoPlacement = () => {
    if (!logoAuto) return null;
    const url = resolveMediaUrl(restaurantLogo);
    if (!url) return null;
    return {
      url,
      name: restaurantName,
      slot: logoSlot || DEFAULT_LOGO_SLOT,
      shape: logoShape || 'ellipse',
    };
  };

  const applyLogoAutomatic = (enabled) => {
    const next = logoStateForFormat(qrFormat, {
      enabled,
      slot: logoSlot,
      shape: logoShape,
    });
    next.enabled = enabled;
    qrEchoUntilRef.current = Date.now() + 2500;
    setLogoAuto(next.enabled);
    setLogoSlot(next.slot);
    setLogoShape(next.shape);
    void saveQrLogo(next);
  };

  const chooseQrFormat = async (format) => {
    if (!format || uploadingQrFormat) return;
    if (qrPrintFormatBySrc(qrFormat)?.id === format.id) return;
    qrEchoUntilRef.current = Date.now() + 2500;
    const logo = logoStateForFormat(format.src, null);
    setQrFormat(format.src);
    setQrSlot(format.qr);
    setLogoAuto(logo.enabled);
    setLogoSlot(logo.slot);
    setLogoShape(logo.shape);
    if (!canSave) return;
    try {
      await api.put('/admin-modules/auto-pedido/qr-format', { qr_format: format.src });
      await api.put('/admin-modules/auto-pedido/qr-slot', { qr_slot: format.qr });
      await saveQrLogo(logo, { silent: true });
    } catch (err) {
      qrEchoUntilRef.current = 0;
      toast.error(err.message || 'No se pudo elegir el formato');
      void load({ silent: true });
    }
  };

  const downloadTableQr = async (table) => {
    const formatImageUrl = requireQrFormat();
    if (!formatImageUrl) return;
    const logo = logoPlacement();
    const tid = toast.loading('Preparando PDF a doble cara…');
    try {
      await downloadTableQrA5({
        url: selfOrderUrlForTable(table.number),
        tableNumber: table.number,
        formatImageUrl,
        slot: qrSlot,
        logoUrl: logo?.url || '',
        logoSlot: logo?.slot,
        logoShape: logo?.shape,
        restaurantName: logo?.name || '',
      });
      toast.success('PDF descargado: frente QR y reverso de términos', { id: tid });
    } catch (err) {
      toast.error(err.message || 'No se pudo descargar el QR', { id: tid });
    }
  };

  const printTableSheets = async (list, busyId) => {
    if (printingQrTableId) return;
    const formatImageUrl = requireQrFormat();
    if (!formatImageUrl) return;
    const sheets = (list || []).map((table) => ({
      url: selfOrderUrlForTable(table.number),
      tableNumber: table.number,
    }));
    if (!sheets.length) {
      toast.error('No hay mesas para imprimir');
      return;
    }
    setPrintingQrTableId(busyId);
    const tid = toast.loading(sheets.length > 1 ? 'Preparando PDFs A5 a doble cara…' : 'Preparando PDF A5 a doble cara…');
    try {
      await printTableQrA5Sheets(sheets, formatImageUrl, qrSlot, logoPlacement());
      toast.success(
        sheets.length > 1
          ? `${sheets.length} mesas listas: cada una con frente QR y reverso de términos`
          : 'Listo para imprimir: frente QR y reverso de términos',
        { id: tid },
      );
    } catch (err) {
      toast.error(err.message || 'No se pudo imprimir el QR', { id: tid });
    } finally {
      setPrintingQrTableId('');
    }
  };

  const printTableQr = (table) => printTableSheets([table], table.id);
  const printAllTableQr = () => printTableSheets(tables, 'all');

  const filteredProducts = products.filter((p) => {
    if (Number(p.is_active || 0) === 0) return false;
    if (selectedCategory !== 'all' && p.category_id !== selectedCategory) return false;
    return true;
  });

  const openEditProduct = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: String(product?.name || ''),
      price: String(product?.price ?? ''),
      category_id: String(product?.category_id || ''),
    });
  };

  const saveProduct = async () => {
    if (!editingProduct) return;
    const name = String(productForm.name || '').trim();
    const categoryId = String(productForm.category_id || '').trim();
    const price = Number(productForm.price);
    if (!name || !categoryId || !Number.isFinite(price) || price < 0) {
      toast.error('Completa nombre, categoría y precio');
      return;
    }
    const tid = toast.loading('Guardando producto…');
    try {
      await api.put(`/products/${editingProduct.id}`, {
        name,
        category_id: categoryId,
        price,
      });
      setEditingProduct(null);
      toast.success('Producto actualizado', { id: tid });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar', { id: tid });
    }
  };

  const uploadProductImage = async (productId, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canSave) return;
    const tid = toast.loading('Subiendo imagen…');
    try {
      const { url } = await api.upload(file);
      await api.put(`/products/${productId}`, { image: url || '', image_source: 'manual' });
      toast.success('Imagen actualizada (manual tiene prioridad)', { id: tid });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo actualizar imagen', { id: tid });
    }
  };

  const importImagesFromServer = async () => {
    if (!canSave || importingFolder) return;
    setImportingFolder(true);
    const tid = toast.loading('Leyendo imágenes del servidor…');
    try {
      const data = await api.get('/admin-modules/auto-pedido/server-images');
      const files = (Array.isArray(data?.images) ? data.images : []).filter(isImageFile);
      if (!files.length) {
        toast.error('El servidor no tiene fotos de productos', { id: tid });
        return;
      }
      const { matches, unmatched, ambiguous } = matchImageFilesToProducts(files, products);
      if (!matches.length) {
        toast.dismiss(tid);
        openFolderImportResult({ assigned: [], failed: [], unmatched, ambiguous });
        return;
      }
      const assigned = [];
      const failed = [];
      for (let i = 0; i < matches.length; i += 1) {
        const { file, product } = matches[i];
        toast.loading(`Asignando imágenes ${i + 1}/${matches.length}…`, { id: tid });
        try {
          await api.put(`/products/${product.id}`, { image: file.url || '', image_source: 'manual' });
          assigned.push({ file, product });
        } catch (err) {
          failed.push({ file, product, error: err.message || 'No se pudo asignar' });
        }
      }
      toast.dismiss(tid);
      openFolderImportResult({ assigned, failed, unmatched, ambiguous });
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudieron leer las imágenes del servidor', { id: tid });
    } finally {
      setImportingFolder(false);
    }
  };

  const revokePreviewUrl = (url) => {
    if (String(url || '').startsWith('blob:')) URL.revokeObjectURL(url);
  };

  const openFolderImportResult = ({ assigned, failed, unmatched, ambiguous }) => {
    const toPending = (file, reason, extra = {}) => ({
      key: `${reason}:${file.url || file.name}`,
      file,
      reason,
      previewUrl: file.url ? resolveMediaUrl(file.url) : URL.createObjectURL(file),
      candidates: extra.candidates || [],
      productId: extra.productId || (extra.candidates?.[0]?.id ?? ''),
    });
    setFolderImportResult((prev) => {
      prev?.pending?.forEach((item) => revokePreviewUrl(item.previewUrl));
      return {
        assigned,
        pending: [
          ...ambiguous.map(({ file, candidates }) => toPending(file, 'ambiguous', { candidates })),
          ...failed.map(({ file, product, error }) => ({ ...toPending(file, 'failed', { productId: product?.id }), error })),
          ...unmatched.map((file) => toPending(file, 'unmatched')),
        ],
      };
    });
    setShowFolderImportModal(true);
  };

  const closeFolderImportModal = () => {
    setShowFolderImportModal(false);
    setFolderImportResult((prev) => {
      if (prev?.pending?.length) return prev;
      return null;
    });
  };

  const setPendingProduct = (key, productId) => {
    setFolderImportResult((prev) => (prev ? {
      ...prev,
      pending: prev.pending.map((item) => (item.key === key ? { ...item, productId } : item)),
    } : prev));
  };

  const discardPendingImage = (key) => {
    setFolderImportResult((prev) => {
      if (!prev) return prev;
      const item = prev.pending.find((p) => p.key === key);
      if (item) revokePreviewUrl(item.previewUrl);
      return { ...prev, pending: prev.pending.filter((p) => p.key !== key) };
    });
  };

  const assignPendingImage = async (key) => {
    const item = folderImportResult?.pending.find((p) => p.key === key);
    const product = products.find((p) => p.id === item?.productId);
    if (!item || !product || !canSave || assigningPendingKey) return;
    setAssigningPendingKey(key);
    try {
      const imageUrl = item.file?.url || (await api.upload(item.file))?.url || '';
      await api.put(`/products/${product.id}`, { image: imageUrl, image_source: 'manual' });
      revokePreviewUrl(item.previewUrl);
      setFolderImportResult((prev) => (prev ? {
        assigned: [...prev.assigned, { file: item.file, product }],
        pending: prev.pending.filter((p) => p.key !== key),
      } : prev));
      toast.success(`Imagen asignada a ${product.name}`);
      load();
    } catch (err) {
      toast.error(err.message || 'No se pudo asignar la imagen');
    } finally {
      setAssigningPendingKey('');
    }
  };

  const productsForManualAssign = [...products].sort((a, b) => {
    const aHas = a.image ? 1 : 0;
    const bHas = b.image ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    return String(a.name || '').localeCompare(String(b.name || ''), 'es');
  });
  const pendingFolderCount = folderImportResult?.pending?.length || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card flex flex-col justify-between gap-3 border border-[color:var(--ui-accent)]/35 bg-[var(--ui-surface)]">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--ui-body-text)]">Productos e imágenes del menú</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            Toma las fotos que ya están en el servidor, nombradas igual que el producto (ej. «Lomo saltado.jpg»), y las asigna solas. Las que no coincidan puede asignarlas a mano.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 w-full">
          {canSave ? (
            <>
              <button
                type="button"
                onClick={() => void importImagesFromServer()}
                disabled={importingFolder}
                className="btn-secondary text-sm inline-flex items-center justify-center gap-2 px-4 py-2.5"
              >
                <MdFolderOpen className="text-lg" />
                {importingFolder ? 'Asignando…' : 'Cargar imágenes del servidor'}
              </button>
              {pendingFolderCount && !showFolderImportModal ? (
                <button
                  type="button"
                  onClick={() => setShowFolderImportModal(true)}
                  className="btn-secondary text-sm inline-flex items-center justify-center gap-2 px-4 py-2.5 border-amber-400 text-amber-800"
                >
                  Asignar pendientes ({pendingFolderCount})
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setShowProductCatalog((v) => !v)}
            className="btn-primary text-sm inline-flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto px-5 py-2.5"
          >
            {showProductCatalog ? <MdVisibilityOff className="text-lg" /> : <MdVisibility className="text-lg" />}
            {showProductCatalog ? 'Ocultar productos' : 'Mostrar productos'}
          </button>
        </div>
      </div>

      <div className="card border border-[color:var(--ui-border)] bg-[var(--ui-surface)]">
        <div className="flex h-full flex-col justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--ui-body-text)]">Al escanear el QR mostrar primero</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              Define qué ve el cliente al abrir el enlace de la mesa: productos, cartas o ambos.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 w-full">
            {[
              { id: 'productos', label: 'Productos' },
              { id: 'cartas', label: 'Cartas' },
              { id: 'ambos', label: 'Ambos' },
            ].map((opt) => {
              const active = qrHome === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!canSave || savingQrHome}
                  onClick={() => void saveQrHome(opt.id)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-[var(--ui-accent)] border-[var(--ui-accent)] text-white'
                      : 'bg-[var(--ui-surface-2)] border-[color:var(--ui-border)] text-[var(--ui-body-text)] hover:border-[var(--ui-accent-muted)]'
                  } disabled:opacity-60`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {showProductCatalog ? (
      <div className="card mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              selectedCategory === 'all' ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border border-[color:var(--ui-border)]'
            }`}
          >
            Todas
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                selectedCategory === c.id ? 'bg-[var(--ui-accent)] text-white' : 'bg-[var(--ui-surface-2)] text-[var(--ui-body-text)] border border-[color:var(--ui-border)]'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredProducts.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-[var(--ui-surface)] p-3">
              <div className="aspect-[4/3] rounded-lg bg-[var(--ui-surface-2)] border border-slate-700/50 overflow-hidden mb-2">
                {p.image ? (
                  <img src={resolveMediaUrl(p.image)} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-[var(--ui-muted)]">Sin imagen</div>
                )}
              </div>
              <p className="text-sm font-semibold text-[var(--ui-body-text)] truncate">{p.name}</p>
              <p className="text-sm text-[var(--ui-accent)]">S/ {Number(p.price || 0).toFixed(2)}</p>
              {p.image_source === 'auto' ? (
                <p className="text-[10px] text-[var(--ui-muted)] mt-0.5">Imagen automática</p>
              ) : p.image_source === 'manual' ? (
                <p className="text-[10px] text-emerald-600 mt-0.5">Imagen manual</p>
              ) : null}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="file"
                  accept="image/*"
                  id={`product-image-${p.id}`}
                  className="sr-only"
                  onChange={(e) => uploadProductImage(p.id, e)}
                  disabled={!canSave}
                />
                <label
                  htmlFor={`product-image-${p.id}`}
                  className={`text-xs py-1.5 rounded-lg text-center border ${canSave ? 'border-[color:var(--ui-border)] text-[var(--ui-accent)] cursor-pointer hover:bg-[var(--ui-sidebar-hover)]' : 'border-slate-500/40 ui-text-muted'}`}
                >
                  Subir imagen
                </label>
                <button
                  type="button"
                  onClick={() => openEditProduct(p)}
                  className="text-xs py-1.5 rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)] inline-flex items-center justify-center gap-1"
                  disabled={!canSave}
                >
                  <MdEdit /> Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      ) : null}

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold rf-section-title">Cartas</h2>
          <div className="flex gap-2">
            <button type="button" onClick={addRow} className="btn-secondary text-sm inline-flex items-center gap-1">
              <MdAdd /> Añadir
            </button>
            {canSave && cartas.some((c) => !cartaHasDisplayableContent(c)) ? (
              <button type="button" onClick={save} className="btn-primary text-sm inline-flex items-center gap-1">
                <MdSave /> Guardar
              </button>
            ) : null}
          </div>
        </div>
        {!canSave && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Solo un usuario administrador puede guardar cambios en las cartas.
          </p>
        )}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {cartas.length === 0 && (
            <p className="ui-text-muted text-sm py-6">No hay cartas. Pulse Añadir para generar una a la derecha.</p>
          )}
          {cartas.map((c, i) => {
            const ready = cartaHasDisplayableContent(c);
            return (
              <div
                key={c.id || i}
                className="w-[11.5rem] shrink-0 rounded-xl border border-slate-200 bg-[var(--ui-surface)] p-2 flex flex-col"
              >
                <button
                  type="button"
                  className="aspect-[210/297] w-full overflow-hidden rounded-lg border border-slate-200 bg-[var(--ui-surface-2)] flex items-center justify-center"
                  onClick={() => ready && setCartaFullIndex(i)}
                  disabled={!ready}
                  title={ready ? 'Maximizar' : 'Sin carta'}
                >
                  {ready && isGeneratedCarta(c) ? (
                    <CartaPreviewMedia carta={c} className="max-h-full max-w-full object-contain" />
                  ) : ready && c.url ? (
                    <img
                      src={resolveMediaUrl(c.url)}
                      alt={c.name || `Carta ${i + 1}`}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="px-2 text-center text-[11px] text-[var(--ui-muted)]">Nueva carta</span>
                  )}
                </button>
                <p className="mt-2 truncate text-sm font-medium text-[var(--ui-body-text)]">
                  {c.name || `Carta ${i + 1}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {ready ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setCartaFullIndex(i)}
                        className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                      >
                        <MdFullscreen />
                        Maximizar
                      </button>
                      <button
                        type="button"
                        onClick={() => openGenerator(i)}
                        className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                        disabled={!canSave}
                      >
                        <MdEdit />
                        Editar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openGenerator(i)}
                        className="btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1"
                        disabled={!canSave}
                      >
                        <MdRestaurantMenu />
                        Generar
                      </button>
                      <input
                        type="file"
                        accept="image/*,.pdf,application/pdf"
                        id={`carta-upload-${i}`}
                        className="sr-only"
                        onChange={(e) => uploadCartaFile(i, e)}
                        disabled={!canSave}
                      />
                      <label
                        htmlFor={`carta-upload-${i}`}
                        className={`btn-secondary text-[11px] py-1 px-2 inline-flex items-center gap-1 ${!canSave ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                      >
                        <MdUploadFile />
                        Subir
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeRow(i)}
                    className="p-1 text-red-600 hover:bg-red-50 rounded-lg ml-auto"
                    disabled={!canSave}
                    aria-label="Eliminar"
                  >
                    <MdDelete className="text-lg" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold rf-section-title">Enlaces y QR por mesa</h2>
            <p className="text-xs text-[var(--ui-muted)] mt-1 max-w-xl">
              Elija un formato de la fila. El QR de cada mesa va en el recuadro violeta. El logo automático se puede mover, cambiar de forma o desactivar si el diseño ya lo trae. Al descargar o imprimir salen las dos caras: frente con el QR y reverso con los términos y condiciones.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {qrFormat ? (
              <span className="text-xs font-medium text-emerald-700">Formato cargado</span>
            ) : (
              <span className="text-xs text-[var(--ui-muted)]">Sin formato</span>
            )}
            {canSave ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  id="auto-pedido-qr-format"
                  className="sr-only"
                  onChange={(e) => void uploadQrFormat(e)}
                  disabled={uploadingQrFormat}
                />
                <label
                  htmlFor="auto-pedido-qr-format"
                  className={`btn-secondary text-sm inline-flex items-center gap-1 ${uploadingQrFormat ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}
                >
                  <MdUploadFile />
                  {uploadingQrFormat ? 'Subiendo…' : (qrFormat ? 'Cambiar formato' : 'Cargar formato')}
                </label>
                {qrFormat ? (
                  <button
                    type="button"
                    className="btn-secondary text-sm"
                    disabled={uploadingQrFormat}
                    onClick={() => void clearQrFormat()}
                  >
                    Quitar
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className="btn-primary text-sm inline-flex items-center gap-1"
              disabled={Boolean(printingQrTableId) || tables.length === 0}
              onClick={() => void printAllTableQr()}
            >
              <MdPrint />
              {printingQrTableId === 'all' ? 'Preparando…' : 'Imprimir todas (A5)'}
            </button>
          </div>
        </div>
        <div className="mb-4 flex gap-3 overflow-x-auto pb-2">
          {QR_PRINT_FORMATS.map((format) => {
            const selected = qrPrintFormatBySrc(qrFormat)?.id === format.id;
            return (
              <button
                key={format.id}
                type="button"
                onClick={() => void chooseQrFormat(format)}
                disabled={uploadingQrFormat}
                className={`w-28 shrink-0 rounded-xl border bg-white p-1.5 text-left transition ${
                  selected
                    ? 'border-violet-600 ring-2 ring-violet-500'
                    : 'border-slate-200 hover:border-violet-300'
                }`}
              >
                <img src={format.src} alt="" className="h-44 w-full rounded-lg bg-slate-100 object-contain" />
                <span className={`mt-1 block text-center text-xs font-medium ${selected ? 'text-violet-700' : 'text-slate-600'}`}>
                  {format.name}
                </span>
              </button>
            );
          })}
        </div>
        {qrFormat ? (
          <QrSlotEditor
            imageUrl={resolveMediaUrl(qrFormat)}
            slot={qrSlot}
            logoUrl={resolveMediaUrl(restaurantLogo)}
            logoEnabled={logoAuto}
            logoSlot={logoSlot}
            logoShape={logoShape}
            sampleNumber={tables[0]?.number ?? '1'}
            placing={placingQrSlot}
            onDragStart={(kind) => {
              if (kind === 'logo') draggingLogoRef.current = true;
              else draggingSlotRef.current = true;
            }}
            onChange={setQrSlot}
            onCommit={(slot) => {
              draggingSlotRef.current = false;
              setQrSlot(slot);
              void saveQrSlot(slot);
            }}
            onLogoEnabledChange={applyLogoAutomatic}
            onLogoChange={setLogoSlot}
            onLogoCommit={(slot) => {
              draggingLogoRef.current = false;
              setLogoSlot(slot);
              void saveQrLogo({ enabled: true, slot, shape: logoShape });
            }}
            onLogoShapeChange={(shape) => {
              setLogoShape(shape);
              void saveQrLogo({ enabled: true, slot: logoSlot, shape });
            }}
            onUseFrame={() => void placeQrOnFrame()}
          />
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((t) => {
            const url = selfOrderUrlForTable(t.number);
            const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
            return (
              <div key={t.id} className="border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center">
                <p className="font-semibold rf-section-title">{t.name}</p>
                <p className="text-xs ui-text-muted mb-2">Mesa {t.number}</p>
                <img src={qrSrc} alt="" className="w-40 h-40 mb-2 bg-white p-1 rounded" />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyLink(t.number)}
                    className="text-xs text-[var(--ui-accent)] inline-flex items-center gap-1 hover:underline"
                  >
                    <MdContentCopy /> Copiar enlace
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadTableQr(t)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)]"
                    title="Descargar hoja A5"
                    aria-label={`Descargar QR de ${t.name}`}
                  >
                    <MdDownload className="text-lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void printTableQr(t)}
                    disabled={Boolean(printingQrTableId)}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[color:var(--ui-border)] text-[var(--ui-accent)] hover:bg-[var(--ui-sidebar-hover)] disabled:opacity-50"
                    title="Imprimir hoja A5"
                    aria-label={`Imprimir QR de ${t.name}`}
                  >
                    <MdPrint className="text-lg" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {tables.length === 0 && <p className="ui-text-muted text-sm">No hay mesas configuradas. Créalas en Configuración → Salones y Mesas.</p>}
      </div>

      <Modal
        isOpen={showFolderImportModal && Boolean(folderImportResult)}
        onClose={closeFolderImportModal}
        title="Imágenes del servidor"
        size="lg"
      >
        {folderImportResult ? (
          <div className="space-y-3 text-sm">
            <p className="text-emerald-700 font-semibold">
              {folderImportResult.assigned.length} imagen(es) asignada(s) a su producto.
            </p>
            {folderImportResult.assigned.length ? (
              <ul className="max-h-32 overflow-y-auto space-y-1 text-xs text-[var(--ui-muted)]">
                {folderImportResult.assigned.map(({ file, product }) => (
                  <li key={`${product.id}:${file.name}`}>{file.name} → <span className="font-medium text-[var(--ui-body-text)]">{product.name}</span></li>
                ))}
              </ul>
            ) : null}
            {folderImportResult.pending.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                <p className="font-semibold text-amber-900">
                  Asignar manualmente ({folderImportResult.pending.length})
                </p>
                <p className="text-xs text-amber-900/80 mt-0.5">
                  Estas imágenes no coincidieron con un producto. Elija el producto y pulse «Asignar».
                </p>
                <ul className="mt-2 space-y-2 max-h-[45vh] overflow-y-auto pr-1">
                  {folderImportResult.pending.map((item) => {
                    const busy = assigningPendingKey === item.key;
                    const candidateIds = new Set(item.candidates.map((c) => c.id));
                    return (
                      <li
                        key={item.key}
                        className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface)] p-2"
                      >
                        <div className="flex items-center gap-2 min-w-0 sm:w-56 shrink-0">
                          <img
                            src={item.previewUrl}
                            alt=""
                            className="w-14 h-14 rounded-md object-cover border border-[color:var(--ui-border)] shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[var(--ui-body-text)] truncate" title={item.file.name}>
                              {item.file.name}
                            </p>
                            <p className="text-[11px] text-[var(--ui-muted)]">
                              {item.reason === 'ambiguous' && 'Coincide con varios productos'}
                              {item.reason === 'unmatched' && 'Sin producto con ese nombre'}
                              {item.reason === 'failed' && `Error: ${item.error || 'no se pudo asignar'}`}
                            </p>
                          </div>
                        </div>
                        <select
                          className="input-field text-sm flex-1 min-w-0"
                          value={item.productId}
                          onChange={(e) => setPendingProduct(item.key, e.target.value)}
                          disabled={busy}
                        >
                          <option value="">Elegir producto…</option>
                          {item.candidates.length ? (
                            <optgroup label="Sugeridos">
                              {item.candidates.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </optgroup>
                          ) : null}
                          <optgroup label="Todos los productos">
                            {productsForManualAssign
                              .filter((p) => !candidateIds.has(p.id))
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}{p.image ? ' (ya tiene imagen)' : ''}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            className="btn-primary text-xs px-3 py-2"
                            disabled={!item.productId || Boolean(assigningPendingKey)}
                            onClick={() => void assignPendingImage(item.key)}
                          >
                            {busy ? 'Asignando…' : 'Asignar'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs px-3 py-2"
                            disabled={busy}
                            onClick={() => discardPendingImage(item.key)}
                          >
                            Omitir
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" className="btn-primary text-sm" onClick={closeFolderImportModal}>
                {folderImportResult.pending.length ? 'Cerrar (asignar luego)' : 'Entendido'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        title="Editar producto"
        size="md"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs ui-text-muted mb-1">Nombre</label>
            <input
              className="input-field"
              value={productForm.name}
              onChange={(e) => setProductForm((prev) => ({ ...prev, name: formatCatalogNameInput(e.target.value) }))}
            />
          </div>
          <div>
            <label className="block text-xs ui-text-muted mb-1">Precio</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input-field"
              value={productForm.price}
              onChange={(e) => setProductForm((prev) => ({ ...prev, price: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs ui-text-muted mb-1">Categoría</label>
            <select
              className="input-field"
              value={productForm.category_id}
              onChange={(e) => setProductForm((prev) => ({ ...prev, category_id: e.target.value }))}
            >
              <option value="">Seleccione</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setEditingProduct(null)} className="btn-secondary text-sm">Cancelar</button>
            <button type="button" onClick={saveProduct} className="btn-primary text-sm">Guardar</button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={genOpenIndex !== null}
        onClose={closeGenerator}
        title={genOpenIndex !== null && isGeneratedCarta(cartas[genOpenIndex]) ? 'Editar carta del sistema' : 'Generar carta desde texto'}
        size="wide"
        variant="dark"
        maxHeightClass="max-h-[min(98dvh,calc(100dvh-0.5rem))]"
        bodyClassName="flex flex-col min-h-0 overflow-hidden !p-4 sm:!p-5"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 text-[var(--ui-body-text)]">
          <p className="shrink-0 text-[11px] leading-snug text-[var(--ui-muted)] sm:text-xs">
            Una carta por categoría, máximo {CARTA_MAX_PRODUCTS} productos. Escriba{' '}
            <span className="font-mono text-[var(--ui-accent)]">Nombre | descripción  precio</span>
            {' '}o cargue los productos de una categoría.
          </p>
          <div className="shrink-0 space-y-2">
            <p className="text-xs font-medium text-[var(--ui-muted)]">Fondos por color</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {CARTA_BACKGROUND_PRESETS.map((preset) => {
                const selected = genPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyCartaPreset(preset.id)}
                    className={`w-20 shrink-0 rounded-lg border p-1 text-left ${
                      selected
                        ? 'border-[color:var(--ui-accent)] ring-2 ring-[color:var(--ui-accent)]'
                        : 'border-[color:var(--ui-border)]'
                    }`}
                    title={`${preset.name}: texto ${preset.colors.text}, título ${preset.colors.title}, subtítulos ${preset.colors.section}`}
                  >
                    <span
                      className="block h-14 w-full overflow-hidden rounded-md bg-cover bg-center"
                      style={{
                        backgroundColor: preset.colors.bg,
                        backgroundImage: `url(${preset.src})`,
                      }}
                    />
                    <span className="mt-1 block truncate text-center text-[10px] font-medium">{preset.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-xs font-medium text-[var(--ui-muted)]">
                Cargar productos de una categoría
                <select
                  className="input-field mt-0.5 py-1.5 text-sm"
                  value={genCategoryId}
                  onChange={(e) => setGenCategoryId(e.target.value)}
                >
                  <option value="">Elegir categoría…</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-secondary text-sm shrink-0" onClick={loadProductsIntoCarta}>
                Cargar en la carta
              </button>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 xl:flex-row xl:items-end xl:gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="min-w-0 text-[11px] font-medium text-[var(--ui-muted)]">
                Título
                <input
                  className="input-field mt-0.5 py-1.5 text-sm"
                  value={genTitle}
                  onChange={(e) => setGenTitle(e.target.value)}
                  placeholder="Vinos y champán"
                />
              </label>
              <label className="min-w-0 text-[11px] font-medium text-[var(--ui-muted)]">
                Subtítulo
                <input
                  className="input-field mt-0.5 py-1.5 text-sm"
                  value={genStyle.subtitle}
                  onChange={(e) => setGenStyle((s) => ({ ...s, subtitle: e.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label className="min-w-0 text-[11px] font-medium text-[var(--ui-muted)]">
                Sección
                <input
                  className="input-field mt-0.5 py-1.5 text-sm"
                  value={genStyle.sectionLabel}
                  onChange={(e) => setGenStyle((s) => ({ ...s, sectionLabel: e.target.value }))}
                  placeholder="Texto de la sección"
                />
              </label>
              <label className="min-w-0 text-[11px] font-medium text-[var(--ui-muted)]">
                Pie
                <input
                  className="input-field mt-0.5 py-1.5 text-sm"
                  value={genStyle.footer}
                  onChange={(e) => setGenStyle((s) => ({ ...s, footer: e.target.value }))}
                  placeholder="Gracias por su visita"
                />
              </label>
            </div>
            <div className="shrink-0">
              <p className="mb-0.5 text-[11px] font-medium text-[var(--ui-muted)]">Colores</p>
              <div className="flex gap-1.5">
                {[
                  ['title', 'Título', DEFAULT_MENU_CARTA_COLORS.title],
                  ['text', 'Texto', DEFAULT_MENU_CARTA_COLORS.text],
                  ['section', 'Sección', DEFAULT_MENU_CARTA_COLORS.section],
                  ['price', 'Precio', DEFAULT_MENU_CARTA_COLORS.price],
                ].map(([key, label, fallback]) => (
                  <label key={key} className="flex w-14 flex-col gap-0.5 text-[10px] text-[var(--ui-muted)]">
                    {label}
                    <input
                      type="color"
                      value={normalizeHex(genColors[key], fallback)}
                      onChange={(e) => setGenColors((c) => ({ ...c, [key]: e.target.value }))}
                      className="h-8 w-full min-w-0 rounded border border-[color:var(--ui-border)] cursor-pointer bg-[var(--ui-surface-2)] p-0.5"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-[11px] font-medium text-[var(--ui-muted)]">Tamaños</p>
              <div className="flex gap-1.5">
                {[
                  ['titleSize', 'Título', 20, 56],
                  ['subtitleSize', 'Subtít.', 8, 24],
                  ['itemSize', 'Texto', 12, 32],
                  ['sectionSize', 'Sección', 10, 28],
                  ['priceSize', 'Precio', 12, 32],
                ].map(([key, label, min, max]) => (
                  <label key={key} className="min-w-0 flex-1 text-[10px] text-[var(--ui-muted)]">
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={genStyle[key]}
                      onChange={(e) => setGenStyle((s) => ({ ...s, [key]: Number(e.target.value) }))}
                      className="input-field mt-0.5 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-[11px] font-medium text-[var(--ui-muted)]">Márgenes</p>
              <div className="flex gap-1.5">
                {[
                  ['marginLeft', 'Izq.', 40, 200],
                  ['marginRight', 'Der.', 40, 200],
                  ['marginTop', 'Arriba', 30, 220],
                  ['marginBottom', 'Abajo', 30, 180],
                ].map(([key, label, min, max]) => (
                  <label key={key} className="min-w-0 flex-1 text-[10px] text-[var(--ui-muted)]">
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={genStyle[key]}
                      onChange={(e) => setGenStyle((s) => ({ ...s, [key]: Number(e.target.value) }))}
                      className="input-field mt-0.5 py-1 text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-[var(--ui-muted)]">
                {genPreviewMode === 'max' ? 'Vista previa maximizada' : 'Contenido y vista previa'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn-secondary text-xs inline-flex items-center gap-1 py-1.5 px-2"
                  onClick={() => setGenPreviewFull(true)}
                  disabled={!genPreviewUrl}
                >
                  <MdFullscreen />
                  Vista completa
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs inline-flex items-center gap-1 py-1.5 px-2"
                  onClick={() => setGenPreviewMode('max')}
                  disabled={genPreviewMode === 'max'}
                >
                  <MdOpenInFull />
                  Maximizar
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs inline-flex items-center gap-1 py-1.5 px-2"
                  onClick={() => setGenPreviewMode(genPreviewMode === 'split' ? 'min' : 'split')}
                >
                  {genPreviewMode === 'min' ? <MdOpenInFull /> : <MdCloseFullscreen />}
                  {genPreviewMode === 'min' ? 'Restaurar' : 'Minimizar'}
                </button>
              </div>
            </div>
            <div
              className={`grid min-h-0 flex-1 gap-2 ${
                genPreviewMode === 'max'
                  ? 'grid-cols-1'
                  : genPreviewMode === 'min'
                    ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(8rem,11rem)]'
                    : 'grid-cols-1 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]'
              }`}
            >
              {genPreviewMode !== 'max' ? (
                <div className="flex min-h-0 min-w-0 flex-col">
                  <label className="mb-0.5 block shrink-0 text-xs font-medium text-[var(--ui-muted)]">Contenido</label>
                  <div className="flex min-h-[12rem] min-w-0 flex-1 flex-col">
                    <MenuCartaSyntaxEditor
                      value={genText}
                      onChange={setGenText}
                      bgColor={normalizeHex(genColors.bg, DEFAULT_MENU_CARTA_COLORS.bg)}
                      textColor={normalizeHex(genColors.text, DEFAULT_MENU_CARTA_COLORS.text)}
                      sectionColor={normalizeHex(genColors.section, DEFAULT_MENU_CARTA_COLORS.section)}
                    />
                  </div>
                  <div className="mt-2 flex shrink-0 flex-wrap gap-2">
                    <button type="button" onClick={closeGenerator} className="btn-secondary text-sm">
                      Cerrar
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadGeneratedCartaPng()}
                      className="btn-secondary text-sm inline-flex items-center gap-1"
                      disabled={genExporting}
                    >
                      <MdDownload />
                      {genExporting ? 'Preparando…' : 'Descargar PNG A4'}
                    </button>
                    <button type="button" onClick={() => void applyGeneratedCarta()} className="btn-primary text-sm" disabled={!canSave}>
                      Guardar en carta QR
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex min-h-0 min-w-0 flex-col">
                <label className="mb-0.5 block shrink-0 text-xs font-medium text-[var(--ui-muted)]">Vista previa</label>
                <div
                  className={`flex min-w-0 items-start justify-center overflow-auto rounded-xl border border-[color:var(--ui-border)] p-3 ${
                    genPreviewMode === 'min' ? 'min-h-[10rem] h-40' : 'min-h-[32rem] h-[min(72vh,820px)] flex-1'
                  }`}
                  style={{ backgroundColor: normalizeHex(genColors.bg, DEFAULT_MENU_CARTA_COLORS.bg) }}
                >
                  {genPreviewUrl ? (
                    <img
                      src={genPreviewUrl}
                      alt="Vista previa de la carta generada"
                      className={`rounded-lg object-contain object-top ${
                        genPreviewMode === 'min'
                          ? 'max-h-full max-w-full h-full w-auto'
                          : 'h-full w-auto max-w-full'
                      }`}
                    />
                  ) : (
                    <p className="px-4 self-center text-center text-sm text-[var(--ui-muted)]">Escribe platos y precios para ver la vista previa</p>
                  )}
                </div>
              </div>
            </div>
            {genPreviewMode === 'max' ? (
              <div className="mt-2 flex shrink-0 flex-wrap gap-2">
                <button type="button" onClick={closeGenerator} className="btn-secondary text-sm">
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => void downloadGeneratedCartaPng()}
                  className="btn-secondary text-sm inline-flex items-center gap-1"
                  disabled={genExporting}
                >
                  <MdDownload />
                  {genExporting ? 'Preparando…' : 'Descargar PNG A4'}
                </button>
                <button type="button" onClick={() => void applyGeneratedCarta()} className="btn-primary text-sm" disabled={!canSave}>
                  Guardar en carta QR
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
      {cartaFullIndex != null && cartas[cartaFullIndex] ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/90">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
            <p className="text-sm font-medium">{cartas[cartaFullIndex].name || 'Carta'}</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              onClick={() => setCartaFullIndex(null)}
            >
              <MdFullscreenExit />
              Cerrar
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 flex items-center justify-center">
            {isGeneratedCarta(cartas[cartaFullIndex]) ? (
              <CartaPreviewMedia
                carta={cartas[cartaFullIndex]}
                className="max-h-[calc(100dvh-5rem)] max-w-full object-contain rounded-lg shadow-2xl"
              />
            ) : cartas[cartaFullIndex].url ? (
              <img
                src={resolveMediaUrl(cartas[cartaFullIndex].url)}
                alt={cartas[cartaFullIndex].name || 'Carta'}
                className="max-h-[calc(100dvh-5rem)] max-w-full object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <p className="py-16 text-center text-sm text-white/70">No hay carta</p>
            )}
          </div>
        </div>
      ) : null}
      {genPreviewFull ? (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black/90">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
            <p className="text-sm font-medium">Vista completa de la carta</p>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
              onClick={() => setGenPreviewFull(false)}
            >
              <MdFullscreenExit />
              Cerrar
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            {genPreviewUrl ? (
              <img
                src={genPreviewUrl}
                alt="Vista completa de la carta"
                className="mx-auto h-auto w-auto max-w-full rounded-lg shadow-2xl"
                style={{ maxHeight: 'none', minHeight: '80vh' }}
              />
            ) : (
              <p className="py-16 text-center text-sm text-white/70">No hay vista previa</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
