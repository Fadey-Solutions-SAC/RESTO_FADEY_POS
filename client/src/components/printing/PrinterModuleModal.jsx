import Modal from '../Modal';
import PrinterModulePanel from './PrinterModulePanel';
import { PRINTING_MODULE_LABELS } from '../../utils/printingConfig';

export default function PrinterModuleModal({ isOpen, onClose, moduleKey, moduleLabel: moduleLabelProp }) {
  const moduleLabel = moduleLabelProp || PRINTING_MODULE_LABELS[moduleKey] || moduleKey;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Impresora — ${moduleLabel}`}
      size="lg"
    >
      <PrinterModulePanel moduleKey={moduleKey} showLinkSection />
    </Modal>
  );
}
