import { MdCallMerge, MdPerson } from 'react-icons/md';
import { formatMesaMapTableNumber, getTableDisplayLabel, splitTableNameLabel } from '../utils/mesaMapTableVisual';

function nameSizeClass(text) {
  const longestWord = String(text || '').split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0);
  const len = String(text || '').length;
  if (longestWord > 11 || len > 22) return 'rf-mesa-map-tile__name--xs';
  if (longestWord > 8 || len > 14) return 'rf-mesa-map-tile__name--sm';
  return '';
}

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
  const isNameLabel = String(table?.display_label || '').toLowerCase() === 'name'
    && String(table?.name || '').trim();
  const nameParts = isNameLabel ? splitTableNameLabel(numberLabel) : null;

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
      title={getTableDisplayLabel(table)}
    >
      <div className="rf-mesa-map-tile__table">
        {visualState === 'united' ? (
          <MdCallMerge className="rf-mesa-map-tile__union-icon" aria-hidden="true" />
        ) : null}
        {nameParts ? (
          <span className="rf-mesa-map-tile__name-block">
            <span className={['rf-mesa-map-tile__name', nameSizeClass(nameParts.prefix)].filter(Boolean).join(' ')}>
              {nameParts.prefix}
            </span>
            {nameParts.number ? (
              <span className="rf-mesa-map-tile__number rf-mesa-map-tile__number--suffix">{nameParts.number}</span>
            ) : null}
          </span>
        ) : (
          <span className="rf-mesa-map-tile__number">{numberLabel}</span>
        )}
        <span className="rf-mesa-map-tile__capacity">
          <MdPerson className="rf-mesa-map-tile__capacity-icon" aria-hidden="true" />
          {capacityLabel}
        </span>
      </div>
    </button>
  );
}
