import { WORLD } from '../core/constants';
import type { CharacterAnimState } from '../core/types';
import {
  PlaceholderCharacterRenderer,
  drawFloorShadow,
  drawPlayerBadge,
  type CharacterRenderData,
  type CharacterRenderer,
} from './characterRenderer';
import { POP_PALETTE } from './palette';

export const SPRITE_033_CELL_WIDTH = 244;
export const SPRITE_033_CELL_HEIGHT = 250;

export const SPRITE_033_ROWS = {
  DOWN: 0,
  RIGHT: 1,
  UP: 2,
  LEFT: 3,
} as const;

export type SpriteRow = 0 | 1 | 2 | 3;

export interface SpriteActionMeta {
  frames: number;
  fps: number;
  sheet: string;
}

export interface SpriteManifest {
  character_id: string;
  rig_version?: string;
  actions: Record<string, SpriteActionMeta>;
}

export interface SpriteSlice {
  actionKey: string;
  row: SpriteRow;
  frameIndex: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const LOOPING_STATES = new Set<CharacterAnimState>([
  'idle',
  'walk',
  'run',
  'air_float',
  'win',
]);

function resolveActionAndRow(
  animState: CharacterAnimState,
  facing: 1 | -1,
  manifest: SpriteManifest,
): { actionKey: string; row: SpriteRow; forceLastFrame: boolean; loop: boolean } {
  const dirRow: SpriteRow = facing === 1 ? SPRITE_033_ROWS.RIGHT : SPRITE_033_ROWS.LEFT;

  switch (animState) {
    case 'idle':
      return { actionKey: 'idle', row: SPRITE_033_ROWS.DOWN, forceLastFrame: false, loop: true };
    case 'walk':
    case 'run':
    case 'air_float':
      return { actionKey: animState, row: dirRow, forceLastFrame: false, loop: true };
    case 'jump_launch':
    case 'spike':
    case 'slide':
    case 'attack':
      return { actionKey: animState, row: dirRow, forceLastFrame: false, loop: false };
    case 'hurt':
      return { actionKey: 'hurt', row: SPRITE_033_ROWS.DOWN, forceLastFrame: false, loop: false };
    case 'win': {
      const actionKey = manifest.actions.win ? 'win' : 'idle';
      return { actionKey, row: SPRITE_033_ROWS.DOWN, forceLastFrame: false, loop: true };
    }
    case 'lose': {
      if (manifest.actions.lose) {
        return { actionKey: 'lose', row: SPRITE_033_ROWS.DOWN, forceLastFrame: false, loop: false };
      }
      return { actionKey: 'hurt', row: SPRITE_033_ROWS.DOWN, forceLastFrame: true, loop: false };
    }
    default:
      return {
        actionKey: 'idle',
        row: SPRITE_033_ROWS.DOWN,
        forceLastFrame: false,
        loop: LOOPING_STATES.has(animState),
      };
  }
}

/**
 * Pure frame-slicing computation for character 033 4-row sprite sheets.
 */
export function computeSpriteSlice(
  animState: CharacterAnimState,
  facing: 1 | -1,
  animTime: number,
  manifest: SpriteManifest,
): SpriteSlice {
  const { actionKey, row, forceLastFrame, loop } = resolveActionAndRow(
    animState,
    facing,
    manifest,
  );
  const meta = manifest.actions[actionKey] ?? manifest.actions.idle;
  const frames = Math.max(1, meta?.frames ?? 1);
  const fps = Math.max(1, meta?.fps ?? 1);
  const safeTime = Number.isFinite(animTime) ? Math.max(0, animTime) : 0;

  let frameIndex: number;
  if (forceLastFrame) {
    frameIndex = frames - 1;
  } else if (loop) {
    frameIndex = Math.floor(safeTime * fps) % frames;
  } else {
    frameIndex = Math.min(frames - 1, Math.floor(safeTime * fps));
  }

  return {
    actionKey,
    row,
    frameIndex,
    sx: frameIndex * SPRITE_033_CELL_WIDTH,
    sy: row * SPRITE_033_CELL_HEIGHT,
    sw: SPRITE_033_CELL_WIDTH,
    sh: SPRITE_033_CELL_HEIGHT,
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const TARGET_SPRITE_HEIGHT = 118;
const FOOT_PADDING_PX = 8;

/**
 * Renders character 033 using its 244x250 multi-row sprite sheets, seamlessly
 * delegating to PlaceholderCharacterRenderer until sheets are ready.
 */
export class Sprite033Renderer implements CharacterRenderer {
  private readonly basePath: string;
  private readonly placeholder = new PlaceholderCharacterRenderer();
  private readonly sheetImages = new Map<string, HTMLImageElement>();
  private manifest: SpriteManifest | null = null;
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  constructor(basePath = './sprites/033') {
    this.basePath = basePath.replace(/\/+$/, '');
  }

  /** Asynchronously loads actions_manifest.json and all sprite sheet PNGs. */
  load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      if (typeof fetch === 'undefined') {
        return;
      }
      try {
        const res = await fetch(`${this.basePath}/actions_manifest.json`);
        if (!res.ok) {
          return;
        }
        const manifest = (await res.json()) as SpriteManifest;
        if (!manifest?.actions) {
          return;
        }
        this.manifest = manifest;

        const entries = Object.entries(manifest.actions);
        await Promise.all(
          entries.map(async ([actionKey, meta]) => {
            const img = await loadImage(`${this.basePath}/${meta.sheet}`);
            if (img) {
              this.sheetImages.set(actionKey, img);
            }
          }),
        );

        this.loaded = this.sheetImages.has('idle');
      } catch {
        // Keep placeholder fallback if offline or manifest load fails.
      }
    })();

    return this.loadPromise;
  }

  /** Returns true once manifest and at least the core idle sheet are loaded. */
  isLoaded(): boolean {
    return this.loaded && this.manifest !== null;
  }

  render(ctx: CanvasRenderingContext2D, data: CharacterRenderData): void {
    if (!this.loaded || !this.manifest) {
      this.placeholder.render(ctx, data);
      return;
    }

    let slice = computeSpriteSlice(
      data.animState,
      data.facing,
      data.animTime,
      this.manifest,
    );
    let img = this.sheetImages.get(slice.actionKey);
    if (!img || !img.complete || img.naturalWidth <= 0) {
      slice = computeSpriteSlice('idle', data.facing, data.animTime, this.manifest);
      img = this.sheetImages.get('idle');
      if (!img || !img.complete || img.naturalWidth <= 0) {
        this.placeholder.render(ctx, data);
        return;
      }
    }

    const isP1 = data.playerId === 'p1';
    const ringColor = isP1 ? POP_PALETTE.YELLOW : POP_PALETTE.MAGENTA;

    drawFloorShadow(ctx, data.x, data.y, data.radius, 1.05);

    // Pop-Art P1 / P2 ground ring so shared 033 sprites remain instantly distinguishable
    const heightAboveFloor = Math.max(0, WORLD.FLOOR_Y - (data.y + data.radius));
    const ringScale = Math.max(0.55, 1 - heightAboveFloor / 320);
    ctx.save();
    ctx.strokeStyle = POP_PALETTE.INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(
      data.x,
      WORLD.FLOOR_Y + 1,
      data.radius * 1.08 * ringScale,
      10 * ringScale,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    const drawH = TARGET_SPRITE_HEIGHT;
    const drawW = drawH * (SPRITE_033_CELL_WIDTH / SPRITE_033_CELL_HEIGHT);
    const dx = data.x - drawW * 0.5;
    const dy = data.y + data.radius - drawH + FOOT_PADDING_PX;

    ctx.drawImage(
      img,
      slice.sx,
      slice.sy,
      slice.sw,
      slice.sh,
      dx,
      dy,
      drawW,
      drawH,
    );

    drawPlayerBadge(ctx, data.playerId, data.x, dy + 6);
  }
}
