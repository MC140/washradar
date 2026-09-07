import {useCallback, useState} from 'react';
import {appConfig} from '../config/env';
import type {Point, RankedWash} from '../domain/models';
import {GoogleMap} from './GoogleMap';
import {OpenMap} from './OpenMap';

export function MapView(props: {washes: RankedWash[]; origin: Point; selectedId?: string; onSelect: (wash: RankedWash) => void}) {
  const [googleFailed, setGoogleFailed] = useState(false);
  const failure = useCallback(() => setGoogleFailed(true), []);
  if (appConfig.googleMapsBrowserKey && !googleFailed) return <GoogleMap {...props} onFailure={failure} />;
  return <OpenMap {...props} />;
}
