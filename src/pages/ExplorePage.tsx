import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {ChevronRight, CloudSun, List, LocateFixed, Map as MapIcon, Navigation, Search, SlidersHorizontal} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useWashRadar} from '../state/WashRadarContext';
import {startingPrice} from '../domain/engine';
import type {AdCreative, RankedWash, SortMode, WashFilters, WashType} from '../domain/models';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {WashCard} from '../components/WashCard';
import {Modal} from '../components/Modal';
import {NearbyOffer} from '../components/NearbyOffer';
import {repository} from '../services';

const MapView = lazy(() => import('../components/MapView').then((module) => ({default: module.MapView})));
const sortOptions: SortMode[] = ['Recommended', 'Fastest Total Time', 'Shortest Queue', 'Nearest', 'Lowest Price'];
const chips: {type?: WashType; label: string}[] = [
  {label: 'All washes'},
  {type: 'touchless', label: 'Touchless'},
  {type: 'soft-cloth', label: 'Soft cloth'},
  {type: 'tunnel', label: 'Tunnel'},
  {type: 'self-serve', label: 'Self serve'},
  {type: 'automatic', label: 'Automatic'},
  {type: 'hand-wash', label: 'Hand wash'},
];

export function ExplorePage() {
  const {mode, origin, washes, loading, error, offline, filters, setFilters, sort, setSort, favourites, toggleFavourite, locate, search, refresh} = useWashRadar();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [selectedMapWash, setSelectedMapWash] = useState<RankedWash>();
  const [ad, setAd] = useState<AdCreative | null>(null);
  const [locationPrompt, setLocationPrompt] = useState(() => localStorage.getItem('wr-location-intro') !== 'seen');

  const filtered = useMemo(() => {
    const values = washes.filter((wash) => {
      const price = startingPrice(wash);
      return (!filters.openNow || wash.estimate.operatingStatus === 'open') &&
        (!filters.types.length || filters.types.some((type) => wash.types.includes(type))) &&
        (!Number.isFinite(price) || price <= filters.maximumPrice) &&
        wash.distanceKm <= filters.maximumDistanceKm &&
        (filters.queueUnderMinutes === null || wash.estimate.waitMinutes <= filters.queueUnderMinutes);
    });
    return values.sort((a, b) =>
      sort === 'Fastest Total Time' ? a.totalMinutes - b.totalMinutes :
      sort === 'Shortest Queue' ? a.estimate.waitMinutes - b.estimate.waitMinutes :
      sort === 'Nearest' ? a.distanceKm - b.distanceKm :
      sort === 'Lowest Price' ? startingPrice(a) - startingPrice(b) :
      a.score - b.score,
    );
  }, [filters, sort, washes]);
  const best = filtered.find((wash) => wash.estimate.operatingStatus === 'open');
  const fastest = [...filtered].filter(isOpen).sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
  const cheapest = [...filtered].filter(isOpen).sort((a, b) => startingPrice(a) - startingPrice(b))[0];
  const closest = [...filtered].filter(isOpen).sort((a, b) => a.distanceKm - b.distanceKm)[0];

  useEffect(() => {
    let cancelled = false;
    void repository.getAd('explore_nearby_offer', origin).then((creative) => !cancelled && setAd(creative));
    return () => { cancelled = true; };
  }, [origin]);

  const submitSearch = async () => {
    if (query.trim().length < 2) return;
    setSearchMessage('Searching…');
    try {
      const found = await search(query);
      setSearchMessage(found ? '' : 'No matching area found. Try a city, postal code or address.');
      if (found) setQuery('');
    } catch {
      setSearchMessage('Search is unavailable right now. Try your current location.');
    }
  };

  return (
    <>
      {mode === 'demo' && <div className="demo-banner"><strong>DEMO MODE</strong><span>All places, prices, ratings and queue activity shown here are fictional.</span></div>}
      {offline && <div className="status-banner">You’re offline. The app shell is available, but queue data may be out of date.</div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void refresh()}>Try again</button></div>}

      <section className="hero">
        <div><p className="eyebrow">A CLEAN CAR. A CLEAR ROUTE.</p><h1>Where should you wash your car <em>right now?</em></h1><p>Compare the drive, queue, wash time and price in one glance.</p></div>
        <button className="secondary-button locate-hero" onClick={() => void locate()}><Navigation size={17} /> Use my location</button>
      </section>

      <form className="search-row" onSubmit={(event) => {event.preventDefault(); void submitSearch();}}>
        <label className="search-box"><Search size={20} /><span className="sr-only">Search city, postal code or address</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city, postal code or address" /></label>
        <button className="filter-button" type="button" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={19} /><span>Filters</span></button>
      </form>
      {searchMessage && <p className="search-message" role="status">{searchMessage}</p>}

      <div className="filter-chips" aria-label="Wash type filters">
        {chips.map((chip) => {
          const selected = chip.type ? filters.types.includes(chip.type) : filters.types.length === 0;
          return <button key={chip.label} className={selected ? 'selected' : ''} onClick={() => setFilters({...filters, types: chip.type ? [chip.type] : []})}>{chip.label}</button>;
        })}
        <label className="open-toggle"><input type="checkbox" checked={filters.openNow} onChange={(event) => setFilters({...filters, openNow: event.target.checked})} /><span /> Open now</label>
      </div>

      {loading ? <LoadingCards /> : best ? (
        <>
          <div className="recommend-layout">
            <WashCard wash={best} best saved={favourites.includes(best.id)} onSave={() => void toggleFavourite(best.id)} />
            <aside className="recommend-copy">
              <span className="radar-orbit"><LocateFixed size={36} /></span>
              <p className="eyebrow">THE DECISION, MADE CLEAR</p>
              <h2>Best is more than closest.</h2>
              <p>WashRadar weighs your drive, queue, wash time, price and data confidence. Paid placements never change this result.</p>
              <div><CloudSun size={17} /> Weather-ready recommendations</div>
            </aside>
          </div>
          <div className="decision-strip" aria-label="Quick comparisons">
            <Decision label="Fastest" wash={fastest} value={fastest ? fastest.totalMinutes + ' min total' : '—'} />
            <Decision label="Cheapest" wash={cheapest} value={cheapest && Number.isFinite(startingPrice(cheapest)) ? '$' + startingPrice(cheapest).toFixed(2) : 'Unknown'} />
            <Decision label="Closest" wash={closest} value={closest ? closest.distanceKm.toFixed(1) + ' km' : '—'} />
          </div>
        </>
      ) : !loading && <EmptyState onReset={() => setFilters({...filters, types: [], maximumDistanceKm: 50, maximumPrice: 50, queueUnderMinutes: null, openNow: false})} />}

      {ad && <NearbyOffer ad={ad} placement="explore_nearby_offer" />}

      <div className="results-bar">
        <h2>Nearby washes <span>{filtered.length}</span></h2>
        <div>
          <select aria-label="Sort nearby washes" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            {sortOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
          <div className="view-toggle" role="group" aria-label="Choose results view">
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={16} /> List</button>
            <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><MapIcon size={16} /> Map</button>
          </div>
        </div>
      </div>

      {!loading && filtered.length > 0 && (view === 'list'
        ? <div className="cards-grid">{filtered.map((wash) => <WashCard key={wash.id} wash={wash} saved={favourites.includes(wash.id)} onSave={() => void toggleFavourite(wash.id)} />)}</div>
        : <div className="map-section"><Suspense fallback={<div className="map-skeleton" />}>
            <MapView washes={filtered} origin={origin} selectedId={selectedMapWash?.id} onSelect={setSelectedMapWash} />
          </Suspense>{selectedMapWash && <div className="map-preview"><button aria-label="Close map preview" onClick={() => setSelectedMapWash(undefined)}>×</button><WashCard compact wash={selectedMapWash} saved={favourites.includes(selectedMapWash.id)} onSave={() => void toggleFavourite(selectedMapWash.id)} /></div>}</div>
      )}

      <FilterModal open={filterOpen} filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} />
      <Modal open={locationPrompt} onClose={() => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false);}} title="Find the best wash near you" description="Share your location once to compare nearby drive and queue times. WashRadar does not keep a public GPS trail.">
        <div className="location-consent-actions"><button className="primary-button" onClick={async () => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false); await locate();}}>Use my location</button><button className="secondary-button" onClick={() => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false);}}>Search manually</button></div>
      </Modal>
    </>
  );
}

function isOpen(wash: RankedWash) { return wash.estimate.operatingStatus === 'open'; }
function Decision({label, wash, value}: {label: string; wash?: RankedWash; value: string}) {
  return <Link to={wash ? '/wash/' + wash.id : '/'}><small>{label}</small><strong>{wash?.name ?? 'No option'}</strong><span>{value} <ChevronRight size={14} /></span></Link>;
}
function LoadingCards() {
  return <div className="loading-grid" aria-label="Loading nearby washes"><div /><div /><div /></div>;
}
function EmptyState({onReset}: {onReset: () => void}) {
  return <section className="empty-state"><LocateFixed size={32} /><h2>No washes match these filters.</h2><p>Try a wider distance or include closed locations.</p><button className="secondary-button" onClick={onReset}>Reset filters</button></section>;
}
function FilterModal({open, filters, onChange, onClose}: {open: boolean; filters: WashFilters; onChange: (filters: WashFilters) => void; onClose: () => void}) {
  return <Modal open={open} onClose={onClose} title="Find your kind of wash" description="These choices stay on this device.">
    <label className="field-label">Maximum price · ${filters.maximumPrice}<input type="range" min={5} max={50} value={filters.maximumPrice} onChange={(event) => onChange({...filters, maximumPrice: Number(event.target.value)})} /></label>
    <label className="field-label">Maximum distance · {filters.maximumDistanceKm} km<input type="range" min={1} max={50} value={filters.maximumDistanceKm} onChange={(event) => onChange({...filters, maximumDistanceKm: Number(event.target.value)})} /></label>
    <label className="field-label">Queue limit<select value={filters.queueUnderMinutes ?? 'any'} onChange={(event) => onChange({...filters, queueUnderMinutes: event.target.value === 'any' ? null : Number(event.target.value)})}><option value="any">Any wait</option><option value={10}>Under 10 minutes</option><option value={20}>Under 20 minutes</option></select></label>
    <div className="type-grid">{Object.entries(WASH_TYPE_CONFIG).map(([type, data]) => <label key={type}><input type="checkbox" checked={filters.types.includes(type as WashType)} onChange={(event) => onChange({...filters, types: event.target.checked ? [...filters.types, type as WashType] : filters.types.filter((item) => item !== type)})} /> {data.label}</label>)}</div>
    <button className="primary-button full" onClick={onClose}>Show washes</button>
  </Modal>;
}
