import { WORLD } from '../core/constants';
import type { CharacterAnimState, PlayerId } from '../core/types';
import { POP_DISPLAY_FONT, POP_PALETTE } from './palette';

export interface CharacterRenderData {
  playerId: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  facing: 1 | -1;
  animState: CharacterAnimState;
  animTime: number;
}

export interface CharacterRenderer {
  render(ctx: CanvasRenderingContext2D, data: CharacterRenderData): void;
}

interface SquashPose {
  scaleX: number;
  scaleY: number;
  tiltRad: number;
  offsetY: number;
}

function computeSquashPose(
  animState: CharacterAnimState,
  animTime: number,
  facing: 1 | -1,
): SquashPose {
  const t = Math.max(0, animTime);
  switch (animState) {
    case 'jump_launch':
      return { scaleX: 0.84, scaleY: 1.2, tiltRad: facing * -0.06, offsetY: 0 };
    case 'air_float':
      return {
        scaleX: 0.94,
        scaleY: 1.07,
        tiltRad: facing * 0.05,
        offsetY: Math.sin(t * 10) * 2,
      };
    case 'spike':
    case 'attack':
      return { scaleX: 1.14, scaleY: 0.9, tiltRad: facing * 0.24, offsetY: -2 };
    case 'slide':
      return { scaleX: 1.28, scaleY: 0.72, tiltRad: facing * 0.42, offsetY: 8 };
    case 'hurt':
      return {
        scaleX: 1.15,
        scaleY: 0.85,
        tiltRad: Math.sin(t * 36) * 0.14,
        offsetY: 4,
      };
    case 'win':
      return {
        scaleX: 0.96,
        scaleY: 1.08,
        tiltRad: Math.sin(t * 8) * 0.08,
        offsetY: -Math.abs(Math.sin(t * 7)) * 12,
      };
    case 'lose':
      return { scaleX: 1.08, scaleY: 0.84, tiltRad: facing * -0.1, offsetY: 6 };
    case 'walk':
    case 'run': {
      const freq = animState === 'run' ? 14 : 9;
      const bounce = Math.abs(Math.sin(t * freq));
      return {
        scaleX: 1 + (1 - bounce) * 0.06,
        scaleY: 0.95 + bounce * 0.08,
        tiltRad: facing * (animState === 'run' ? 0.14 : 0.07),
        offsetY: -bounce * 4,
      };
    }
    case 'idle':
    default: {
      const breath = Math.sin(t * 4.2);
      return {
        scaleX: 1 + breath * 0.03,
        scaleY: 1 - breath * 0.03,
        tiltRad: 0,
        offsetY: 0,
      };
    }
  }
}

/** Draws the hard comic floor shadow beneath a character. */
export function drawFloorShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  widthScale = 1,
): void {
  const heightAboveFloor = Math.max(0, WORLD.FLOOR_Y - (y + radius));
  const proximity = Math.max(0.35, 1 - heightAboveFloor / 280);
  const rx = radius * 0.95 * proximity * widthScale;
  const ry = 8 * proximity;

  ctx.save();
  ctx.globalAlpha = 0.28 * proximity;
  ctx.fillStyle = POP_PALETTE.SHADOW;
  ctx.beginPath();
  ctx.ellipse(x, WORLD.FLOOR_Y + 2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function beginRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.rect(x, y, w, h);
  }
}

/** Draws a bold Pop-Art P1/P2 pill badge above a character. */
export function drawPlayerBadge(
  ctx: CanvasRenderingContext2D,
  playerId: PlayerId,
  x: number,
  topY: number,
): void {
  const label = playerId === 'p1' ? 'P1' : 'P2';
  const fill = playerId === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA;
  const textFill = playerId === 'p1' ? POP_PALETTE.INK : POP_PALETTE.CREAM;
  const badgeW = 36;
  const badgeH = 20;
  const bx = x - badgeW * 0.5;
  const by = topY - badgeH;

  ctx.save();
  ctx.fillStyle = POP_PALETTE.SHADOW;
  beginRoundedRect(ctx, bx + 2, by + 2, badgeW, badgeH, 6);
  ctx.fill();

  ctx.fillStyle = fill;
  ctx.strokeStyle = POP_PALETTE.INK;
  ctx.lineWidth = 3;
  beginRoundedRect(ctx, bx, by, badgeW, badgeH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textFill;
  ctx.font = `900 12px ${POP_DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, by + badgeH * 0.54);
  ctx.restore();
}

/**
 * Lively Pop-Art geometric Pikachu-style character renderer used both as
 * an immediate fallback while sprite sheets load and in placeholder mode.
 */
export class PlaceholderCharacterRenderer implements CharacterRenderer {
  render(ctx: CanvasRenderingContext2D, data: CharacterRenderData): void {
    const { playerId, x, y, radius, facing, animState, animTime } = data;
    const isP1 = playerId === 'p1';
    const bodyColor = isP1 ? POP_PALETTE.YELLOW : '#FFD447';
    const accentColor = isP1 ? POP_PALETTE.CYAN : POP_PALETTE.MAGENTA;
    const cheekColor = isP1 ? POP_PALETTE.RED : POP_PALETTE.MAGENTA;
    const pose = computeSquashPose(animState, animTime, facing);

    drawFloorShadow(ctx, x, y, radius, pose.scaleX);

    ctx.save();
    ctx.translate(x, y + radius + pose.offsetY);
    ctx.rotate(pose.tiltRad);
    ctx.scale(facing * pose.scaleX, pose.scaleY);

    const r = radius;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = POP_PALETTE.INK;

    // Lightning tail
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(-r * 0.65, -r * 0.3);
    ctx.lineTo(-r * 1.25, -r * 0.72);
    ctx.lineTo(-r * 1.02, -r * 0.92);
    ctx.lineTo(-r * 1.48, -r * 1.48);
    ctx.lineTo(-r * 1.15, -r * 1.6);
    ctx.lineTo(-r * 0.8, -r * 0.98);
    ctx.lineTo(-r * 1.02, -r * 0.8);
    ctx.lineTo(-r * 0.58, -r * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pointed ears with black tips
    const drawEar = (baseX: number, baseY: number, tipX: number, tipY: number): void => {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.moveTo(baseX - 9, baseY);
      ctx.quadraticCurveTo(tipX - 8, (baseY + tipY) * 0.5, tipX, tipY);
      ctx.quadraticCurveTo(tipX + 10, (baseY + tipY) * 0.5, baseX + 9, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = POP_PALETTE.INK;
      ctx.beginPath();
      ctx.moveTo(tipX - 5, tipY + 12);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX + 6, tipY + 13);
      ctx.closePath();
      ctx.fill();
    };

    drawEar(-r * 0.42, -r * 1.62, -r * 0.78, -r * 2.48);
    drawEar(r * 0.34, -r * 1.68, r * 0.62, -r * 2.48);

    // Chubby body + head silhouette anchored at feet (0, 0)
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.96, r * 0.88, r * 0.96, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // P2 / P1 sporty headband stripe for immediate contrast
    ctx.fillStyle = accentColor;
    beginRoundedRect(ctx, -r * 0.78, -r * 1.52, r * 1.56, r * 0.22, 4);
    ctx.fill();
    ctx.stroke();

    // Expressive eyes
    const eyeY = -r * 1.12;
    const drawEye = (ex: number): void => {
      ctx.fillStyle = POP_PALETTE.INK;
      ctx.beginPath();
      ctx.arc(ex, eyeY, r * 0.13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = POP_PALETTE.CREAM;
      ctx.beginPath();
      ctx.arc(ex - r * 0.03, eyeY - r * 0.04, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
    };
    drawEye(r * 0.05);
    drawEye(r * 0.48);

    // Electric cheeks
    ctx.fillStyle = cheekColor;
    ctx.beginPath();
    ctx.arc(-r * 0.16, -r * 0.88, r * 0.17, 0, Math.PI * 2);
    ctx.arc(r * 0.62, -r * 0.88, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Happy / determined mouth
    ctx.beginPath();
    if (animState === 'hurt' || animState === 'lose') {
      ctx.arc(r * 0.28, -r * 0.76, r * 0.12, Math.PI, 0);
    } else {
      ctx.arc(r * 0.28, -r * 0.84, r * 0.13, 0.1 * Math.PI, 0.9 * Math.PI);
    }
    ctx.stroke();

    // Little feet
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -4, r * 0.24, r * 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.34, -4, r * 0.24, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    drawPlayerBadge(ctx, playerId, x, y - radius * 1.5 - 6);
  }
}
