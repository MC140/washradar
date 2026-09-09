import type {Point} from '../domain/models';
import {repository} from './index';

type AddressSuggestion = {
  label: string;
  point: Point;
  kind: 'address' | 'city' | 'postal';
};

type AddressChunkRow = [searchKey: string, label: string, lat: number, lng: number];
type AreaRow = [searchKey: string, label: string, lat: number, lng: number, kind: 'city' | 'postal'];
type AreaIndex = {release?: string; areas?: AreaRow[]};

const selectedPoints = new Map<string, Point>();
const chunkCache = new Map<string, Promise<AddressChunkRow[]>>();
let areaIndexPromise: Promise<AreaIndex> | null = null;
let installed = false;
let searchWrapped = false;

export function normalizeAddressQuery(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactKey(value: string) {
  return normalizeAddressQuery(value).replace(/[^a-z0-9]/g, '');
}

function baseUrl(path: string) {
  return new URL(path.replace(/^\//, ''), new URL(import.meta.env.BASE_URL, window.location.href)).toString();
}

async function loadAreas(): Promise<AreaIndex> {
  if (!areaIndexPromise) {
    areaIndexPromise = fetch(baseUrl('address-index/areas.json'), {cache: 'force-cache'})
      .then(async (response) => response.ok ? await response.json() as AreaIndex : {areas: []})
      .catch(() => ({areas: []}));
  }
  return areaIndexPromise;
}

async function loadChunk(query: string): Promise<AddressChunkRow[]> {
  const compact = compactKey(query);
  if (compact.length < 3 || !/^\d/.test(compact)) return [];
  const key = compact.slice(0, 3);
  if (!chunkCache.has(key)) {
    chunkCache.set(key, fetch(baseUrl(`address-index/chunks/${encodeURIComponent(key)}.json`), {cache: 'force-cache'})
      .then(async (response) => response.ok ? await response.json() as AddressChunkRow[] : [])
      .catch(() => []));
  }
  return chunkCache.get(key)!;
}

async function localSuggestions(query: string): Promise<AddressSuggestion[]> {
  const normalized = normalizeAddressQuery(query);
  if (normalized.length < 2) return [];

  const [areas, chunk] = await Promise.all([loadAreas(), loadChunk(query)]);
  const areaMatches = (areas.areas ?? [])
    .filter(([key, label]) => key.startsWith(normalized) || normalizeAddressQuery(label).startsWith(normalized))
    .slice(0, 4)
    .map(([, label, lat, lng, kind]) => ({label, point: {lat, lng}, kind} satisfies AddressSuggestion));

  const addressMatches = chunk
    .filter(([key]) => key.startsWith(normalized))
    .slice(0, 8)
    .map(([, label, lat, lng]) => ({label, point: {lat, lng}, kind: 'address' as const}));

  const seen = new Set<string>();
  return [...addressMatches, ...areaMatches]
    .filter((item) => {
      const key = normalizeAddressQuery(item.label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function exactLocalPoint(query: string): Promise<Point | null> {
  const key = normalizeAddressQuery(query);
  const selected = selectedPoints.get(key);
  if (selected) return selected;

  const areas = await loadAreas();
  const match = (areas.areas ?? []).find(([searchKey, label]) => searchKey === key || normalizeAddressQuery(label) === key);
  return match ? {lat: Number(match[2]), lng: Number(match[3])} : null;
}

function wrapRepositorySearch() {
  if (searchWrapped) return;
  searchWrapped = true;
  const providerSearch = repository.searchLocation.bind(repository);
  repository.searchLocation = async (query: string) => {
    const local = await exactLocalPoint(query);
    if (local) return local;
    return providerSearch(query);
  };
}

function installStyles() {
  if (document.getElementById('wr-address-autocomplete-style')) return;
  const style = document.createElement('style');
  style.id = 'wr-address-autocomplete-style';
  style.textContent = `
    .wr-autocomplete-host { position: relative !important; }
    .wr-autocomplete-menu {
      position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 80;
      background: var(--surface, #fff); border: 1px solid rgba(15,23,42,.14);
      border-radius: 14px; box-shadow: 0 18px 45px rgba(15,23,42,.16);
      overflow: hidden; max-height: 320px; overflow-y: auto;
    }
    .wr-autocomplete-menu[hidden] { display: none !important; }
    .wr-autocomplete-option {
      width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer;
      padding: 11px 13px; display: grid; gap: 2px; color: inherit;
    }
    .wr-autocomplete-option + .wr-autocomplete-option { border-top: 1px solid rgba(15,23,42,.08); }
    .wr-autocomplete-option:hover, .wr-autocomplete-option.is-active { background: rgba(15,118,110,.08); }
    .wr-autocomplete-option strong { font: inherit; font-weight: 650; line-height: 1.25; }
    .wr-autocomplete-option small { opacity: .62; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .wr-autocomplete-note { padding: 8px 13px; font-size: 11px; opacity: .6; border-top: 1px solid rgba(15,23,42,.08); }
  `;
  document.head.appendChild(style);
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', {bubbles: true}));
}

function enhanceInput(input: HTMLInputElement) {
  if (input.dataset.wrAddressAutocomplete === 'true') return;
  input.dataset.wrAddressAutocomplete = 'true';
  input.autocomplete = 'off';
  input.setAttribute('aria-autocomplete', 'list');

  const host = input.closest('label') ?? input.parentElement;
  if (!host) return;
  host.classList.add('wr-autocomplete-host');

  const menu = document.createElement('div');
  menu.className = 'wr-autocomplete-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  host.appendChild(menu);

  let suggestions: AddressSuggestion[] = [];
  let activeIndex = -1;
  let requestVersion = 0;
  let debounceTimer = 0;

  const close = () => {
    suggestions = [];
    activeIndex = -1;
    menu.hidden = true;
    menu.replaceChildren();
    input.removeAttribute('aria-activedescendant');
  };

  const commit = (item: AddressSuggestion) => {
    selectedPoints.set(normalizeAddressQuery(item.label), item.point);
    setReactInputValue(input, item.label);
    close();
    window.setTimeout(() => input.form?.requestSubmit(), 0);
  };

  const render = (items: AddressSuggestion[]) => {
    suggestions = items;
    activeIndex = items.length ? 0 : -1;
    menu.replaceChildren();
    if (!items.length) {
      menu.hidden = true;
      return;
    }
    items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wr-autocomplete-option' + (index === activeIndex ? ' is-active' : '');
      button.id = `wr-address-option-${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      const title = document.createElement('strong');
      title.textContent = item.label;
      const type = document.createElement('small');
      type.textContent = item.kind === 'address' ? 'GTA address · local index' : item.kind === 'postal' ? 'Postal area · local index' : 'City · local index';
      button.append(title, type);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        commit(item);
      });
      menu.appendChild(button);
    });
    const note = document.createElement('div');
    note.className = 'wr-autocomplete-note';
    note.textContent = 'Local GTA address data — no paid map lookup';
    menu.appendChild(note);
    menu.hidden = false;
    input.setAttribute('aria-activedescendant', 'wr-address-option-0');
  };

  const refresh = () => {
    window.clearTimeout(debounceTimer);
    const query = input.value;
    if (normalizeAddressQuery(query).length < 2) {
      close();
      return;
    }
    debounceTimer = window.setTimeout(() => {
      const version = ++requestVersion;
      void localSuggestions(query).then((items) => {
        if (version === requestVersion && document.activeElement === input) render(items);
      });
    }, 120);
  };

  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => window.setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (menu.hidden || !suggestions.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + direction + suggestions.length) % suggestions.length;
      [...menu.querySelectorAll<HTMLButtonElement>('.wr-autocomplete-option')].forEach((button, index) => {
        button.classList.toggle('is-active', index === activeIndex);
        button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      });
      input.setAttribute('aria-activedescendant', `wr-address-option-${activeIndex}`);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      commit(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}

function scanForInputs() {
  document.querySelectorAll<HTMLInputElement>('input[placeholder*="city, postal code or address" i]')
    .forEach(enhanceInput);
}

export function installAddressAutocomplete() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  wrapRepositorySearch();
  installStyles();
  scanForInputs();
  const observer = new MutationObserver(scanForInputs);
  observer.observe(document.documentElement, {childList: true, subtree: true});
}
