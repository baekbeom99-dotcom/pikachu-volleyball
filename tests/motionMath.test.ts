import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import {
  createSideTrackerState,
  evaluateSidePose,
  type NormalizedLandmark,
} from '../src/input/motionMath';

interface PoseBuilderOptions {
  centerX?: number;
  width?: number;
  hipY?: number;
  shoulderY?: number;
  noseY?: number;
  leftWristY?: number;
  rightWristY?: number;
  minY?: number;
  maxY?: number;
  visibility?: number;
}

function makePose(options: PoseBuilderOptions = {}): NormalizedLandmark[] {
  const {
    centerX = 0.5,
    width = 0.36,
    hipY = 0.62,
    shoulderY = 0.42,
    noseY = 0.28,
    leftWristY = 0.58,
    rightWristY = 0.58,
    minY = 0.2,
    maxY = 0.85,
    visibility = 0.95,
  } = options;

  const halfW = width / 2;
  const landmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: centerX,
    y: (hipY + shoulderY) / 2,
    visibility: 0,
  }));

  // Head & extremities define outer bounding box cleanly when desired
  landmarks[0] = { x: centerX, y: noseY, visibility };
  landmarks[11] = { x: centerX - halfW * 0.45, y: shoulderY, visibility };
  landmarks[12] = { x: centerX + halfW * 0.45, y: shoulderY, visibility };
  landmarks[15] = { x: centerX - halfW, y: leftWristY, visibility };
  landmarks[16] = { x: centerX + halfW, y: rightWristY, visibility };
  landmarks[23] = { x: centerX - halfW * 0.35, y: hipY, visibility };
  landmarks[24] = { x: centerX + halfW * 0.35, y: hipY, visibility };
  landmarks[27] = { x: centerX - halfW * 0.3, y: maxY, visibility };
  landmarks[28] = { x: centerX + halfW * 0.3, y: maxY, visibility };
  // Top crown landmark to pin minY cleanly
  landmarks[1] = { x: centerX, y: minY, visibility };

  return landmarks;
}

describe('motionMath', () => {
  it('returns NO_PERSON for null, empty, or insufficient visible landmarks', () => {
    const tracker = createSideTrackerState();
    tracker.okHoldSeconds = 0.4;
    tracker.lastGateStatus = 'OK';

    const emptyRes = evaluateSidePose('left', null, tracker, 1 / 60);
    expect(emptyRes).toEqual({
      detected: false,
      targetX: null,
      jump: false,
      widthRatio: 0,
      heightRatio: 0,
      gateStatus: 'NO_PERSON',
    });
    expect(tracker.okHoldSeconds).toBe(0);
    expect(tracker.lastGateStatus).toBe('NO_PERSON');

    const emptyArrayRes = evaluateSidePose('right', [], tracker, 1 / 60);
    expect(emptyArrayRes).toEqual({
      detected: false,
      targetX: null,
      jump: false,
      widthRatio: 0,
      heightRatio: 0,
      gateStatus: 'NO_PERSON',
    });

    // Only 2 visible landmarks (below minimum of 3)
    const sparse: NormalizedLandmark[] = [];
    sparse[11] = { x: 0.4, y: 0.4, visibility: 0.9 };
    sparse[12] = { x: 0.6, y: 0.4, visibility: 0.9 };
    sparse[15] = { x: 0.3, y: 0.5, visibility: 0.2 }; // below MIN_VISIBILITY 0.45
    const twoVisible = evaluateSidePose('left', sparse, tracker, 1 / 60);
    expect(twoVisible.detected).toBe(false);
    expect(twoVisible.gateStatus).toBe('NO_PERSON');

    // 3 visible landmarks, but none are torso (11, 12, 23, 24)
    const noTorso: NormalizedLandmark[] = [];
    noTorso[0] = { x: 0.5, y: 0.2, visibility: 0.9 };
    noTorso[15] = { x: 0.4, y: 0.5, visibility: 0.9 };
    noTorso[16] = { x: 0.6, y: 0.5, visibility: 0.9 };
    const noTorsoRes = evaluateSidePose('left', noTorso, tracker, 1 / 60);
    expect(noTorsoRes.detected).toBe(false);
    expect(noTorsoRes.gateStatus).toBe('NO_PERSON');
  });

  it('maps left and right ROI torso center X onto P1 and P2 court bounds and clamps extremes', () => {
    const leftMin = WORLD.PLAYER_RADIUS + 8;
    const leftMax = WORLD.NET_LEFT - WORLD.PLAYER_RADIUS - 8;
    const rightMin = WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS + 8;
    const rightMax = WORLD.WIDTH - WORLD.PLAYER_RADIUS - 8;

    const leftTracker = createSideTrackerState();
    const leftCenter = evaluateSidePose('left', makePose({ centerX: 0.5 }), leftTracker, 1 / 60);
    expect(leftCenter.detected).toBe(true);
    expect(leftCenter.targetX).toBeCloseTo((leftMin + leftMax) / 2, 5);

    const rightTracker = createSideTrackerState();
    const rightCenter = evaluateSidePose('right', makePose({ centerX: 0.5 }), rightTracker, 1 / 60);
    expect(rightCenter.detected).toBe(true);
    expect(rightCenter.targetX).toBeCloseTo((rightMin + rightMax) / 2, 5);

    // Out-of-bounds negative/over-1 coordinates must clamp within each player's court bounds
    const leftLowTracker = createSideTrackerState();
    const leftLow = evaluateSidePose(
      'left',
      makePose({ centerX: -0.25, width: 0.2 }),
      leftLowTracker,
      1 / 60,
    );
    expect(leftLow.targetX).toBeCloseTo(leftMin, 5);

    const rightHighTracker = createSideTrackerState();
    const rightHigh = evaluateSidePose(
      'right',
      makePose({ centerX: 1.25, width: 0.2 }),
      rightHighTracker,
      1 / 60,
    );
    expect(rightHigh.targetX).toBeCloseTo(rightMax, 5);

    // EMA smoothing (alpha = 0.35) and undefined visibility treated as visible
    const emaTracker = createSideTrackerState();
    const pose1 = makePose({ centerX: 0.4 }).map((lm) =>
      lm.visibility === 0 ? lm : { x: lm.x, y: lm.y },
    );
    evaluateSidePose('left', pose1, emaTracker, 1 / 60);
    expect(emaTracker.smoothedCenterX).toBeCloseTo(0.4, 5);
    evaluateSidePose('left', makePose({ centerX: 0.6 }), emaTracker, 1 / 60);
    expect(emaTracker.smoothedCenterX).toBeCloseTo(0.4 + 0.35 * (0.6 - 0.4), 5);
  });

  it('guards against divider intrusion while preserving existing anchor and rejects unanchored edge intrusion', () => {
    const rightMin = WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS + 8;
    const rightMax = WORLD.WIDTH - WORLD.PLAYER_RADIUS - 8;
    const expectedP2At065 = rightMin + 0.65 * (rightMax - rightMin);

    // Anchored P2 at x = 0.65
    const rightTracker = createSideTrackerState();
    const initial = evaluateSidePose(
      'right',
      makePose({ centerX: 0.65, width: 0.36, minY: 0.2, maxY: 0.85 }),
      rightTracker,
      0.6,
    );
    expect(initial.detected).toBe(true);
    expect(initial.gateStatus).toBe('OK');
    expect(initial.targetX).toBeCloseTo(expectedP2At065, 5);

    // Invading landmark cluster from left side inside divider margin (< 0.14) at x = 0.06
    const invaderOnRight = evaluateSidePose(
      'right',
      makePose({ centerX: 0.06, width: 0.12, minY: 0.3, maxY: 0.5 }),
      rightTracker,
      1 / 60,
    );
    expect(invaderOnRight.detected).toBe(true);
    expect(invaderOnRight.targetX).toBeCloseTo(expectedP2At065, 5);
    expect(invaderOnRight.widthRatio).toBeCloseTo(0.36, 5);
    expect(invaderOnRight.heightRatio).toBeCloseTo(0.65, 5);
    expect(invaderOnRight.gateStatus).toBe('OK');
    expect(invaderOnRight.jump).toBe(false);
    expect(rightTracker.smoothedCenterX).toBeCloseTo(0.65, 5);

    // Invading cluster whose torso center is < 0.14 even though an arm reaches past 0.14 (pure rule b)
    const wideInvader = evaluateSidePose(
      'right',
      makePose({ centerX: 0.1, width: 0.18 }), // maxX = 0.19 >= 0.14, rawCenterX = 0.10 < 0.14
      rightTracker,
      1 / 60,
    );
    expect(wideInvader.detected).toBe(true);
    expect(wideInvader.targetX).toBeCloseTo(expectedP2At065, 5);
    expect(rightTracker.smoothedCenterX).toBeCloseTo(0.65, 5);

    // Left ROI anchored at x = 0.35 ignores invader at x = 0.92 (> 0.86)
    const leftTracker = createSideTrackerState();
    const leftAnchor = evaluateSidePose(
      'left',
      makePose({ centerX: 0.35, width: 0.36 }),
      leftTracker,
      0.6,
    );
    const leftInvaded = evaluateSidePose(
      'left',
      makePose({ centerX: 0.92, width: 0.1 }),
      leftTracker,
      1 / 60,
    );
    expect(leftInvaded.detected).toBe(true);
    expect(leftInvaded.targetX).toBeCloseTo(leftAnchor.targetX!, 5);

    // Pure edge intrusion with NO existing anchor is rejected as NO_PERSON
    const unanchoredLeft = createSideTrackerState();
    const pureLeftEdge = evaluateSidePose(
      'left',
      makePose({ centerX: 0.93, width: 0.1 }), // minX = 0.88 > 0.86
      unanchoredLeft,
      1 / 60,
    );
    expect(pureLeftEdge.detected).toBe(false);
    expect(pureLeftEdge.targetX).toBeNull();
    expect(pureLeftEdge.gateStatus).toBe('NO_PERSON');

    const unanchoredRight = createSideTrackerState();
    const pureRightEdge = evaluateSidePose(
      'right',
      makePose({ centerX: 0.07, width: 0.1 }), // maxX = 0.12 < 0.14
      unanchoredRight,
      1 / 60,
    );
    expect(pureRightEdge.detected).toBe(false);
    expect(pureRightEdge.targetX).toBeNull();
    expect(pureRightEdge.gateStatus).toBe('NO_PERSON');

    // Sustained divider intrusion (>= 0.4s) resets anchored tracker to NO_PERSON
    const sustainedTracker = createSideTrackerState();
    evaluateSidePose(
      'right',
      makePose({ centerX: 0.65, width: 0.36, minY: 0.2, maxY: 0.85 }),
      sustainedTracker,
      0.6,
    );
    const heldShort = evaluateSidePose(
      'right',
      makePose({ centerX: 0.06, width: 0.1, minY: 0.3, maxY: 0.5 }),
      sustainedTracker,
      0.25,
    );
    expect(heldShort.detected).toBe(true);
    expect(heldShort.widthRatio).toBeCloseTo(0.36, 5);
    expect(heldShort.heightRatio).toBeCloseTo(0.65, 5);
    expect(heldShort.gateStatus).toBe('OK');

    // A valid detection resets intrusionHoldSeconds back to 0
    evaluateSidePose(
      'right',
      makePose({ centerX: 0.65, width: 0.36, minY: 0.2, maxY: 0.85 }),
      sustainedTracker,
      1 / 60,
    );
    expect(sustainedTracker.intrusionHoldSeconds).toBe(0);

    // Now sustain intrusion for >= 0.4s -> resets to NO_PERSON
    evaluateSidePose(
      'right',
      makePose({ centerX: 0.06, width: 0.1 }),
      sustainedTracker,
      0.2,
    );
    const sustainedReset = evaluateSidePose(
      'right',
      makePose({ centerX: 0.06, width: 0.1 }),
      sustainedTracker,
      0.2,
    );
    expect(sustainedReset).toEqual({
      detected: false,
      targetX: null,
      jump: false,
      widthRatio: 0,
      heightRatio: 0,
      gateStatus: 'NO_PERSON',
    });
    expect(sustainedTracker.smoothedCenterX).toBeNull();
    expect(sustainedTracker.intrusionHoldSeconds).toBe(0);
  });

  it('enforces distance gate hysteresis across TOO_CLOSE, OK hold duration, and deadband', () => {
    const tracker = createSideTrackerState();

    // Too close by width (0.64 > 0.58)
    const tooClose = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.64, minY: 0.2, maxY: 0.85 }),
      tracker,
      0.2,
    );
    expect(tooClose.widthRatio).toBeCloseTo(0.64, 5);
    expect(tooClose.gateStatus).toBe('TOO_CLOSE');

    // Shrinks to OK dimensions (0.42 <= 0.48, 0.65 <= 0.76) for 0.2s -> still TOO_CLOSE
    const holding1 = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.42, minY: 0.2, maxY: 0.85 }),
      tracker,
      0.2,
    );
    expect(holding1.widthRatio).toBeCloseTo(0.42, 5);
    expect(holding1.heightRatio).toBeCloseTo(0.65, 5);
    expect(holding1.gateStatus).toBe('TOO_CLOSE');

    // Sustained >= 0.5s total -> transitions to OK
    const holding2 = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.42, minY: 0.2, maxY: 0.85 }),
      tracker,
      0.3,
    );
    expect(holding2.gateStatus).toBe('OK');

    // Deadband (0.52 between 0.48 and 0.58) stays OK once OK
    const deadband = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.52, minY: 0.2, maxY: 0.85 }),
      tracker,
      0.1,
    );
    expect(deadband.gateStatus).toBe('OK');
    expect(tracker.okHoldSeconds).toBe(0);

    // Too close by height (0.88 > 0.85) drops back to TOO_CLOSE
    const tooTall = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.4, minY: 0.06, maxY: 0.94 }),
      tracker,
      0.1,
    );
    expect(tooTall.heightRatio).toBeCloseTo(0.88, 5);
    expect(tooTall.gateStatus).toBe('TOO_CLOSE');

    // Deadband while TOO_CLOSE stays TOO_CLOSE
    const deadbandTooClose = evaluateSidePose(
      'left',
      makePose({ centerX: 0.5, width: 0.52, minY: 0.2, maxY: 0.85 }),
      tracker,
      0.3,
    );
    expect(deadbandTooClose.gateStatus).toBe('TOO_CLOSE');
    expect(tracker.okHoldSeconds).toBe(0);
  });

  it('detects jumps from hip rise, shoulder rise, and raised wrist above nose', () => {
    // 1. Sudden upward hip rise (> 0.06)
    const hipTracker = createSideTrackerState();
    const base = evaluateSidePose(
      'left',
      makePose({ hipY: 0.62, shoulderY: 0.42, noseY: 0.28 }),
      hipTracker,
      1 / 60,
    );
    expect(base.jump).toBe(false);

    const hipJump = evaluateSidePose(
      'left',
      makePose({ hipY: 0.54, shoulderY: 0.40, noseY: 0.26 }), // hip rise = 0.08 > 0.06
      hipTracker,
      1 / 60,
    );
    expect(hipJump.jump).toBe(true);
    // Baseline must not be dragged up during jump
    expect(hipTracker.baselineHipY).toBeCloseTo(0.62, 5);

    // 2. Sudden upward shoulder rise (> 0.06)
    const shoulderTracker = createSideTrackerState();
    evaluateSidePose(
      'left',
      makePose({ hipY: 0.62, shoulderY: 0.44, noseY: 0.28 }),
      shoulderTracker,
      1 / 60,
    );
    const shoulderJump = evaluateSidePose(
      'left',
      makePose({ hipY: 0.60, shoulderY: 0.36, noseY: 0.24 }), // shoulder rise = 0.08 > 0.06
      shoulderTracker,
      1 / 60,
    );
    expect(shoulderJump.jump).toBe(true);

    // 3. Raised wrist above nose (wrist.y < nose.y - 0.04)
    const wristTracker = createSideTrackerState();
    evaluateSidePose(
      'right',
      makePose({ hipY: 0.62, shoulderY: 0.42, noseY: 0.28, leftWristY: 0.55, rightWristY: 0.55 }),
      wristTracker,
      1 / 60,
    );
    const wristJump = evaluateSidePose(
      'right',
      makePose({ hipY: 0.62, shoulderY: 0.42, noseY: 0.28, leftWristY: 0.22, rightWristY: 0.55 }),
      wristTracker,
      1 / 60,
    );
    expect(wristJump.jump).toBe(true);

    // Small wrist raise below threshold (nose.y - 0.03) does not trigger jump, and right wrist above threshold does
    const smallWristMove = evaluateSidePose(
      'right',
      makePose({ hipY: 0.62, shoulderY: 0.42, noseY: 0.28, leftWristY: 0.25, rightWristY: 0.55 }),
      wristTracker,
      1 / 60,
    );
    expect(smallWristMove.jump).toBe(false);

    const rightWristJump = evaluateSidePose(
      'right',
      makePose({ hipY: 0.62, shoulderY: 0.42, noseY: 0.28, leftWristY: 0.55, rightWristY: 0.23 }),
      wristTracker,
      1 / 60,
    );
    expect(rightWristJump.jump).toBe(true);

    // 4. Slow non-jumping drift updates baseline gradually (alpha = 0.04)
    const driftTracker = createSideTrackerState();
    evaluateSidePose('left', makePose({ hipY: 0.6, shoulderY: 0.4 }), driftTracker, 1 / 60);
    const driftRes = evaluateSidePose(
      'left',
      makePose({ hipY: 0.57, shoulderY: 0.37 }),
      driftTracker,
      1 / 60,
    );
    expect(driftRes.jump).toBe(false);
    expect(driftTracker.baselineHipY).toBeCloseTo(0.6 + 0.04 * (0.57 - 0.6), 5);
  });

  it('completes OK distance hysteresis cleanly in 30 frames of WORLD.FIXED_DT', () => {
    const tracker = createSideTrackerState();
    const okPose = makePose({ centerX: 0.5, width: 0.42, minY: 0.2, maxY: 0.85 });

    for (let i = 0; i < 29; i += 1) {
      const frame = evaluateSidePose('left', okPose, tracker, WORLD.FIXED_DT);
      expect(frame.gateStatus).toBe('TOO_CLOSE');
    }

    const frame30 = evaluateSidePose('left', okPose, tracker, WORLD.FIXED_DT);
    expect(frame30.gateStatus).toBe('OK');
  });

  it('handles NaN landmark coordinates and non-finite dt safely', () => {
    const tracker = createSideTrackerState();
    const poseWithNaN = makePose({ centerX: 0.5, width: 0.4, minY: 0.2, maxY: 0.85 });
    poseWithNaN[15] = { x: Number.NaN, y: 0.5, visibility: 0.95 };

    const nanDtRes = evaluateSidePose('left', poseWithNaN, tracker, Number.NaN);
    expect(nanDtRes.detected).toBe(true);
    expect(Number.isFinite(nanDtRes.targetX)).toBe(true);
    expect(Number.isFinite(nanDtRes.widthRatio)).toBe(true);
    expect(Number.isFinite(nanDtRes.heightRatio)).toBe(true);
    expect(tracker.okHoldSeconds).toBe(0);

    // If all torso landmarks become NaN, tracker safely reports NO_PERSON without poisoning state
    const badTorsoPose = makePose({ centerX: 0.5 });
    for (const idx of [11, 12, 23, 24]) {
      badTorsoPose[idx] = { x: Number.NaN, y: Number.POSITIVE_INFINITY, visibility: 0.95 };
    }
    const badTorsoRes = evaluateSidePose('left', badTorsoPose, tracker, -0.5);
    expect(badTorsoRes.detected).toBe(false);
    expect(badTorsoRes.gateStatus).toBe('NO_PERSON');
    expect(tracker.smoothedCenterX).toBeNull();
  });
});
