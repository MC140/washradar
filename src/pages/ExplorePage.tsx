import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {ChevronRight, List, LocateFixed, Map as MapIcon, Navigation, Search, ShieldCheck, SlidersHorizontal} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useWashRadar} from '../state/WashRadarContext';
import {hasQueueEvidence, startingPrice} from '../domain/engine';
import type {AdCreative, RankedWash, SortMode, WashFilters, WashType} from '../domain/models';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {WashCard} from '../components/WashCard';
import {Modal} from '../components/Modal';
import {NearbyOffer} from '../components/NearbyOffer';
import {ReportModal} from '../components/ReportModal';
import {repository} from '../services';

const MapView = lazy(() => import('../components/MapView').then((module) => ({default: module.MapView})));
const baseSortOptions: SortMode[] = ['Recommended', 'Shortest Queue', 'Nearest', 'Lowest Price'];
const quickSortLabels: Partial<Record<SortMode, string>> = {
  Recommended: 'Recommended',
  'Shortest Queue': 'Shortest wait',
  Nearest: 'Nearest',
  'Lowest Price': 'Lowest price',
};
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
  const {mode, origin, locationReady, washes, loading, error, offline, filters, setFilters, sort, setSort, favourites, toggleFavourite, locate, search, exploreAt, refresh} = useWashRadar();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [selectedMapWash, setSelectedMapWash] = useState<RankedWash>();
  const [reportingWash, setReportingWash] = useState<RankedWash>();
  const [ad, setAd] = useState<AdCreative | null>(null);
  const [locationPrompt, setLocationPrompt] = useState(() => localStorage.getItem('wr-location-intro') !== 'seen');

  const typeCounts = useMemo(() => {
    const counts = new Map<WashType, number>();
    for (const chip of chips) {
      if (chip.type) counts.set(chip.type, washes.filter((wash) => wash.types.includes(chip.type!)).length);
    }
    return counts;
  }, [washes]);
  const typeDataAvailable = [...typeCounts.values()].some((count) => count > 0);
  const priceDataAvailable = washes.some((wash) => Number.isFinite(startingPrice(wash)));
  const hoursDataAvailable = washes.some((wash) => wash.estimate.operatingStatus !== 'unknown');
  const queueDataAvailable = washes.some((wash) => hasQueueEvidence(wash, wash.estimate));
  const sortOptions = baseSortOptions.filter((option) =>
    (option !== 'Lowest Price' || priceDataAvailable) &&
    (option !== 'Shortest Queue' || queueDataAvailable),
  );

  useEffect(() => {
    if (!sortOptions.includes(sort)) setSort('Recommended');
  }, [sort, setSort, priceDataAvailable, queueDataAvailable]);

  const filtered = useMemo(() => {
    const typeFilterActive = typeDataAvailable && filters.types.length > 0;
    const priceFilterActive = priceDataAvailable && filters.maximumPrice < 50;
    const openFilterActive = hoursDataAvailable && filters.openNow;
    const values = washes.filter((wash) => {
      const price = startingPrice(wash);
      const queueKnown = hasQueueEvidence(wash, wash.estimate);
      return (!openFilterActive || wash.estimate.operatingStatus === 'open') &&
        (!typeFilterActive || filters.types.some((type) => wash.types.includes(type))) &&
        (!priceFilterActive || (Number.isFinite(price) && price <= filters.maximumPrice)) &&
        wash.distanceKm <= filters.maximumDistanceKm &&
        (filters.queueUnderMinutes === null || (queueKnown && wash.estimate.waitMinutes <= filters.queueUnderMinutes));
    });
    const unknownLast = (known: boolean, value: number) => known ? value : Number.POSITIVE_INFINITY;
    return values.sort((a, b) =>
      sort === 'Shortest Queue'
        ? unknownLast(hasQueueEvidence(a, a.estimate), a.estimate.waitMinutes) - unknownLast(hasQueueEvidence(b, b.estimate), b.estimate.waitMinutes)
        : sort === 'Nearest'
          ? a.distanceKm - b.distanceKm
          : sort === 'Lowest Price'
            ? startingPrice(a) - startingPrice(b)
            : a.score - b.score,
    );
  }, [filters, sort, washes, typeDataAvailable, priceDataAvailable, hoursDataAvailable]);

  const eligible = filtered.filter((wash) => wash.estimate.operatingStatus !== 'closed' && wash.estimate.operatingStatus !== 'unavailable');
  const explicitlyOpen = eligible.filter(isOpen);
  const recommendationPool = explicitlyOpen.length ? explicitlyOpen : eligible;
  const best = recommendationPool[0];
  const fastest = recommendationPool.filter((wash) => hasQueueEvidence(wash, wash.estimate)).sort((a, b) => a.totalMinutes - b.totalMinutes)[0];
  const cheapest = recommendationPool.filter((wash) => Number.isFinite(startingPrice(wash))).sort((a, b) => startingPrice(a) - startingPrice(b))[0];
  const closest = [...recommendationPool].sort((a, b) => a.distanceKm - b.distanceKm)[0];
  const bestIsFullyInformed = Boolean(best && best.estimate.operatingStatus === 'open' && hasQueueEvidence(best, best.estimate));

  useEffect(() => {
    if (!locationReady) {
      setAd(null);
      return;
    }
    let cancelled = false;
    void repository.getAd('explore_nearby_offer', origin).then((creative) => !cancelled && setAd(creative));
    return () => { cancelled = true; };
  }, [locationReady, origin]);

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
        <div><p className="eyebrow">A CLEAN CAR. A CLEAR ROUTE.</p><h1>Where should you wash your car <em>right now?</em></h1><p>Compare the drive, queue, wash time and price when that data is available. Unknowns stay marked unknown.</p></div>
        <button className="secondary-button locate-hero" onClick={() => void locate()}><Navigation size={17} /> Use my location</button>
      </section>

      <form className="search-row" onSubmit={(event) => {event.preventDefault(); void submitSearch();}}>
        <label className="search-box"><Search size={20} /><span className="sr-only">Search city, postal code or address</span><input value={query} onChange={(event) => {setQuery(event.target.value); if (searchMessage) setSearchMessage('');}} placeholder="Search city, postal code or address" /></label>
        <button className="filter-button" type="button" aria-label="Filters" onClick={() => setFilterOpen(true)}><SlidersHorizontal size={19} /><span>Filters</span></button>
      </form>
      {searchMessage && <p className="search-message" role="status">{searchMessage}</p>}

      <div className="filter-chips" aria-label="Wash type filters">
        {chips.map((chip) => {
          const count = chip.type ? typeCounts.get(chip.type) ?? 0 : washes.length;
          const selected = chip.type ? count > 0 && filters.types.includes(chip.type) : filters.types.length === 0;
          const unavailable = Boolean(chip.type) && count === 0;
          return <button key={chip.label} disabled={unavailable} title={unavailable ? `No verified ${chip.label.toLowerCase()} listings nearby yet.` : undefined} className={selected ? 'selected' : ''} onClick={() => setFilters({...filters, types: chip.type ? [chip.type] : []})}><span>{chip.label}</span>{chip.type && count > 0 && <small>{count}</small>}</button>;
        })}
        <label className="open-toggle" title={!hoursDataAvailable ? 'Business hours are not verified for these listings yet.' : undefined}><input type="checkbox" disabled={!hoursDataAvailable} checked={hoursDataAvailable && filters.openNow} onChange={(event) => setFilters({...filters, openNow: event.target.checked})} /><span /> Open now</label>
      </div>
      {locationReady && !loading && (!typeDataAvailable || !hoursDataAvailable || !priceDataAvailable) && <p className="search-message" role="status">Some listing details are still being verified. Filters that depend on missing data are disabled rather than guessing.</p>}

      {loading ? <LoadingCards /> : best ? (
        <>
          <div className="recommend-layout">
            <WashCard wash={best} best saved={favourites.includes(best.id)} onSave={() => void toggleFavourite(best.id)} onReport={() => setReportingWash(best)} />
            <aside className="recommend-copy">
              <span className="radar-orbit"><LocateFixed size={36} /></span>
              <p className="eyebrow">THE DECISION, MADE CLEAR</p>
              <h2>{bestIsFullyInformed ? 'Best is more than closest.' : 'Best available estimate.'}</h2>
              <p>{bestIsFullyInformed
                ? 'WashRadar weighs your drive, queue, wash time, price and data confidence. Paid placements never change this result.'
                : 'Live queue, hours or price data is still limited here. WashRadar uses what is known and adds an uncertainty penalty instead of treating missing data as zero.'}</p>
              <div><ShieldCheck size={17} /> Unknown data stays visible as unknown</div>
            </aside>
          </div>
          <div className="decision-strip" aria-label="Quick comparisons">
            <Decision label="Fastest known" wash={fastest} value={fastest ? fastest.totalMinutes + ' min total' : 'Queue data needed'} />
            <Decision label="Cheapest known" wash={cheapest} value={cheapest ? '$' + startingPrice(cheapest).toFixed(2) : 'Price data needed'} />
            <Decision label="Closest" wash={closest} value={closest ? closest.distanceKm.toFixed(1) + ' km' : '—'} />
          </div>
        </>
      ) : !loading && <EmptyState locationReady={locationReady} onLocate={locate} onReset={() => setFilters({...filters, types: [], maximumDistanceKm: 50, maximumPrice: 50, queueUnderMinutes: null, openNow: false})} />}

      {ad && <NearbyOffer ad={ad} placement="explore_nearby_offer" />}

      {locationReady && <div className="results-bar results-bar-v2">
        <h2>Nearby washes <span>{filtered.length}</span></h2>
        <div className="results-controls">
          <div className="quick-sort" role="group" aria-label="Sort nearby washes">
            {sortOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sort === option}
                onClick={() => setSort(option)}
              >
                {quickSortLabels[option] ?? option}
              </button>
            ))}
          </div>
          <div className="view-toggle" role="group" aria-label="Choose results view">
            <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><List size={16} /> List</button>
            <button className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}><MapIcon size={16} /> Map</button>
          </div>
        </div>
      </div>}

      {locationReady && !loading && filtered.length > 0 && (view === 'list'
        ? <div className="cards-grid">{filtered.map((wash) => <WashCard key={wash.id} wash={wash} saved={favourites.includes(wash.id)} onSave={() => void toggleFavourite(wash.id)} onReport={() => setReportingWash(wash)} />)}</div>
        : <div className="map-section">
            <p className="map-browse-hint">Drag the map to another neighbourhood, then choose <strong>Search this area</strong>. Tap a wash marker to see its details.</p>
            <Suspense fallback={<div className="map-skeleton" />}>
              <MapView
                washes={filtered}
                origin={origin}
                selectedId={selectedMapWash?.id}
                onSelect={setSelectedMapWash}
                onSearchArea={(point) => {
                  setSelectedMapWash(undefined);
                  exploreAt(point);
                }}
              />
            </Suspense>
            {selectedMapWash && <div className="map-preview"><button aria-label="Close map preview" onClick={() => setSelectedMapWash(undefined)}>×</button><WashCard compact wash={selectedMapWash} saved={favourites.includes(selectedMapWash.id)} onSave={() => void toggleFavourite(selectedMapWash.id)} onReport={() => setReportingWash(selectedMapWash)} /></div>}
          </div>
      )}

      <FilterModal open={filterOpen} filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)} availability={{types: typeDataAvailable, prices: priceDataAvailable, hours: hoursDataAvailable}} />
      <ReportModal open={Boolean(reportingWash)} initialWash={reportingWash} onClose={() => setReportingWash(undefined)} />
      <Modal open={locationPrompt} onClose={() => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false);}} title="Find the best wash near you" description="Share your location once to compare nearby drive and queue times. WashRadar does not keep a public GPS trail.">
        <div className="location-consent-actions"><button className="primary-button" onClick={async () => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false); await locate();}}>Use my location</button><button className="secondary-button" onClick={() => {localStorage.setItem('wr-location-intro', 'seen'); setLocationPrompt(false);}}>Search manually</button></div>
      </Modal>
    </>
  );
}

function isOpen(wash: RankedWash) { return wash.estimate.operatingStatus === 'open'; }
function Decision({label, wash, value}: {label: string; wash?: RankedWash; value: string}) {
  return <Link to={wash ? '/wash/' + wash.id : '/'}><small>{label}</small><strong>{wash?.name ?? 'Not enough data'}</strong><span>{value} <ChevronRight size={14} /></span></Link>;
}
function LoadingCards() {
  return <div className="loading-grid" aria-label="Loading nearby washes"><div /><div /><div /></div>;
}
function EmptyState({locationReady, onLocate, onReset}: {locationReady: boolean; onLocate: () => Promise<void>; onReset: () => void}) {
  if (!locationReady) {
    return <section className="empty-state"><LocateFixed size={32} /><h2>Set your location to find nearby washes.</h2><p>Use your current location or search by city, postal code or address.</p><button className="primary-button" onClick={() => void onLocate()}>Use my location</button></section>;
  }
  return <section className="empty-state"><LocateFixed size={32} /><h2>No washes found nearby yet.</h2><p>Try a wider distance, remove filters or search another area.</p><button className="secondary-button" onClick={onReset}>Reset filters</button></section>;
}
function FilterModal({open, filters, onChange, onClose, availability}: {open: boolean; filters: WashFilters; onChange: (filters: WashFilters) => void; onClose: () => void; availability: {types: boolean; prices: boolean; hours: boolean}}) {
  return <Modal open={open} onClose={onClose} title="Find your kind of wash" description="Filters only use verified fields. Missing data is never treated as a match.">
    <label className="field-label">Maximum price · {availability.prices ? '$' + filters.maximumPrice : 'Price data unavailable'}<input disabled={!availability.prices} type="range" min={5} max={50} value={filters.maximumPrice} onChange={(event) => onChange({...filters, maximumPrice: Number(event.target.value)})} /></label>
    <label className="field-label">Maximum distance · {filters.maximumDistanceKm} km<input type="range" min={1} max={50} value={filters.maximumDistanceKm} onChange={(event) => onChange({...filters, maximumDistanceKm: Number(event.target.value)})} /></label>
    <label className="field-label">Queue limit<select value={filters.queueUnderMinutes ?? 'any'} onChange={(event) => onChange({...filters, queueUnderMinutes: event.target.value === 'any' ? null : Number(event.target.value)})}><option value="any">Any wait / unknown allowed</option><option value={10}>Known queue under 10 minutes</option><option value={20}>Known queue under 20 minutes</option></select></label>
    {!availability.types && <p className="search-message">Wash types are not verified for these listings yet, so type filters are disabled.</p>}
    {!availability.hours && <p className="search-message">Business hours are not verified yet. “Open now” stays off until they are.</p>}
    <div className="type-grid">{Object.entries(WASH_TYPE_CONFIG).map(([type, data]) => <label key={type}><input disabled={!availability.types} type="checkbox" checked={availability.types && filters.types.includes(type as WashType)} onChange={(event) => onChange({...filters, types: event.target.checked ? [...filters.types, type as WashType] : filters.types.filter((item) => item !== type)})} /> {data.label}</label>)}</div>
    <button className="primary-button full" onClick={onClose}>Show washes</button>
  </Modal>;
}
