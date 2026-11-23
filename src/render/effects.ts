import { WORLD } from '../core/constants';
import type { BallState, GameState } from '../core/types';
import { POP_DISPLAY_FONT, POP_PALETTE, drawPopText } from './palette';

interface ComicBurst {
  text: string;
  x: number;
  y: number;
  color: string;
  age: number;
  duration: number;
  spikes: number;
  rotation: number;
}

const BURST_DURATION = 0.65;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawStarburstPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  spikes: number,
  rotation: number,
): void {
  const totalPoints = spikes * 2;
  ctx.beginPath();
  for (let i = 0; i < totalPoints; i++) {
    const angle = rotation + (i * Math.PI) / spikes;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

/**
 * Manages Pop-Art comic starburst callouts, ball speed trails, and screen shake.
 */
export class EffectsManager {
  private bursts: ComicBurst[] = [];
  private shakeTimer = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;
  private burstCounter = 0;

  /** Clears all active bursts and screen shake state. */
  reset(): void {
    this.bursts = [];
    this.shakeTimer = 0;
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
  }

  /** Spawns a jagged comic-starburst badge that pops in and fades over 0.65s. */
  triggerBurst(text: string, x: number, y: number, color: string): void {
    const clampedX = clamp(x, 42, WORLD.WIDTH - 42);
    const clampedY = clamp(y, 72, WORLD.FLOOR_Y - 36);
    const tilt = ((this.burstCounter % 5) - 2) * 0.06;
    this.burstCounter += 1;

    this.bursts.push({
      text,
      x: clampedX,
      y: clampedY,
      color,
      age: 0,
      duration: BURST_DURATION,
      spikes: 11,
      rotation: tilt,
    });
  }

  /** Triggers a decaying screen shake for the given intensity (px) and duration (seconds). */
  triggerShake(intensity: number, duration: number): void {
    if (intensity <= 0 || duration <= 0) {
      return;
    }
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
  }

  /** Spawns Pop-Art bursts and shake from the latest frame's physics events. */
  consumePhysicsEvents(state: GameState): void {
    const events = state.lastEvents;

    if (events.spikedBy) {
      const hitter = events.spikedBy === 'p1' ? state.players[0] : state.players[1];
      const offsetX = events.spikedBy === 'p1' ? 26 : -26;
      const safeY = Math.min(state.ball.y - 48, hitter.y - hitter.radius - 46);
      this.triggerBurst('SMASH!', state.ball.x + offsetX, safeY, POP_PALETTE.MAGENTA);
      this.triggerShake(9, 0.1);
    } else if (events.volleyBy) {
      const hitter = events.volleyBy === 'p1' ? state.players[0] : state.players[1];
      const safeY = Math.min(state.ball.y - 44, hitter.y - hitter.radius - 44);
      this.triggerBurst('POW!', state.ball.x, safeY, POP_PALETTE.YELLOW);
    }

    if (events.slidBy) {
      const slider = events.slidBy === 'p1' ? state.players[0] : state.players[1];
      this.triggerBurst('DIVE!', slider.x, slider.y - slider.radius - 46, POP_PALETTE.CYAN);
    }

    if (events.netHit) {
      this.triggerBurst('NET!', WORLD.NET_X, WORLD.NET_TOP_Y - 38, POP_PALETTE.ORANGE);
    }

    if (events.ballHitFloorSide) {
      this.triggerBurst('POINT!', state.ball.x, WORLD.FLOOR_Y - 122, POP_PALETTE.RED);
      this.triggerShake(10, 0.1);
    }
  }

  /** Advances burst lifetimes and decays active screen shake. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }

    for (const burst of this.bursts) {
      burst.age += dt;
    }
    this.bursts = this.bursts.filter((b) => b.age < b.duration);

    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      if (this.shakeTimer === 0) {
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
      }
    }
  }

  /** Returns the current camera shake offset in world pixels. */
  getShakeOffset(): { x: number; y: number } {
    if (this.shakeTimer <= 0 || this.shakeDuration <= 0) {
      return { x: 0, y: 0 };
    }
    const decay = this.shakeTimer / this.shakeDuration;
    const amp = this.shakeIntensity * decay;
    return {
      x: (Math.random() * 2 - 1) * amp,
      y: (Math.random() * 2 - 1) * amp,
    };
  }

  /** Renders comic speed circles along the ball's recent trail. */
  renderBallTrail(ctx: CanvasRenderingContext2D, ball: BallState): void {
    const len = ball.trail.length;
    if (len === 0) {
      return;
    }

    ctx.save();
    for (let i = 0; i < len; i++) {
      const point = ball.trail[i];
      const t = (i + 1) / (len + 1);
      const radius = ball.radius * (0.28 + 0.52 * t);

      ctx.globalAlpha = point.isSpiked ? 0.16 + 0.42 * t : 0.08 + 0.22 * t;
      ctx.fillStyle = point.isSpiked
        ? i % 2 === 0
          ? POP_PALETTE.MAGENTA
          : POP_PALETTE.YELLOW
        : POP_PALETTE.CREAM;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (point.isSpiked && i % 2 === 1) {
        ctx.strokeStyle = POP_PALETTE.INK;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Renders all active jagged comic-starburst callouts. */
  render(ctx: CanvasRenderingContext2D): void {
    for (const burst of this.bursts) {
      const progress = clamp(burst.age / burst.duration, 0, 1);
      let scale = 1;
      if (progress < 0.2) {
        const popT = progress / 0.2;
        scale = 0.4 + 0.8 * Math.sin(popT * Math.PI * 0.65);
      } else if (progress < 0.32) {
        const settleT = (progress - 0.2) / 0.12;
        scale = 1.18 - 0.18 * settleT;
      }

      const alpha = progress > 0.65 ? clamp(1 - (progress - 0.65) / 0.35, 0, 1) : 1;
      const floatY = -progress * 18;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(burst.x, burst.y + floatY);
      ctx.scale(scale, scale);

      // Hard comic shadow starburst (50% compact size)
      ctx.fillStyle = POP_PALETTE.SHADOW;
      drawStarburstPolygon(ctx, 2, 2, 26, 17, burst.spikes, burst.rotation);
      ctx.fill();

      // Colored starburst fill + thick ink outline
      ctx.fillStyle = burst.color;
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      drawStarburstPolygon(ctx, 0, 0, 26, 17, burst.spikes, burst.rotation);
      ctx.fill();
      ctx.stroke();

      drawPopText(ctx, burst.text, 0, 0.5, {
        font: `900 11px ${POP_DISPLAY_FONT}`,
        fill: POP_PALETTE.CREAM,
        strokeWidth: 2.5,
        shadowOffsetX: 1.5,
        shadowOffsetY: 1.5,
      });

      ctx.restore();
    }
  }
}
