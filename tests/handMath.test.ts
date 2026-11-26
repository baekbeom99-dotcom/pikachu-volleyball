import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import type { HumanHandVisual } from '../src/core/types';
import {
  FIST_MAX_HOLD_SECONDS,
  HUMAN_COURT_HEIGHT,
  HUMAN_COURT_TOP_Y,
  HUMAN_LEFT_RECT,
  HUMAN_RIGHT_RECT,
  advanceSideHandsTimers,
  computeHandStrikePoint,
  createSideHandsTrackerState,
  evaluateArHands,
  isClosedFist,
  mapHandNormalizedToWorld,
  partitionHandsForArPlayers,
} from '../src/input/handMath';
import type { NormalizedLandmark } from '../src/input/motionMath';

function makeOpenHand(cx: number, cy: number, scale = 0.14): NormalizedLandmark[] {
  const lms: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({
    x: cx,
    y: cy,
  }));
  lms[0] = { x: cx, y: cy + scale * 0.55 };
  lms[5] = { x: cx - scale * 0.35, y: cy - scale * 0.1 };
  lms[9] = { x: cx, y: cy - scale * 0.15 };
  lms[10] = { x: cx, y: cy - scale * 0.45 };
  lms[13] = { x: cx + scale * 0.25, y: cy - scale * 0.1 };
  lms[17] = { x: cx + scale * 0.45, y: cy };

  lms[4] = { x: cx - scale * 0.75, y: cy - scale * 0.1 };
  lms[6] = { x: cx - scale * 0.35, y: cy - scale * 0.45 };
  lms[8] = { x: cx - scale * 0.35, y: cy - scale * 0.85 };
  lms[12] = { x: cx, y: cy - scale * 0.95 };
  lms[14] = { x: cx + scale * 0.25, y: cy - scale * 0.48 };
  lms[16] = { x: cx + scale * 0.25, y: cy - scale * 0.88 };
  lms[18] = { x: cx + scale * 0.45, y: cy - scale * 0.35 };
  lms[20] = { x: cx + scale * 0.45, y: cy - scale * 0.7 };
  return lms;
}

describe('handMath (1:1 AR fist rules)', () => {
  it('computes strike point and detects closed fist only (ignoring open hand and pinch)', () => {
    expect(computeHandStrikePoint(null)).toBeNull();
    expect(computeHandStrikePoint([])).toBeNull();

    const openHand = makeOpenHand(0.5, 0.5);
    const point = computeHandStrikePoint(openHand)!;
    expect(point.x).toBeCloseTo(0.5028, 3);
    expect(isClosedFist(openHand)).toBe(false);

    // Thumb-index pinch while other fingers are open should NOT count as fist
    const pinchHand = makeOpenHand(0.5, 0.5);
    pinchHand[4] = { x: 0.49, y: 0.45 };
    pinchHand[8] = { x: 0.495, y: 0.455 };
    expect(isClosedFist(pinchHand)).toBe(false);

    // Closed fist (at least 3 fingers curled inside PIPs)
    const fistHand = makeOpenHand(0.5, 0.5);
    fistHand[8] = { x: 0.48, y: 0.55 };
    fistHand[12] = { x: 0.5, y: 0.56 };
    fistHand[16] = { x: 0.52, y: 0.55 };
    fistHand[20] = { x: 0.54, y: 0.54 };
    expect(isClosedFist(fistHand)).toBe(true);
  });

  it('maps normalized coordinates directly onto left and right 1:1 court rects', () => {
    const p1Center = mapHandNormalizedToWorld('left', 0.5, 0.5);
    expect(p1Center.x).toBeCloseTo(HUMAN_LEFT_RECT.width * 0.5, 2);
    expect(p1Center.y).toBeCloseTo(HUMAN_COURT_TOP_Y + HUMAN_COURT_HEIGHT * 0.5, 2);

    const p2Center = mapHandNormalizedToWorld('right', 0.5, 0.5);
    expect(p2Center.x).toBeCloseTo(
      HUMAN_RIGHT_RECT.x + HUMAN_RIGHT_RECT.width * 0.5,
      2,
    );
    expect(p2Center.x).toBeGreaterThan(WORLD.NET_RIGHT);
  });

  it('partitions hands cleanly for 1P (up to 2 hands) and 2P split halves', () => {
    const leftHand = makeOpenHand(0.25, 0.5);
    const rightHand = makeOpenHand(0.75, 0.5);

    const npcPart = partitionHandsForArPlayers([leftHand, rightHand], 'npc');
    expect(npcPart.left).toHaveLength(2);
    expect(npcPart.right).toHaveLength(0);

    const twoPPart = partitionHandsForArPlayers([leftHand, rightHand], '2p');
    expect(twoPPart.left).toHaveLength(1);
    expect(twoPPart.left[0].localNormX).toBeCloseTo(0.5, 1);
    expect(twoPPart.right).toHaveLength(1);
    expect(twoPPart.right[0].localNormX).toBeCloseTo(0.5, 1);
  });

  it('allows hitting only when fist is closed, expires after 1 second, and resets on opening hand', () => {
    const tracker = createSideHandsTrackerState();

    // Open hand cannot hit
    const openRes = evaluateArHands(
      'left',
      [{ localNormX: 0.4, localNormY: 0.6, isFist: false }],
      tracker,
      WORLD.FIXED_DT,
    );
    expect(openRes[0].isFist).toBe(false);
    expect(openRes[0].canHit).toBe(false);

    // Clenching fist activates hit window immediately
    const clench0 = evaluateArHands(
      'left',
      [{ localNormX: 0.4, localNormY: 0.6, isFist: true }],
      tracker,
      WORLD.FIXED_DT,
    );
    expect(clench0[0].isFist).toBe(true);
    expect(clench0[0].canHit).toBe(true);
    expect(clench0[0].fistRemainingRatio).toBe(1);

    // Holding fist at 0.8s is still valid
    const hold08 = evaluateArHands(
      'left',
      [{ localNormX: 0.45, localNormY: 0.55, isFist: true }],
      tracker,
      0.8,
    );
    expect(hold08[0].canHit).toBe(true);
    expect(hold08[0].fistRemainingRatio).toBeCloseTo(0.2, 2);

    // Holding fist past 1.0s expires hit capability
    const expired = evaluateArHands(
      'left',
      [{ localNormX: 0.45, localNormY: 0.55, isFist: true }],
      tracker,
      0.25,
    );
    expect(expired[0].isFist).toBe(true);
    expect(expired[0].canHit).toBe(false);
    expect(expired[0].fistRemainingRatio).toBe(0);

    // Opening hand resets timer; clenching again restores hit capability
    const reopened = evaluateArHands(
      'left',
      [{ localNormX: 0.45, localNormY: 0.55, isFist: false }],
      tracker,
      WORLD.FIXED_DT,
    );
    expect(reopened[0].canHit).toBe(false);

    const reclenched = evaluateArHands(
      'left',
      [{ localNormX: 0.45, localNormY: 0.55, isFist: true }],
      tracker,
      WORLD.FIXED_DT,
    );
    expect(reclenched[0].canHit).toBe(true);
    expect(reclenched[0].fistRemainingRatio).toBe(1);
  });

  it('expires fist timers between webcam frames via advanceSideHandsTimers', () => {
    const tracker = createSideHandsTrackerState();
    const hands = evaluateArHands(
      'left',
      [{ localNormX: 0.5, localNormY: 0.5, isFist: true }],
      tracker,
      WORLD.FIXED_DT,
    );
    const visuals: HumanHandVisual[] = hands.map((h) => ({
      playerId: 'p1',
      x: h.x,
      y: h.y,
      isFist: h.isFist,
      canHit: h.canHit,
      fistRemainingRatio: h.fistRemainingRatio,
    }));

    expect(hands[0].canHit).toBe(true);
    advanceSideHandsTimers(tracker, hands, visuals, 'p1', FIST_MAX_HOLD_SECONDS + 0.05);
    expect(hands[0].canHit).toBe(false);
    expect(visuals[0].canHit).toBe(false);
    expect(visuals[0].fistRemainingRatio).toBe(0);
  });
});
