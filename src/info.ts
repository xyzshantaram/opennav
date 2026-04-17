import type { TurnAction } from './api';

export const INFO_W = 148;
export const INFO_H = 128;

function turnArrow(action: TurnAction): string {
  if (action.action === 'arrive') return '□';
  const dir = action.direction ?? '';
  switch (dir) {
    case 'left':        return '←';
    case 'sharpLeft':   return '↰';
    case 'slightLeft':  return '↖';
    case 'right':       return '→';
    case 'sharpRight':  return '↱';
    case 'slightRight': return '↗';
    case 'uTurnLeft':
    case 'uTurnRight':  return '↩';
    default:            return '↑';
  }
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}min`;
}

// Truncate text to fit within maxWidth, appending ellipsis if needed
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

export interface InfoPanelData {
  nextTurn: TurnAction | null;
  distanceToTurn: number;     // meters
  currentStreet: string;
  nextStreet: string;
  remainingDistance: number;  // meters
  remainingDuration: number;  // seconds
}

export function renderInfoPanel(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  data: InfoPanelData
) {
  const x = offsetX;
  const W = INFO_W;

  // Background
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, 0, W, INFO_H);

  // Left border divider
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, INFO_H);
  ctx.stroke();

  const innerX = x + 4;
  const innerW = W - 8;

  // ── Section 1: turn arrow + distance (rows 0–44) ──────────────────────────
  if (data.nextTurn && data.nextTurn.action !== 'depart') {
    const arrow = turnArrow(data.nextTurn);

    // Arrow on left, distance on right, vertically centred in top zone
    ctx.fillStyle = '#000';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrow, innerX, 22);

    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatDistance(data.distanceToTurn), x + W - 4, 22);
  } else {
    // No upcoming turn - just show a straight-ahead arrow
    ctx.fillStyle = '#000';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('↑', innerX, 22);
  }

  // Divider
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(innerX, 44);
  ctx.lineTo(x + W - 4, 44);
  ctx.stroke();

  // ── Section 2: street names (rows 46–88) ──────────────────────────────────
  const streetY1 = 50;
  const streetY2 = 70;
  const labelY1  = 47;
  const labelY2  = 67;

  // "on" label + current street
  ctx.fillStyle = '#999';
  ctx.font = '7px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('ON', innerX, labelY1);

  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px monospace';
  ctx.textBaseline = 'top';
  const currentStreetText = data.currentStreet || '—';
  ctx.fillText(truncate(ctx, currentStreetText, innerW), innerX, streetY1);

  // "then" label + next street
  ctx.fillStyle = '#999';
  ctx.font = '7px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText('THEN', innerX, labelY2);

  ctx.fillStyle = '#000';
  ctx.font = '9px monospace';
  ctx.textBaseline = 'top';
  const nextStreetText = data.nextStreet || '—';
  ctx.fillText(truncate(ctx, nextStreetText, innerW), innerX, streetY2);

  // Divider
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(innerX, 90);
  ctx.lineTo(x + W - 4, 90);
  ctx.stroke();

  // ── Section 3: remaining distance + ETA (rows 92–128) ─────────────────────
  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatDistance(data.remainingDistance), innerX, 96);

  ctx.textAlign = 'right';
  ctx.fillText(formatDuration(data.remainingDuration), x + W - 4, 96);

  ctx.fillStyle = '#999';
  ctx.font = '7px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('LEFT', innerX, 112);

  ctx.textAlign = 'right';
  ctx.fillText('ETA', x + W - 4, 112);
}
