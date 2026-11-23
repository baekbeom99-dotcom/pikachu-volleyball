import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  SPRITE_033_CELL_HEIGHT,
  SPRITE_033_CELL_WIDTH,
  Sprite033Renderer,
  computeSpriteSlice,
  type SpriteManifest,
} from '../src/render/sprite033Renderer';

function loadRealManifest(): SpriteManifest {
  const raw = readFileSync(
    resolve('public/sprites/033/actions_manifest.json'),
    'utf8',
  );
  return JSON.parse(raw) as SpriteManifest;
}

describe('computeSpriteSlice', () => {
  const realManifest = loadRealManifest();

  it('uses expected cell dimensions 244x250', () => {
    expect(SPRITE_033_CELL_WIDTH).toBe(244);
    expect(SPRITE_033_CELL_HEIGHT).toBe(250);
  });

  it('maps idle to row 0 (DOWN) and loops across frames regardless of facing', () => {
    // idle: frames = 4, fps = 7
    const f0 = computeSpriteSlice('idle', 1, 0, realManifest);
    expect(f0).toEqual({
      actionKey: 'idle',
      row: 0,
      frameIndex: 0,
      sx: 0,
      sy: 0,
      sw: 244,
      sh: 250,
    });

    // At t = 5 / 7 -> frame 5 % 4 = 1, even when facing -1
    const f1 = computeSpriteSlice('idle', -1, 5 / 7 + 0.001, realManifest);
    expect(f1).toEqual({
      actionKey: 'idle',
      row: 0,
      frameIndex: 1,
      sx: 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });

    // Negative animTime clamps safely to 0
    const neg = computeSpriteSlice('idle', 1, -0.5, realManifest);
    expect(neg.frameIndex).toBe(0);
    expect(neg.sx).toBe(0);
  });

  it('maps looping directional states (walk, run, air_float) to RIGHT (row 1) or LEFT (row 3)', () => {
    // walk: frames = 8, fps = 11
    const walkRight = computeSpriteSlice('walk', 1, 10 / 11 + 0.001, realManifest);
    expect(walkRight).toEqual({
      actionKey: 'walk',
      row: 1,
      frameIndex: 2,
      sx: 2 * 244,
      sy: 1 * 250,
      sw: 244,
      sh: 250,
    });

    // run: frames = 8, fps = 12
    const runLeft = computeSpriteSlice('run', -1, 9 / 12 + 0.001, realManifest);
    expect(runLeft).toEqual({
      actionKey: 'run',
      row: 3,
      frameIndex: 1,
      sx: 1 * 244,
      sy: 3 * 250,
      sw: 244,
      sh: 250,
    });

    // air_float: frames = 4, fps = 10
    const floatLeft = computeSpriteSlice('air_float', -1, 7 / 10 + 0.001, realManifest);
    expect(floatLeft).toEqual({
      actionKey: 'air_float',
      row: 3,
      frameIndex: 3,
      sx: 3 * 244,
      sy: 3 * 250,
      sw: 244,
      sh: 250,
    });
  });

  it('clamps one-shot directional states (jump_launch, spike, slide, attack) at last frame', () => {
    // spike: frames = 5, fps = 12 -> clamped at 4
    const spikeRight = computeSpriteSlice('spike', 1, 2.5, realManifest);
    expect(spikeRight).toEqual({
      actionKey: 'spike',
      row: 1,
      frameIndex: 4,
      sx: 4 * 244,
      sy: 1 * 250,
      sw: 244,
      sh: 250,
    });

    // slide: frames = 5, fps = 10 -> frame 2 at t = 0.25, clamped at 4 at t = 1.0
    const slideMid = computeSpriteSlice('slide', -1, 0.25, realManifest);
    expect(slideMid).toEqual({
      actionKey: 'slide',
      row: 3,
      frameIndex: 2,
      sx: 2 * 244,
      sy: 3 * 250,
      sw: 244,
      sh: 250,
    });

    const jumpEnd = computeSpriteSlice('jump_launch', 1, 5.0, realManifest);
    expect(jumpEnd.actionKey).toBe('jump_launch');
    expect(jumpEnd.row).toBe(1);
    expect(jumpEnd.frameIndex).toBe(3);

    const attackEnd = computeSpriteSlice('attack', -1, 5.0, realManifest);
    expect(attackEnd.actionKey).toBe('attack');
    expect(attackEnd.row).toBe(3);
    expect(attackEnd.frameIndex).toBe(5);
  });

  it('maps hurt to row 0 (DOWN) and clamps at last frame', () => {
    // hurt: frames = 5, fps = 10
    const hurtMid = computeSpriteSlice('hurt', -1, 0.21, realManifest);
    expect(hurtMid).toEqual({
      actionKey: 'hurt',
      row: 0,
      frameIndex: 2,
      sx: 2 * 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });

    const hurtEnd = computeSpriteSlice('hurt', 1, 4.0, realManifest);
    expect(hurtEnd.frameIndex).toBe(4);
    expect(hurtEnd.row).toBe(0);
  });

  it('falls back win -> idle row 0 and lose -> hurt last frame row 0 when absent from manifest', () => {
    const winFallback = computeSpriteSlice('win', -1, 2 / 7 + 0.001, realManifest);
    expect(winFallback).toEqual({
      actionKey: 'idle',
      row: 0,
      frameIndex: 2,
      sx: 2 * 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });

    const loseFallback = computeSpriteSlice('lose', 1, 0, realManifest);
    expect(loseFallback).toEqual({
      actionKey: 'hurt',
      row: 0,
      frameIndex: 4,
      sx: 4 * 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });
  });

  it('uses win and lose actions directly when present in manifest', () => {
    const extendedManifest: SpriteManifest = {
      ...realManifest,
      actions: {
        ...realManifest.actions,
        win: { frames: 3, fps: 6, sheet: 'win_sheet.png' },
        lose: { frames: 4, fps: 8, sheet: 'lose_sheet.png' },
      },
    };

    const winSlice = computeSpriteSlice('win', 1, 4 / 6 + 0.001, extendedManifest);
    expect(winSlice).toEqual({
      actionKey: 'win',
      row: 0,
      frameIndex: 1,
      sx: 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });

    const loseSlice = computeSpriteSlice('lose', -1, 2.0, extendedManifest);
    expect(loseSlice).toEqual({
      actionKey: 'lose',
      row: 0,
      frameIndex: 3,
      sx: 3 * 244,
      sy: 0,
      sw: 244,
      sh: 250,
    });
  });
});

describe('Sprite033Renderer', () => {
  it('delegates to PlaceholderCharacterRenderer before sheets are loaded', () => {
    const renderer = new Sprite033Renderer();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      drawImage: vi.fn(),
      measureText: vi.fn(() => ({ width: 20 })),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineJoin: 'round',
      lineCap: 'round',
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    expect(renderer.isLoaded()).toBe(false);
    renderer.render(ctx, {
      playerId: 'p1',
      x: 200,
      y: 498,
      vx: 0,
      vy: 0,
      radius: 38,
      facing: 1,
      animState: 'idle',
      animTime: 0.2,
    });

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
