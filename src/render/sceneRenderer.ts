import { WORLD } from '../core/constants';
import type {
  BallState,
  GameState,
  MotionOverlayData,
  MotionSideStatus,
  PlayerState,
  VisualJoystick,
} from '../core/types';
import {
  PlaceholderCharacterRenderer,
  type CharacterRenderData,
  type CharacterRenderer,
} from './characterRenderer';
import { EffectsManager } from './effects';
import {
  POP_PALETTE,
  createBenDayPattern,
  drawPopPanel,
  drawPopText,
} from './palette';
import { Sprite033Renderer } from './sprite033Renderer';

export interface SceneOverlayContext {
  joysticks: VisualJoystick[];
  canvasCssWidth: number;
  canvasCssHeight: number;
  motionOverlay: MotionOverlayData | null;
  motionPreviewCanvas: HTMLCanvasElement | null;
  showPlaceholders?: boolean;
}

export interface PopArtSceneRendererOptions {
  characterRenderer?: CharacterRenderer;
  placeholderRenderer?: CharacterRenderer;
  effects?: EffectsManager;
  preloadSprites?: boolean;
}

const TOO_CLOSE_WIDTH_REF = 0.58;
const TOO_CLOSE_HEIGHT_REF = 0.85;
const OK_WIDTH_REF = 0.48;
const OK_HEIGHT_REF = 0.76;

function toCharacterRenderData(player: PlayerState): CharacterRenderData {
  return {
    playerId: player.id,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    radius: player.radius,
    facing: player.facing,
    animState: player.animState,
    animTime: player.animTime,
  };
}

/**
 * Full Pop-Art 2D canvas scene renderer for the 864x608 volleyball world.
 * Decoupled from src/input/* — consumes only plain DTOs via SceneOverlayContext.
 */
export class PopArtSceneRenderer {
  private readonly characterRenderer: CharacterRenderer;
  private readonly placeholderRenderer: CharacterRenderer;
  readonly effects: EffectsManager;

  constructor(options: PopArtSceneRendererOptions = {}) {
    this.placeholderRenderer =
      options.placeholderRenderer ?? new PlaceholderCharacterRenderer();
    this.characterRenderer = options.characterRenderer ?? new Sprite033Renderer();
    this.effects = options.effects ?? new EffectsManager();

    if (
      options.preloadSprites !== false &&
      this.characterRenderer instanceof Sprite033Renderer
    ) {
      void this.characterRenderer.load();
    }
  }

  /** Preloads sprite assets if using Sprite033Renderer. */
  async preload(): Promise<void> {
    if (this.characterRenderer instanceof Sprite033Renderer) {
      await this.characterRenderer.load();
    }
  }

  /** Renders the complete Pop-Art court, entities, motion HUD, joysticks, and effects. */
  render(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    overlay: SceneOverlayContext,
  ): void {
    const shake = this.effects.getShakeOffset();

    ctx.save();
    ctx.clearRect(0, 0, WORLD.WIDTH, WORLD.HEIGHT);
    ctx.translate(shake.x, shake.y);

    this.drawSky(ctx);

    if (state.controlMode === 'motion') {
      this.drawMotionCameraPanel(ctx, state, overlay);
    }

    this.drawCourt(ctx);
    this.drawNet(ctx);

    const activeRenderer = overlay.showPlaceholders
      ? this.placeholderRenderer
      : this.characterRenderer;

    for (const player of state.players) {
      activeRenderer.render(ctx, toCharacterRenderData(player));
    }

    this.drawBall(ctx, state.ball);
    this.effects.render(ctx);

    if (state.controlMode === 'touch') {
      this.drawDynamicJoysticks(ctx, overlay);
    }

    this.drawScoreboardHud(ctx, state);
    this.drawPhaseOverlay(ctx, state);

    ctx.restore();
  }

  private drawSky(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    if (typeof ctx.createLinearGradient === 'function') {
      const grad = ctx.createLinearGradient(0, 0, 0, WORLD.FLOOR_Y);
      grad.addColorStop(0, '#17B2FF');
      grad.addColorStop(0.55, '#59D6FF');
      grad.addColorStop(1, '#B3F2FF');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#38CCFF';
    }
    ctx.fillRect(0, 0, WORLD.WIDTH, WORLD.FLOOR_Y);

    const benDay = createBenDayPattern(ctx, 'rgba(255, 255, 255, 0.16)', 18, 2.2);
    if (benDay) {
      ctx.fillStyle = benDay;
      ctx.fillRect(0, 0, WORLD.WIDTH, WORLD.FLOOR_Y * 0.65);
    }

    // Pop-Art comic sun in upper-left sky
    this.drawPopSun(ctx, 118, 118, 34);

    // Layered Pop-Art clouds with hard ink outlines and drop shadows
    this.drawPopCloud(ctx, 215, 168, 1.0);
    this.drawPopCloud(ctx, 446, 118, 0.82);
    this.drawPopCloud(ctx, 704, 156, 1.06);
    this.drawPopCloud(ctx, 598, 258, 0.68);
    ctx.restore();
  }

  private drawPopSun(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
  ): void {
    ctx.save();
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    const rayCount = 8;
    for (let i = 0; i < rayCount; i++) {
      const angle = (i * Math.PI * 2) / rayCount;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (radius + 8), cy + Math.sin(angle) * (radius + 8));
      ctx.lineTo(cx + Math.cos(angle) * (radius + 19), cy + Math.sin(angle) * (radius + 19));
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
    ctx.restore();
  }

  private drawPopCloud(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
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
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Hard comic offset shadow
    ctx.fillStyle = 'rgba(17, 17, 17, 0.22)';
    traceCloudPath(5, 5);
    ctx.fill();

    // Cream-white cloud body + thick ink outline
    ctx.fillStyle = POP_PALETTE.CREAM;
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    traceCloudPath(0, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawMotionCameraPanel(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    overlay: SceneOverlayContext,
  ): void {
    const frameW = 368;
    const frameH = 248;
    const frameX = (WORLD.WIDTH - frameW) * 0.5;
    const frameY = 78;
    const isWaiting = state.phase === 'WAITING_DISTANCE';

    ctx.save();
    ctx.globalAlpha = isWaiting ? 0.98 : 0.78;
    drawPopPanel(ctx, frameX, frameY, frameW, frameH, POP_PALETTE.CREAM, 6, 4);

    if (overlay.motionPreviewCanvas) {
      ctx.drawImage(overlay.motionPreviewCanvas, frameX + 4, frameY + 4, frameW - 8, frameH - 8);
    } else {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(frameX + 4, frameY + 4, frameW - 8, frameH - 8);
      drawPopText(
        ctx,
        overlay.motionOverlay?.error ? 'CAMERA UNAVAILABLE' : 'STARTING CAMERA...',
        frameX + frameW * 0.5,
        frameY + frameH * 0.5,
        {
          font: '900 18px Impact, "Arial Black", sans-serif',
          fill: POP_PALETTE.YELLOW,
          strokeWidth: 4,
          shadowOffsetX: 2,
          shadowOffsetY: 2,
        },
      );
    }

    // Thick comic divider down the center of the camera feed
    const midX = frameX + frameW * 0.5;
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(midX, frameY + 4);
    ctx.lineTo(midX, frameY + frameH - 4);
    ctx.stroke();

    const splitLabel =
      state.opponentMode === '2p'
        ? '1P  |  2P'
        : overlay.motionOverlay?.activeSide === 'right'
          ? 'NPC  |  HUMAN'
          : 'HUMAN  |  NPC';
    drawPopPanel(ctx, midX - 58, frameY - 12, 116, 24, POP_PALETTE.YELLOW, 3, 3);
    drawPopText(ctx, splitLabel, midX, frameY, {
      font: '900 13px Impact, "Arial Black", sans-serif',
      fill: POP_PALETTE.INK,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    });

    if (isWaiting && overlay.motionOverlay) {
      const [leftStatus, rightStatus] = overlay.motionOverlay.statuses;
      if (state.opponentMode === '2p') {
        this.drawMotionHalfGate(ctx, leftStatus, frameX + 6, frameY + 20, frameW * 0.5 - 12, frameH - 26);
        this.drawMotionHalfGate(ctx, rightStatus, midX + 6, frameY + 20, frameW * 0.5 - 12, frameH - 26);
      } else {
        const explicitActiveSide = overlay.motionOverlay.activeSide;
        const rightActive =
          explicitActiveSide !== undefined
            ? explicitActiveSide === 'right'
            : rightStatus.detected && leftStatus.gateStatus === 'NO_PERSON';
        const activeStatus = rightActive ? rightStatus : leftStatus;
        const activeX = rightActive ? midX + 6 : frameX + 6;
        this.drawMotionHalfGate(ctx, activeStatus, activeX, frameY + 20, frameW * 0.5 - 12, frameH - 26);
      }
    }

    ctx.restore();
  }

  private drawMotionHalfGate(
    ctx: CanvasRenderingContext2D,
    status: MotionSideStatus,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const widthNorm = status.widthRatio / TOO_CLOSE_WIDTH_REF;
    const heightNorm = status.heightRatio / TOO_CLOSE_HEIGHT_REF;
    const ratio = Math.max(widthNorm, heightNorm);
    const okRatioMarker =
      heightNorm > widthNorm
        ? OK_HEIGHT_REF / TOO_CLOSE_HEIGHT_REF
        : OK_WIDTH_REF / TOO_CLOSE_WIDTH_REF;
    const gaugeMax = 1.25;
    const fillNorm = Math.max(0, Math.min(1, ratio / gaugeMax));
    const okTickNorm = okRatioMarker / gaugeMax;
    const dangerTickNorm = 1 / gaugeMax;

    if (status.gateStatus === 'OK') {
      drawPopPanel(ctx, x + 8, y + h - 42, w - 16, 32, POP_PALETTE.LIME, 3, 3);
      drawPopText(ctx, 'OK! READY', x + w * 0.5, y + h - 26, {
        font: '900 16px Impact, "Arial Black", sans-serif',
        fill: POP_PALETTE.INK,
        strokeWidth: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      });
      return;
    }

    const isTooClose = status.gateStatus === 'TOO_CLOSE';
    const bannerFill = isTooClose ? POP_PALETTE.RED : POP_PALETTE.YELLOW;
    const bannerTextFill = isTooClose ? POP_PALETTE.CREAM : POP_PALETTE.INK;
    const title = isTooClose ? 'STEP BACK!' : 'STEP IN!';
    const subtitle = isTooClose ? '멀리 떨어지세요' : '카메라 안으로 들어오세요';

    // Dim half backdrop so warning pops crisply
    ctx.save();
    ctx.fillStyle = isTooClose ? 'rgba(255, 59, 48, 0.25)' : 'rgba(17, 17, 17, 0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const boxH = 88;
    const boxY = y + h * 0.5 - boxH * 0.5;
    drawPopPanel(ctx, x + 4, boxY, w - 8, boxH, bannerFill, 4, 3);

    drawPopText(ctx, title, x + w * 0.5, boxY + 22, {
      font: '900 20px Impact, "Arial Black", sans-serif',
      fill: bannerTextFill,
      strokeColor: POP_PALETTE.INK,
      strokeWidth: isTooClose ? 3.5 : 0,
      shadowOffsetX: isTooClose ? 2 : 0,
      shadowOffsetY: isTooClose ? 2 : 0,
    });

    drawPopText(ctx, subtitle, x + w * 0.5, boxY + 46, {
      font: '700 13px "Noto Sans KR", "Arial Black", sans-serif',
      fill: bannerTextFill,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      maxWidth: w - 18,
    });

    // Live size-ratio gauge bar
    const barX = x + 14;
    const barY = boxY + 62;
    const barW = w - 28;
    const barH = 14;

    ctx.save();
    ctx.fillStyle = POP_PALETTE.CREAM;
    ctx.fillRect(barX, barY, barW, barH);

    // Safe green target zone up to OK threshold
    ctx.fillStyle = 'rgba(163, 230, 53, 0.45)';
    ctx.fillRect(barX, barY, barW * okTickNorm, barH);

    // Current detected size ratio fill
    ctx.fillStyle = isTooClose ? POP_PALETTE.MAGENTA : POP_PALETTE.CYAN;
    ctx.fillRect(barX, barY, barW * fillNorm, barH);

    // Danger threshold marker
    const dangerX = barX + barW * dangerTickNorm;
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dangerX, barY - 2);
    ctx.lineTo(dangerX, barY + barH + 2);
    ctx.stroke();

    ctx.strokeRect(barX, barY, barW, barH);
    ctx.restore();
  }

  private drawCourt(ctx: CanvasRenderingContext2D): void {
    const sandH = WORLD.HEIGHT - WORLD.FLOOR_Y;

    ctx.save();
    ctx.fillStyle = POP_PALETTE.ORANGE;
    ctx.fillRect(0, WORLD.FLOOR_Y, WORLD.WIDTH, sandH);

    // Warm sunlit strip near baseline
    ctx.fillStyle = '#FFD166';
    ctx.fillRect(0, WORLD.FLOOR_Y, WORLD.WIDTH, 14);

    // Ben-Day halftone sand texture
    const sandPattern = createBenDayPattern(ctx, 'rgba(17, 17, 17, 0.12)', 14, 2);
    if (sandPattern) {
      ctx.fillStyle = sandPattern;
      ctx.fillRect(0, WORLD.FLOOR_Y + 14, WORLD.WIDTH, sandH - 14);
    }

    // Thick comic baseline + court boundary ticks
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, WORLD.FLOOR_Y);
    ctx.lineTo(WORLD.WIDTH, WORLD.FLOOR_Y);
    ctx.moveTo(WORLD.NET_X, WORLD.FLOOR_Y);
    ctx.lineTo(WORLD.NET_X, WORLD.HEIGHT);
    ctx.stroke();
    ctx.restore();
  }

  private drawNet(ctx: CanvasRenderingContext2D): void {
    const postX = WORLD.NET_LEFT;
    const postY = WORLD.NET_TOP_Y;
    const postW = WORLD.NET_WIDTH;
    const postH = WORLD.FLOOR_Y - WORLD.NET_TOP_Y;

    ctx.save();
    // Hard drop shadow
    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.fillRect(postX + 5, postY, postW, postH);
    ctx.beginPath();
    ctx.arc(WORLD.NET_X + 5, postY, WORLD.NET_CAP_RADIUS, Math.PI, 0);
    ctx.fill();

    // Striped Pop-Art net body clipped to post + rounded cap
    ctx.save();
    ctx.beginPath();
    ctx.arc(WORLD.NET_X, postY, WORLD.NET_CAP_RADIUS, Math.PI, 0);
    ctx.lineTo(WORLD.NET_RIGHT, WORLD.FLOOR_Y);
    ctx.lineTo(postX, WORLD.FLOOR_Y);
    ctx.closePath();
    ctx.clip();

    ctx.fillStyle = POP_PALETTE.CREAM;
    ctx.fillRect(postX, postY - WORLD.NET_CAP_RADIUS, postW, postH + WORLD.NET_CAP_RADIUS);

    const stripeH = 16;
    for (let y = postY - WORLD.NET_CAP_RADIUS; y < WORLD.FLOOR_Y; y += stripeH * 2) {
      ctx.fillStyle = POP_PALETTE.MAGENTA;
      ctx.fillRect(postX, y, postW, stripeH);
    }

    // Right-edge halftone shading
    const netShadow = createBenDayPattern(ctx, 'rgba(17, 17, 17, 0.25)', 6, 1.3);
    if (netShadow) {
      ctx.fillStyle = netShadow;
      ctx.fillRect(WORLD.NET_X, postY - WORLD.NET_CAP_RADIUS, postW * 0.5, postH + WORLD.NET_CAP_RADIUS);
    }
    ctx.restore();

    // Bold comic ink outline
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(WORLD.NET_X, postY, WORLD.NET_CAP_RADIUS, Math.PI, 0);
    ctx.lineTo(WORLD.NET_RIGHT, WORLD.FLOOR_Y);
    ctx.lineTo(postX, WORLD.FLOOR_Y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D, ball: BallState): void {
    // Floor shadow ellipse under ball
    const height = Math.max(0, WORLD.FLOOR_Y - (ball.y + ball.radius));
    const proximity = Math.max(0.28, 1 - height / 460);
    ctx.save();
    ctx.globalAlpha = 0.26 * proximity;
    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.beginPath();
    ctx.ellipse(ball.x, WORLD.FLOOR_Y + 2, ball.radius * proximity, 7 * proximity, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.effects.renderBallTrail(ctx, ball);

    ctx.save();
    ctx.translate(ball.x, ball.y);

    if (ball.isSpiked) {
      ctx.save();
      ctx.strokeStyle = POP_PALETTE.MAGENTA;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, ball.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(ball.rotation);

    // Clip panels inside volleyball circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = POP_PALETTE.CREAM;
    ctx.fillRect(-ball.radius, -ball.radius, ball.radius * 2, ball.radius * 2);

    // Pop-Art yellow & magenta volleyball panels
    ctx.fillStyle = POP_PALETTE.YELLOW;
    ctx.beginPath();
    ctx.moveTo(-ball.radius, -ball.radius * 0.2);
    ctx.quadraticCurveTo(0, -ball.radius * 0.9, ball.radius, -ball.radius * 0.15);
    ctx.lineTo(ball.radius, -ball.radius);
    ctx.lineTo(-ball.radius, -ball.radius);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = POP_PALETTE.MAGENTA;
    ctx.beginPath();
    ctx.moveTo(-ball.radius, ball.radius * 0.35);
    ctx.quadraticCurveTo(0, ball.radius * 0.85, ball.radius, ball.radius * 0.3);
    ctx.lineTo(ball.radius, ball.radius);
    ctx.lineTo(-ball.radius, ball.radius);
    ctx.closePath();
    ctx.fill();

    // Seam lines
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-ball.radius, -ball.radius * 0.2);
    ctx.quadraticCurveTo(0, -ball.radius * 0.9, ball.radius, -ball.radius * 0.15);
    ctx.moveTo(-ball.radius, ball.radius * 0.35);
    ctx.quadraticCurveTo(0, ball.radius * 0.85, ball.radius, ball.radius * 0.3);
    ctx.moveTo(-ball.radius * 0.15, -ball.radius);
    ctx.quadraticCurveTo(ball.radius * 0.28, 0, -ball.radius * 0.1, ball.radius);
    ctx.stroke();
    ctx.restore();

    // Specular highlight & bold outer ink outline
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.ellipse(-ball.radius * 0.36, -ball.radius * 0.36, 7, 4, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawDynamicJoysticks(
    ctx: CanvasRenderingContext2D,
    overlay: SceneOverlayContext,
  ): void {
    const cssW = overlay.canvasCssWidth;
    const cssH = overlay.canvasCssHeight;
    if (
      overlay.joysticks.length === 0 ||
      !Number.isFinite(cssW) ||
      !Number.isFinite(cssH) ||
      cssW <= 0 ||
      cssH <= 0
    ) {
      return;
    }

    const scaleX = WORLD.WIDTH / cssW;
    const scaleY = WORLD.HEIGHT / cssH;
    const radiusScale = (scaleX + scaleY) * 0.5;

    for (const joy of overlay.joysticks) {
      const ox = joy.originX * scaleX;
      const oy = joy.originY * scaleY;
      const kx = joy.knobX * scaleX;
      const ky = joy.knobY * scaleY;
      const outerR = Math.max(24, joy.maxRadius * radiusScale);
      const knobR = Math.max(16, outerR * 0.42);
      const knobColor =
        joy.playerId === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA;

      ctx.save();

      // Outer joystick ring
      ctx.fillStyle = 'rgba(255, 253, 245, 0.48)';
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ox, oy, outerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Directional up-arrow jump indicator
      ctx.fillStyle = joy.jumpActive ? POP_PALETTE.LIME : POP_PALETTE.CREAM;
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 2.5;
      const arrowY = oy - outerR + 12;
      ctx.beginPath();
      ctx.moveTo(ox, arrowY - 10);
      ctx.lineTo(ox - 10, arrowY + 2);
      ctx.lineTo(ox + 10, arrowY + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      drawPopText(ctx, 'JUMP', ox, oy - outerR - 10, {
        font: '900 11px Impact, "Arial Black", sans-serif',
        fill: joy.jumpActive ? POP_PALETTE.LIME : POP_PALETTE.CREAM,
        strokeWidth: 3,
        shadowOffsetX: 1,
        shadowOffsetY: 1,
      });

      // Knob drop shadow + Pop-Art knob
      ctx.fillStyle = POP_PALETTE.SHADOW;
      ctx.beginPath();
      ctx.arc(kx + 3, ky + 3, knobR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = knobColor;
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(kx, ky, knobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawScoreboardHud(ctx: CanvasRenderingContext2D, state: GameState): void {
    const topY = 14;
    const panelH = 44;
    const sideW = 128;

    // P1 score badge
    drawPopPanel(ctx, 22, topY, sideW, panelH, POP_PALETTE.YELLOW, 4, 4);
    drawPopText(ctx, `P1  ${state.scores.p1}`, 22 + sideW * 0.5, topY + panelH * 0.52, {
      font: '900 24px Impact, "Arial Black", sans-serif',
      fill: POP_PALETTE.INK,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    });

    // Center target score pill
    const centerW = 120;
    const centerX = WORLD.NET_X - centerW * 0.5;
    drawPopPanel(ctx, centerX, topY + 4, centerW, 36, POP_PALETTE.CREAM, 4, 3);
    drawPopText(
      ctx,
      `TARGET ${state.targetScore}`,
      WORLD.NET_X,
      topY + 23,
      {
        font: '900 16px Impact, "Arial Black", sans-serif',
        fill: POP_PALETTE.INK,
        strokeWidth: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      },
    );

    // P2 / NPC score badge
    const p2Label = state.opponentMode === 'npc' ? 'NPC' : 'P2';
    const p2Fill =
      state.opponentMode === 'npc' ? POP_PALETTE.CYAN : POP_PALETTE.MAGENTA;
    const p2Text =
      state.opponentMode === 'npc' ? POP_PALETTE.INK : POP_PALETTE.CREAM;
    const p2X = WORLD.WIDTH - 22 - sideW;

    drawPopPanel(ctx, p2X, topY, sideW, panelH, p2Fill, 4, 4);
    drawPopText(
      ctx,
      `${p2Label}  ${state.scores.p2}`,
      p2X + sideW * 0.5,
      topY + panelH * 0.52,
      {
        font: '900 24px Impact, "Arial Black", sans-serif',
        fill: p2Text,
        strokeWidth: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      },
    );
  }

  private drawPhaseOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
    if (state.phase === 'READY_SERVE') {
      const label = state.phaseTimer < 0.22 ? 'GO!' : 'READY!';
      drawPopText(ctx, label, WORLD.NET_X, 170, {
        font: '900 58px Impact, "Arial Black", sans-serif',
        fill: state.phaseTimer < 0.22 ? POP_PALETTE.LIME : POP_PALETTE.YELLOW,
        strokeWidth: 7,
        shadowOffsetX: 5,
        shadowOffsetY: 5,
      });
      return;
    }

    if (state.phase === 'POINT_SCORED') {
      const scorerLabel =
        state.lastScorer === 'p1'
          ? 'P1 POINT!'
          : state.opponentMode === 'npc'
            ? 'NPC POINT!'
            : 'P2 POINT!';
      drawPopText(ctx, scorerLabel, WORLD.NET_X, 168, {
        font: '900 52px Impact, "Arial Black", sans-serif',
        fill: state.lastScorer === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA,
        strokeWidth: 7,
        shadowOffsetX: 5,
        shadowOffsetY: 5,
      });
      return;
    }

    if (state.phase === 'MATCH_OVER' && state.winner) {
      const winnerLabel =
        state.winner === 'p1'
          ? 'P1 WINS!'
          : state.opponentMode === 'npc'
            ? 'NPC WINS!'
            : 'P2 WINS!';
      drawPopText(ctx, winnerLabel, WORLD.NET_X, 148, {
        font: '900 62px Impact, "Arial Black", sans-serif',
        fill: state.winner === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA,
        strokeWidth: 8,
        shadowOffsetX: 6,
        shadowOffsetY: 6,
      });
    }
  }
}
