import { MdBed } from 'react-icons/md';

export const HOTEL_MAP_ZONE = 'hotel';

function roomState(room) {
  if (room?.status === 'occupied') return 'occupied';
  if (room?.status === 'maintenance') return 'maintenance';
  return 'available';
}

function stateLabel(state) {
  if (state === 'occupied') return 'Ocupada';
  if (state === 'maintenance') return 'Mant.';
  return 'Libre';
}

export default function HotelRoomTile({ room, selected = false, onClick }) {
  const state = roomState(room);
  const number = String(room?.number || '').trim();
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rf-hotel-room-tile',
        `rf-hotel-room-tile--${state}`,
        selected ? 'rf-hotel-room-tile--selected' : '',
      ].filter(Boolean).join(' ')}
      title={`Habitación ${number}`}
    >
      <span className="rf-hotel-room-tile__room">
        <MdBed aria-hidden="true" />
        <span className="rf-hotel-room-tile__number">{number}</span>
        <span className="rf-hotel-room-tile__meta">{stateLabel(state)}</span>
      </span>
    </button>
  );
}

export function HotelRoomMap({ rooms, onOpen, emptyText = 'No hay habitaciones en esta zona' }) {
  if (!rooms?.length) {
    return <p className="py-16 text-center text-sm text-[var(--ui-muted)]">{emptyText}</p>;
  }
  return (
    <>
      <div className="rf-mesa-map-legend shrink-0">
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#22c55e' }} />
          Libre
        </span>
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#f97316' }} />
          Ocupada
        </span>
        <span className="rf-mesa-map-legend__item">
          <span className="rf-mesa-map-legend__dot" style={{ background: '#9ca3af' }} />
          Mantenimiento
        </span>
      </div>
      <div className="rf-mesa-map-grid">
        {rooms.map((room) => (
          <HotelRoomTile key={room.id} room={room} onClick={() => onOpen(room)} />
        ))}
      </div>
    </>
  );
}
