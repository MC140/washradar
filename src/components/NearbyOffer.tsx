import {ExternalLink, Megaphone} from 'lucide-react';
import {useEffect, useRef} from 'react';
import type {AdCreative} from '../domain/models';
import {analytics} from '../services/analytics';
import {repository} from '../services';

export function NearbyOffer({ad, placement}: {ad: AdCreative; placement: string}) {
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    analytics.track('ad_impression', {campaignId: ad.campaignId, placement});
    void repository.recordAdEvent(ad, 'impression', placement);
  }, [ad, placement]);
  return (
    <aside className="nearby-offer" aria-label={ad.disclosure + ' from ' + ad.businessName}>
      <span className="sponsored-label"><Megaphone size={13} /> {ad.disclosure}</span>
      <div>
        <strong>{ad.headline}</strong>
        <p>{ad.body}</p>
        <small>{ad.businessName}{ad.distanceKm ? ' · ' + ad.distanceKm.toFixed(1) + ' km away' : ''}</small>
      </div>
      <a href={ad.destinationUrl} target="_blank" rel="sponsored noopener noreferrer" onClick={() => {
        analytics.track('ad_click', {campaignId: ad.campaignId, placement});
        void repository.recordAdEvent(ad, 'click', placement);
      }}>{ad.callToAction} <ExternalLink size={14} /></a>
    </aside>
  );
}
