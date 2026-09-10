import {useEffect, useMemo, useRef, useState} from 'react';
import type {Point, RankedWash} from '../domain/models';
import {hasQueueEvidence} from '../domain/engine';
import {appConfig} from '../config/env';

function project(point: Point, zoom: number) {
  const n = 2 ** zoom;
  return {
    x: ((point.lng + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan((point.lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  };
}

function unproject(point: {x: number; y: number}, zoom: number): Point {
  const n = 2 ** zoom;
  const lng = (point.x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * point.y) / n))) * 180) / Math.PI;
  return {lat, lng};
}

type Cluster = {x: number; y: number; washes: RankedWash[]};

function clusterWashes(washes: RankedWash[], zoom: number) {
  const threshold = 38 / 256;
  const clusters: Cluster[] = [];

  for (const wash of washes) {
    const point = project(wash.position, zoom);
    const existing = clusters.find((cluster) => Math.hypot(cluster.x - point.x, cluster.y - point.y) < threshold);
    if (!existing) {
      clusters.push({x: point.x, y: point.y, washes: [wash]});
      continue;
    }
    const count = existing.washes.length;
    existing.x = (existing.x * count + point.x) / (count + 1);
    existing.y = (existing.y * count + point.y) / (count + 1);
    existing.washes.push(wash);
  }

  return clusters;
}

function markerState(wash: RankedWash) {
  const unavailable = wash.estimate.operatingStatus === 'closed' || wash.estimate.operatingStatus === 'unavailable';
  const knownWait = !unavailable && hasQueueEvidence(wash, wash.estimate);
  if (unavailable) return {tone: 'closed', knownWait: false};
  if (!knownWait) return {tone: 'unknown', knownWait: false};
  if (wash.estimate.waitMinutes <= 15) return {tone: 'short', knownWait: true};
  if (wash.estimate.waitMinutes <= 39) return {tone: 'moderate', knownWait: true};
  return {tone: 'long', knownWait: true};
}

export function OpenMap({washes, origin, selectedId, onSelect, onSearchArea}: {
  washes: RankedWash[];
  origin: Point;
  selectedId?: string;
  onSelect: (wash: RankedWash) => void;
  onSearchArea: (point: Point) => void;
}) {
  const [zoom, setZoom] = useState(12);
  const [offset, setOffset] = useState({x: 0, y: 0});
  const [tilesFailed, setTilesFailed] = useState(false);
  const drag = useRef<{x: number; y: number; startX: number; startY: number} | null>(null);
  const center = useMemo(() => {
    const value = project(origin, zoom);
    return {x: value.x + offset.x, y: value.y + offset.y};
  }, [origin, offset, zoom]);
  const clusters = useMemo(() => clusterWashes(washes, zoom), [washes, zoom]);
  const mapMoved = Math.abs(offset.x) > 0.015 || Math.abs(offset.y) > 0.015;
  const searchPoint = useMemo(() => unproject(center, zoom), [center, zoom]);
  const tileUrl = (z: number, x: number, y: number) => appConfig.mapTileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

  useEffect(() => {
    setOffset({x: 0, y: 0});
  }, [origin.lat, origin.lng]);

  const zoomToCluster = (cluster: Cluster) => {
    const target = unproject({x: cluster.x, y: cluster.y}, zoom);
    const nextZoom = Math.min(16, zoom + 2);
    const targetAtNextZoom = project(target, nextZoom);
    const originAtNextZoom = project(origin, nextZoom);
    setZoom(nextZoom);
    setOffset({x: targetAtNextZoom.x - originAtNextZoom.x, y: targetAtNextZoom.y - originAtNextZoom.y});
  };

  return (
    <div
      className="wash-map"
      aria-label="Interactive map of nearby car washes"
      onPointerDown={(event) => {
        drag.current = {x: offset.x, y: offset.y, startX: event.clientX, startY: event.clientY};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setOffset({
          x: drag.current.x - (event.clientX - drag.current.startX) / 256,
          y: drag.current.y - (event.clientY - drag.current.startY) / 256,
        });
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <div className="map-grid" aria-hidden="true">
        {Array.from({length: 25}, (_, index) => {
          const x = Math.floor(center.x) + (index % 5) - 2;
          const y = Math.floor(center.y) + Math.floor(index / 5) - 2;
          return !tilesFailed && (
            <img
              key={zoom + '-' + x + '-' + y}
              alt=""
              src={tileUrl(zoom, x, y)}
              onError={() => setTilesFailed(true)}
              draggable={false}
              style={{
                left: 'calc(50% + ' + ((x - center.x) * 256) + 'px)',
                top: 'calc(50% + ' + ((y - center.y) * 256) + 'px)',
              }}
            />
          );
        })}
      </div>

      {tilesFailed && <p className="map-fallback">Map tiles are unavailable. Wash pins still show their relative position.</p>}

      {clusters.map((cluster) => {
        const left = 'calc(50% + ' + ((cluster.x - center.x) * 256) + 'px)';
        const top = 'calc(50% + ' + ((cluster.y - center.y) * 256) + 'px)';

        if (cluster.washes.length > 1) {
          const containsSelection = cluster.washes.some((wash) => wash.id === selectedId);
          return (
            <button
              key={cluster.washes.map((wash) => wash.id).join('-')}
              className={'map-cluster' + (containsSelection ? ' selected' : '')}
              style={{left, top}}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => zoomToCluster(cluster)}
              aria-label={`${cluster.washes.length} car washes nearby. Zoom in to separate them.`}
            >
              {cluster.washes.length}
            </button>
          );
        }

        const wash = cluster.washes[0];
        const state = markerState(wash);
        const unavailable = wash.estimate.operatingStatus === 'closed' || wash.estimate.operatingStatus === 'unavailable';
        const accessibleStatus = unavailable
          ? 'currently unavailable'
          : state.knownWait
            ? `${Math.round(wash.estimate.waitMinutes)} minute estimated wait`
            : 'no recent wait data';

        return (
          <button
            key={wash.id}
            className={'map-pin ' + state.tone + (selectedId === wash.id ? ' selected' : '')}
            style={{left, top}}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect(wash)}
            aria-label={`${wash.name}, ${accessibleStatus}`}
          >
            {state.knownWait
              ? <span>{Math.round(wash.estimate.waitMinutes)}</span>
              : <span className="map-pin-dot" aria-hidden="true" />}
          </button>
        );
      })}

      <span
        className="user-pin"
        style={{left: 'calc(50% - ' + offset.x * 256 + 'px)', top: 'calc(50% - ' + offset.y * 256 + 'px)'}}
        aria-label="Current search origin"
      />

      {mapMoved && <>
        <span className="map-search-target" aria-hidden="true" />
        <button
          className="map-search-area-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onSearchArea(searchPoint)}
        >
          Search this area
        </button>
      </>}

      <div className="map-controls">
        <button aria-label="Zoom map in" onClick={() => setZoom((value) => Math.min(16, value + 1))}>+</button>
        <button aria-label="Zoom map out" onClick={() => setZoom((value) => Math.max(10, value - 1))}>−</button>
        <button aria-label="Return to search location" onClick={() => setOffset({x: 0, y: 0})}>◎</button>
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{appConfig.mapAttribution}</a>
      <div className="map-legend" aria-label="Wait-time marker legend">
        <span><i className="short" /> 0–15 min</span>
        <span><i className="moderate" /> 16–39 min</span>
        <span><i className="long" /> 40+ min</span>
        <span><i className="unknown" /> No recent wait</span>
      </div>
    </div>
  );
}
