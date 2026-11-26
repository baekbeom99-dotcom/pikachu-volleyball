import { WORLD } from '../core/constants';
import { HAND_HIT_RADIUS } from '../core/physics';
import type {
  BallState,
  GameState,
  HandMotionOverlayData,
  HumanOverlayData,
  MotionOverlayData,
  MotionSideStatus,
  PlayerState,
  VisualJoystick,
} from '../core/types';
import {
  FIST_MAX_HOLD_SECONDS,
  HUMAN_LEFT_RECT,
  HUMAN_RIGHT_RECT,
} from '../input/handMath';
import {
  PlaceholderCharacterRenderer,
  type CharacterRenderData,
  type CharacterRenderer,
} from './characterRenderer';
import { EffectsManager } from './effects';
import {
  POP_DISPLAY_FONT,
  POP_PALETTE,
  createBenDayPattern,
  drawPopPanel,
  drawPopText,
} from './palette';
import { SkyCycleRenderer } from './skyRenderer';
import { Sprite033Renderer } from './sprite033Renderer';

export interface SceneOverlayContext {
  joysticks: VisualJoystick[];
  canvasCssWidth: number;
  canvasCssHeight: number;
  motionOverlay: MotionOverlayData | null;
  motionPreviewCanvas: HTMLCanvasElement | null;
  handMotionOverlay?: HandMotionOverlayData | null;
  handPreviewCanvas?: HTMLCanvasElement | null;
  humanOverlay?: HumanOverlayData | null;
  showPlaceholders?: boolean;
}

export interface PopArtSceneRendererOptions {
  characterRenderer?: CharacterRenderer;
  placeholderRenderer?: CharacterRenderer;
  effects?: EffectsManager;
  sky?: SkyCycleRenderer;
  preloadSprites?: boolean;
}

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
  readonly sky: SkyCycleRenderer;

  constructor(options: PopArtSceneRendererOptions = {}) {
    this.placeholderRenderer =
      options.placeholderRenderer ?? new PlaceholderCharacterRenderer();
    this.characterRenderer = options.characterRenderer ?? new Sprite033Renderer();
    this.effects = options.effects ?? new EffectsManager();
    this.sky = options.sky ?? new SkyCycleRenderer();

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

    this.sky.render(ctx, state.ball.x, state.ball.y);

    if (state.controlMode === 'motion') {
      this.drawMotionCameraPanel(ctx, state, overlay);
    } else if (state.controlMode === 'hand') {
      this.drawHandCameraPanel(ctx, state, overlay);
    } else if (state.controlMode === 'human' && overlay.humanOverlay) {
      this.drawHumanCourtCutouts(ctx, state, overlay.humanOverlay);
    }

    this.drawCourt(ctx);
    this.drawNet(ctx);

    const activeRenderer = overlay.showPlaceholders
      ? this.placeholderRenderer
      : this.characterRenderer;

    for (const player of state.players) {
      const skipAvatarForHuman =
        state.controlMode === 'human' &&
        (player.id === 'p1' || state.opponentMode === '2p');
      if (!skipAvatarForHuman) {
        activeRenderer.render(ctx, toCharacterRenderData(player));
      }
    }

    this.drawBall(ctx, state.ball);
    this.effects.render(ctx);

    if (state.controlMode === 'touch') {
      this.drawDynamicJoysticks(ctx, overlay);
    } else if (state.controlMode === 'hand') {
      this.drawHandStatusOverlay(ctx, state, overlay.handMotionOverlay ?? null);
    } else if (state.controlMode === 'human' && overlay.humanOverlay) {
      this.drawHumanHandRings(ctx, state, overlay.humanOverlay);
    }

    this.drawScoreboardHud(ctx, state);
    this.drawPhaseOverlay(ctx, state);

    ctx.restore();
  }

  private drawHumanCourtCutouts(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    humanOverlay: HumanOverlayData,
  ): void {
    const slots: ReadonlyArray<{
      cutout: HTMLCanvasElement | null;
      rect: typeof HUMAN_LEFT_RECT;
    }> =
      state.opponentMode === '2p'
        ? [
            { cutout: humanOverlay.cutouts[0], rect: HUMAN_LEFT_RECT },
            { cutout: humanOverlay.cutouts[1], rect: HUMAN_RIGHT_RECT },
          ]
        : [{ cutout: humanOverlay.cutouts[0], rect: HUMAN_LEFT_RECT }];

    for (const { cutout, rect } of slots) {
      if (cutout) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        ctx.drawImage(cutout, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      } else if (!humanOverlay.isReady && !humanOverlay.error) {
        drawPopText(
          ctx,
          'CAM LOADING...',
          rect.x + rect.width * 0.5,
          rect.y + rect.height * 0.45,
          {
            font: `900 18px ${POP_DISPLAY_FONT}`,
            fill: POP_PALETTE.YELLOW,
            strokeWidth: 4,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
          },
        );
      }
    }
  }

  private drawHumanHandRings(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    humanOverlay: HumanOverlayData,
  ): void {
    if (state.phase === 'MENU' || state.phase === 'MATCH_OVER') {
      return;
    }

    const activePlayers = state.opponentMode === '2p' ? (['p1', 'p2'] as const) : (['p1'] as const);
    for (const pid of activePlayers) {
      const hasHand = humanOverlay.hands.some((h) => h.playerId === pid);
      if (!hasHand && humanOverlay.isReady) {
        const badgeX = pid === 'p1' ? 18 : WORLD.WIDTH - 134;
        const badgeY = 98;
        ctx.save();
        ctx.globalAlpha = 0.9;
        drawPopPanel(ctx, badgeX, badgeY, 116, 28, POP_PALETTE.CREAM, 3, 3);
        drawPopText(ctx, 'SHOW HAND', badgeX + 58, badgeY + 14, {
          font: `900 12px ${POP_DISPLAY_FONT}`,
          fill: pid === 'p1' ? POP_PALETTE.INK : POP_PALETTE.MAGENTA,
          strokeWidth: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
        });
        ctx.restore();
      }
    }

    for (const hand of humanOverlay.hands) {
      const activeColor = hand.playerId === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.CYAN;

      ctx.save();
      if (hand.canHit) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = activeColor;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, HAND_HIT_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 0.94;
        ctx.strokeStyle = POP_PALETTE.INK;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, HAND_HIT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        // Remaining 1-second fist timer arc
        if (hand.fistRemainingRatio > 0) {
          ctx.strokeStyle = POP_PALETTE.MAGENTA;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(
            hand.x,
            hand.y,
            HAND_HIT_RADIUS + 5,
            -Math.PI * 0.5,
            -Math.PI * 0.5 + Math.PI * 2 * hand.fistRemainingRatio,
          );
          ctx.stroke();
        }

        const remainingSec = Math.max(
          0,
          Math.min(
            FIST_MAX_HOLD_SECONDS,
            hand.fistRemainingRatio * FIST_MAX_HOLD_SECONDS,
          ),
        );
        drawPopText(ctx, remainingSec.toFixed(2), hand.x, hand.y, {
          font: `900 16px ${POP_DISPLAY_FONT}`,
          fill: activeColor,
          strokeWidth: 4,
          shadowOffsetX: 1.5,
          shadowOffsetY: 1.5,
        });
      } else if (hand.isFist) {
        // Fist held past 1.0s — cannot hit until hand opens
        ctx.globalAlpha = 0.58;
        ctx.strokeStyle = POP_PALETTE.RED;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, HAND_HIT_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 0.95;
        drawPopText(ctx, '0.00', hand.x, hand.y, {
          font: `900 15px ${POP_DISPLAY_FONT}`,
          fill: POP_PALETTE.RED,
          strokeWidth: 3.5,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
        });

        drawPopText(ctx, 'OPEN!', hand.x, hand.y - HAND_HIT_RADIUS - 12, {
          font: `900 11px ${POP_DISPLAY_FONT}`,
          fill: POP_PALETTE.RED,
          strokeWidth: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
        });
      } else {
        // Open hand — prompt inside ring; ball passes through without hitting
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = 'rgba(17, 17, 17, 0.22)';
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, HAND_HIT_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = POP_PALETTE.CREAM;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        ctx.globalAlpha = 0.96;
        drawPopText(ctx, '주먹을 쥐세요', hand.x, hand.y, {
          font: '900 11px "Noto Sans KR", "Arial Black", sans-serif',
          fill: POP_PALETTE.CREAM,
          strokeWidth: 3.5,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
          maxWidth: HAND_HIT_RADIUS * 1.75,
        });
      }
      ctx.restore();
    }
  }

  private drawHandCameraPanel(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    overlay: SceneOverlayContext,
  ): void {
    const isWaiting = state.phase === 'WAITING_DISTANCE';
    const is2p = state.opponentMode === '2p';
    const handOverlay = overlay.handMotionOverlay ?? null;
    const previewCanvas = overlay.handPreviewCanvas ?? null;
    const hasError = Boolean(handOverlay?.error);

    if (!is2p) {
      // 1P Hand Motion: show full unsplit cam centered over player's left court
      const panelW = 248;
      const panelH = 186;
      const panelX = WORLD.NET_LEFT * 0.5 - panelW * 0.5;
      const panelY = 78;

      this.drawCourtCameraHalf(ctx, {
        side: 'left',
        x: panelX,
        y: panelY,
        w: panelW,
        h: panelH,
        label: '1P',
        labelFill: POP_PALETTE.YELLOW,
        previewCanvas,
        hasError,
        showGate: false,
        isWaiting,
        fullFrame: true,
      });

      const leftStatus = handOverlay?.statuses[0];
      if (handOverlay?.isReady && leftStatus?.detected) {
        this.drawHandSplitDot(
          ctx,
          panelX,
          panelY,
          panelW,
          panelH,
          leftStatus.normX,
          leftStatus.normY,
          leftStatus.jumpActive,
        );
      }
      return;
    }

    const panelW = 168;
    const panelH = 240;
    const panelY = 78;
    const leftPanelX = WORLD.NET_LEFT * 0.5 - panelW * 0.5;
    const rightPanelX = (WORLD.NET_RIGHT + WORLD.WIDTH) * 0.5 - panelW * 0.5;

    this.drawCourtCameraHalf(ctx, {
      side: 'left',
      x: leftPanelX,
      y: panelY,
      w: panelW,
      h: panelH,
      label: '1P',
      labelFill: POP_PALETTE.YELLOW,
      previewCanvas,
      hasError,
      showGate: false,
      isWaiting,
    });

    this.drawCourtCameraHalf(ctx, {
      side: 'right',
      x: rightPanelX,
      y: panelY,
      w: panelW,
      h: panelH,
      label: '2P',
      labelFill: POP_PALETTE.MAGENTA,
      labelTextFill: POP_PALETTE.CREAM,
      previewCanvas,
      hasError,
      showGate: false,
      isWaiting,
    });

    if (!handOverlay?.isReady) {
      return;
    }

    const leftStatus = handOverlay.statuses[0];
    if (leftStatus?.detected) {
      this.drawHandSplitDot(
        ctx,
        leftPanelX,
        panelY,
        panelW,
        panelH,
        leftStatus.normX,
        leftStatus.normY,
        leftStatus.jumpActive,
      );
    }

    const rightStatus = handOverlay.statuses[1];
    if (rightStatus?.detected) {
      this.drawHandSplitDot(
        ctx,
        rightPanelX,
        panelY,
        panelW,
        panelH,
        rightStatus.normX,
        rightStatus.normY,
        rightStatus.jumpActive,
      );
    }
  }

  private drawHandSplitDot(
    ctx: CanvasRenderingContext2D,
    panelX: number,
    panelY: number,
    panelW: number,
    panelH: number,
    normX: number,
    normY: number,
    jumpActive: boolean,
  ): void {
    const clampedX = Math.max(0, Math.min(1, normX));
    const clampedY = Math.max(0, Math.min(1, normY));
    const dotX = panelX + 4 + clampedX * (panelW - 8);
    const dotY = panelY + 4 + clampedY * (panelH - 8);

    ctx.save();
    ctx.fillStyle = jumpActive ? POP_PALETTE.LIME : POP_PALETTE.ORANGE;
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(dotX, dotY, jumpActive ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHandStatusOverlay(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    handOverlay: HandMotionOverlayData | null,
  ): void {
    if (!handOverlay?.isReady || state.phase === 'MENU' || state.phase === 'MATCH_OVER') {
      return;
    }

    const activeSlots =
      state.opponentMode === '2p'
        ? [
            { player: state.players[0], status: handOverlay.statuses[0], minX: 72, maxX: WORLD.NET_LEFT - 72 },
            { player: state.players[1], status: handOverlay.statuses[1], minX: WORLD.NET_RIGHT + 72, maxX: WORLD.WIDTH - 72 },
          ]
        : [
            { player: state.players[0], status: handOverlay.statuses[0], minX: 72, maxX: WORLD.NET_LEFT - 72 },
          ];

    const gaugeW = 116;
    const gaugeH = 24;
    const gaugeY = WORLD.FLOOR_Y + 26;

    for (const { player, status, minX, maxX } of activeSlots) {
      const centerX = Math.max(minX, Math.min(maxX, player.x));
      const gaugeX = centerX - gaugeW * 0.5;
      const centerY = gaugeY + gaugeH * 0.5;

      ctx.save();
      ctx.globalAlpha = 0.94;
      drawPopPanel(ctx, gaugeX, gaugeY, gaugeW, gaugeH, POP_PALETTE.CREAM, 3, 2);

      if (!status.detected) {
        drawPopText(ctx, 'SHOW HAND', centerX, centerY, {
          font: `900 10px ${POP_DISPLAY_FONT}`,
          fill: POP_PALETTE.INK,
          strokeWidth: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
        });
        ctx.restore();
        continue;
      }

      const clampedMove = Math.max(-1, Math.min(1, status.moveX));
      const trackHalf = gaugeW * 0.5 - 24;
      const knobX = centerX + clampedMove * trackHalf;

      // Left arrow
      ctx.fillStyle = clampedMove < -0.08 ? POP_PALETTE.CYAN : '#CBD5E1';
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(gaugeX + 9, centerY);
      ctx.lineTo(gaugeX + 16, centerY - 5);
      ctx.lineTo(gaugeX + 16, centerY + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Right arrow
      ctx.fillStyle = clampedMove > 0.08 ? POP_PALETTE.ORANGE : '#CBD5E1';
      ctx.beginPath();
      ctx.moveTo(gaugeX + gaugeW - 9, centerY);
      ctx.lineTo(gaugeX + gaugeW - 16, centerY - 5);
      ctx.lineTo(gaugeX + gaugeW - 16, centerY + 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Center rail + neutral tick
      ctx.strokeStyle = 'rgba(17, 17, 17, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(centerX - trackHalf, centerY);
      ctx.lineTo(centerX + trackHalf, centerY);
      ctx.moveTo(centerX, centerY - 5);
      ctx.lineTo(centerX, centerY + 5);
      ctx.stroke();

      // Sliding directional knob
      ctx.fillStyle = status.jumpActive
        ? POP_PALETTE.LIME
        : Math.abs(clampedMove) > 0.08
          ? POP_PALETTE.YELLOW
          : POP_PALETTE.CREAM;
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(knobX, centerY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (status.jumpActive) {
        drawPopText(ctx, 'JUMP', centerX, gaugeY + gaugeH + 10, {
          font: `900 10px ${POP_DISPLAY_FONT}`,
          fill: POP_PALETTE.LIME,
          strokeWidth: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
        });
      }

      ctx.restore();
    }
  }

  private drawMotionCameraPanel(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    overlay: SceneOverlayContext,
  ): void {
    const panelW = 168;
    const panelH = 240;
    const panelY = 78;
    const leftCenterX = WORLD.NET_LEFT * 0.5; // 212 — center of left court
    const rightCenterX = (WORLD.NET_RIGHT + WORLD.WIDTH) * 0.5; // 652 — center of right court
    const leftPanelX = leftCenterX - panelW * 0.5;
    const rightPanelX = rightCenterX - panelW * 0.5;
    const isWaiting = state.phase === 'WAITING_DISTANCE';

    const statuses = overlay.motionOverlay?.statuses;
    const leftStatus = statuses ? statuses[0] : undefined;
    const rightStatus = statuses ? statuses[1] : undefined;
    const explicitActiveSide = overlay.motionOverlay?.activeSide;
    const rightActiveInNpc =
      explicitActiveSide !== undefined
        ? explicitActiveSide === 'right'
        : Boolean(rightStatus?.detected && leftStatus?.gateStatus === 'NO_PERSON');

    const leftLabel =
      state.opponentMode === '2p' ? '1P' : rightActiveInNpc ? 'NPC' : 'HUMAN';
    const rightLabel =
      state.opponentMode === '2p' ? '2P' : rightActiveInNpc ? 'HUMAN' : 'NPC';
    const showLeftGate =
      isWaiting && (state.opponentMode === '2p' || !rightActiveInNpc);
    const showRightGate =
      isWaiting && (state.opponentMode === '2p' || rightActiveInNpc);

    this.drawCourtCameraHalf(ctx, {
      side: 'left',
      x: leftPanelX,
      y: panelY,
      w: panelW,
      h: panelH,
      label: leftLabel,
      labelFill: state.opponentMode === '2p' || !rightActiveInNpc ? POP_PALETTE.YELLOW : POP_PALETTE.CYAN,
      previewCanvas: overlay.motionPreviewCanvas,
      hasError: Boolean(overlay.motionOverlay?.error),
      status: leftStatus,
      showGate: showLeftGate,
      isWaiting,
    });

    this.drawCourtCameraHalf(ctx, {
      side: 'right',
      x: rightPanelX,
      y: panelY,
      w: panelW,
      h: panelH,
      label: rightLabel,
      labelFill: state.opponentMode === '2p' ? POP_PALETTE.MAGENTA : rightActiveInNpc ? POP_PALETTE.YELLOW : POP_PALETTE.CYAN,
      labelTextFill: state.opponentMode === '2p' ? POP_PALETTE.CREAM : POP_PALETTE.INK,
      previewCanvas: overlay.motionPreviewCanvas,
      hasError: Boolean(overlay.motionOverlay?.error),
      status: rightStatus,
      showGate: showRightGate,
      isWaiting,
    });
  }

  private drawCourtCameraHalf(
    ctx: CanvasRenderingContext2D,
    opts: {
      side: 'left' | 'right';
      x: number;
      y: number;
      w: number;
      h: number;
      label: string;
      labelFill: string;
      labelTextFill?: string;
      previewCanvas: HTMLCanvasElement | null;
      hasError: boolean;
      status?: MotionSideStatus;
      showGate: boolean;
      isWaiting: boolean;
      fullFrame?: boolean;
    },
  ): void {
    const {
      side,
      x,
      y,
      w,
      h,
      label,
      labelFill,
      labelTextFill,
      previewCanvas,
      hasError,
      status,
      showGate,
      isWaiting,
      fullFrame = false,
    } = opts;

    ctx.save();
    ctx.globalAlpha = isWaiting ? 0.96 : 0.76;
    drawPopPanel(ctx, x, y, w, h, POP_PALETTE.CREAM, 5, 4);

    if (previewCanvas) {
      const srcW = previewCanvas.width || 480;
      const srcH = previewCanvas.height || 360;
      const sx = fullFrame ? 0 : side === 'left' ? 0 : srcW * 0.5;
      const sw = fullFrame ? srcW : srcW * 0.5;
      ctx.drawImage(
        previewCanvas,
        sx,
        0,
        sw,
        srcH,
        x + 4,
        y + 4,
        w - 8,
        h - 8,
      );
    } else {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      drawPopText(
        ctx,
        hasError ? 'NO CAMERA' : 'LOADING...',
        x + w * 0.5,
        y + h * 0.5,
        {
          font: `900 14px ${POP_DISPLAY_FONT}`,
          fill: POP_PALETTE.YELLOW,
          strokeWidth: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
        },
      );
    }

    const badgeW = 78;
    const badgeH = 22;
    drawPopPanel(ctx, x + (w - badgeW) * 0.5, y - 11, badgeW, badgeH, labelFill, 3, 3);
    drawPopText(ctx, label, x + w * 0.5, y, {
      font: `900 12px ${POP_DISPLAY_FONT}`,
      fill: labelTextFill ?? POP_PALETTE.INK,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    });

    if (showGate && status) {
      this.drawMotionHalfGate(ctx, status, x + 4, y + 16, w - 8, h - 20);
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
    if (status.gateStatus === 'OK') {
      drawPopPanel(ctx, x + 8, y + h - 38, w - 16, 30, POP_PALETTE.LIME, 3, 3);
      drawPopText(ctx, 'OK! READY', x + w * 0.5, y + h - 23, {
        font: `900 14px ${POP_DISPLAY_FONT}`,
        fill: POP_PALETTE.INK,
        strokeWidth: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      });
      return;
    }

    ctx.save();
    ctx.fillStyle = 'rgba(17, 17, 17, 0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    const boxH = 66;
    const boxY = y + h * 0.5 - boxH * 0.5;
    drawPopPanel(ctx, x + 4, boxY, w - 8, boxH, POP_PALETTE.YELLOW, 4, 3);

    drawPopText(ctx, 'STEP IN!', x + w * 0.5, boxY + 22, {
      font: `900 18px ${POP_DISPLAY_FONT}`,
      fill: POP_PALETTE.INK,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    });

    drawPopText(ctx, '카메라 안으로 들어오세요', x + w * 0.5, boxY + 46, {
      font: '700 11px "Noto Sans KR", "Arial Black", sans-serif',
      fill: POP_PALETTE.INK,
      strokeWidth: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      maxWidth: w - 16,
    });
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
    const r = ball.radius;

    // Floor shadow ellipse under ball
    const height = Math.max(0, WORLD.FLOOR_Y - (ball.y + r));
    const proximity = Math.max(0.28, 1 - height / 460);
    ctx.save();
    ctx.globalAlpha = 0.26 * proximity;
    ctx.fillStyle = POP_PALETTE.SHADOW;
    ctx.beginPath();
    ctx.ellipse(ball.x, WORLD.FLOOR_Y + 2, r * proximity, 7 * proximity, 0, 0, Math.PI * 2);
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
      ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Clip all interior panels, shading, and highlights inside ball circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = POP_PALETTE.CREAM;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // Classic 18-panel 3-sector woven volleyball (Blue, Yellow, Cream) matching reference
    ctx.save();
    ctx.rotate(ball.rotation);

    const VOLLEY_BLUE = '#4E6CD9';
    const seamCtrlAngleOffset = -0.14;
    const seamCtrlR = r * 0.56;
    const edgeR = r * 1.18;
    const baseAngle = -Math.PI / 2;
    const sectorStep = (Math.PI * 2) / 3;

    const sectorBands: ReadonlyArray<readonly [string, string, string]> = [
      [VOLLEY_BLUE, POP_PALETTE.YELLOW, POP_PALETTE.CREAM], // Top-right sector
      [POP_PALETTE.YELLOW, VOLLEY_BLUE, POP_PALETTE.CREAM], // Bottom sector
      [POP_PALETTE.YELLOW, VOLLEY_BLUE, POP_PALETTE.CREAM], // Top-left sector
    ];

    const seamCoords = (angle: number) => ({
      cx: seamCtrlR * Math.cos(angle + seamCtrlAngleOffset),
      cy: seamCtrlR * Math.sin(angle + seamCtrlAngleOffset),
      ex: edgeR * Math.cos(angle),
      ey: edgeR * Math.sin(angle),
    });

    for (let k = 0; k < 3; k++) {
      const a0 = baseAngle + k * sectorStep;
      const a1 = a0 + sectorStep;
      const s0 = seamCoords(a0);
      const s1 = seamCoords(a1);
      const [innerColor, midColor, outerColor] = sectorBands[k];

      ctx.save();
      // Clip to curved 120-degree sector wedge
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s0.cx, s0.cy, s0.ex, s0.ey);
      ctx.arc(0, 0, edgeR, a0, a1);
      ctx.quadraticCurveTo(s1.cx, s1.cy, 0, 0);
      ctx.closePath();
      ctx.clip();

      // Orient local axes so seam `a1` sits roughly along +X and stripes bow toward `-Y`
      ctx.rotate(a1);

      const spanL = -r * 0.5;
      const spanR = r * 1.25;
      const midX = r * 0.42;
      const y1 = -r * 0.34;
      const y2 = -r * 0.68;

      // Outer Cream cap
      ctx.fillStyle = outerColor;
      ctx.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);

      // Middle band
      ctx.fillStyle = midColor;
      ctx.beginPath();
      ctx.moveTo(spanL, y2 + r * 0.12);
      ctx.quadraticCurveTo(midX, y2 - r * 0.18, spanR, y2 + r * 0.16);
      ctx.lineTo(spanR, r * 0.5);
      ctx.lineTo(spanL, r * 0.5);
      ctx.closePath();
      ctx.fill();

      // Inner band bordering seam `a1`
      ctx.fillStyle = innerColor;
      ctx.beginPath();
      ctx.moveTo(spanL, y1 + r * 0.12);
      ctx.quadraticCurveTo(midX, y1 - r * 0.18, spanR, y1 + r * 0.16);
      ctx.lineTo(spanR, r * 0.5);
      ctx.lineTo(spanL, r * 0.5);
      ctx.closePath();
      ctx.fill();

      // Dividing stripe seam lines inside sector
      ctx.strokeStyle = POP_PALETTE.INK;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(spanL, y1 + r * 0.12);
      ctx.quadraticCurveTo(midX, y1 - r * 0.18, spanR, y1 + r * 0.16);
      ctx.moveTo(spanL, y2 + r * 0.12);
      ctx.quadraticCurveTo(midX, y2 - r * 0.18, spanR, y2 + r * 0.16);
      ctx.stroke();

      ctx.restore();
    }

    // Three primary curved Y-seams radiating from center
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 2.9;
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const s = seamCoords(baseAngle + k * sectorStep);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(s.cx, s.cy, s.ex, s.ey);
      ctx.stroke();
    }
    ctx.restore();

    // Two-step spherical shading crescent on bottom-right (`음영`)
    ctx.save();
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = POP_PALETTE.INK;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, -0.35, Math.PI * 0.88);
    ctx.quadraticCurveTo(
      r * 0.04,
      r * 0.16,
      r * 1.02 * Math.cos(-0.35),
      r * 1.02 * Math.sin(-0.35),
    );
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.02, -0.18, Math.PI * 0.78);
    ctx.quadraticCurveTo(
      r * 0.22,
      r * 0.28,
      r * 1.02 * Math.cos(-0.18),
      r * 1.02 * Math.sin(-0.18),
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Glossy specular highlights on upper-left (`반사광`)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.36, r * 0.24, r * 0.12, -0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.14, -r * 0.56, r * 0.075, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.86, Math.PI * 1.08, Math.PI * 1.42);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Bold Pop-Art outer ink outline
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
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
        font: `900 11px ${POP_DISPLAY_FONT}`,
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
      font: `900 24px ${POP_DISPLAY_FONT}`,
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
        font: `900 16px ${POP_DISPLAY_FONT}`,
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
        font: `900 24px ${POP_DISPLAY_FONT}`,
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
        font: `900 58px ${POP_DISPLAY_FONT}`,
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
        font: `900 52px ${POP_DISPLAY_FONT}`,
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
        font: `900 62px ${POP_DISPLAY_FONT}`,
        fill: state.winner === 'p1' ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA,
        strokeWidth: 8,
        shadowOffsetX: 6,
        shadowOffsetY: 6,
      });
    }
  }
}
