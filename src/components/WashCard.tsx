import {Clock3, Droplets, Heart, MapPin, Navigation, ShieldCheck, Star} from 'lucide-react';
import {Link} from 'react-router-dom';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {hasQueueEvidence, startingPrice} from '../domain/engine';
import type {RankedWash} from '../domain/models';
import {analytics} from '../services/analytics';
import {directionsUrl} from '../services/location';
import {minutesAgo, money} from '../utils/format';

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
  const queueTone = unavailable || queueMinutes === null ? '' : queueMinutes <= 10 ? 'short' : queueMinutes <= 25 ? 'moderate' : 'long';
  const statusLabel = open ? 'Open now' : status === 'closed' ? 'Closed' : status === 'unavailable' ? 'Unavailable' : 'Hours unknown';
  const bestLabel = open && hasQueueData ? 'BEST RIGHT NOW' : 'BEST AVAILABLE ESTIMATE';
  const trustState = hasQueueData ? wash.estimate.dataState : 'LIMITED DATA';
  const directions = () => {
    analytics.track('directions_clicked', {washId: wash.id, from: best ? 'best' : 'card'});
    window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');
  };

  return (
    <article className={'wash-card ' + (best ? 'best-card' : '') + (compact ? ' compact-card' : '')}>
      <div className="card-kicker">
        {best ? <span className="eyebrow"><span aria-hidden="true">✦</span> {bestLabel}</span> : <span className="wash-icon"><Droplets size={20} /></span>}
        <button className={'icon-button ' + (saved ? 'is-saved' : '')} onClick={onSave} aria-label={saved ? 'Remove from saved washes' : 'Save this wash'}>
          <Heart size={20} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="card-heading">
        <div>
          <Link to={'/wash/' + wash.id} onClick={() => {
            analytics.track('wash_viewed', {washId: wash.id});
            if (best) analytics.track('best_right_now_selected', {washId: wash.id});
          }}>
            <h2>{wash.name}</h2>
          </Link>
          <p><MapPin size={14} /> {wash.address} · {wash.distanceKm.toFixed(1)} km away</p>
        </div>
        <div className={'queue-number ' + queueTone}>
          <button className="quick-directions" onClick={directions} aria-label={'Get directions to ' + wash.name}><Navigation size={13} /> Directions</button>
          <strong>{unavailable || queueMinutes === null ? '—' : estimatedPrefix + queueMinutes}</strong>
          <span>{status === 'closed' ? 'Closed' : status === 'unavailable' ? 'Unavailable' : queueMinutes === null ? 'queue unknown' : 'min queue'}</span>
        </div>
      </div>

      <div className="tag-row">
        {wash.types.slice(0, 2).map((type) => <span key={type}>{WASH_TYPE_CONFIG[type].label}</span>)}
        {!wash.types.length && <span>Wash type unknown</span>}
        <span>{Number.isFinite(price) ? 'From ' + money(price) : 'Price unknown'}</span>
        <span className={open ? 'open-tag' : unavailable ? 'closed-tag' : ''}>{statusLabel}</span>
      </div>

      <div
        className="time-equation"
        style={{gridTemplateColumns: 'repeat(3, minmax(0, 1fr))'}}
        aria-label={'Distance ' + wash.distanceKm.toFixed(1) + ' kilometres, queue ' + (queueMinutes === null ? 'unknown' : queueMinutes + ' minutes') + ', wash about ' + wash.estimatedWashMinutes + ' minutes'}
      >
        <span><MapPin size={16} /><b>{wash.distanceKm.toFixed(1)} km</b><small>Distance</small></span>
        <span><Clock3 size={16} /><b>{queueMinutes === null ? '—' : estimatedPrefix + queueMinutes + 'm'}</b><small>{wash.estimate.estimatedCars !== null ? 'Queue · ~' + wash.estimate.estimatedCars + ' cars' : 'Queue'}</small></span>
        <span><Droplets size={16} /><b>~{wash.estimatedWashMinutes}m</b><small>Wash est.</small></span>
      </div>

      <div className="trust-row">
        <span className={'data-state ' + (hasQueueData ? wash.estimate.dataState.toLowerCase().replace(' ', '-') : 'estimated')}>{trustState}</span>
        <span><ShieldCheck size={14} /> {hasQueueData ? wash.estimate.confidenceLabel : 'Queue unknown'}</span>
        <span>{hasQueueData ? minutesAgo(wash.estimate.lastUpdatedAt) : 'No queue evidence yet'}</span>
        {wash.rating !== null && <span><Star size={14} fill="currentColor" /> {wash.rating.toFixed(1)} <small>({wash.ratingCount})</small></span>}
      </div>

      {wash.reasons.length > 0 && <p className="decision-reason">{wash.reasons[0]}</p>}

      <div className="card-actions">
        {onReport && <button className="queue-update-button" onClick={onReport}>Update queue</button>}
        <Link className="secondary-button" to={'/wash/' + wash.id} onClick={() => {
          analytics.track('wash_viewed', {washId: wash.id});
          if (best) analytics.track('best_right_now_selected', {washId: wash.id});
        }}>Details</Link>
      </div>
    </article>
  );
}
