import { useState, useEffect, useRef, useCallback } from 'react';
import { api, resolveMediaUrl } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { MdAdd, MdDelete, MdSave, MdContentCopy, MdUploadFile, MdRestaurantMenu, MdEdit, MdVisibility, MdVisibilityOff, MdFolderOpen, MdDownload, MdPrint } from 'react-icons/md';
import QRCode from 'qrcode';
import { downloadTableQrA5, normalizeQrSlot, printTableQrA5Sheets, suggestFormatQrSlot } from '../../utils/tableQrPrint';
import { QR_PRINT_FORMATS, qrPrintFormatBySrc } from '../../data/qrPrintFormats';
import CartasHorizontalCarousel from '../../components/CartasHorizontalCarousel';
import Modal from '../../components/Modal';
import {
  parseMenuLines,
  buildMenuCartaSvgBlob,
  DEFAULT_MENU_CARTA_COLORS,
  normalizeHex,
} from '../../utils/generateMenuCartaSvg';
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
Ceviche clásico  28
Wantán frito  18

# Platos fuertes
Lomo saltado  38
Ají de gallina  32

Postres
Helado de vainilla  10`;

function selfOrderUrlForTable(number) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/auto-pedido?mesa=${encodeURIComponent(String(number))}`;
}

function signNamePreviewPx(name) {
  const len = Math.max(1, String(name || '').trim().length);
  return Math.max(6, Math.min(11, 72 / (len * 0.55)));
}

function QrSlotEditor({ imageUrl, slot, sampleNumber, onDragStart, onChange, onCommit, onUseFrame, placing, logoUrl, logoSlot, logoShape, restaurantName }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const [preview, setPreview] = useState('');
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;

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
      onChangeRef.current(next);
    };
    const up = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      onCommitRef.current(drag.current || drag.slot);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const start = (event, mode) => {
    if (!slot || !frameRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === 'move') event.currentTarget.focus();
    onDragStart?.();
    dragRef.current = {
      mode,
      px: event.clientX,
      py: event.clientY,
      slot: { ...slot },
      current: { ...slot },
      rect: frameRef.current.getBoundingClientRect(),
    };
  };

  const nudge = (event) => {
    if (!slot) return;
    const step = event.shiftKey ? 0.02 : 0.004;
    let next = null;
    if (event.key === 'ArrowLeft') next = normalizeQrSlot({ ...slot, x: slot.x - step });
    if (event.key === 'ArrowRight') next = normalizeQrSlot({ ...slot, x: slot.x + step });
    if (event.key === 'ArrowUp') next = normalizeQrSlot({ ...slot, y: slot.y - step });
    if (event.key === 'ArrowDown') next = normalizeQrSlot({ ...slot, y: slot.y + step });
    if (!next) return;
    event.preventDefault();
    onChange(next);
    onCommit(next);
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          ref={frameRef}
          className="relative mx-auto w-full max-w-[260px] shrink-0 bg-white rounded-lg border border-slate-200"
        >
          <img src={imageUrl} alt="Formato de impresión" className="block w-full h-auto select-none" draggable={false} />
          {logoSlot ? (
            <div
              className="absolute overflow-hidden pointer-events-none"
              style={{
                left: `${logoSlot.x * 100}%`,
                top: `${logoSlot.y * 100}%`,
                width: `${logoSlot.w * 100}%`,
                height: `${logoSlot.h * 100}%`,
                borderRadius: logoShape === 'roundrect' ? '16%' : '50%',
                background: '#f6ead2',
              }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt=""
                  className="absolute left-[14%] object-cover"
                  style={{
                    top: restaurantName ? '6%' : '8%',
                    width: '72%',
                    height: restaurantName ? '56%' : '84%',
                    borderRadius: logoShape === 'roundrect' ? '12%' : '50%',
                  }}
                />
              ) : null}
              {restaurantName ? (
                <span
                  className="absolute left-[14%] right-[14%] text-center font-bold leading-none text-[#3f2a16]"
                  style={{ bottom: '10%', fontSize: `${signNamePreviewPx(restaurantName)}px` }}
                >
                  {restaurantName}
                </span>
              ) : null}
            </div>
          ) : null}
          {slot ? (
            <div
              tabIndex={0}
              aria-label="Lugar del código QR. Arrastre para moverlo."
              className="absolute border-2 border-violet-600 cursor-move touch-none outline-none focus:ring-2 focus:ring-violet-400"
              style={{
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
              }}
              onPointerDown={(e) => start(e, 'move')}
              onKeyDown={nudge}
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
                onPointerDown={(e) => start(e, 'resize')}
                aria-hidden
              />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-medium rf-section-title">Lugar del QR</p>
          <p className="mt-1 text-xs text-[var(--ui-muted)]">
            Arrastre el recuadro hasta el marco del diseño. La esquina violeta cambia el tamaño. Con el recuadro seleccionado, las flechas lo mueven con más precisión.
            {logoUrl
              ? ' El logo de Mi Restaurante se recorta al letrero de arriba.'
              : ' Configure el logo en Mi Restaurante para colocarlo en el letrero.'}
          </p>
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
  const [genColors, setGenColors] = useState(() => ({ ...DEFAULT_MENU_CARTA_COLORS }));
  const [showProductCatalog, setShowProductCatalog] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [folderImportResult, setFolderImportResult] = useState(null);
  const [showFolderImportModal, setShowFolderImportModal] = useState(false);
  const [assigningPendingKey, setAssigningPendingKey] = useState('');
  const [printingQrTableId, setPrintingQrTableId] = useState('');
  const [qrHome, setQrHome] = useState('productos');
  const [qrFormat, setQrFormat] = useState('');
  const [qrSlot, setQrSlot] = useState(null);
  const [restaurantLogo, setRestaurantLogo] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [qrDataReady, setQrDataReady] = useState(false);
  const [placingQrSlot, setPlacingQrSlot] = useState(false);
  const [uploadingQrFormat, setUploadingQrFormat] = useState(false);
  const draggingSlotRef = useRef(false);
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
          setQrFormat(String(cData?.qr_format || '').trim());
          if (!draggingSlotRef.current) setQrSlot(normalizeQrSlot(cData?.qr_slot));
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
    if (['auto_pedido_qr_format', 'auto_pedido_qr_slot'].includes(d) && Date.now() < qrEchoUntilRef.current) return;
    if (['auto_pedido_cartas', 'auto_pedido_qr_home', 'auto_pedido_qr_format', 'auto_pedido_qr_slot', 'modifiers', 'discounts', 'offers', 'combos', 'catalog'].includes(d)) {
      void load({ silent: true });
    }
  });
  useSocket('inventory-update', () => {
    void load({ silent: true });
  });

  useEffect(() => {
    if (genOpenIndex === null) return undefined;
    const rows = parseMenuLines(genText);
    const blob = buildMenuCartaSvgBlob({
      rows,
      title: genTitle.trim() || 'Nuestra carta',
      colors: genColors,
    });
    const url = URL.createObjectURL(blob);
    setGenPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [genOpenIndex, genText, genTitle, genColors]);

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
    if (next.some((c) => !String(c.url || '').trim())) {
      toast('Carta quitada. Complete las demás y pulse Guardar para confirmar.');
      return;
    }
    await persistCartas(next, 'Carta eliminada');
  };

  const openGenerator = (index) => {
    setGenTitle('Nuestra carta');
    setGenText(MENU_GEN_PLACEHOLDER);
    setGenColors({ ...DEFAULT_MENU_CARTA_COLORS });
    setGenOpenIndex(index);
  };

  const closeGenerator = () => {
    setGenOpenIndex(null);
    setGenPreviewUrl('');
  };

  const applyGeneratedCarta = async () => {
    if (!canSave || genOpenIndex === null) return;
    const rows = parseMenuLines(genText);
    if (!rows.some((r) => r.kind === 'item' && r.price != null && Number.isFinite(Number(r.price)))) {
      toast.error('Añade al menos una línea con precio al final (ej. Lomo saltado  35)');
      return;
    }
    const tid = toast.loading('Generando y subiendo…');
    try {
      const blob = buildMenuCartaSvgBlob({
        rows,
        title: genTitle.trim() || 'Nuestra carta',
        colors: genColors,
      });
      const file = new File([blob], `carta-${Date.now()}.svg`, { type: 'image/svg+xml' });
      const { url } = await api.upload(file);
      markCartasEdited();
      updateRow(genOpenIndex, 'url', url || '');
      toast.success('Carta generada aplicada. Pulsa Guardar para persistir.', { id: tid });
      closeGenerator();
    } catch (err) {
      toast.error(err.message || 'No se pudo subir la carta', { id: tid });
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

  const persistCartas = async (list, successMessage) => {
    if (!canSave) return;
    const tid = toast.loading('Guardando…');
    try {
      const normalized = list.map((c, i) => ({
        id: String(c.id || '').startsWith('tmp-') ? '' : c.id,
        name: c.name || `Carta ${i + 1}`,
        url: String(c.url || '').trim(),
        sort: i,
      }));
      const invalid = normalized.find((c) => !c.url);
      if (invalid) {
        toast.error('Cada carta debe tener una URL válida', { id: tid });
        return;
      }
      const data = await api.put('/admin-modules/auto-pedido/cartas', { cartas: normalized });
      loadSeqRef.current += 1;
      cartasDirtyRef.current = false;
      setCartas(data.cartas || normalized);
      toast.success(successMessage, { id: tid });
    } catch (e) {
      toast.error(e.message || 'No se pudo guardar', { id: tid });
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
      setQrFormat(String(data?.qr_format || url || '').trim());
      setQrSlot(normalizeQrSlot(data?.qr_slot));
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
      toast.success('Formato quitado');
    } catch (err) {
      toast.error(err.message || 'No se pudo quitar el formato');
    } finally {
      setUploadingQrFormat(false);
    }
  };

  const logoPlacement = () => {
    const preset = qrPrintFormatBySrc(qrFormat);
    const url = resolveMediaUrl(restaurantLogo);
    if (!url) return null;
    return {
      url,
      name: restaurantName,
      slot: preset?.logo || { x: 0.32, y: 0.05, w: 0.36, h: 0.13 },
      shape: preset?.logoShape || 'ellipse',
    };
  };

  const chooseQrFormat = async (format) => {
    if (!format || uploadingQrFormat) return;
    if (qrPrintFormatBySrc(qrFormat)?.id === format.id) return;
    qrEchoUntilRef.current = Date.now() + 2500;
    setQrFormat(format.src);
    setQrSlot(format.qr);
    if (!canSave) return;
    try {
      await api.put('/admin-modules/auto-pedido/qr-format', { qr_format: format.src });
      await api.put('/admin-modules/auto-pedido/qr-slot', { qr_slot: format.qr });
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
    } catch (err) {
      toast.error(err.message || 'No se pudo descargar el QR');
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
    const tid = toast.loading(sheets.length > 1 ? 'Preparando hojas A5…' : 'Preparando hoja A5…');
    try {
      await printTableQrA5Sheets(sheets, formatImageUrl, qrSlot, logoPlacement());
      toast.success(sheets.length > 1 ? `${sheets.length} hojas A5 listas para imprimir` : 'Hoja A5 lista para imprimir', { id: tid });
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
        <div className="flex flex-col lg:flex-row gap-6 lg:items-stretch">
          <div className="lg:w-[min(100%,420px)] shrink-0 rounded-xl border border-slate-200 bg-[var(--ui-surface)] overflow-hidden min-h-[280px] lg:min-h-[460px] flex flex-col">
            <CartasHorizontalCarousel cartas={cartas} className="flex-1 min-h-0" />
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="text-lg font-semibold rf-section-title">Cartas</h2>
              <div className="flex gap-2">
                <button type="button" onClick={addRow} className="btn-secondary text-sm inline-flex items-center gap-1">
                  <MdAdd /> Añadir
                </button>
                {canSave ? (
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
            <div className="space-y-3">
              {cartas.length === 0 && (
                <p className="ui-text-muted text-sm">No hay cartas. Añade una y sube un archivo o indica una URL.</p>
              )}
              {cartas.map((c, i) => (
                <div key={c.id || i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end border border-slate-200 rounded-lg p-3">
                  <div className="md:col-span-3">
                    <label className="block text-xs ui-text-muted mb-1">Nombre</label>
                    <input
                      className="input-field"
                      value={c.name}
                      onChange={(e) => updateRow(i, 'name', e.target.value)}
                      disabled={!canSave}
                    />
                  </div>
                  <div className="md:col-span-6">
                    <label className="block text-xs ui-text-muted mb-1">URL (imagen o PDF)</label>
                    <input
                      className="input-field font-mono text-sm"
                      value={c.url}
                      onChange={(e) => updateRow(i, 'url', e.target.value)}
                      placeholder="https://…, /cartas/… o /uploads/…"
                      disabled={!canSave}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <span className="block text-xs ui-text-muted mb-1">Archivo</span>
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
                      className={`btn-secondary text-sm w-full inline-flex items-center justify-center gap-1 py-2 ${!canSave ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                    >
                      <MdUploadFile className="text-lg shrink-0" />
                      Subir
                    </label>
                  </div>
                  <div className="md:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void removeRow(i)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      disabled={!canSave}
                      aria-label="Eliminar"
                    >
                      <MdDelete className="text-xl" />
                    </button>
                  </div>
                  <div className="md:col-span-12 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => openGenerator(i)}
                      className="text-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 font-medium disabled:opacity-50"
                      disabled={!canSave}
                    >
                      <MdRestaurantMenu className="text-lg" />
                      Generar carta desde texto (platos y precios)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold rf-section-title">Enlaces y QR por mesa</h2>
            <p className="text-xs text-[var(--ui-muted)] mt-1 max-w-xl">
              Elija un formato de la fila. El QR de cada mesa va en el recuadro y el logo de Mi Restaurante en el letrero de arriba. La hoja completa solo sale al descargar o imprimir.
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
            restaurantName={restaurantName}
            logoSlot={qrPrintFormatBySrc(qrFormat)?.logo}
            logoShape={qrPrintFormatBySrc(qrFormat)?.logoShape || 'ellipse'}
            sampleNumber={tables[0]?.number ?? '1'}
            placing={placingQrSlot}
            onDragStart={() => { draggingSlotRef.current = true; }}
            onChange={setQrSlot}
            onCommit={(slot) => {
              draggingSlotRef.current = false;
              setQrSlot(slot);
              void saveQrSlot(slot);
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
        title="Generar carta desde texto"
        size="wide"
        variant="dark"
        maxHeightClass="max-h-[min(98dvh,calc(100dvh-0.5rem))]"
        bodyClassName="flex flex-col min-h-0 overflow-hidden !p-4 sm:!p-5"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 text-[var(--ui-body-text)]">
          <p className="shrink-0 text-[11px] leading-snug text-[var(--ui-muted)] sm:text-xs">
            Una línea por plato y precio al final (opcional <span className="font-mono text-[var(--ui-accent)]">S/</span>). Categoría solo si la línea empieza por{' '}
            <span className="font-mono text-[var(--ui-accent)]">#</span>.
          </p>
          <div className="grid shrink-0 grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,260px)] lg:gap-3">
            <div>
              <label className="mb-0.5 block text-xs font-medium text-[var(--ui-muted)]">Título de la carta</label>
              <input
                className="input-field py-1.5 text-sm"
                value={genTitle}
                onChange={(e) => setGenTitle(e.target.value)}
                placeholder="Nuestra carta"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--ui-muted)]">Colores</p>
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-[var(--ui-muted)]">
                  Fondo
                  <input
                    type="color"
                    value={normalizeHex(genColors.bg, DEFAULT_MENU_CARTA_COLORS.bg)}
                    onChange={(e) => setGenColors((c) => ({ ...c, bg: e.target.value }))}
                    className="h-9 w-full min-w-0 rounded border border-[color:var(--ui-border)] cursor-pointer bg-[var(--ui-surface-2)] p-0.5"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--ui-muted)]">
                  Texto
                  <input
                    type="color"
                    value={normalizeHex(genColors.text, DEFAULT_MENU_CARTA_COLORS.text)}
                    onChange={(e) => setGenColors((c) => ({ ...c, text: e.target.value }))}
                    className="h-9 w-full min-w-0 rounded border border-[color:var(--ui-border)] cursor-pointer bg-[var(--ui-surface-2)] p-0.5"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--ui-muted)]">
                  Líneas #
                  <input
                    type="color"
                    value={normalizeHex(genColors.section, DEFAULT_MENU_CARTA_COLORS.section)}
                    onChange={(e) => setGenColors((c) => ({ ...c, section: e.target.value }))}
                    className="h-9 w-full min-w-0 rounded border border-[color:var(--ui-border)] cursor-pointer bg-[var(--ui-surface-2)] p-0.5"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--ui-muted)]">
                  Precios
                  <input
                    type="color"
                    value={normalizeHex(genColors.price, DEFAULT_MENU_CARTA_COLORS.price)}
                    onChange={(e) => setGenColors((c) => ({ ...c, price: e.target.value }))}
                    className="h-9 w-full min-w-0 rounded border border-[color:var(--ui-border)] cursor-pointer bg-[var(--ui-surface-2)] p-0.5"
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
            <div className="mb-0.5 hidden shrink-0 items-end gap-3 xl:grid xl:grid-cols-2">
              <label className="block text-xs font-medium text-[var(--ui-muted)]">Contenido</label>
              <label className="block text-xs font-medium text-[var(--ui-muted)]">Vista previa</label>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-3">
              <div className="flex min-h-0 flex-1 flex-col">
                <label className="mb-0.5 block shrink-0 text-xs font-medium text-[var(--ui-muted)] xl:sr-only">Contenido</label>
                <div className="flex min-h-0 flex-1 flex-col">
                  <MenuCartaSyntaxEditor
                    value={genText}
                    onChange={setGenText}
                    bgColor={normalizeHex(genColors.bg, DEFAULT_MENU_CARTA_COLORS.bg)}
                    textColor={normalizeHex(genColors.text, DEFAULT_MENU_CARTA_COLORS.text)}
                    sectionColor={normalizeHex(genColors.section, DEFAULT_MENU_CARTA_COLORS.section)}
                  />
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <label className="mb-0.5 block shrink-0 text-xs font-medium text-[var(--ui-muted)] xl:sr-only">Vista previa</label>
                <div
                  className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-[color:var(--ui-border)] p-3"
                  style={{ backgroundColor: normalizeHex(genColors.bg, DEFAULT_MENU_CARTA_COLORS.bg) }}
                >
                  {genPreviewUrl ? (
                    <img
                      src={genPreviewUrl}
                      alt="Vista previa de la carta generada"
                      className="max-h-full max-w-full h-auto w-auto rounded-lg object-contain"
                    />
                  ) : (
                    <p className="px-4 text-center text-sm text-[var(--ui-muted)]">Escribe platos y precios para ver la vista previa</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[color:var(--ui-border)] pt-2">
            <button type="button" onClick={closeGenerator} className="btn-secondary text-sm">
              Cerrar
            </button>
            <button type="button" onClick={applyGeneratedCarta} className="btn-primary text-sm" disabled={!canSave}>
              Subir y aplicar a «{genOpenIndex !== null ? cartas[genOpenIndex]?.name || 'esta carta' : ''}»
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
