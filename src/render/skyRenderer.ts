import { WORLD } from '../core/constants';
import type { GameState } from '../core/types';
import { POP_PALETTE, createBenDayPattern } from './palette';

export const SKY_CYCLE_DURATION = 80; // seconds for full morning -> noon -> evening -> night cycle
const DAY_FRACTION = 0.625; // 50s day, 30s night
const SURPRISED_DURATION = 0.75;

export type CelestialExpression = 'normal' | 'surprised' | 'happy';

export interface SkyComputedState {
  phase: number;
  isDay: boolean;
  topColor: string;
  midColor: string;
  horizonColor: string;
  sunX: number;
  sunY: number;
  moonX: number;
  moonY: number;
  nightAlpha: number;
  sunsetWeight: number;
}

interface CloudItem {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

interface StarItem {
  x: number;
  y: number;
  size: number;
  speed: number;
  twinkleOffset: number;
  fourPoint: boolean;
}

interface SkyKeyframe {
  phase: number;
  top: string;
  mid: string;
  horizon: string;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  // Morning (아침)
  { phase: 0.0, top: '#2AB7FF', mid: '#7CE0FF', horizon: '#FFD4A3' },
  // Noon / Day (낮)
  { phase: 0.28, top: '#15A8FF', mid: '#56D5FF', horizon: '#B5F3FF' },
  // Evening / Sunset (저녁)
  { phase: 0.56, top: '#4D247A', mid: '#FF5A6E', horizon: '#FFB703' },
  // Dusk -> Night (초저녁/밤)
  { phase: 0.66, top: '#0D1536', mid: '#192A56', horizon: '#383B74' },
  // Deep Night (한밤중)
  { phase: 0.85, top: '#080D24', mid: '#121E43', horizon: '#1F3061' },
  // Pre-dawn wrap
  { phase: 1.0, top: '#2AB7FF', mid: '#7CE0FF', horizon: '#FFD4A3' },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number): string =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function lerpHex(hexA: string, hexB: string, t: number): string {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const safeT = clamp(t, 0, 1);
  return toHex(lerp(r1, r2, safeT), lerp(g1, g2, safeT), lerp(b1, b2, safeT));
}

function wrapX(x: number, margin: number): number {
  const span = WORLD.WIDTH + margin * 2;
  return ((((x + margin) % span) + span) % span) - margin;
}

/**
 * Computes sky gradient colors, sun/moon arc coordinates, and night star visibility
 * for a given cycle timestamp in seconds.
 */
export function computeSkyState(cycleTime: number): SkyComputedState {
  const safeTime = Number.isFinite(cycleTime) ? cycleTime : 0;
  const wrapped = ((safeTime % SKY_CYCLE_DURATION) + SKY_CYCLE_DURATION) % SKY_CYCLE_DURATION;
  const phase = wrapped / SKY_CYCLE_DURATION;

  let k0 = SKY_KEYFRAMES[0];
  let k1 = SKY_KEYFRAMES[1];
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (phase >= SKY_KEYFRAMES[i].phase && phase <= SKY_KEYFRAMES[i + 1].phase) {
      k0 = SKY_KEYFRAMES[i];
      k1 = SKY_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, k1.phase - k0.phase);
  const localT = (phase - k0.phase) / span;

  const isDay = phase < DAY_FRACTION;
  const dayT = isDay ? phase / DAY_FRACTION : 1;
  const nightT = isDay ? 0 : (phase - DAY_FRACTION) / (1 - DAY_FRACTION);

  const sunX = lerp(-48, WORLD.WIDTH + 48, dayT);
  const sunY = 185 - Math.sin(dayT * Math.PI) * 100;

  const moonX = lerp(-48, WORLD.WIDTH + 48, nightT);
  const moonY = 185 - Math.sin(nightT * Math.PI) * 100;

  let nightAlpha = 0;
  if (phase >= 0.58 && phase < 0.68) {
    nightAlpha = (phase - 0.58) / 0.1;
  } else if (phase >= 0.68 && phase < 0.94) {
    nightAlpha = 1;
  } else if (phase >= 0.94) {
    nightAlpha = Math.max(0, 1 - (phase - 0.94) / 0.06);
  }

  const sunsetDist = Math.abs(phase - 0.56);
  const sunsetWeight = clamp(1 - sunsetDist / 0.14, 0, 1);

  return {
    phase,
    isDay,
    topColor: lerpHex(k0.top, k1.top, localT),
    midColor: lerpHex(k0.mid, k1.mid, localT),
    horizonColor: lerpHex(k0.horizon, k1.horizon, localT),
    sunX,
    sunY,
    moonX,
    moonY,
    nightAlpha,
    sunsetWeight,
  };
}

/**
 * Computes pupil offset within eye bounds pointing from (faceX, faceY) toward the ball.
 */
export function computePupilOffset(
  faceX: number,
  faceY: number,
  ballX: number,
  ballY: number,
  maxOffset = 3.2,
): { x: number; y: number } {
  const dx = ballX - faceX;
  const dy = ballY - faceY;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < 0.001) {
    return { x: 0, y: 0 };
  }
  const scale = clamp(dist / 160, 0.25, 1) * maxOffset;
  return {
    x: (dx / dist) * scale,
    y: (dy / dist) * scale,
  };
}

function createInitialClouds(): CloudItem[] {
  return [
    { x: 180, y: 158, scale: 1.0, speed: 11 },
    { x: 430, y: 114, scale: 0.82, speed: 8 },
    { x: 695, y: 150, scale: 1.08, speed: 13 },
    { x: 560, y: 248, scale: 0.68, speed: 9.5 },
  ];
}

function createInitialStars(): StarItem[] {
  const stars: StarItem[] = [];
  for (let i = 0; i < 20; i++) {
    stars.push({
      x: ((i * 137 + 41) % (WORLD.WIDTH + 40)) - 20,
      y: 28 + ((i * 73 + 19) % 270),
      size: 2.2 + (i % 3) * 1.4,
      speed: 5.5 + (i % 4) * 1.8,
      twinkleOffset: i * 0.7,
      fourPoint: i % 3 === 0,
    });
  }
  return stars;
}

/**
 * Renders an animated Pop-Art sky with morning/noon/evening/night transitions,
 * cute sun & moon with ball-tracking eyes and spike/result expressions, drifting clouds, and night stars.
 */
export class SkyCycleRenderer {
  private cycleTime: number;
  private clouds: CloudItem[];
  private stars: StarItem[];
  private surprisedTimer = 0;
  private resultHappy = false;

  constructor(initialCycleTime = SKY_CYCLE_DURATION * 0.08) {
    this.cycleTime = initialCycleTime;
    this.clouds = createInitialClouds();
    this.stars = createInitialStars();
  }

  /** Returns the current facial expression of the sun/moon. */
  getExpression(): CelestialExpression {
    if (this.resultHappy) {
      return 'happy';
    }
    if (this.surprisedTimer > 0) {
      return 'surprised';
    }
    return 'normal';
  }

  /** Returns current cloud positions (for inspection/testing). */
  getCloudPositions(): ReadonlyArray<{ x: number; y: number }> {
    return this.clouds.map(({ x, y }) => ({ x, y }));
  }

  /** Returns current star positions (for inspection/testing). */
  getStarPositions(): ReadonlyArray<{ x: number; y: number }> {
    return this.stars.map(({ x, y }) => ({ x, y }));
  }

  /** Advances sky cycle time, cloud drift, star drift, and expression decay. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }

    this.cycleTime = (this.cycleTime + dt) % SKY_CYCLE_DURATION;

    for (const cloud of this.clouds) {
      cloud.x = wrapX(cloud.x + cloud.speed * dt, 95);
    }

    for (const star of this.stars) {
      star.x = wrapX(star.x + star.speed * dt, 24);
    }

    if (this.surprisedTimer > 0) {
      this.surprisedTimer = Math.max(0, this.surprisedTimer - dt);
    }
  }

  /** Updates sun/moon facial expressions from spike events and point/match results. */
  consumeGameState(state: GameState): void {
    if (state.lastEvents.spikedBy !== null) {
      this.surprisedTimer = SURPRISED_DURATION;
    }
    this.resultHappy =
      state.phase === 'POINT_SCORED' || state.phase === 'MATCH_OVER';
  }

  /** Renders sky gradient, twinkling night stars, cute sun/moon, and drifting clouds. */
  render(
    ctx: CanvasRenderingContext2D,
    ballX: number,
    ballY: number,
  ): void {
    const sky = computeSkyState(this.cycleTime);
    const expression = this.getExpression();

    ctx.save();
    if (typeof ctx.createLinearGradient === 'function') {
      const grad = ctx.createLinearGradient(0, 0, 0, WORLD.FLOOR_Y);
      grad.addColorStop(0, sky.topColor);
      grad.addColorStop(0.55, sky.midColor);
      grad.addColorStop(1, sky.horizonColor);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = sky.midColor;
    }
    ctx.fillRect(0, 0, WORLD.WIDTH, WORLD.FLOOR_Y);

    const benDay = createBenDayPattern(
      ctx,
      sky.nightAlpha > 0.5 ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.14)',
      18,
      2.2,
    );
    if (benDay) {
      ctx.fillStyle = benDay;
      ctx.fillRect(0, 0, WORLD.WIDTH, WORLD.FLOOR_Y * 0.68);
    }

    if (sky.nightAlpha > 0.02) {
      this.drawStars(ctx, sky.nightAlpha);
    }

    if (sky.isDay) {
      this.drawSun(ctx, sky.sunX, sky.sunY, ballX, ballY, expression);
    } else {
      this.drawMoon(ctx, sky.moonX, sky.moonY, ballX, ballY, expression);
    }

    const cloudFill =
      sky.nightAlpha > 0.5
        ? lerpHex(POP_PALETTE.CREAM, '#9FB7E0', (sky.nightAlpha - 0.5) * 2)
        : sky.sunsetWeight > 0.2
          ? lerpHex(POP_PALETTE.CREAM, '#FFD9C2', sky.sunsetWeight * 0.75)
          : POP_PALETTE.CREAM;
    const cloudAlpha = 1 - sky.nightAlpha * 0.28;

    for (const cloud of this.clouds) {
      this.drawCloud(ctx, cloud.x, cloud.y, cloud.scale, cloudFill, cloudAlpha);
    }

    ctx.restore();
  }

  private drawStars(ctx: CanvasRenderingContext2D, nightAlpha: number): void {
    ctx.save();
    for (const star of this.stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(this.cycleTime * 2.6 + star.twinkleOffset);
      ctx.globalAlpha = nightAlpha * twinkle;
      ctx.fillStyle = POP_PALETTE.YELLOW;

      if (star.fourPoint) {
        const outer = star.size * 1.9;
        const inner = star.size * 0.55;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4;
          const r = i % 2 === 0 ? outer : inner;
          const sx = star.x + Math.cos(angle) * r;
          const sy = star.y + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size * 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawSun(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    ballX: number,
    ballY: number,
    expression: CelestialExpression,
  ): void {
    const radius = 36;
    ctx.save();
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';

    const raySpin = this.cycleTime * 0.35;
    const rayCount = 10;
    for (let i = 0; i < rayCount; i++) {
      const angle = raySpin + (i * Math.PI * 2) / rayCount;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (radius + 6), cy + Math.sin(angle) * (radius + 6));
      ctx.lineTo(cx + Math.cos(angle) * (radius + 17), cy + Math.sin(angle) * (radius + 17));
      ctx.stroke();
    }

    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.beginPath();
    ctx.arc(cx + 4, cy + 4, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = POP_PALETTE.YELLOW;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    this.drawCuteFace(ctx, cx, cy, ballX, ballY, expression);
    ctx.restore();
  }

  private drawMoon(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    ballX: number,
    ballY: number,
    expression: CelestialExpression,
  ): void {
    const radius = 35;
    ctx.save();

    // Soft outer moon glow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#FFF5BA';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Hard shadow
    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.beginPath();
    ctx.arc(cx + 4, cy + 4, radius, 0, Math.PI * 2);
    ctx.fill();

    // Moon body
    ctx.fillStyle = '#FFF3B0';
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Subtle cute craters near rim
    ctx.fillStyle = 'rgba(214, 184, 92, 0.42)';
    ctx.beginPath();
    ctx.arc(cx - 18, cy - 16, 5, 0, Math.PI * 2);
    ctx.arc(cx + 19, cy - 12, 4, 0, Math.PI * 2);
    ctx.arc(cx + 15, cy + 19, 3.5, 0, Math.PI * 2);
    ctx.fill();

    this.drawCuteFace(ctx, cx, cy, ballX, ballY, expression);
    ctx.restore();
  }

  private drawCuteFace(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    ballX: number,
    ballY: number,
    expression: CelestialExpression,
  ): void {
    const eyeOffsetX = 11.5;
    const eyeY = cy - 4;

    // Rosy cheeks
    ctx.fillStyle = '#FF6B9D';
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.ellipse(cx - 18, cy + 7, 5, 3.2, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 18, cy + 7, 5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (expression === 'happy') {
      // Joyful ^ ^ smiling eyes
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        const ex = cx + side * eyeOffsetX;
        ctx.beginPath();
        ctx.arc(ex, eyeY + 2, 5.5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      // Big cheerful D grin
      ctx.fillStyle = '#FF3B5C';
      ctx.beginPath();
      ctx.arc(cx, cy + 6, 8, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    const eyeRadius = expression === 'surprised' ? 7 : 5.6;
    const pupilRadius = expression === 'surprised' ? 2.6 : 3;
    const maxOffset = expression === 'surprised' ? 3.5 : 2.6;
    const pupil = computePupilOffset(cx, eyeY, ballX, ballY, maxOffset);

    // Eyes with ball-tracking pupils
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeOffsetX;
      ctx.fillStyle = POP_PALETTE.CREAM;
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ex, eyeY, eyeRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = POP_PALETTE.INK;
      ctx.beginPath();
      ctx.arc(ex + pupil.x, eyeY + pupil.y, pupilRadius, 0, Math.PI * 2);
      ctx.fill();

      // Tiny eye sparkle
      ctx.fillStyle = POP_PALETTE.CREAM;
      ctx.beginPath();
      ctx.arc(ex + pupil.x - 1, eyeY + pupil.y - 1.1, 1.1, 0, Math.PI * 2);
      ctx.fill();

      if (expression === 'surprised') {
        // Raised eyebrows
        ctx.strokeStyle = POP_PALETTE.INK;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(ex, eyeY - 7, 5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }

    // Mouth
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    if (expression === 'surprised') {
      ctx.fillStyle = '#FF3B5C';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 11, 4.8, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy + 7, 6, 0.18 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();
    }
  }

  private drawCloud(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
    fill: string,
    alpha: number,
  ): void {
    const traceCloudPath = (ox: number, oy: number): void => {
      ctx.beginPath();
      ctx.moveTo(ox - 54, oy + 16);
      ctx.arc(ox - 34, oy + 2, 22, Math.PI * 0.78, Math.PI * 1.85);
      ctx.arc(ox - 4, oy - 12, 28, Math.PI * 1.12, Math.PI * 1.92);
      ctx.arc(ox + 32, oy, 22, Math.PI * 1.32, Math.PI * 0.25);
      ctx.lineTo(ox - 54, oy + 16);
      ctx.closePath();
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    ctx.fillStyle = 'rgba(17, 17, 17, 0.22)';
    traceCloudPath(5, 5);
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    traceCloudPath(0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
