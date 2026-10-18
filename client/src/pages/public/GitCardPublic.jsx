import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getApiBase } from '../../utils/api';
import GitCardVisual from '../../components/GitCardVisual';

export default function GitCardPublic() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${getApiBase()}/public/git-cards/${encodeURIComponent(token)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Enlace no válido');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setData({ error: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <div className="min-h-screen bg-slate-100 p-6 text-center text-slate-500">Cargando GIT Cards...</div>;
  }
  if (data?.error) {
    return <div className="min-h-screen bg-slate-100 p-6 text-center text-rose-600">{data.error}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <GitCardVisual card={data.card} />
        {data.card?.info_text ? (
          <p className="text-sm text-slate-600">{data.card.info_text}</p>
        ) : null}
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          {data.next_step || data.card?.next_step}
        </p>
        {(data.rewards || []).length ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">Recompensas</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {data.rewards.map((r, i) => (
                <li key={`${r.title}-${i}`}>{r.title} · {r.status}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {data.survey_required && !data.survey_done ? (
          <Link
            to="/encuesta"
            className="block rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700"
          >
            Completar encuesta de fidelización
          </Link>
        ) : (
          <Link to="/encuesta" className="block text-center text-sm font-medium text-blue-700 underline">
            Volver a fidelización
          </Link>
        )}
      </div>
    </div>
  );
}
