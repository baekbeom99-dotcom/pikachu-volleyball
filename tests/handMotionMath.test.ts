import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import {
  HAND_JOYSTICK_RADIUS,
  createSingleHandTrackerState,
  evaluateSingleHandMotion,
  selectSingleHandBySide,
  stepSmoothDirectionalInput,
} from '../src/input/handMotionMath';
import type { NormalizedLandmark } from '../src/input/motionMath';

function makeHand(cx: number, cy: number): NormalizedLandmark[] {
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: cx,
    y: cy,
  }));
  lms[0] = { x: cx, y: cy + 0.05 };
  lms[5] = { x: cx - 0.03, y: cy };
  lms[9] = { x: cx, y: cy - 0.02 };
  lms[10] = { x: cx, y: cy - 0.05 };
  lms[17] = { x: cx + 0.03, y: cy };
  return lms;
}

describe('handMotionMath (dragged air-joystick & upward jump)', () => {
  it('picks only one hand in 1P npc mode and one hand per half in 2P mode', () => {
    const hLeft = makeHand(0.22, 0.6);
    const hRight = makeHand(0.76, 0.6);

    const npcSelected = selectSingleHandBySide([hRight, hLeft], 'npc', 0.21, null);
    expect(npcSelected.left).toBe(hLeft);
    expect(npcSelected.right).toBeNull();

    const twoPSelected = selectSingleHandBySide([hRight, hLeft], '2p');
    expect(twoPSelected.left).toBe(hLeft);
    expect(twoPSelected.right).toBe(hRight);
  });

  it('ignores absolute hand placement and keeps moving when held slightly off anchor', () => {
    const dt = 1 / 30;
    const tracker = createSingleHandTrackerState();

    // First appearance anywhere in camera starts neutral (0 movement, 0 jump)
    const first = evaluateSingleHandMotion(makeHand(0.92, 0.12), tracker, dt);
    expect(first.detected).toBe(true);
    expect(first.moveX).toBe(0);
    expect(first.jump).toBe(false);

    // Holding stationary at initial anchor keeps moveX === 0 and jump === false
    for (let i = 0; i < 6; i++) {
      const steady = evaluateSingleHandMotion(makeHand(0.92, 0.12), tracker, dt);
      expect(steady.moveX).toBe(0);
      expect(steady.jump).toBe(false);
    }

    // Moving slightly left of anchor (by 0.06) and holding there keeps moveX < 0 continuously
    const leftTracker = createSingleHandTrackerState();
    evaluateSingleHandMotion(makeHand(0.3, 0.6), leftTracker, dt);
    for (let i = 0; i < 5; i++) {
      evaluateSingleHandMotion(makeHand(0.24, 0.6), leftTracker, dt);
    }
    const heldLeft = evaluateSingleHandMotion(makeHand(0.24, 0.6), leftTracker, dt);
    expect(heldLeft.moveX).toBeLessThan(-0.5);
  });

  it('drags anchor when extended beyond radius so a small pullback immediately reverses', () => {
    const dt = 1 / 30;
    const tracker = createSingleHandTrackerState();

    // Start at 0.2, sweep right all the way to 0.7 -> anchor drags near 0.7 - radius
    evaluateSingleHandMotion(makeHand(0.2, 0.6), tracker, dt);
    for (let i = 0; i < 12; i++) {
      evaluateSingleHandMotion(makeHand(0.7, 0.6), tracker, dt);
    }
    expect(tracker.anchorX!).toBeCloseTo(0.7 - HAND_JOYSTICK_RADIUS, 2);

    // Pulling back slightly to 0.56 (crossing dragged anchor) immediately flips moveX < 0
    for (let i = 0; i < 8; i++) {
      evaluateSingleHandMotion(makeHand(0.56, 0.6), tracker, dt);
    }
    const reversed = evaluateSingleHandMotion(makeHand(0.56, 0.6), tracker, dt);
    expect(reversed.moveX).toBeLessThan(-0.3);
  });

  it('suppresses incidental upward wobble during fast horizontal swings and triggers on vertical lift', () => {
    const dt = 1 / 30;

    // Fast horizontal sweep with slight upward drift (|dx| >> |dy|) must NOT jump
    const sweepTracker = createSingleHandTrackerState();
    evaluateSingleHandMotion(makeHand(0.3, 0.6), sweepTracker, dt);
    const sweep = evaluateSingleHandMotion(makeHand(0.45, 0.585), sweepTracker, dt);
    expect(sweep.jump).toBe(false);

    // Intentional upward lift triggers jump, then stops when stationary or moving down
    const jumpTracker = createSingleHandTrackerState();
    evaluateSingleHandMotion(makeHand(0.5, 0.75), jumpTracker, dt);
    const up = evaluateSingleHandMotion(makeHand(0.5, 0.67), jumpTracker, dt);
    expect(up.jump).toBe(true);

    const down = evaluateSingleHandMotion(makeHand(0.5, 0.74), jumpTracker, dt);
    expect(down.jump).toBe(false);

    // Missing hand resets anchor and jump
    const lost = evaluateSingleHandMotion(null, jumpTracker, dt);
    expect(lost.detected).toBe(false);
    expect(lost.moveX).toBe(0);
    expect(lost.jump).toBe(false);
    expect(jumpTracker.anchorX).toBeNull();
  });

  it('smoothly ramps and releases directional moveX at 60Hz', () => {
    const tracker = createSingleHandTrackerState();
    const m1 = stepSmoothDirectionalInput(tracker, 1, WORLD.FIXED_DT);
    expect(m1.moveX).toBeGreaterThan(0);
    expect(m1.moveX).toBeLessThan(0.5);

    const m2 = stepSmoothDirectionalInput(tracker, 1, WORLD.FIXED_DT);
    expect(m2.moveX).toBeGreaterThan(m1.moveX);
    expect(m2.moveX).toBeLessThan(1);

    const r1 = stepSmoothDirectionalInput(tracker, 0, WORLD.FIXED_DT);
    expect(r1.moveX).toBeLessThan(m2.moveX);
    expect(r1.moveX).toBeGreaterThan(0);
  });
});
