import {ArrowUpRight, Car, Clock3, Droplets, Heart, MapPin, ShieldCheck, Star} from 'lucide-react';
import {Link} from 'react-router-dom';
import {WASH_TYPE_CONFIG} from '../domain/config';
import {startingPrice} from '../domain/engine';
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
  const hasQueueData = wash.estimate.recentSignalCount > 0 || wash.historicalSampleCount > 0;
  const queueMinutes = !unavailable && hasQueueData ? wash.estimate.waitMinutes : null;
  const startsInMinutes = queueMinutes === null ? null : wash.driveMinutes + queueMinutes;
  const doneInMinutes = startsInMinutes === null ? null : startsInMinutes + wash.estimatedWashMinutes;
  const estimatedPrefix = wash.estimate.dataState === 'ESTIMATED' ? '~' : '';
  const price = startingPrice(wash);
  const queueTone = unavailable || queueMinutes === null ? '' : queueMinutes <= 10 ? 'short' : queueMinutes <= 25 ? 'moderate' : 'long';
  const statusLabel = open ? 'Open now' : status === 'closed' ? 'Closed' : status === 'unavailable' ? 'Unavailable' : 'Hours unknown';
  const directions = () => {
    analytics.track('directions_clicked', {washId: wash.id, from: best ? 'best' : 'card'});
    window.open(directionsUrl(wash), '_blank', 'noopener,noreferrer');
  };

  return (
    <article className={'wash-card ' + (best ? 'best-card' : '') + (compact ? ' compact-card' : '')}>
      <div className="card-kicker">
        {best ? <span className="eyebrow"><span aria-hidden="true">✦</span> BEST RIGHT NOW</span> : <span className="wash-icon"><Droplets size={20} /></span>}
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
          <p><MapPin size={14} /> {wash.address} · {wash.distanceKm.toFixed(1)} km</p>
        </div>
        <div className={'queue-number ' + queueTone}>
          <strong>{unavailable || queueMinutes === null ? '—' : estimatedPrefix + queueMinutes}</strong>
          <span>{status === 'closed' ? 'Closed' : status === 'unavailable' ? 'Unavailable' : queueMinutes === null ? 'queue unknown' : 'min queue'}</span>
        </div>
      </div>

      <div className="tag-row">
        {wash.types.slice(0, 2).map((type) => <span key={type}>{WASH_TYPE_CONFIG[type].label}</span>)}
        <span>{Number.isFinite(price) ? 'From ' + money(price) : 'Price unknown'}</span>
        <span className={open ? 'open-tag' : unavailable ? 'closed-tag' : ''}>{statusLabel}</span>
      </div>

      <div
        className="time-equation"
        style={{gridTemplateColumns: 'repeat(5, minmax(0, 1fr))'}}
        aria-label={'Drive ' + wash.driveMinutes + ' minutes, queue ' + (queueMinutes === null ? 'unknown' : queueMinutes + ' minutes') + ', wash about ' + wash.estimatedWashMinutes + ' minutes, starts in ' + (startsInMinutes === null ? 'unknown' : startsInMinutes + ' minutes') + ', done in ' + (doneInMinutes === null ? 'unknown' : doneInMinutes + ' minutes')}
      >
        <span><Car size={16} /><b>{wash.driveMinutes}m</b><small>Drive</small></span>
        <span><Clock3 size={16} /><b>{queueMinutes === null ? '—' : estimatedPrefix + queueMinutes + 'm'}</b><small>{wash.estimate.estimatedCars !== null ? 'Queue · ~' + wash.estimate.estimatedCars + ' cars' : 'Queue'}</small></span>
        <span><Droplets size={16} /><b>~{wash.estimatedWashMinutes}m</b><small>Wash</small></span>
        <span><Clock3 size={16} /><b>{startsInMinutes === null ? '—' : '~' + startsInMinutes + 'm'}</b><small>Starts in</small></span>
        <span className="total"><b>{doneInMinutes === null ? '—' : '~' + doneInMinutes + 'm'}</b><small>Done in</small></span>
      </div>

      <div className="trust-row">
        <span className={'data-state ' + wash.estimate.dataState.toLowerCase().replace(' ', '-')}>{wash.estimate.dataState}</span>
        <span><ShieldCheck size={14} /> {wash.estimate.confidenceLabel}</span>
        <span>{minutesAgo(wash.estimate.lastUpdatedAt)}</span>
        {wash.rating !== null && <span><Star size={14} fill="currentColor" /> {wash.rating.toFixed(1)} <small>({wash.ratingCount})</small></span>}
      </div>

      {wash.reasons.length > 0 && <p className="decision-reason">{wash.reasons[0]}</p>}

      <div className="card-actions">
        <button className="primary-button" onClick={directions}><ArrowUpRight size={17} /> Directions</button>
        {onReport && <button className="secondary-button" onClick={onReport}>Share what you see</button>}
        <Link className="secondary-button" to={'/wash/' + wash.id} onClick={() => {
          analytics.track('wash_viewed', {washId: wash.id});
          if (best) analytics.track('best_right_now_selected', {washId: wash.id});
        }}>Details</Link>
      </div>
    </article>
  );
}
