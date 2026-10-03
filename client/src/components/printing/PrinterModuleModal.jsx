import Modal from '../Modal';
import PrinterModulePanel from './PrinterModulePanel';
import { PRINTING_MODULE_LABELS } from '../../utils/printingConfig';

/** `children`: ajustes propios del módulo (p. ej. área de producción), mostrados antes de la impresora. */
export default function PrinterModuleModal({
  isOpen,
  onClose,
  moduleKey,
  moduleLabel: moduleLabelProp,
  children,
  printerTitle,
}) {
  const moduleLabel = moduleLabelProp || PRINTING_MODULE_LABELS[moduleKey] || moduleKey;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Configuración — ${moduleLabel}`}
      size="lg"
    >
      {children ? (
        <div className="space-y-4">
          {children}
          <div className="space-y-2">
            {printerTitle ? (
              <p className="text-sm font-semibold text-[var(--ui-body-text)]">{printerTitle}</p>
            ) : null}
            <PrinterModulePanel moduleKey={moduleKey} showLinkSection />
          </div>
        </div>
      ) : (
        <PrinterModulePanel moduleKey={moduleKey} showLinkSection showSoundControl />
      )}
    </Modal>
  );
}
