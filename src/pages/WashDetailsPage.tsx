import {ArrowLeft, Bell, Check, Clock3, Droplets, MapPin, Navigation, ShieldCheck, Star, TimerReset, TriangleAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {AlertModal} from '../components/AlertModal';
import {Modal} from '../components/Modal';
import {NearbyOffer} from '../components/NearbyOffer';
import {ReportModal} from '../components/ReportModal';
import {QUEUE_CONFIG, WASH_TYPE_CONFIG} from '../domain/config';
import {distanceKm, hasQueueEvidence} from '../domain/engine';
import type {AdCreative, BusinessHours, QueueBucket, QueueSignal, RankedWash} from '../domain/models';
import {analytics} from '../services/analytics';
import {repository} from '../services';
import {directionsUrl, requestLocation} from '../services/location';
import {loadWashDetail} from '../services/washDetail';
import {useWashRadar} from '../state/WashRadarContext';
import {minutesAgo, money} from '../utils/format';

const reportLabels: Record<string, string> = {
  queue: 'Queue size reported',
  session: 'Observed wait completed',
  normal: 'Operating normally',
  closed: 'Wash reported closed',
  broken: 'Machine unavailable',
  stalled: 'Line not moving',
  payment: 'Payment machine problem',
  dryer: 'Dryer issue',
  other: 'Other issue',
};

export function WashDetailsPage() {
  const {id} = useParams();
  const {origin, locationReady, washes, signals, favourites, toggleFavourite, startSession, session, loading, refresh} = useWashRadar();
  const contextWash = washes.find((item) => item.id === id);
  const [directWash, setDirectWash] = useState<RankedWash | null>(null);
  const [directSignals, setDirectSignals] = useState<QueueSignal[]>([]);
  const [directLoading, setDirectLoading] = useState(!contextWash);
  const [directError, setDirectError] = useState('');
  const wash = contextWash ?? directWash;
  const visibleSignals = contextWash ? signals : directSignals;
  const [reportOpen, setReportOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [ad, setAd] = useState<AdCreative | null>(null);

  useEffect(() => {
    if (!id || contextWash) {
      setDirectLoading(false);
      return;
    }
    let cancelled = false;
    setDirectLoading(true);
    setDirectError('');
    void loadWashDetail(id, locationReady ? origin : undefined)
      .then((result) => {
        if (cancelled) return;
        setDirectWash(result.wash);
        setDirectSignals(result.signals);
      })
      .catch((error) => {
        if (!cancelled) setDirectError(error instanceof Error ? error.message : 'This wash could not be loaded right now.');
      })
      .finally(() => {
        if (!cancelled) setDirectLoading(false);
      });
    return () => { cancelled = true; };
  }, [contextWash, id, locationReady, origin]);

  useEffect(() => {
    if (!wash) return;
    analytics.track('wash_viewed', {washId: wash.id});
    let cancelled = false;
    void repository.getAd('wash_detail_nearby_offer', wash.position, wash.id).then((creative) => !cancelled && setAd(creative));
    return () => {cancelled = true;};
  }, [wash]);

  if ((loading || directLoading) && !wash) return <div className="detail-loading" />;
  if (!wash) return <section className="empty-state"><h1>{directError ? 'Wash temporarily unavailable' : 'Wash not found'}</h1><p>{directError || 'This listing may have moved or been removed.'}</p><Link className="secondary-button" to="/">Back to Explore</Link></section>;

  const recent = visibleSignals.filter((signal) => signal.washId === wash.id && !signal.disabled).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
  const unavailable = wash.estimate.operatingStatus === 'closed' || wash.estimate.operatingStatus === 'unavailable';
  const queueKnown = !unavailable && hasQueueEvidence(wash, wash.estimate);
  const queueMinutes = queueKnown ? wash.estimate.waitMinutes : null;
  const verifiedPriceDates = wash.packages.map((item) => item.verifiedAt).filter((value): value is string => Boolean(value));
  const latestPriceVerification = verifiedPriceDates.length ? Math.max(...verifiedPriceDates.map((value) => new Date(value).getTime())) : null;
  const priceAge = latestPriceVerification === null ? null : Math.floor((Date.now() - latestPriceVerification) / 86_400_000);
  const status = statusPresentation(wash.estimate.operatingStatus);
  const queueStateLabel = queueKnown ? wash.estimate.dataState : 'LIMITED DATA';
  const distanceKnown = Boolean(contextWash || locationReady);
  const distanceLabel = distanceKnown ? `${wash.distanceKm.toFixed(1)} km` : 'Set location';
  const directions = () => {
    analytics.track('directions_clicked', {washId: wash.id, from: 'details'});
    window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');
  };

  const startQueue = async (bucket?: QueueBucket) => {
    if (contextWash) {
      await startSession(wash.id, bucket);
      return;
    }
    const freshLocation = await requestLocation();
    if (freshLocation.accuracy > QUEUE_CONFIG.maximumAccurateGpsMetres) {
      throw new Error('GPS accuracy is too low to verify a queue timer. Try again in a moment or move closer to the wash entrance.');
    }
    if (distanceKm(freshLocation.point, wash.position) > QUEUE_CONFIG.nearbyRadiusKm) {
      throw new Error('You need to be at this car wash to start a verified queue timer. Quick queue reports still work from anywhere.');
    }
    await repository.startQueueSession(wash.id, freshLocation.point, bucket);
    await refresh();
  };

  return (
    <>
      <Link className="back-link" to="/"><ArrowLeft size={17} /> Back to nearby washes</Link>
      <div className="detail-grid">
        <div>
          <section className="detail-hero">
            <div className="detail-title">
              <div><p className="eyebrow">YOUR WASH DECISION</p><h1>{wash.name}</h1><p><MapPin size={15} /> {wash.address}, {wash.city}</p></div>
              <button className={'save-large ' + (favourites.includes(wash.id) ? 'saved' : '')} onClick={() => void toggleFavourite(wash.id)}>Save</button>
            </div>
            <div className="status-line">
              <strong className={status.tone}>{status.label}</strong>
              {wash.rating !== null && <span><Star size={15} fill="currentColor" /> {wash.rating.toFixed(1)} ({wash.ratingCount})</span>}
              <button className="quick-directions detail-quick-directions" onClick={directions}><Navigation size={13} /> Directions</button>
            </div>
            <div className="detail-wait">
              <div><small>CURRENT WAIT</small><strong>{queueMinutes === null ? '—' : (wash.estimate.dataState === 'ESTIMATED' ? '~' : '') + queueMinutes}{queueMinutes !== null && <span> min</span>}</strong><span>{queueMinutes === null ? 'Queue unknown' : 'Current queue estimate'}</span></div>
              <div><small>DATA STATUS</small><b className={'data-state ' + (queueKnown ? wash.estimate.dataState.toLowerCase().replace(' ', '-') : 'estimated')}>{queueStateLabel}</b><span>{queueKnown ? minutesAgo(wash.estimate.lastUpdatedAt) : 'No queue evidence yet'}</span></div>
              <div><small>CONFIDENCE</small><b><ShieldCheck size={17} /> {queueKnown ? wash.estimate.confidenceLabel : 'Queue unknown'}</b><span>{wash.estimate.recentSignalCount ? wash.estimate.recentSignalCount + ' recent signals' : wash.historicalSampleCount > 0 ? wash.historicalSampleCount + ' historical samples' : 'Waiting for driver or historical data'}</span></div>
            </div>
            <div className="large-equation">
              <span><MapPin size={20} /><small>DISTANCE</small><b>{distanceLabel}</b></span><i>·</i>
              <span><Clock3 size={20} /><small>WAIT</small><b>{queueMinutes === null ? '—' : queueMinutes + ' min'}</b></span><i>·</i>
              <span><Droplets size={20} /><small>WASH EST.</small><b>~{wash.estimatedWashMinutes} min</b></span>
            </div>
            {!distanceKnown && <p className="disclaimer"><MapPin size={14} /> Set your location on Explore to calculate distance. Directions still opens the wash in your navigation app.</p>}
            <p className="disclaimer"><TriangleAlert size={14} /> Travel time and traffic are intentionally left to your navigation app. WashRadar focuses on distance and queue conditions.</p>
            <div className="detail-actions">
              <button className="queue-update-button" onClick={() => setReportOpen(true)}>Update queue</button>
              <button className="secondary-button" disabled={Boolean(session)} onClick={() => setQueueOpen(true)}><TimerReset size={17} /> Join queue</button>
              <button className="secondary-button" onClick={() => setAlertOpen(true)}><Bell size={17} /> Alert me</button>
            </div>
          </section>

          {ad && <NearbyOffer ad={ad} placement="wash_detail_nearby_offer" />}

          <section className="panel package-panel">
            <div className="panel-heading"><div><p className="eyebrow">WASH OPTIONS</p><h2>Packages and prices</h2></div><span>{wash.packages.length === 0 ? 'Price data not available' : priceAge === null ? 'Verification date unavailable' : priceAge > 30 ? 'Price may have changed' : 'Recently verified'}</span></div>
            {wash.packages.length > 0 ? <>
              <div className="package-grid">{wash.packages.map((item) => <article key={item.id}><small>{WASH_TYPE_CONFIG[item.washType].label}</small><h3>{item.name}</h3><strong>{money(item.price, item.currency)}</strong>{item.membershipAvailable && <span>Membership available</span>}{item.promotion && <span>{item.promotion}</span>}</article>)}</div>
              <p className="disclaimer"><TriangleAlert size={14} /> Prices are informational and may change. Confirm at the location before purchasing.</p>
              <button className="text-button" onClick={() => setPriceOpen(true)}>Report an incorrect price</button>
            </> : <div className="no-reports"><strong>Pricing not verified yet</strong><p>WashRadar will show prices only after a reliable source is available. We won’t invent a starting price.</p></div>}
          </section>

          <section className="panel">
            <p className="eyebrow">LOCATION DETAILS</p><h2>Before you go</h2>
            <dl className="info-list">
              <div><dt>Wash type</dt><dd>{wash.types.length ? wash.types.map((type) => WASH_TYPE_CONFIG[type].label).join(', ') : 'Not yet verified'}</dd></div>
              <div><dt>Hours today</dt><dd>{hoursToday(wash.hours)}</dd></div>
              <div><dt>Distance</dt><dd>{distanceLabel}</dd></div>
              <div><dt>Navigation</dt><dd>Tap Directions for live traffic and ETA in your Maps app</dd></div>
              <div><dt>Amenities</dt><dd>{wash.amenities.join(', ') || 'Not listed'}</dd></div>
              <div><dt>Address</dt><dd>{wash.address}, {wash.city}, {wash.region}</dd></div>
            </dl>
          </section>
        </div>

        <aside className="panel reports-panel">
          <p className="eyebrow">RECENT DRIVER REPORTS</p><h2>What drivers are seeing</h2><p>Nearby verified reports carry more weight. Exact device locations are never displayed.</p>
          {recent.length ? recent.map((signal) => <article className="report-row" key={signal.id}><span><Check size={16} /></span><div><strong>{reportLabels[signal.kind]}{signal.waitMinutes !== null ? ' · ' + signal.waitMinutes + ' min' : ''}</strong><p>{minutesAgo(signal.createdAt)} · {signal.verification === 'remote' ? 'Remote report' : signal.verification === 'session' ? 'Verified queue session' : 'Verified nearby'}</p></div></article>) : <div className="no-reports"><Clock3 size={25} /><strong>No recent driver reports</strong><p>{wash.historicalSampleCount > 0 ? 'A historical estimate may still be available.' : 'There is no queue estimate yet. A quick driver report helps everyone.'}</p></div>}
          <button className="queue-update-button full" onClick={() => setReportOpen(true)}>Update queue</button>
        </aside>
      </div>
      <ReportModal open={reportOpen} initialWash={wash} onClose={() => setReportOpen(false)} />
      <AlertModal open={alertOpen} wash={wash} onClose={() => setAlertOpen(false)} />
      <QueueStartModal open={queueOpen} onClose={() => setQueueOpen(false)} onStart={async (bucket) => {
        try { await startQueue(bucket); setQueueOpen(false); toast.success('Verified queue timer started.'); }
        catch (error) { toast.error(error instanceof Error ? error.message : 'The timer could not start.'); }
      }} />
      <PriceCorrectionModal open={priceOpen} washId={wash.id} onClose={() => setPriceOpen(false)} />
    </>
  );
}

function statusPresentation(status: 'open' | 'closed' | 'unavailable' | 'unknown') {
  if (status === 'open') return {label: 'OPEN', tone: 'open'};
  if (status === 'closed') return {label: 'CLOSED', tone: 'closed'};
  if (status === 'unavailable') return {label: 'UNAVAILABLE', tone: 'closed'};
  return {label: 'HOURS UNKNOWN', tone: 'unknown'};
}

function hoursToday(hours: BusinessHours[]) {
  if (!hours.length) return 'Hours not available';
  const today = hours.find((item) => item.weekday === new Date().getDay());
  if (!today) return 'Hours not available';
  if (today.closed) return 'Closed today';
  if (!today.opensAt || !today.closesAt) return 'Hours not available';
  return `${formatClock(today.opensAt)}–${formatClock(today.closesAt)}`;
}

function formatClock(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const date = new Date(2000, 0, 1, hours, minutes);
  return date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
}

function PriceCorrectionModal({open, washId, onClose}: {open: boolean; washId: string; onClose: () => void}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return <Modal open={open} onClose={onClose} title="Report an incorrect price" description="Price corrections are reviewed before they appear publicly.">
    <label className="field-label">Correct starting price (CAD)<input className="text-input" type="number" min="0" max="500" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Optional" /></label>
    <label className="field-label">What changed?<textarea className="text-input" maxLength={500} required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Package name, posted price, or other detail" /></label>
    <button className="primary-button full" disabled={busy || note.trim().length < 3} onClick={async () => {
      setBusy(true);
      try { await repository.submitPriceCorrection(washId, amount ? Number(amount) : null, note.trim()); toast.success('Thanks. We’ll review the correction.'); onClose(); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Correction could not be sent.'); }
      finally { setBusy(false); }
    }}>Submit correction</button>
  </Modal>;
}

function QueueStartModal({open, onClose, onStart}: {open: boolean; onClose: () => void; onStart: (bucket?: QueueBucket) => Promise<void>}) {
  const [busy, setBusy] = useState(false);
  const options: {label: string; bucket?: QueueBucket}[] = [{label: 'Skip this question'}, {label: 'No queue', bucket: 'none'}, {label: '1–3 ahead', bucket: '1-3'}, {label: '4–7 ahead', bucket: '4-7'}, {label: '8+ ahead', bucket: '8-12'}];
  return <Modal open={open} onClose={onClose} title="Start verified queue timer" description="How many cars are ahead? This is optional. WashRadar will request a fresh GPS reading to verify that you are actually near this wash.">
    <div className="queue-start-options">{options.map((option) => <button disabled={busy} key={option.label} onClick={async () => {setBusy(true); try {await onStart(option.bucket);} finally {setBusy(false);}}}>{option.label}</button>)}</div>
  </Modal>;
}
