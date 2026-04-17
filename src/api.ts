// HERE API client - calls HERE directly using key from localStorage

const HERE_KEY_STORAGE = 'here_api_key';

export function getApiKey(): string | null {
  return localStorage.getItem(HERE_KEY_STORAGE);
}

export function setApiKey(key: string) {
  localStorage.setItem(HERE_KEY_STORAGE, key.trim());
}

export function clearApiKey() {
  localStorage.removeItem(HERE_KEY_STORAGE);
}

// Pick English name from a HERE road name array, falling back to first entry
export function pickRoadName(names: { value: string; language: string }[] | undefined): string {
  if (!names?.length) return '';
  return (names.find(n => n.language === 'en') ?? names[0]).value;
}

function requireKey(): string {
  const key = getApiKey();
  if (!key) throw new Error('No HERE API key set');
  return key;
}

export interface AutocompleteItem {
  id: string;
  title: string;
  resultType?: string; // 'place' | 'street' | 'locality' | 'houseNumber' | 'addressBlock'
  address: {
    label: string;
    street?: string;
    district?: string;
    city?: string;
  };
  position?: { lat: number; lng: number };
  categories?: { id: string; name: string; primary?: boolean }[];
}

export interface RouteSection {
  polyline: string; // HERE flexible polyline encoded
  turnByTurnActions: TurnAction[];
  summary: {
    duration: number;   // seconds
    length: number;     // meters
    baseDuration: number;
  };
}

export interface TurnAction {
  action: string;       // 'depart' | 'arrive' | 'turn' | 'roundabout' | etc
  direction?: string;   // 'left' | 'right' | 'slightLeft' | etc
  instruction: string;  // human-readable e.g. "Turn left onto MG Road"
  offset: number;       // index into decoded polyline
  duration: number;     // seconds to next action
  length: number;       // meters to next action
  // HERE v8 road name fields
  currentRoad?: { name?: RoadName[] };
  nextRoad?: { name?: RoadName[] };
}

export interface RoadName {
  value: string;
  language: string;
}

export interface RouteResult {
  sections: RouteSection[];
}

export async function searchPlaces(query: string, at?: string): Promise<AutocompleteItem[]> {
  const key = requireKey();
  // Discover returns both POIs (buildings, businesses, landmarks) and addresses,
  // unlike autocomplete which is road/address only
  const atParam = at ?? '20.5937,78.9629';
  const params = new URLSearchParams({
    q: query,
    limit: '7',
    lang: 'en',
    at: atParam,
    apiKey: key,
  });

  const res = await fetch(`https://discover.search.hereapi.com/v1/discover?${params}`);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid HERE API key');
    throw new Error(`Search failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.items ?? []) as AutocompleteItem[];
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = requireKey();
  const params = new URLSearchParams({ at: `${lat},${lng}`, lang: 'en', apiKey: key });
  const res = await fetch(`https://revgeocode.search.hereapi.com/v1/revgeocode?${params}`);
  if (!res.ok) return '';
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return '';
  // Prefer street name, fall back to district/city
  return item.address?.street ?? item.address?.district ?? item.address?.city ?? item.title ?? '';
}

export async function lookupPlace(id: string): Promise<AutocompleteItem> {
  const key = requireKey();
  const params = new URLSearchParams({ id, apiKey: key });
  const res = await fetch(`https://lookup.search.hereapi.com/v1/lookup?${params}`);
  if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
  return res.json();
}

export async function getRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<RouteResult> {
  const key = requireKey();
  const params = new URLSearchParams({
    transportMode: 'car',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    return: 'polyline,turnByTurnActions,summary',
    apiKey: key,
  });

  const res = await fetch(`https://router.hereapi.com/v8/routes?${params}`);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid HERE API key');
    throw new Error(`Route failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data.routes?.length) throw new Error('No route found');

  return { sections: data.routes[0].sections } as RouteResult;
}
