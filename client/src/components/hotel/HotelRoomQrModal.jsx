import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { downloadTableQrPng, selfOrderUrl } from '../../utils/tableQrPrint';

/** El clic muestra el QR. La descarga está dentro de esa vista. */
export default function HotelRoomQrModal({ room, onClose }) {
  const [src, setSrc] = useState('');
  const url = room ? selfOrderUrl(room.number, 'habitacion') : '';

  useEffect(() => {
    if (!room) {
      setSrc('');
      return undefined;
    }
    let alive = true;
    QRCode.toDataURL(url, { width: 280, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => { if (alive) setSrc(data); })
      .catch(() => { if (alive) toast.error('No se pudo mostrar el QR'); });
    return () => { alive = false; };
  }, [room, url]);

  const download = async () => {
    if (!room) return;
    try {
      await downloadTableQrPng({
        url,
        title: `Habitación ${room.number}`,
        subtitle: 'Auto pedido',
      });
    } catch (err) {
      toast.error(err.message || 'No se pudo descargar el QR');
    }
  };

  return (
    <Modal isOpen={Boolean(room)} onClose={onClose} title={`QR · Habitación ${room?.number || ''}`} size="sm">
      <div className="flex flex-col items-center gap-4">
        {src ? (
          <img src={src} alt={`QR de la habitación ${room?.number || ''}`} className="w-56 h-56 bg-white rounded-xl p-2" />
        ) : (
          <div className="w-56 h-56 flex items-center justify-center"><div className="rf-loader rf-loader--md" /></div>
        )}
        <p className="text-sm text-center text-[var(--ui-muted)]">El huésped escanea este código para pedir a la habitación.</p>
        <button type="button" className="btn-primary w-full" onClick={download} disabled={!src}>Descargar</button>
      </div>
    </Modal>
  );
}
