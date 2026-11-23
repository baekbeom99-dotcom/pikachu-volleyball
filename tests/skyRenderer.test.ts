import { describe, expect, it, vi } from 'vitest';
import { WORLD } from '../src/core/constants';
import { createGameState } from '../src/core/rules';
import {
  SKY_CYCLE_DURATION,
  SkyCycleRenderer,
  computePupilOffset,
  computeSkyState,
} from '../src/render/skyRenderer';

function createMockSkyCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    createPattern: vi.fn(() => null),
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('SkyCycleRenderer and sky math', () => {
  it('moves sun left-to-right during day and spawns moon on left moving right at night', () => {
    const morning = computeSkyState(SKY_CYCLE_DURATION * 0.08);
    const noon = computeSkyState(SKY_CYCLE_DURATION * 0.31);
    const evening = computeSkyState(SKY_CYCLE_DURATION * 0.55);
    expect(morning.isDay).toBe(true);
    expect(noon.isDay).toBe(true);
    expect(evening.isDay).toBe(true);
    expect(morning.sunX).toBeLessThan(noon.sunX);
    expect(noon.sunX).toBeLessThan(evening.sunX);
    expect(noon.sunY).toBeLessThan(morning.sunY);

    // Distinct morning -> noon -> evening sky colors
    expect(morning.horizonColor).not.toBe(noon.horizonColor);
    expect(noon.horizonColor).not.toBe(evening.horizonColor);

    // After sun sets, moon rises on the left and moves right
    const nightEarly = computeSkyState(SKY_CYCLE_DURATION * 0.68);
    const nightMid = computeSkyState(SKY_CYCLE_DURATION * 0.82);
    const nightLate = computeSkyState(SKY_CYCLE_DURATION * 0.95);
    expect(nightEarly.isDay).toBe(false);
    expect(nightEarly.moonX).toBeLessThan(nightMid.moonX);
    expect(nightMid.moonX).toBeLessThan(nightLate.moonX);
    expect(nightMid.nightAlpha).toBeGreaterThan(0.8);
  });

  it('tracks ball position with celestial pupil offsets', () => {
    const right = computePupilOffset(200, 120, 700, 120, 4);
    expect(right.x).toBeGreaterThan(3);
    expect(Math.abs(right.y)).toBeLessThan(0.01);

    const downLeft = computePupilOffset(500, 120, 200, 420, 4);
    expect(downLeft.x).toBeLessThan(-2);
    expect(downLeft.y).toBeGreaterThan(2);
  });

  it('switches celestial face to surprised on spike and happy on score/match result', () => {
    const sky = new SkyCycleRenderer();
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'READY_SERVE',
    });
    state.phase = 'PLAYING';
    expect(sky.getExpression()).toBe('normal');

    state.lastEvents.spikedBy = 'p1';
    sky.consumeGameState(state);
    expect(sky.getExpression()).toBe('surprised');

    // Surprised decays back to normal after > 0.75s
    state.lastEvents.spikedBy = null;
    sky.update(0.8);
    sky.consumeGameState(state);
    expect(sky.getExpression()).toBe('normal');

    // Result phases produce happy smiling expression
    state.phase = 'POINT_SCORED';
    sky.consumeGameState(state);
    expect(sky.getExpression()).toBe('happy');
  });

  it('slowly moves clouds across the sky and renders stars at night', () => {
    const sky = new SkyCycleRenderer();
    const initialCloudXs = sky.getCloudPositions().map((c) => c.x);
    const initialStarXs = sky.getStarPositions().map((s) => s.x);

    sky.update(5);
    const movedCloudXs = sky.getCloudPositions().map((c) => c.x);
    expect(movedCloudXs[0]).not.toBe(initialCloudXs[0]);

    // Advance into night phase and verify stars move and render
    sky.update(SKY_CYCLE_DURATION * 0.75 - 5);
    const movedStarXs = sky.getStarPositions().map((s) => s.x);
    expect(movedStarXs[0]).not.toBe(initialStarXs[0]);

    const ctx = createMockSkyCtx();
    sky.render(ctx, WORLD.WIDTH / 2, WORLD.HEIGHT / 2);
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalled();
  });
});
