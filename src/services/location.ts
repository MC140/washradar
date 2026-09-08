import type {Point, RankedWash} from '../domain/models';

export function requestLocation(): Promise<{point: Point; accuracy: number}> {
  if (!navigator.geolocation) return Promise.reject(new Error('GPS is unavailable in this browser. Search by city, postal code or address instead.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        point: {lat: position.coords.latitude, lng: position.coords.longitude},
        accuracy: position.coords.accuracy,
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Location permission is blocked for this site. Allow location access in your browser settings, then try again.'));
          return;
        }
        if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new Error('Your location could not be determined right now. Try again outdoors or search by city, postal code or address.'));
          return;
        }
        if (error.code === error.TIMEOUT) {
          reject(new Error('Location lookup timed out. Try again or search by city, postal code or address.'));
          return;
        }
        reject(new Error('Location was not shared. Search by city, postal code or address instead.'));
      },
      {enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000},
    );
  });
}

export function directionsUrl(wash: RankedWash): string {
  const destination = encodeURIComponent(wash.position.lat + ',' + wash.position.lng);
  if (/iPhone|iPad|Macintosh/.test(navigator.userAgent)) {
    return 'https://maps.apple.com/?daddr=' + destination + '&dirflg=d';
  }
  return 'https://www.google.com/maps/dir/?api=1&destination=' + destination + '&travelmode=driving';
}

export function geocodeDemoSearch(query: string, washes: RankedWash[]): Point | null {
  const normalized = query.trim().toLowerCase();
  const match = washes.find((wash) =>
    [wash.name, wash.address, wash.city, wash.postalCode].some((value) => value.toLowerCase().includes(normalized)),
  );
  if (match) return match.position;
  const known: Record<string, Point> = {
    mississauga: {lat: 43.589, lng: -79.644},
    milton: {lat: 43.5183, lng: -79.8774},
    brampton: {lat: 43.7315, lng: -79.7624},
    toronto: {lat: 43.6532, lng: -79.3832},
    oakville: {lat: 43.4675, lng: -79.6877},
    'l5b': {lat: 43.589, lng: -79.644},
    'l9t': {lat: 43.5183, lng: -79.8774},
  };
  return Object.entries(known).find(([key]) => normalized.includes(key))?.[1] ?? null;
}
