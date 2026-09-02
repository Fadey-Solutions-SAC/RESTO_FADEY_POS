import { MdCallMerge } from 'react-icons/md';
import {
  formatMesaMapTableNumber,
  splitChairsPerSide,
} from '../utils/mesaMapTableVisual';

function MesaChairsRow({ count }) {
  if (!count) return null;
  return (
    <div className="rf-mesa-map-tile__chairs-row" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="rf-mesa-map-chair" />
      ))}
    </div>
  );
}

function MesaChairsCol({ count }) {
  if (!count) return null;
  return (
    <div className="rf-mesa-map-tile__chairs-col" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="rf-mesa-map-chair" />
      ))}
    </div>
  );
}

/**
 * Mesa cuadrada con sillas alrededor para el mapa de caja.
 */
export default function MesaMapTableTile({
  table,
  visualState = 'available',
  chairCount = 4,
  selected = false,
  unitePicked = false,
  onClick,
  className = '',
}) {
  const [top, right, bottom, left] = splitChairsPerSide(chairCount);
  const numberLabel = formatMesaMapTableNumber(table);
  const capacityLabel = String(chairCount);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rf-mesa-map-tile',
        `rf-mesa-map-tile--${visualState}`,
        selected ? 'rf-mesa-map-tile--selected' : '',
        unitePicked ? 'rf-mesa-map-tile--unite-pick' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={table?.name || `Mesa ${numberLabel}`}
    >
      <MesaChairsRow count={top} />
      <div className="rf-mesa-map-tile__middle">
        <MesaChairsCol count={left} />
        <div className="rf-mesa-map-tile__table">
          {visualState === 'united' ? (
            <MdCallMerge className="rf-mesa-map-tile__union-icon" aria-hidden="true" />
          ) : null}
          <span className="rf-mesa-map-tile__number">{numberLabel}</span>
          <span className="rf-mesa-map-tile__capacity">{capacityLabel}</span>
        </div>
        <MesaChairsCol count={right} />
      </div>
      <MesaChairsRow count={bottom} />
    </button>
  );
}
