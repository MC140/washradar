import {useEffect, useRef} from 'react';
import type {Point, RankedWash} from '../domain/models';
import {appConfig} from '../config/env';

type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
  Marker: new (options: Record<string, unknown>) => {addListener: (event: string, callback: () => void) => void};
};

declare global {
  interface Window {
    google?: {maps: GoogleMaps};
  }
}

export function GoogleMap({washes, origin, onSelect, onFailure}: {washes: RankedWash[]; origin: Point; onSelect: (wash: RankedWash) => void; onFailure: () => void}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!window.google) {
          await new Promise<void>((resolve, reject) => {
            const existing = document.querySelector<HTMLScriptElement>('script[data-washradar-google]');
            if (existing) {
              existing.addEventListener('load', () => resolve(), {once: true});
              existing.addEventListener('error', reject, {once: true});
              return;
            }
            const script = document.createElement('script');
            script.dataset.washradarGoogle = 'true';
            script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(appConfig.googleMapsBrowserKey) + '&v=weekly';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }
        if (cancelled || !container.current || !window.google) return;
        const map = new window.google.maps.Map(container.current, {center: origin, zoom: 12, disableDefaultUI: true, zoomControl: true});
        washes.forEach((wash) => {
          const marker = new window.google!.maps.Marker({
            map,
            position: wash.position,
            title: wash.name + ' · ' + wash.estimate.waitMinutes + ' min wait',
            label: wash.estimate.operatingStatus === 'open' ? String(wash.estimate.waitMinutes) : '×',
          });
          marker.addListener('click', () => onSelect(wash));
        });
      } catch {
        onFailure();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [onFailure, onSelect, origin, washes]);
  return <div className="wash-map" ref={container} aria-label="Google map of nearby car washes" />;
}
