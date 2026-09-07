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
  compact = false,
}: {
  wash: RankedWash;
  best?: boolean;
  saved: boolean;
  onSave: () => void;
  compact?: boolean;
}) {
  const open = wash.estimate.operatingStatus === 'open';
  const price = startingPrice(wash);
  const queueTone = !open ? 'closed' : wash.estimate.waitMinutes <= 10 ? 'short' : wash.estimate.waitMinutes <= 25 ? 'moderate' : 'long';
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
          <strong>{open ? (wash.estimate.dataState === 'ESTIMATED' ? '~' : '') + wash.estimate.waitMinutes : '—'}</strong>
          <span>{open ? 'min wait' : wash.estimate.operatingStatus === 'closed' ? 'Closed' : 'Unavailable'}</span>
        </div>
      </div>

      <div className="tag-row">
        {wash.types.slice(0, 2).map((type) => <span key={type}>{WASH_TYPE_CONFIG[type].label}</span>)}
        <span>{Number.isFinite(price) ? 'From ' + money(price) : 'Price unknown'}</span>
        <span className={open ? 'open-tag' : 'closed-tag'}>{open ? 'Open now' : 'Not available'}</span>
      </div>

      <div className="time-equation" aria-label={'Drive ' + wash.driveMinutes + ' minutes, wait ' + wash.estimate.waitMinutes + ' minutes, wash ' + wash.estimatedWashMinutes + ' minutes, total ' + wash.totalMinutes + ' minutes'}>
        <span><Car size={16} /><b>{wash.driveMinutes}m</b><small>Drive</small></span>
        <i aria-hidden="true">+</i>
        <span><Clock3 size={16} /><b>{wash.estimate.waitMinutes}m</b><small>Wait</small></span>
        <i aria-hidden="true">+</i>
        <span><Droplets size={16} /><b>{wash.estimatedWashMinutes}m</b><small>Wash</small></span>
        <i aria-hidden="true">=</i>
        <span className="total"><b>{wash.totalMinutes}m</b><small>Total</small></span>
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
        <Link className="secondary-button" to={'/wash/' + wash.id} onClick={() => {
          analytics.track('wash_viewed', {washId: wash.id});
          if (best) analytics.track('best_right_now_selected', {washId: wash.id});
        }}>View details</Link>
      </div>
    </article>
  );
}
