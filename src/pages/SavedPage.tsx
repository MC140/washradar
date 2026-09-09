import {Heart} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {WashCard} from '../components/WashCard';
import type {RankedWash} from '../domain/models';
import {loadWashDetail} from '../services/washDetail';
import {useWashRadar} from '../state/WashRadarContext';

export function SavedPage() {
  const {washes, favourites, toggleFavourite} = useWashRadar();
  const [fallbackWashes, setFallbackWashes] = useState<Record<string, RankedWash>>({});
  const [loadingFallbacks, setLoadingFallbacks] = useState(false);

  const contextById = useMemo(() => new Map(washes.map((wash) => [wash.id, wash])), [washes]);

  useEffect(() => {
    const missing = favourites.filter((id) => !contextById.has(id) && !fallbackWashes[id]);
    if (!missing.length) return;
    let cancelled = false;
    setLoadingFallbacks(true);
    void Promise.all(missing.map(async (id) => [id, (await loadWashDetail(id)).wash] as const))
      .then((items) => {
        if (cancelled) return;
        setFallbackWashes((current) => {
          const next = {...current};
          for (const [id, wash] of items) if (wash) next[id] = wash;
          return next;
        });
      })
      .finally(() => { if (!cancelled) setLoadingFallbacks(false); });
    return () => { cancelled = true; };
  }, [contextById, fallbackWashes, favourites]);

  const saved = favourites.map((id) => contextById.get(id) ?? fallbackWashes[id]).filter((wash): wash is RankedWash => Boolean(wash));
  const hasSavedIds = favourites.length > 0;

  return <><section className="page-heading"><p className="eyebrow">YOUR REGULAR SPOTS</p><h1>Saved washes.</h1><p>Keep your favourites close and compare today’s conditions.</p></section>
    {saved.length ? <div className="cards-grid">{saved.map((wash) => contextById.has(wash.id)
      ? <WashCard key={wash.id} wash={wash} saved onSave={() => void toggleFavourite(wash.id)} />
      : <article className="panel" key={wash.id}><p className="eyebrow">SAVED WASH</p><h2>{wash.name}</h2><p>{wash.address}, {wash.city}</p><p>Set your location on Explore to compare current distance and nearby conditions.</p><div className="card-actions"><button className="text-button" onClick={() => void toggleFavourite(wash.id)}>Remove</button><Link className="secondary-button" to={'/wash/' + wash.id}>Details</Link></div></article>)}</div>
      : hasSavedIds && loadingFallbacks
        ? <section className="empty-state"><Heart size={30} /><h2>Loading saved washes…</h2><p>Restoring your saved locations.</p></section>
        : <section className="empty-state"><Heart size={30} /><h2>No saved washes yet.</h2><p>Tap the heart on a wash to find it here.</p><Link className="secondary-button" to="/">Explore nearby washes</Link></section>}</>;
}
