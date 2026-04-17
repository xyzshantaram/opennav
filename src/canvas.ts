import type { LatLng } from './polyline';
import type { Position } from './gps';
import { ditherImageData } from './dither';

// Map panel is 148x128 (left half of 296x128 display)
export const MAP_W = 148;
export const MAP_H = 128;

// Meters visible ahead and behind on the map
const LOOKAHEAD_M = 200;
const LOOKBEHIND_M = 200;


// Equirectangular projection helpers
function metersPerDegreeLat() {
  return 111320; // roughly constant
}

function metersPerDegreeLng(lat: number) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

// Find the closest point on the polyline to a given position
// Returns { index, fraction, point, distanceAlong }
export function closestPointOnRoute(
  polyline: LatLng[],
  pos: LatLng
): { segIndex: number; point: LatLng; distanceAlong: number } {
  if (polyline.length === 0) return { segIndex: 0, point: pos, distanceAlong: 0 };
  if (polyline.length === 1) return { segIndex: 0, point: polyline[0], distanceAlong: 0 };

  let bestDist = Infinity;
  let bestSegIndex = 0;
  let bestFraction = 0;
  let cumulativeAlong = 0;
  let bestAlong = 0;
  let segLengths: number[] = [];

  // Precompute segment lengths
  for (let i = 0; i < polyline.length - 1; i++) {
    segLengths.push(haversineM(polyline[i], polyline[i + 1]));
  }

  let along = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];

    // Project pos onto segment ab using equirectangular approx
    const mlat = metersPerDegreeLat();
    const mlng = metersPerDegreeLng((a.lat + b.lat) / 2);

    const ax = a.lng * mlng, ay = a.lat * mlat;
    const bx = b.lng * mlng, by = b.lat * mlat;
    const px = pos.lng * mlng, py = pos.lat * mlat;

    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
    }

    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const dx = px - cx, dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < bestDist) {
      bestDist = dist;
      bestSegIndex = i;
      bestFraction = t;
      bestAlong = along + t * segLengths[i];
    }

    along += segLengths[i];
  }

  cumulativeAlong = bestAlong;

  const a = polyline[bestSegIndex];
  const b = polyline[bestSegIndex + 1];
  const point: LatLng = {
    lat: a.lat + bestFraction * (b.lat - a.lat),
    lng: a.lng + bestFraction * (b.lng - a.lng),
  };

  return { segIndex: bestSegIndex, point, distanceAlong: cumulativeAlong };
}

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const c = sinDLat * sinDLat + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

// Compute total cumulative distances along the polyline
export function buildCumulativeDistances(polyline: LatLng[]): number[] {
  const dists = [0];
  for (let i = 1; i < polyline.length; i++) {
    dists.push(dists[i - 1] + haversineM(polyline[i - 1], polyline[i]));
  }
  return dists;
}

// Get a slice of polyline between distanceAlong - behind and distanceAlong + ahead
function slicePolylineByDistance(
  polyline: LatLng[],
  cumDists: number[],
  centerDist: number,
  behind: number,
  ahead: number
): LatLng[] {
  const start = Math.max(0, centerDist - behind);
  const end = Math.min(cumDists[cumDists.length - 1], centerDist + ahead);
  const result: LatLng[] = [];

  for (let i = 0; i < polyline.length - 1; i++) {
    const da = cumDists[i];
    const db = cumDists[i + 1];

    if (db < start || da > end) continue;

    if (da >= start && db <= end) {
      if (result.length === 0) result.push(polyline[i]);
      result.push(polyline[i + 1]);
    } else {
      // Partial segment - interpolate endpoints
      const a = polyline[i];
      const b = polyline[i + 1];
      const segLen = db - da;

      if (da < start && db > start) {
        const t = (start - da) / segLen;
        result.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) });
      }
      if (db > end) {
        const t = (end - da) / segLen;
        result.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) });
      } else if (result.length > 0) {
        result.push(b);
      }
    }
  }

  return result;
}

export interface RenderOptions {
  polyline: LatLng[];
  cumDists: number[];
  position: Position;
  snappedPoint: LatLng;
  distanceAlong: number;
  nextTurnPoint?: LatLng; // point to mark as upcoming turn
}

export function renderMapToOffscreen(opts: RenderOptions): HTMLCanvasElement {
  const offscreen = document.createElement('canvas');
  offscreen.width = MAP_W;
  offscreen.height = MAP_H;
  const ctx = offscreen.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // White background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, MAP_W, MAP_H);

  const { polyline, cumDists, snappedPoint, distanceAlong } = opts;

  // Slice visible portion of route
  const visible = slicePolylineByDistance(polyline, cumDists, distanceAlong, LOOKBEHIND_M, LOOKAHEAD_M);
  if (visible.length < 2) {
    // Not enough route visible - just show position marker
    drawPositionMarker(ctx, MAP_W / 2, MAP_H / 2);
    return offscreen;
  }

  // Compute bounding box of the visible slice
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of visible) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // Add padding
  const PAD = 8;
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;

  // Keep aspect ratio correct using meters
  const midLat = (minLat + maxLat) / 2;
  const mPerLat = metersPerDegreeLat();
  const mPerLng = metersPerDegreeLng(midLat);
  const heightM = latRange * mPerLat;
  const widthM = lngRange * mPerLng;

  // Scale to fit canvas with padding, preserving aspect ratio
  const canvasW = MAP_W - PAD * 2;
  const canvasH = MAP_H - PAD * 2;
  const scale = Math.min(canvasW / (widthM || 1), canvasH / (heightM || 1));

  // Project lat/lng to canvas coords
  function project(p: LatLng): [number, number] {
    const x = PAD + ((p.lng - minLng) * mPerLng) * scale + (canvasW - widthM * scale) / 2;
    // Flip y: lat increases up, canvas y increases down
    const y = PAD + ((maxLat - p.lat) * mPerLat) * scale + (canvasH - heightM * scale) / 2;
    return [x, y];
  }

  // Draw route line
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const [x0, y0] = project(visible[0]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < visible.length; i++) {
    const [xi, yi] = project(visible[i]);
    ctx.lineTo(xi, yi);
  }
  ctx.stroke();

  // Draw ahead portion slightly bolder
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const aheadVisible = slicePolylineByDistance(polyline, cumDists, distanceAlong, 0, LOOKAHEAD_M);
  if (aheadVisible.length >= 2) {
    const [ax0, ay0] = project(aheadVisible[0]);
    ctx.moveTo(ax0, ay0);
    for (let i = 1; i < aheadVisible.length; i++) {
      const [axi, ayi] = project(aheadVisible[i]);
      ctx.lineTo(axi, ayi);
    }
    ctx.stroke();
  }

  // Draw next turn marker
  if (opts.nextTurnPoint) {
    const [tx, ty] = project(opts.nextTurnPoint);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(tx, ty, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw GPS position marker
  const [px, py] = project(snappedPoint);
  drawPositionMarker(ctx, px, py);

  return offscreen;
}

function drawPositionMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Filled circle with white ring
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
}

export function applyDitherToCanvas(
  src: HTMLCanvasElement,
  dst: CanvasRenderingContext2D,
  dstX: number,
  dstY: number
) {
  const ctx = src.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const imageData = ctx.getImageData(0, 0, src.width, src.height);
  const dithered = ditherImageData(imageData);
  dst.putImageData(dithered, dstX, dstY);
}
