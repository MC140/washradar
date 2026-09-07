import {Heart} from 'lucide-react';
import {Link} from 'react-router-dom';
import {WashCard} from '../components/WashCard';
import {useWashRadar} from '../state/WashRadarContext';

export function SavedPage() {
  const {washes, favourites, toggleFavourite} = useWashRadar();
  const saved = washes.filter((wash) => favourites.includes(wash.id));
  return <><section className="page-heading"><p className="eyebrow">YOUR REGULAR SPOTS</p><h1>Saved washes.</h1><p>Keep your favourites close and compare today’s conditions.</p></section>
    {saved.length ? <div className="cards-grid">{saved.map((wash) => <WashCard key={wash.id} wash={wash} saved onSave={() => void toggleFavourite(wash.id)} />)}</div> : <section className="empty-state"><Heart size={30} /><h2>No saved washes yet.</h2><p>Tap the heart on a wash to find it here.</p><Link className="secondary-button" to="/">Explore nearby washes</Link></section>}</>;
}
