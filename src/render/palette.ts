export const POP_PALETTE = {
  YELLOW: '#FFE600',
  CYAN: '#00D4FF',
  MAGENTA: '#FF2E93',
  ORANGE: '#FFB703',
  RED: '#FF3B30',
  CREAM: '#FFFDF5',
  INK: '#111111',
  SHADOW: '#111111',
  LIME: '#A3E635',
} as const;

export const POP_DISPLAY_FONT =
  '"Russo One", "Chakra Petch", "Bahnschrift", "Arial Black", "Noto Sans KR", sans-serif';

export interface PopTextOptions {
  font?: string;
  fill?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
}

const tileCache = new Map<string, HTMLCanvasElement>();
const patternCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | null>>();

/**
 * Creates or returns a cached Ben-Day halftone CanvasPattern for Pop-Art fills.
 * Returns null safely in non-DOM or unsupported canvas environments.
 */
export function createBenDayPattern(
  ctx: CanvasRenderingContext2D,
  dotColor: string,
  spacing: number,
  radius: number,
): CanvasPattern | null {
  if (
    typeof document === 'undefined' ||
    typeof ctx.createPattern !== 'function' ||
    !Number.isFinite(spacing) ||
    !Number.isFinite(radius) ||
    spacing <= 0 ||
    radius <= 0
  ) {
    return null;
  }

  const key = `${dotColor}|${spacing}|${radius}`;
  let ctxPatterns = patternCache.get(ctx);
  if (ctxPatterns?.has(key)) {
    return ctxPatterns.get(key) ?? null;
  }

  let tile = tileCache.get(key);
  if (!tile) {
    const size = Math.max(4, Math.round(spacing * 2));
    tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tileCtx = tile.getContext('2d');
    if (!tileCtx) {
      return null;
    }

    tileCtx.fillStyle = dotColor;
    const q1 = size / 4;
    const q3 = (size * 3) / 4;
    // Staggered 45-degree Ben-Day dot grid
    for (const [px, py] of [
      [q1, q1],
      [q3, q3],
    ]) {
      tileCtx.beginPath();
      tileCtx.arc(px, py, radius, 0, Math.PI * 2);
      tileCtx.fill();
    }

    tileCache.set(key, tile);
  }

  const pattern = ctx.createPattern(tile, 'repeat');
  if (!ctxPatterns) {
    ctxPatterns = new Map();
    patternCache.set(ctx, ctxPatterns);
  }
  ctxPatterns.set(key, pattern);
  return pattern;
}

/**
 * Draws radial comic sunburst beams centered at (cx, cy).
 */
export function drawSunburst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  rays: number,
  colorA: string,
  colorB: string,
): void {
  if (rays <= 0 || outerRadius <= 0) {
    return;
  }

  ctx.save();
  ctx.fillStyle = colorB;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.fill();

  const step = (Math.PI * 2) / rays;
  const halfBeam = step * 0.5;
  ctx.fillStyle = colorA;
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const startAngle = i * step;
    const endAngle = startAngle + halfBeam;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Draws a crisp Pop-Art comic panel with a hard #111111 drop shadow and thick ink outline.
 */
export function drawPopPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shadowOffset = 5,
  borderWidth = 4,
): void {
  ctx.save();
  if (shadowOffset !== 0) {
    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.fillRect(x + shadowOffset, y + shadowOffset, w, h);
  }

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  if (borderWidth > 0) {
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'miter';
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

/**
 * Draws bold Pop-Art comic text with hard drop shadow and thick ink stroke.
 */
export function drawPopText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: PopTextOptions = {},
): void {
  const {
    font = `900 28px ${POP_DISPLAY_FONT}`,
    fill = POP_PALETTE.YELLOW,
    strokeColor = POP_PALETTE.INK,
    strokeWidth = 5,
    shadowColor = POP_PALETTE.SHADOW,
    shadowOffsetX = 4,
    shadowOffsetY = 4,
    align = 'center',
    baseline = 'middle',
    maxWidth,
  } = options;

  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;

  if (shadowOffsetX !== 0 || shadowOffsetY !== 0) {
    ctx.fillStyle = shadowColor;
    if (maxWidth !== undefined) {
      ctx.fillText(text, x + shadowOffsetX, y + shadowOffsetY, maxWidth);
    } else {
      ctx.fillText(text, x + shadowOffsetX, y + shadowOffsetY);
    }
  }

  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    if (maxWidth !== undefined) {
      ctx.strokeText(text, x, y, maxWidth);
    } else {
      ctx.strokeText(text, x, y);
    }
  }

  ctx.fillStyle = fill;
  if (maxWidth !== undefined) {
    ctx.fillText(text, x, y, maxWidth);
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}
