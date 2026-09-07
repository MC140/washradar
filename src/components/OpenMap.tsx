import {useMemo, useRef, useState} from 'react';
import type {Point, RankedWash} from '../domain/models';
import {appConfig} from '../config/env';

function project(point: Point, zoom: number) {
  const n = 2 ** zoom;
  return {
    x: ((point.lng + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan((point.lat * Math.PI) / 180)) / Math.PI) / 2) * n,
  };
}

export function OpenMap({washes, origin, selectedId, onSelect}: {washes: RankedWash[]; origin: Point; selectedId?: string; onSelect: (wash: RankedWash) => void}) {
  const [zoom, setZoom] = useState(12);
  const [offset, setOffset] = useState({x: 0, y: 0});
  const [tilesFailed, setTilesFailed] = useState(false);
  const drag = useRef<{x: number; y: number; startX: number; startY: number} | null>(null);
  const center = useMemo(() => {
    const value = project(origin, zoom);
    return {x: value.x + offset.x, y: value.y + offset.y};
  }, [origin, offset, zoom]);
  const tileUrl = (z: number, x: number, y: number) => appConfig.mapTileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

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
      {washes.map((wash) => {
        const point = project(wash.position, zoom);
        const status = wash.estimate.operatingStatus !== 'open'
          ? 'closed'
          : wash.estimate.dataState === 'ESTIMATED' && wash.estimate.confidenceLabel === 'Limited Data'
            ? 'unknown'
            : wash.estimate.waitMinutes <= 10 ? 'short' : wash.estimate.waitMinutes <= 25 ? 'moderate' : 'long';
        return (
          <button
            key={wash.id}
            className={'map-pin ' + status + (selectedId === wash.id ? ' selected' : '')}
            style={{
              left: 'calc(50% + ' + ((point.x - center.x) * 256) + 'px)',
              top: 'calc(50% + ' + ((point.y - center.y) * 256) + 'px)',
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect(wash)}
            aria-label={wash.name + ', ' + wash.estimate.waitMinutes + ' minute wait'}
          >
            {wash.estimate.operatingStatus === 'open'
              ? wash.estimate.confidenceLabel === 'Limited Data' ? '?' : wash.estimate.waitMinutes + 'm'
              : '×'}
          </button>
        );
      })}
      <span className="user-pin" style={{left: 'calc(50% - ' + offset.x * 256 + 'px)', top: 'calc(50% - ' + offset.y * 256 + 'px)'}} aria-hidden="true" />
      <div className="map-controls">
        <button aria-label="Zoom map in" onClick={() => setZoom((value) => Math.min(16, value + 1))}>+</button>
        <button aria-label="Zoom map out" onClick={() => setZoom((value) => Math.max(10, value - 1))}>−</button>
        <button aria-label="Reset map position" onClick={() => setOffset({x: 0, y: 0})}>◎</button>
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{appConfig.mapAttribution}</a>
      <div className="map-legend"><span><i className="short" /> 0–10m</span><span><i className="moderate" /> 11–25m</span><span><i className="long" /> 26m+</span><span><i className="unknown" /> estimate</span></div>
    </div>
  );
}
