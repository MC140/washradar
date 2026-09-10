import {useEffect, useRef, useState} from 'react';
import type {Point, RankedWash} from '../domain/models';
import {hasQueueEvidence} from '../domain/engine';
import {appConfig} from '../config/env';

type GoogleLatLng = {lat: () => number; lng: () => number};
type GoogleMapInstance = {
  getCenter: () => GoogleLatLng | undefined;
  addListener: (event: string, callback: () => void) => void;
};
type GoogleMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapInstance;
  Marker: new (options: Record<string, unknown>) => {addListener: (event: string, callback: () => void) => void};
};

declare global {
  interface Window {
    google?: {maps: GoogleMaps};
  }
}

export function GoogleMap({washes, origin, onSelect, onSearchArea, onFailure}: {
  washes: RankedWash[];
  origin: Point;
  selectedId?: string;
  onSelect: (wash: RankedWash) => void;
  onSearchArea: (point: Point) => void;
  onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [candidatePoint, setCandidatePoint] = useState<Point>();

  useEffect(() => {
    let cancelled = false;
    setCandidatePoint(undefined);
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
        map.addListener('dragend', () => {
          const center = map.getCenter();
          if (center) setCandidatePoint({lat: center.lat(), lng: center.lng()});
        });
        washes.forEach((wash) => {
          const unavailable = wash.estimate.operatingStatus === 'closed' || wash.estimate.operatingStatus === 'unavailable';
          const knownWait = !unavailable && hasQueueEvidence(wash, wash.estimate);
          const wait = Math.round(wash.estimate.waitMinutes);
          const marker = new window.google!.maps.Marker({
            map,
            position: wash.position,
            title: unavailable
              ? `${wash.name} · currently unavailable`
              : knownWait
                ? `${wash.name} · ${wait} min estimated wait`
                : `${wash.name} · no recent wait data`,
            label: knownWait ? String(wait) : undefined,
            opacity: unavailable ? 0.55 : 1,
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

  return <div className="wash-map google-map-shell" aria-label="Google map of nearby car washes">
    <div className="google-map-canvas" ref={container} />
    {candidatePoint && <>
      <span className="map-search-target" aria-hidden="true" />
      <button className="map-search-area-button" onClick={() => onSearchArea(candidatePoint)}>Search this area</button>
    </>}
  </div>;
}
