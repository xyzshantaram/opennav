import { searchPlaces, lookupPlace, getRoute, getApiKey, setApiKey, pickRoadName, reverseGeocode } from './api';
import type { AutocompleteItem, RouteSection, TurnAction } from './api';
import { decodePolyline } from './polyline';
import type { LatLng } from './polyline';
import { GPS } from './gps';
import type { Position } from './gps';
import {
  renderMapToOffscreen,
  applyDitherToCanvas,
  closestPointOnRoute,
  buildCumulativeDistances,
  MAP_W,
} from './canvas';
import { renderInfoPanel } from './info';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const apikeyScreen  = document.getElementById('apikey-screen')   as HTMLDivElement;
const apikeyInput   = document.getElementById('apikey-input')    as HTMLInputElement;
const apikeySaveBtn = document.getElementById('apikey-save-btn') as HTMLButtonElement;
const navScreen     = document.getElementById('nav-screen')      as HTMLDivElement;
const changeKeyBtn  = document.getElementById('change-key-btn')  as HTMLButtonElement;

const originDisplay = document.getElementById('origin-display')  as HTMLDivElement;
const destInput     = document.getElementById('dest-input')      as HTMLInputElement;
const destDrop      = document.getElementById('dest-dropdown')   as HTMLDivElement;
const goBtn         = document.getElementById('go-btn')          as HTMLButtonElement;
const displayCanvas = document.getElementById('display-canvas')  as HTMLCanvasElement;
const statusEl      = document.getElementById('status')          as HTMLDivElement;

const ctx = displayCanvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;;

// ── API key screen ────────────────────────────────────────────────────────────
function showApiKeyScreen() {
  apikeyScreen.classList.remove('hidden');
  navScreen.classList.add('hidden');
  apikeyInput.value = getApiKey() ?? '';
}

function showNavScreen() {
  apikeyScreen.classList.add('hidden');
  navScreen.classList.remove('hidden');
  renderIdle();
  startGPS();
}

apikeySaveBtn.addEventListener('click', () => {
  const key = apikeyInput.value.trim();
  if (!key) return;
  setApiKey(key);
  showNavScreen();
});

apikeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') apikeySaveBtn.click();
});

changeKeyBtn.addEventListener('click', showApiKeyScreen);

// Init: show nav screen if key already stored, otherwise show setup
if (getApiKey()) {
  showNavScreen();
} else {
  showApiKeyScreen();
}

// ── State ─────────────────────────────────────────────────────────────────────
let destPlace:    AutocompleteItem | null = null;
let polyline:     LatLng[] = [];
let cumDists:     number[] = [];
let sections:     RouteSection[] = [];
let gps:           GPS | null = null;
let lastPosition:  Position | null = null;
let lastRenderAt:  number = 0;
const RENDER_INTERVAL_MS = 3000;

// ── GPS startup (runs as soon as nav screen is shown) ─────────────────────────
let reverseGeocodeTimer: number | null = null;

function startGPS() {
  if (gps) return; // already running
  gps = new GPS(
    (pos) => {
      lastPosition = pos;
      updateGoBtn();

      // Reverse geocode at most once every 15s to label the origin field
      if (!reverseGeocodeTimer) {
        reverseGeocodeTimer = window.setTimeout(async () => {
          reverseGeocodeTimer = null;
          try {
            const name = await reverseGeocode(pos.lat, pos.lng);
            originDisplay.textContent = name || `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
            originDisplay.classList.add('ready');
          } catch {
            originDisplay.textContent = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
            originDisplay.classList.add('ready');
          }
        }, 0); // fire immediately on first fix, throttled by resetting after 15s
        // Reset throttle after 15s
        window.setTimeout(() => { reverseGeocodeTimer = null; }, 15000);
      }

      // Re-render if navigating
      if (polyline.length) {
        const now = Date.now();
        if (now - lastRenderAt >= RENDER_INTERVAL_MS) render();
      }
    },
    (err) => {
      originDisplay.textContent = 'GPS unavailable';
      setStatus(err, 'error');
    }
  );
  gps.start();
  originDisplay.textContent = 'acquiring GPS...';
}

function updateGoBtn() {
  goBtn.disabled = !(lastPosition && destPlace);
}

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg: string, type: 'ok' | 'error' | '' = '') {
  statusEl.textContent = msg;
  statusEl.className = `status-bar ${type}`;
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
function buildAutocomplete(
  input: HTMLInputElement,
  dropdown: HTMLDivElement,
  onSelect: (item: AutocompleteItem) => void
) {
  let debounceTimer: number | null = null;
  let activeIndex = -1;
  let items: AutocompleteItem[] = [];

  function showDropdown(results: AutocompleteItem[]) {
    items = results;
    activeIndex = -1;
    dropdown.innerHTML = '';

    if (results.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const el = document.createElement('div');
      el.className = 'autocomplete-item';
      const primaryCat = item.categories?.find(c => c.primary)?.name ?? item.categories?.[0]?.name;
      const subtitle = primaryCat
        ? `${primaryCat} · ${item.address?.city ?? item.address?.district ?? ''}`
        : (item.address?.label ?? '');
      el.innerHTML = `
        <div class="title">${item.title}</div>
        <div class="subtitle">${subtitle}</div>
      `;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      dropdown.appendChild(el);
    }

    dropdown.classList.remove('hidden');
  }

  function selectItem(item: AutocompleteItem) {
    input.value = item.title;
    dropdown.classList.add('hidden');
    items = [];
    onSelect(item);
  }

  function updateActive() {
    const els = dropdown.querySelectorAll('.autocomplete-item');
    els.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { dropdown.classList.add('hidden'); return; }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      try {
        const at = lastPosition ? `${lastPosition.lat},${lastPosition.lng}` : undefined;
        const results = await searchPlaces(q, at);
        showDropdown(results);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('API key')) {
          setStatus(msg, 'error');
          showApiKeyScreen();
        }
      }
    }, 250);
  });

  input.addEventListener('keydown', (e) => {
    if (dropdown.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      updateActive();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActive();
      e.preventDefault();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      selectItem(items[activeIndex]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.add('hidden'), 150);
  });
}

// ── Navigation logic ──────────────────────────────────────────────────────────

// Find the turn action we're currently inside (last depart/turn we've passed)
function findCurrentAction(distanceAlong: number): TurnAction | null {
  if (!sections.length) return null;
  let sectionOffset = 0;
  let last: TurnAction | null = null;

  for (const section of sections) {
    const sectionPoly = decodePolyline(section.polyline);
    const sectionCum = buildCumulativeDistances(sectionPoly);

    for (const action of section.turnByTurnActions) {
      const actionDist = sectionOffset + (sectionCum[Math.min(action.offset, sectionCum.length - 1)] ?? 0);
      if (actionDist <= distanceAlong) {
        last = action;
      } else {
        break;
      }
    }

    sectionOffset += sectionCum[sectionCum.length - 1] ?? 0;
  }

  return last;
}

function findNextTurn(distanceAlong: number): { action: TurnAction; point: LatLng; dist: number } | null {
  if (!sections.length || !polyline.length) return null;

  let sectionOffset = 0;

  for (const section of sections) {
    const sectionPoly = decodePolyline(section.polyline);
    const sectionCum = buildCumulativeDistances(sectionPoly);

    for (const action of section.turnByTurnActions) {
      if (action.action === 'depart') continue;

      const actionDistAlongSection = sectionCum[Math.min(action.offset, sectionCum.length - 1)] ?? 0;
      const globalDist = sectionOffset + actionDistAlongSection;

      if (globalDist > distanceAlong) {
        const polyIdx = Math.min(action.offset, sectionPoly.length - 1);
        const point = sectionPoly[polyIdx] ?? polyline[0];
        return { action, point, dist: globalDist - distanceAlong };
      }
    }

    sectionOffset += sectionCum[sectionCum.length - 1] ?? 0;
  }

  return null;
}

function getRemainingStats(distanceAlong: number): { distance: number; duration: number } {
  const totalLength = cumDists[cumDists.length - 1] ?? 0;
  const remainingDistance = Math.max(0, totalLength - distanceAlong);
  let totalDuration = 0;
  for (const s of sections) totalDuration += s.summary.duration;
  const duration = totalLength > 0 ? (remainingDistance / totalLength) * totalDuration : 0;
  return { distance: remainingDistance, duration };
}

// Extract a street name from a HERE instruction string.
// e.g. "Turn left onto MG Road" → "MG Road"
//      "Head north on Brigade Road" → "Brigade Road"
//      "Take exit 4 toward NH44" → "NH44"
function streetFromInstruction(instruction: string): string {
  if (!instruction) return '';
  const onto = instruction.match(/\bonto\s+(.+)$/i);
  if (onto) return onto[1].trim();
  const on = instruction.match(/\bon\s+(.+)$/i);
  if (on) return on[1].trim();
  const toward = instruction.match(/\btoward\s+(.+)$/i);
  if (toward) return toward[1].trim();
  return '';
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderIdle() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 296, 128);
  ctx.fillStyle = '#bbb';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('set origin + destination', 148, 64);
}

function render() {
  lastRenderAt = Date.now();
  if (!polyline.length || !lastPosition) {
    renderIdle();
    return;
  }

  const { point: snapped, distanceAlong } = closestPointOnRoute(polyline, lastPosition);
  const nextTurn = findNextTurn(distanceAlong);
  const currentAction = findCurrentAction(distanceAlong);
  const stats = getRemainingStats(distanceAlong);

  // Street names: prefer structured road name arrays, fall back to parsing instruction text
  const currentStreet =
    pickRoadName(currentAction?.currentRoad?.name) ||
    pickRoadName(currentAction?.nextRoad?.name) ||
    streetFromInstruction(currentAction?.instruction ?? '');
  const nextStreet =
    pickRoadName(nextTurn?.action.nextRoad?.name) ||
    pickRoadName(nextTurn?.action.currentRoad?.name) ||
    streetFromInstruction(nextTurn?.action.instruction ?? '');

  const mapCanvas = renderMapToOffscreen({
    polyline,
    cumDists,
    position: lastPosition,
    snappedPoint: snapped,
    distanceAlong,
    nextTurnPoint: nextTurn?.point,
  });

  applyDitherToCanvas(mapCanvas, ctx, 0, 0);

  renderInfoPanel(ctx, MAP_W, {
    nextTurn: nextTurn?.action ?? null,
    distanceToTurn: nextTurn?.dist ?? 0,
    currentStreet,
    nextStreet,
    remainingDistance: stats.distance,
    remainingDuration: stats.duration,
  });

  if (stats.distance < 30) setStatus('arrived', 'ok');
}

// ── Start navigation ──────────────────────────────────────────────────────────
async function startNavigation() {
  if (!lastPosition || !destPlace) return;

  goBtn.disabled = true;
  setStatus('calculating route...');

  try {
    const originCoords = { lat: lastPosition.lat, lng: lastPosition.lng };

    async function resolveCoords(item: AutocompleteItem) {
      if (item.position) return item.position;
      const full = await lookupPlace(item.id);
      if (!full.position) throw new Error(`No coordinates for "${item.title}"`);
      return full.position;
    }

    const destCoords = await resolveCoords(destPlace!);

    const route = await getRoute(originCoords, destCoords);
    sections = route.sections;

    polyline = [];
    for (const section of sections) {
      const pts = decodePolyline(section.polyline);
      if (polyline.length > 0 && pts.length > 0) {
        polyline.push(...pts.slice(1));
      } else {
        polyline.push(...pts);
      }
    }

    cumDists = buildCumulativeDistances(polyline);
    const totalKm = (cumDists[cumDists.length - 1] / 1000).toFixed(1);
    setStatus(`route: ${totalKm} km — GPS active`, 'ok');

    render();

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`error: ${msg}`, 'error');
    if (msg.includes('API key')) showApiKeyScreen();
    goBtn.disabled = false;
  }
}

// ── Wire up ───────────────────────────────────────────────────────────────────
buildAutocomplete(destInput, destDrop, (item) => {
  destPlace = item;
  updateGoBtn();
});

goBtn.addEventListener('click', startNavigation);
