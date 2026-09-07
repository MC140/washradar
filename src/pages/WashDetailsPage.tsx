import {ArrowLeft, ArrowUpRight, Bell, Car, Check, Clock3, Droplets, MapPin, ShieldCheck, Star, TimerReset, TriangleAlert} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {AlertModal} from '../components/AlertModal';
import {Modal} from '../components/Modal';
import {NearbyOffer} from '../components/NearbyOffer';
import {ReportModal} from '../components/ReportModal';
import {WASH_TYPE_CONFIG} from '../domain/config';
import type {AdCreative, QueueBucket} from '../domain/models';
import {analytics} from '../services/analytics';
import {repository} from '../services';
import {directionsUrl} from '../services/location';
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
  const {washes, signals, favourites, toggleFavourite, startSession, session, loading} = useWashRadar();
  const wash = washes.find((item) => item.id === id);
  const [reportOpen, setReportOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [ad, setAd] = useState<AdCreative | null>(null);
  useEffect(() => {
    if (!wash) return;
    analytics.track('wash_viewed', {washId: wash.id});
    let cancelled = false;
    void repository.getAd('wash_detail_nearby_offer', wash.position, wash.id).then((creative) => !cancelled && setAd(creative));
    return () => {cancelled = true;};
  }, [wash]);

  if (loading && !wash) return <div className="detail-loading" />;
  if (!wash) return <section className="empty-state"><h1>Wash not found</h1><p>This listing may have moved or been removed.</p><Link className="secondary-button" to="/">Back to Explore</Link></section>;
  const recent = signals.filter((signal) => signal.washId === wash.id && !signal.disabled).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
  const priceAge = wash.sourceUpdatedAt ? Math.floor((Date.now() - new Date(wash.sourceUpdatedAt).getTime()) / 86_400_000) : null;
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
              <strong className={wash.estimate.operatingStatus === 'open' ? 'open' : 'closed'}>{wash.estimate.operatingStatus === 'open' ? 'OPEN' : wash.estimate.operatingStatus === 'closed' ? 'CLOSED' : 'POSSIBLY OUT OF SERVICE'}</strong>
              {wash.rating !== null && <span><Star size={15} fill="currentColor" /> {wash.rating.toFixed(1)} ({wash.ratingCount})</span>}
            </div>
            <div className="detail-wait">
              <div><small>CURRENT WAIT</small><strong>{wash.estimate.dataState === 'ESTIMATED' ? '~' : ''}{wash.estimate.waitMinutes}<span> min</span></strong></div>
              <div><small>DATA STATUS</small><b className={'data-state ' + wash.estimate.dataState.toLowerCase().replace(' ', '-')}>{wash.estimate.dataState}</b><span>{minutesAgo(wash.estimate.lastUpdatedAt)}</span></div>
              <div><small>CONFIDENCE</small><b><ShieldCheck size={17} /> {wash.estimate.confidenceLabel}</b><span>{wash.estimate.recentSignalCount ? wash.estimate.recentSignalCount + ' recent signals' : 'Based on historical patterns'}</span></div>
            </div>
            <div className="large-equation">
              <span><Car size={20} /><small>DRIVE</small><b>{wash.driveMinutes} min</b></span><i>+</i>
              <span><Clock3 size={20} /><small>WAIT</small><b>{wash.estimate.waitMinutes} min</b></span><i>+</i>
              <span><Droplets size={20} /><small>WASH</small><b>{wash.estimatedWashMinutes} min</b></span><i>=</i>
              <span className="total"><small>TOTAL</small><b>{wash.totalMinutes} min</b></span>
            </div>
            <div className="detail-actions">
              <button className="primary-button" onClick={() => {analytics.track('directions_clicked', {washId: wash.id, from: 'details'}); window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');}}><ArrowUpRight size={17} /> Directions</button>
              <button className="secondary-button" onClick={() => setReportOpen(true)}>Report queue</button>
              <button className="secondary-button" disabled={Boolean(session)} onClick={() => setQueueOpen(true)}><TimerReset size={17} /> Join queue</button>
              <button className="secondary-button" onClick={() => setAlertOpen(true)}><Bell size={17} /> Alert me</button>
            </div>
          </section>

          {ad && <NearbyOffer ad={ad} placement="wash_detail_nearby_offer" />}

          <section className="panel package-panel">
            <div className="panel-heading"><div><p className="eyebrow">WASH OPTIONS</p><h2>Packages and prices</h2></div><span>{priceAge === null ? 'Verification date unavailable' : priceAge > 30 ? 'Price may have changed' : 'Recently verified'}</span></div>
            <div className="package-grid">{wash.packages.map((item) => <article key={item.id}><small>{WASH_TYPE_CONFIG[item.washType].label}</small><h3>{item.name}</h3><strong>{money(item.price, item.currency)}</strong>{item.membershipAvailable && <span>Membership available</span>}{item.promotion && <span>{item.promotion}</span>}</article>)}</div>
            <p className="disclaimer"><TriangleAlert size={14} /> Prices are informational and may change. Confirm at the location before purchasing.</p>
            <button className="text-button" onClick={() => setPriceOpen(true)}>Report an incorrect price</button>
          </section>

          <section className="panel">
            <p className="eyebrow">LOCATION DETAILS</p><h2>Before you go</h2>
            <dl className="info-list">
              <div><dt>Wash type</dt><dd>{wash.types.map((type) => WASH_TYPE_CONFIG[type].label).join(', ')}</dd></div>
              <div><dt>Hours today</dt><dd>7:00 AM–10:00 PM</dd></div>
              <div><dt>Distance</dt><dd>{wash.distanceKm.toFixed(1)} km</dd></div>
              <div><dt>Drive estimate</dt><dd>{wash.driveMinutes} min · {wash.driveTimeSource === 'ROUTE' ? 'Live route' : 'Distance estimate'}</dd></div>
              <div><dt>Amenities</dt><dd>{wash.amenities.join(', ') || 'Not listed'}</dd></div>
              <div><dt>Address</dt><dd>{wash.address}, {wash.city}, {wash.region}</dd></div>
            </dl>
          </section>
        </div>

        <aside className="panel reports-panel">
          <p className="eyebrow">RECENT DRIVER REPORTS</p><h2>What drivers are seeing</h2><p>Nearby verified reports carry more weight. Exact device locations are never displayed.</p>
          {recent.length ? recent.map((signal) => <article className="report-row" key={signal.id}><span><Check size={16} /></span><div><strong>{reportLabels[signal.kind]}{signal.waitMinutes !== null ? ' · ' + signal.waitMinutes + ' min' : ''}</strong><p>{minutesAgo(signal.createdAt)} · {signal.verification === 'remote' ? 'Remote report' : 'Verified nearby'}</p></div></article>) : <div className="no-reports"><Clock3 size={25} /><strong>No recent driver reports</strong><p>This queue is a historical estimate.</p></div>}
          <button className="secondary-button full" onClick={() => setReportOpen(true)}>Share what you see</button>
        </aside>
      </div>
      <ReportModal open={reportOpen} initialWash={wash} onClose={() => setReportOpen(false)} />
      <AlertModal open={alertOpen} wash={wash} onClose={() => setAlertOpen(false)} />
      <QueueStartModal open={queueOpen} onClose={() => setQueueOpen(false)} onStart={async (bucket) => {
        try { await startSession(wash.id, bucket); setQueueOpen(false); toast.success('Queue timer started.'); }
        catch (error) { toast.error(error instanceof Error ? error.message : 'The timer could not start.'); }
      }} />
      <PriceCorrectionModal open={priceOpen} washId={wash.id} onClose={() => setPriceOpen(false)} />
    </>
  );
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
  return <Modal open={open} onClose={onClose} title="Start queue timer" description="How many cars are ahead? This is optional. Location is checked once to validate the session.">
    <div className="queue-start-options">{options.map((option) => <button disabled={busy} key={option.label} onClick={async () => {setBusy(true); try {await onStart(option.bucket);} finally {setBusy(false);}}}>{option.label}</button>)}</div>
  </Modal>;
}
