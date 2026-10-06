import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdSettings } from 'react-icons/md';
import { api } from '../../utils/api';
import { getOwnProductionAreaId } from '../../utils/staffModuleAccess';
import { useProductionAreaSettings } from '../../hooks/useProductionAreaSettings';
import ProductionAreaSettingsSection from './ProductionAreaSettingsSection';

/** Mi perfil (cocina / bar / producción): mismos ajustes de avisos y demora que en el panel del área. */
export default function ProductionAreaProfileCard({ user }) {
  const { t } = useTranslation('kitchen');
  const areaId = getOwnProductionAreaId(user);
  const [areaName, setAreaName] = useState('');
  const { settings, loaded, saving, save } = useProductionAreaSettings(areaId, user);

  useEffect(() => {
    if (!areaId || areaId === 'cocina' || areaId === 'bar') return undefined;
    let cancelled = false;
    api.get('/production-areas')
      .then((list) => {
        if (cancelled) return;
        const match = (Array.isArray(list) ? list : []).find((a) => String(a?.id) === areaId);
        setAreaName(String(match?.name || '').trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [areaId]);

  if (!areaId) return null;
  const stationLabel = areaId === 'bar'
    ? t('panel.stationBar')
    : areaId === 'cocina'
      ? t('panel.stationKitchen')
      : (areaName || areaId);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm space-y-3">
      <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <MdSettings className="text-blue-600" /> Avisos de mi área · {stationLabel}
      </p>
      <ProductionAreaSettingsSection
        settings={settings}
        loaded={loaded}
        saving={saving}
        onSave={save}
        stationLabel={stationLabel}
        soundType={areaId === 'bar' ? 'bar' : 'kitchen'}
      />
    </div>
  );
}
