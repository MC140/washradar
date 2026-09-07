import {WASH_TYPE_CONFIG} from '../domain/config';
import type {AdCreative, CarWash, QueueSignal, WashPackage, WashType} from '../domain/models';

export const DEMO_ORIGIN = {lat: 43.589, lng: -79.644};

const locations = [
  ['ClearRoute Touchless', '6800 Meadowvale Town Centre Cir', 'Mississauga', 43.5837, -79.7591, 'touchless', 14.99, 4.6, 642, 3],
  ['Lakeshore Auto Spa', '815 Lakeshore Rd E', 'Mississauga', 43.5712, -79.5684, 'soft-cloth', 12.0, 4.3, 381, 30],
  ['Mavis Express Wash', '5900 Mavis Rd', 'Mississauga', 43.6106, -79.6951, 'tunnel', 16.99, 4.5, 920, 18],
  ['Dundas Clean Bay', '2200 Dundas St E', 'Mississauga', 43.6224, -79.5689, 'automatic', 13.99, 3.9, 212, 12],
  ['Erin Mills Rinse', '3105 Glen Erin Dr', 'Mississauga', 43.5217, -79.6831, 'touchless', 17.99, 4.7, 504, 0],
  ['Heartland Wash Works', '785 Britannia Rd W', 'Mississauga', 43.6115, -79.6934, 'soft-cloth', 15.99, 4.1, 289, 14],
  ['Streetsville Self Serve', '128 Queen St S', 'Mississauga', 43.5841, -79.7189, 'self-serve', 6.0, 4.0, 117, 7],
  ['Port Credit Auto Wash', '80 Lakeshore Rd E', 'Mississauga', 43.5527, -79.5852, 'automatic', 11.99, 4.4, 735, 10],
  ['Milton Clean Lane', '1095 Maple Ave', 'Milton', 43.5277, -79.8661, 'touchless', 15.0, 4.5, 312, 9],
  ['Steeles Express Tunnel', '150 Steeles Ave E', 'Milton', 43.5173, -79.8772, 'tunnel', 18.0, 4.6, 476, 6],
  ['Brampton Wash House', '50 Quarry Edge Dr', 'Brampton', 43.7047, -79.7708, 'soft-cloth', 13.5, 4.2, 655, 11],
  ['Queen Street Touchless', '10015 Hurontario St', 'Brampton', 43.7054, -79.7857, 'touchless', 16.5, 4.1, 298, 20],
  ['Dixie Auto Bath', '1550 South Gateway Rd', 'Mississauga', 43.632, -79.6142, 'automatic', 12.99, 3.8, 97, 8],
  ['Clarkson Hand Wash', '1880 Lakeshore Rd W', 'Mississauga', 43.517, -79.624, 'hand-wash', 28.0, 4.8, 233, 5],
  ['Oakville Express Wash', '240 North Service Rd W', 'Oakville', 43.448, -79.695, 'tunnel', 15.99, 4.6, 845, 4],
  ['Etobicoke Touchless', '5555 Dundas St W', 'Toronto', 43.6349, -79.5418, 'touchless', 17.5, 4.0, 458, 16],
  ['Airport Road Auto Spa', '6900 Airport Rd', 'Mississauga', 43.703, -79.637, 'soft-cloth', 19.99, 4.3, 526, 13],
  ['Cooksville Wash Point', '25 Hillcrest Ave', 'Mississauga', 43.5758, -79.6169, 'automatic', 10.99, 3.7, 189, 7],
  ['Ridgeway Rinse Bay', '3405 Ridgeway Dr', 'Mississauga', 43.5239, -79.7019, 'self-serve', 5.0, 4.2, 126, 2],
  ['Toronto West Clean', '1250 The Queensway', 'Toronto', 43.6218, -79.5354, 'tunnel', 17.99, 4.5, 1082, 15],
] as const;

function packages(washId: string, type: WashType, from: number): WashPackage[] {
  if (type === 'self-serve') {
    return [{id: washId + '-timed', name: 'Timed bay', washType: type, price: from, currency: 'CAD', verifiedAt: '2026-08-20T12:00:00Z', sourceLabel: 'Demo data'}];
  }
  return [
    {id: washId + '-basic', name: 'Basic', washType: type, price: from, currency: 'CAD', verifiedAt: '2026-08-20T12:00:00Z', sourceLabel: 'Demo data'},
    {id: washId + '-premium', name: 'Premium', washType: type, price: from + 4, currency: 'CAD', verifiedAt: '2026-08-20T12:00:00Z', sourceLabel: 'Demo data'},
    {id: washId + '-ultimate', name: 'Ultimate', washType: type, price: from + 8, currency: 'CAD', membershipAvailable: true, verifiedAt: '2026-08-20T12:00:00Z', sourceLabel: 'Demo data'},
  ];
}

export const DEMO_WASHES: CarWash[] = locations.map((item, index) => {
  const [name, address, city, lat, lng, type, from, rating, ratingCount, historical] = item;
  const washType = type as WashType;
  return {
    id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    name,
    address,
    city,
    region: 'Ontario',
    country: 'Canada',
    postalCode: city === 'Milton' ? 'L9T' : city === 'Brampton' ? 'L6V' : city === 'Toronto' ? 'M8Z' : 'L5B',
    position: {lat, lng},
    types: [washType],
    packages: packages('demo-' + index, washType, from),
    status: index === 3 ? 'unavailable' : index === 7 ? 'closed' : 'open',
    rating,
    ratingCount,
    estimatedWashMinutes: WASH_TYPE_CONFIG[washType].defaultDuration,
    minutesPerCar: WASH_TYPE_CONFIG[washType].minutesPerCar,
    historicalWaitMinutes: historical,
    historicalSampleCount: index === 6 ? 1 : index === 2 ? 24 : 12,
    hours: Array.from({length: 7}, (_, weekday) => ({weekday, opensAt: '07:00', closesAt: '22:00', closed: false})),
    amenities: index % 3 === 0 ? ['Vacuums', 'Air pump'] : index % 3 === 1 ? ['Fuel', 'Convenience store'] : ['Vacuums'],
    dataEnvironment: 'demo',
    sourceUpdatedAt: '2026-08-20T12:00:00Z',
  };
});

export function createDemoSignals(now = new Date()): QueueSignal[] {
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const signal = (wash: number, actor: string, wait: number | null, age: number, kind: QueueSignal['kind'] = 'queue', verification: QueueSignal['verification'] = 'nearby'): QueueSignal => ({
    id: 'demo-signal-' + wash + '-' + actor,
    washId: DEMO_WASHES[wash].id,
    actorHash: actor,
    kind,
    waitMinutes: wait,
    verification,
    createdAt: minutesAgo(age),
    reputation: 62,
  });
  return [
    signal(0, 'a', 3, 3, 'session', 'session'),
    signal(0, 'b', 4, 5),
    signal(1, 'a', 30, 4),
    signal(1, 'b', 29, 8),
    signal(4, 'a', 0, 2),
    signal(4, 'b', 0, 4),
    signal(5, 'a', 2, 4),
    signal(5, 'b', 30, 5),
    signal(6, 'a', 7, 34, 'queue', 'remote'),
    signal(3, 'a', null, 3, 'broken'),
    signal(3, 'b', null, 5, 'broken'),
    signal(9, 'a', 5, 12),
    signal(10, 'a', 11, 18),
    signal(12, 'a', 8, 7),
    signal(14, 'a', 2, 6, 'session', 'session'),
    signal(15, 'a', 16, 9),
    signal(17, 'a', 6, 22),
    signal(18, 'a', 1, 5),
  ];
}

export const DEMO_ADS: AdCreative[] = [
  {
    id: 'demo-ad-coffee',
    campaignId: 'demo-campaign-coffee',
    businessName: 'Northline Coffee',
    headline: 'Coffee while you wait',
    body: '15% off any hot drink today · 300 m away',
    callToAction: 'View offer',
    destinationUrl: 'https://example.com/washradar-demo-offer',
    disclosure: 'Nearby offer',
    distanceKm: 0.3,
  },
  {
    id: 'demo-ad-detail',
    campaignId: 'demo-campaign-detail',
    businessName: 'Local Detail Studio',
    headline: 'Interior clean from C$39',
    body: 'A local automotive offer near your selected wash.',
    callToAction: 'See details',
    destinationUrl: 'https://example.com/washradar-demo-offer',
    disclosure: 'Sponsored',
    distanceKm: 1.1,
  },
];
