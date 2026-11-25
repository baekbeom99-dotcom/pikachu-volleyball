import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import {
  assignHandsToSides,
  computePalmCenter,
  createHandTrackerState,
  evaluateHandInput,
  isHandActionGesture,
  smoothCropBounds,
} from '../src/input/handMath';
import type { NormalizedLandmark } from '../src/input/motionMath';

function makeOpenHand(cx: number, cy: number, scale = 0.14): NormalizedLandmark[] {
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: cx,
    y: cy,
  }));
  // Wrist & knuckles
  lms[0] = { x: cx, y: cy + scale * 0.55 };
  lms[5] = { x: cx - scale * 0.35, y: cy - scale * 0.1 };
  lms[9] = { x: cx, y: cy - scale * 0.15 };
  lms[13] = { x: cx + scale * 0.25, y: cy - scale * 0.1 };
  lms[17] = { x: cx + scale * 0.45, y: cy };

  // Extended thumb & spread index/middle/ring/pinky far from wrist
  lms[4] = { x: cx - scale * 0.75, y: cy - scale * 0.1 };
  lms[6] = { x: cx - scale * 0.35, y: cy - scale * 0.45 };
  lms[8] = { x: cx - scale * 0.35, y: cy - scale * 0.85 };
  lms[10] = { x: cx, y: cy - scale * 0.52 };
  lms[12] = { x: cx, y: cy - scale * 0.95 };
  lms[14] = { x: cx + scale * 0.25, y: cy - scale * 0.48 };
  lms[16] = { x: cx + scale * 0.25, y: cy - scale * 0.88 };
  lms[18] = { x: cx + scale * 0.45, y: cy - scale * 0.35 };
  lms[20] = { x: cx + scale * 0.45, y: cy - scale * 0.7 };
  return lms;
}

describe('handMath', () => {
  it('computes palm center and detects pinch and fist gestures cleanly', () => {
    expect(computePalmCenter(null)).toBeNull();
    expect(computePalmCenter([])).toBeNull();

    const openHand = makeOpenHand(0.5, 0.55);
    const palm = computePalmCenter(openHand)!;
    expect(palm).not.toBeNull();
    expect(palm.x).toBeCloseTo(0.5035, 3);
    expect(isHandActionGesture(openHand)).toBe(false);

    // Thumb-index pinch
    const pinchHand = makeOpenHand(0.5, 0.55);
    pinchHand[4] = { x: 0.49, y: 0.45 };
    pinchHand[8] = { x: 0.495, y: 0.455 };
    expect(isHandActionGesture(pinchHand)).toBe(true);

    // Closed fist (tips curled inside PIPs near wrist)
    const fistHand = makeOpenHand(0.5, 0.55);
    fistHand[8] = { x: 0.48, y: 0.58 };
    fistHand[12] = { x: 0.5, y: 0.59 };
    fistHand[16] = { x: 0.52, y: 0.58 };
    fistHand[20] = { x: 0.54, y: 0.57 };
    expect(isHandActionGesture(fistHand)).toBe(true);
  });

  it('tracks smooth court targetX and triggers jump on upward rise or pinch without drifting baseline', () => {
    const tracker = createHandTrackerState();
    const handLeft = makeOpenHand(0.2, 0.65);

    const res1 = evaluateHandInput('left', handLeft, tracker, WORLD.FIXED_DT);
    expect(res1.detected).toBe(true);
    expect(res1.jump).toBe(false);
    expect(res1.targetX).not.toBeNull();
    expect(res1.targetX!).toBeLessThan(WORLD.NET_LEFT * 0.5);

    // Move hand right within P1 half-court
    const handRight = makeOpenHand(0.85, 0.65);
    const res2 = evaluateHandInput('left', handRight, tracker, WORLD.FIXED_DT);
    expect(res2.targetX!).toBeGreaterThan(res1.targetX!);
    expect(res2.jump).toBe(false);

    // Lift hand sharply above baseline -> triggers jump
    const baselineBeforeJump = tracker.baselineY!;
    const raisedHand = makeOpenHand(0.85, 0.45);
    const resJump = evaluateHandInput('left', raisedHand, tracker, WORLD.FIXED_DT);
    expect(resJump.jump).toBe(true);
    expect(tracker.baselineY).toBe(baselineBeforeJump);

    // Missing hand resets state cleanly
    const missing = evaluateHandInput('left', null, tracker, WORLD.FIXED_DT);
    expect(missing.detected).toBe(false);
    expect(missing.targetX).toBeNull();
    expect(missing.jump).toBe(false);
    expect(tracker.smoothedX).toBeNull();
  });

  it('assigns single hand in 1P npc mode and splits left/right halves in 2P mode', () => {
    const leftHand = makeOpenHand(0.25, 0.6);
    const rightHand = makeOpenHand(0.75, 0.6);

    const npcAssigned = assignHandsToSides([rightHand, leftHand], 'npc', 0.24);
    expect(npcAssigned.left).toBe(leftHand);
    expect(npcAssigned.right).toBeNull();

    const twoPlayerAssigned = assignHandsToSides([rightHand, leftHand], '2p');
    expect(twoPlayerAssigned.left).toBe(leftHand);
    expect(twoPlayerAssigned.right).toBe(rightHand);
  });

  it('smoothly interpolates crop bounds', () => {
    const initial = { sx: 20, sy: 10, sw: 100, sh: 140 };
    expect(smoothCropBounds(null, initial, 0.25)).toEqual(initial);

    const blended = smoothCropBounds(initial, { sx: 60, sy: 30, sw: 140, sh: 180 }, 0.25);
    expect(blended).toEqual({ sx: 30, sy: 15, sw: 110, sh: 150 });
  });
});
