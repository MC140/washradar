import type {Point} from '../domain/models';
import {repository} from './index';

type PostalRow = [searchKey: string, label: string, lat: number, lng: number, kind: 'postal'];
type PostalIndex = {source?: string; license?: string; areas?: PostalRow[]};

let installed = false;
let indexPromise: Promise<PostalIndex> | null = null;

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fsa(value: string) {
  const valueCompact = compact(value);
  return /^[a-z]\d[a-z]/i.test(valueCompact) ? valueCompact.slice(0, 3) : '';
}

function baseUrl(path: string) {
  return new URL(path.replace(/^\//, ''), new URL(import.meta.env.BASE_URL, window.location.href)).toString();
}

async function loadPostalIndex(): Promise<PostalIndex> {
  if (!indexPromise) {
    // Postal data is a tiny static file. Always revalidate it so an older Safari/PWA cache
    // can never preserve a missing or stale postal index after a production deployment.
    indexPromise = fetch(baseUrl('postal-index.json'), {cache: 'no-cache'})
      .then(async (response) => response.ok ? await response.json() as PostalIndex : {areas: []})
      .catch(() => ({areas: []}));
  }
  return indexPromise;
}

async function postalPoint(query: string): Promise<Point | null> {
  const postalFsa = fsa(query);
  if (!postalFsa) return null;
  const index = await loadPostalIndex();
  const match = (index.areas ?? []).find(([key]) => compact(key) === postalFsa);
  return match ? {lat: Number(match[2]), lng: Number(match[3])} : null;
}

export function installPostalSearch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const downstreamSearch = repository.searchLocation.bind(repository);
  repository.searchLocation = async (query: string) => {
    const localPostal = await postalPoint(query);
    if (localPostal) return localPostal;
    return downstreamSearch(query);
  };
}
