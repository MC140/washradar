import {CarFront, Heart, Navigation} from 'lucide-react';
import {Link} from 'react-router-dom';
import {hasQueueEvidence} from '../domain/engine';
import type {RankedWash} from '../domain/models';
import {analytics} from '../services/analytics';
import {directionsUrl} from '../services/location';
import {minutesAgo} from '../utils/format';
import '../wash-card-v2.css';

function waitTone(minutes: number | null, unavailable: boolean) {
  if (unavailable || minutes === null) return 'unknown';
  if (minutes <= 15) return 'low';
  if (minutes < 40) return 'medium';
  return 'high';
}

function freshnessTone(iso: string | null) {
  if (!iso) return 'stale';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes <= 5) return 'fresh';
  if (minutes <= 30) return 'aging';
  return 'stale';
}

function carsAhead(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function reporterLabel(wash: RankedWash) {
  return wash.estimate.dataState === 'ESTIMATED' ? 'Estimate' : 'Community';
}

export function WashCard({
  wash,
  best = false,
  bestWait = best,
  saved,
  onSave,
  onReport,
  compact = false,
}: {
  wash: RankedWash;
  best?: boolean;
  bestWait?: boolean;
  saved: boolean;
  onSave: () => void;
  onReport?: () => void;
  compact?: boolean;
}) {
  const status = wash.estimate.operatingStatus;
  const unavailable = status === 'closed' || status === 'unavailable';
  const hasQueueData = hasQueueEvidence(wash, wash.estimate);
  const queueMinutes = !unavailable && hasQueueData ? wash.estimate.waitMinutes : null;
  const estimatedPrefix = wash.estimate.dataState === 'ESTIMATED' ? '~' : '';
  const tone = waitTone(queueMinutes, unavailable);
  const freshness = freshnessTone(wash.estimate.lastUpdatedAt);
  const queueAndWashMinutes = queueMinutes === null ? null : Math.max(0, queueMinutes + wash.estimatedWashMinutes);
  const cars = carsAhead(wash.estimate.estimatedCars);
  const source = reporterLabel(wash);

  const viewDetails = () => {
    analytics.track('wash_viewed', {washId: wash.id});
    if (best) analytics.track('best_right_now_selected', {washId: wash.id});
  };

  const directions = () => {
    analytics.track('directions_clicked', {washId: wash.id, from: best ? 'best' : 'card'});
    window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');
  };

  const waitFallback = status === 'closed'
    ? 'Closed'
    : status === 'unavailable'
      ? 'Unavailable'
      : '—';

  return (
    <article className={`wash-card wash-card-v2 tone-${tone} ${best ? 'best-card' : ''}${bestWait ? ' best-wait-card' : ''}${compact ? ' compact-card' : ''}`}>
      <div className={`wash-card-v2-topline${bestWait ? '' : ' no-badge'}`}>
        {bestWait && <span className="wash-card-v2-best"><span aria-hidden="true">✦</span> Best right now</span>}
        <button className={'wash-card-v2-save ' + (saved ? 'is-saved' : '')} type="button" onClick={onSave} aria-label={saved ? 'Remove from saved washes' : 'Save this wash'} title={saved ? 'Saved' : 'Save'}>
          <Heart size={16} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="wash-card-v2-main">
        <div className="wash-card-v2-identity">
          <div className="wash-card-v2-name-row">
            <Link to={'/wash/' + wash.id} onClick={viewDetails}><h2>{wash.name}</h2></Link>
            <button className="wash-card-v2-directions" type="button" onClick={directions} aria-label={'Get directions to ' + wash.name} title="Directions">
              <Navigation size={16} />
            </button>
          </div>
          <span className="wash-card-v2-distance">{wash.distanceKm.toFixed(1)} km away</span>
        </div>

        <div className="wash-card-v2-wait" aria-label={queueMinutes === null ? 'Wait time unavailable' : `${queueMinutes} minute estimated wait`}>
          <small>Estimated wait</small>
          {queueMinutes !== null ? (
            <div className="wash-card-v2-wait-value"><strong>{estimatedPrefix}{queueMinutes}</strong><span>min</span></div>
          ) : (
            <strong className="wash-card-v2-wait-fallback">{waitFallback}</strong>
          )}
          {queueMinutes !== null && cars !== null && (
            <div className="wash-card-v2-cars" aria-label={`${cars} ${cars === 1 ? 'car' : 'cars'} ahead`}>
              <span className="wash-card-v2-car-icons" aria-hidden="true">
                <CarFront size={15} />
                {cars > 1 && cars < 4 && <CarFront size={15} />}
              </span>
              <span>{cars === 0 ? 'No cars ahead' : `${cars} ${cars === 1 ? 'car' : 'cars'} ahead`}</span>
            </div>
          )}
        </div>
      </div>

      <div className="wash-card-v2-footer">
        <div className={'wash-card-v2-freshness ' + freshness}>
          <i aria-hidden="true" />
          <span>{hasQueueData ? `${source} · ${minutesAgo(wash.estimate.lastUpdatedAt)}` : 'No recent queue report'}</span>
        </div>
        <div className="wash-card-v2-total">
          <span>{queueAndWashMinutes !== null ? <>Queue + wash · <strong>~{queueAndWashMinutes} min</strong></> : <>Queue + wash · <strong>unknown</strong></>}</span>
          <small>+ drive time</small>
        </div>
      </div>

      <div className="card-actions wash-card-v2-actions">
        <Link className="secondary-button" to={'/wash/' + wash.id} onClick={viewDetails}>Details</Link>
        {onReport && <button className="queue-update-button" onClick={onReport}>Update queue</button>}
      </div>
    </article>
  );
}
