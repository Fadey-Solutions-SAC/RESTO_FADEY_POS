import { MdCallMerge, MdPerson } from 'react-icons/md';
import { formatMesaMapTableNumber } from '../utils/mesaMapTableVisual';

/**
 * Mesa cuadrada para el mapa de caja (sin sillas).
 * La capacidad se muestra con un ícono de persona.
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
      <div className="rf-mesa-map-tile__table">
        {visualState === 'united' ? (
          <MdCallMerge className="rf-mesa-map-tile__union-icon" aria-hidden="true" />
        ) : null}
        <span className="rf-mesa-map-tile__number">{numberLabel}</span>
        <span className="rf-mesa-map-tile__capacity">
          <MdPerson className="rf-mesa-map-tile__capacity-icon" aria-hidden="true" />
          {capacityLabel}
        </span>
      </div>
    </button>
  );
}
