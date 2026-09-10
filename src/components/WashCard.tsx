import {CarFront, Clock3, Heart, MapPin, Navigation} from 'lucide-react';
import {Link} from 'react-router-dom';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {hasQueueEvidence, startingPrice} from '../domain/engine';
import type {RankedWash} from '../domain/models';
import {analytics} from '../services/analytics';
import {directionsUrl} from '../services/location';
import {minutesAgo, money} from '../utils/format';
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

function carsAheadLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return 'Cars unknown';
  const cars = Math.max(0, Math.round(value));
  if (cars === 0) return 'No cars ahead';
  return `${cars} ${cars === 1 ? 'car' : 'cars'} ahead`;
}

export function WashCard({
  wash,
  best = false,
  saved,
  onSave,
  onReport,
  compact = false,
}: {
  wash: RankedWash;
  best?: boolean;
  saved: boolean;
  onSave: () => void;
  onReport?: () => void;
  compact?: boolean;
}) {
  const status = wash.estimate.operatingStatus;
  const open = status === 'open';
  const unavailable = status === 'closed' || status === 'unavailable';
  const hasQueueData = hasQueueEvidence(wash, wash.estimate);
  const queueMinutes = !unavailable && hasQueueData ? wash.estimate.waitMinutes : null;
  const estimatedPrefix = wash.estimate.dataState === 'ESTIMATED' ? '~' : '';
  const price = startingPrice(wash);
  const typeLabel = wash.types.length ? WASH_TYPE_CONFIG[wash.types[0]].label : 'Type unknown';
  const statusLabel = open ? 'Open now' : status === 'closed' ? 'Closed' : status === 'unavailable' ? 'Unavailable' : 'Hours unknown';
  const tone = waitTone(queueMinutes, unavailable);
  const freshness = freshnessTone(wash.estimate.lastUpdatedAt);
  const queueAndWashMinutes = queueMinutes === null ? null : Math.max(0, queueMinutes + wash.estimatedWashMinutes);
  const bestLabel = open && hasQueueData ? 'BEST RIGHT NOW' : 'BEST AVAILABLE ESTIMATE';
  const carsLabel = carsAheadLabel(wash.estimate.estimatedCars);

  const viewDetails = () => {
    analytics.track('wash_viewed', {washId: wash.id});
    if (best) analytics.track('best_right_now_selected', {washId: wash.id});
  };

  const directions = () => {
    analytics.track('directions_clicked', {washId: wash.id, from: best ? 'best' : 'card'});
    window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');
  };

  const noQueueTitle = status === 'closed'
    ? 'Closed'
    : status === 'unavailable'
      ? 'Unavailable'
      : 'No recent reports';

  return (
    <article className={'wash-card wash-card-v2 ' + (best ? 'best-card' : '') + (compact ? ' compact-card' : '')}>
      <div className="card-kicker wash-card-v2-top">
        <div className="wash-card-v2-title">
          {best && <span className="wash-card-v2-best"><span aria-hidden="true">✦</span> {bestLabel}</span>}
          <Link to={'/wash/' + wash.id} onClick={viewDetails}><h2>{wash.name}</h2></Link>
          <div className="wash-card-v2-location">
            <button type="button" onClick={directions} aria-label={'Get directions to ' + wash.name}>
              <MapPin size={14} />
              <strong>{wash.distanceKm.toFixed(1)} km</strong>
              <span>Directions</span>
              <Navigation size={12} />
            </button>
            <span className="wash-card-v2-address">{wash.address}</span>
          </div>
        </div>
        <button className={'icon-button wash-card-v2-save ' + (saved ? 'is-saved' : '')} onClick={onSave} aria-label={saved ? 'Remove from saved washes' : 'Save this wash'}>
          <Heart size={20} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="wash-card-v2-meta" aria-label="Wash details">
        <span className="wash-card-v2-type">{typeLabel}</span>
        <span className={'wash-card-v2-status ' + (unavailable ? 'unavailable' : '')}>{statusLabel}</span>
        {Number.isFinite(price) && <span className="wash-card-v2-price">From {money(price)}</span>}
      </div>

      <div className={'wash-card-v2-focus ' + tone}>
        {queueMinutes !== null ? (
          <>
            <div className="wash-card-v2-wait">
              <div className="wash-card-v2-wait-value"><strong>{estimatedPrefix}{queueMinutes}</strong><span>min</span></div>
              <small>WAIT NOW</small>
            </div>
            <div className="wash-card-v2-evidence">
              <div className="wash-card-v2-cars"><CarFront size={18} /><strong>{carsLabel}</strong></div>
              <div className={'wash-card-v2-freshness ' + freshness}><i aria-hidden="true" /><span>{minutesAgo(wash.estimate.lastUpdatedAt)}</span></div>
            </div>
          </>
        ) : (
          <div className="wash-card-v2-unknown">
            <strong>{noQueueTitle}</strong>
            {!unavailable && <span>Be the first to update queue</span>}
          </div>
        )}
      </div>

      {queueAndWashMinutes !== null && (
        <div className="wash-card-v2-total">
          <Clock3 size={15} />
          <span>Queue + wash</span>
          <strong>~{queueAndWashMinutes} min</strong>
        </div>
      )}

      <div className="card-actions wash-card-v2-actions">
        {onReport && <button className="queue-update-button" onClick={onReport}>Update queue</button>}
        <Link className="secondary-button" to={'/wash/' + wash.id} onClick={viewDetails}>Details</Link>
      </div>
    </article>
  );
}
