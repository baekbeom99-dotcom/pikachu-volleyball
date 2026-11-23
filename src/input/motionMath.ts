import { WORLD } from '../core/constants';
import type { MotionGateStatus } from '../core/types';

export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface SideTrackerState {
  smoothedCenterX: number | null;
  baselineHipY: number | null;
  baselineShoulderY: number | null;
  okHoldSeconds: number;
  intrusionHoldSeconds: number;
  lastWidthRatio: number;
  lastHeightRatio: number;
  lastGateStatus: MotionGateStatus;
}

export interface SidePoseEvaluation {
  detected: boolean;
  targetX: number | null;
  jump: boolean;
  widthRatio: number;
  heightRatio: number;
  gateStatus: MotionGateStatus;
}

export const MIN_VISIBILITY = 0.45;
export const DIVIDER_MARGIN = 0.14;
export const MAX_ANCHOR_JUMP = 0.35;
export const EMA_ALPHA = 0.35;
export const TOO_CLOSE_WIDTH = 0.58;
export const TOO_CLOSE_HEIGHT = 0.85;
export const OK_WIDTH = 0.48;
export const OK_HEIGHT = 0.76;
export const OK_HOLD_SECONDS = 0.5;
export const JUMP_RISE_THRESHOLD = 0.06;
export const HAND_UP_OFFSET = 0.04;
export const INTRUSION_RESET_SECONDS = 0.4;

const BASELINE_ALPHA = 0.04;
const COURT_EDGE_PADDING = 8;
const HOLD_EPSILON = 1e-9;

const NOSE = 0;
const FACE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

const TORSO_INDICES = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isVisible(landmark: NormalizedLandmark | undefined): landmark is NormalizedLandmark {
  return (
    landmark !== undefined &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.visibility === undefined || landmark.visibility >= MIN_VISIBILITY)
  );
}

function getVisibleByIndices(
  landmarks: NormalizedLandmark[],
  indices: readonly number[],
): NormalizedLandmark[] {
  const result: NormalizedLandmark[] = [];
  for (const index of indices) {
    const lm = landmarks[index];
    if (isVisible(lm)) {
      result.push(lm);
    }
  }
  return result;
}

function averageField(landmarks: NormalizedLandmark[], field: 'x' | 'y'): number | null {
  if (landmarks.length === 0) {
    return null;
  }
  let sum = 0;
  for (const lm of landmarks) {
    sum += lm[field];
  }
  return sum / landmarks.length;
}

function mapNormalizedXToCourt(side: 'left' | 'right', normalizedX: number): number {
  const clampedX = clamp01(normalizedX);
  const margin = WORLD.PLAYER_RADIUS + COURT_EDGE_PADDING;
  const minX = side === 'left' ? margin : WORLD.NET_RIGHT + margin;
  const maxX = side === 'left' ? WORLD.NET_LEFT - margin : WORLD.WIDTH - margin;
  return minX + clampedX * (maxX - minX);
}

function resetNoPerson(tracker: SideTrackerState): SidePoseEvaluation {
  tracker.smoothedCenterX = null;
  tracker.baselineHipY = null;
  tracker.baselineShoulderY = null;
  tracker.okHoldSeconds = 0;
  tracker.intrusionHoldSeconds = 0;
  tracker.lastWidthRatio = 0;
  tracker.lastHeightRatio = 0;
  tracker.lastGateStatus = 'NO_PERSON';
  return {
    detected: false,
    targetX: null,
    jump: false,
    widthRatio: 0,
    heightRatio: 0,
    gateStatus: 'NO_PERSON',
  };
}

function updateDistanceGate(
  tracker: SideTrackerState,
  widthRatio: number,
  heightRatio: number,
  safeDt: number,
): MotionGateStatus {
  if (widthRatio > TOO_CLOSE_WIDTH || heightRatio > TOO_CLOSE_HEIGHT) {
    tracker.okHoldSeconds = 0;
    tracker.lastGateStatus = 'TOO_CLOSE';
    return tracker.lastGateStatus;
  }

  if (widthRatio <= OK_WIDTH && heightRatio <= OK_HEIGHT) {
    if (tracker.lastGateStatus === 'OK') {
      return 'OK';
    }
    tracker.okHoldSeconds += safeDt;
    tracker.lastGateStatus =
      tracker.okHoldSeconds + HOLD_EPSILON >= OK_HOLD_SECONDS ? 'OK' : 'TOO_CLOSE';
    return tracker.lastGateStatus;
  }

  // Deadband between OK and TOO_CLOSE thresholds preserves current gate without accumulating hold time.
  tracker.okHoldSeconds = 0;
  tracker.lastGateStatus = tracker.lastGateStatus === 'OK' ? 'OK' : 'TOO_CLOSE';
  return tracker.lastGateStatus;
}

function detectJumpAndUpdateBaselines(
  landmarks: NormalizedLandmark[],
  tracker: SideTrackerState,
): boolean {
  const hipY = averageField(getVisibleByIndices(landmarks, [LEFT_HIP, RIGHT_HIP]), 'y');
  const shoulderY = averageField(getVisibleByIndices(landmarks, [LEFT_SHOULDER, RIGHT_SHOULDER]), 'y');

  if (tracker.baselineHipY === null && hipY !== null) {
    tracker.baselineHipY = hipY;
  }
  if (tracker.baselineShoulderY === null && shoulderY !== null) {
    tracker.baselineShoulderY = shoulderY;
  }

  const hipRise = tracker.baselineHipY !== null && hipY !== null ? tracker.baselineHipY - hipY : 0;
  const shoulderRise =
    tracker.baselineShoulderY !== null && shoulderY !== null
      ? tracker.baselineShoulderY - shoulderY
      : 0;

  const nose = landmarks[NOSE];
  const leftWrist = landmarks[LEFT_WRIST];
  const rightWrist = landmarks[RIGHT_WRIST];
  const wristAboveHead =
    isVisible(nose) &&
    ((isVisible(leftWrist) && leftWrist.y < nose.y - HAND_UP_OFFSET) ||
      (isVisible(rightWrist) && rightWrist.y < nose.y - HAND_UP_OFFSET));

  const jump =
    hipRise > JUMP_RISE_THRESHOLD || shoulderRise > JUMP_RISE_THRESHOLD || wristAboveHead;

  if (!jump) {
    if (hipY !== null) {
      tracker.baselineHipY =
        tracker.baselineHipY === null
          ? hipY
          : tracker.baselineHipY + BASELINE_ALPHA * (hipY - tracker.baselineHipY);
    }
    if (shoulderY !== null) {
      tracker.baselineShoulderY =
        tracker.baselineShoulderY === null
          ? shoulderY
          : tracker.baselineShoulderY + BASELINE_ALPHA * (shoulderY - tracker.baselineShoulderY);
    }
  }

  return jump;
}

export function createSideTrackerState(): SideTrackerState {
  return {
    smoothedCenterX: null,
    baselineHipY: null,
    baselineShoulderY: null,
    okHoldSeconds: 0,
    intrusionHoldSeconds: 0,
    lastWidthRatio: 0,
    lastHeightRatio: 0,
    lastGateStatus: 'NO_PERSON',
  };
}

/**
 * Evaluates a single player's pose from ROI-local normalized `[0, 1]` landmarks
 * (with the center divider at `x = 1` for `'left'` and `x = 0` for `'right'`).
 */
export function evaluateSidePose(
  side: 'left' | 'right',
  landmarks: NormalizedLandmark[] | null,
  tracker: SideTrackerState,
  dt: number,
): SidePoseEvaluation {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

  if (!landmarks || landmarks.length === 0) {
    return resetNoPerson(tracker);
  }

  let visibleCount = 0;
  let rawMinX = Infinity;
  let rawMaxX = -Infinity;
  let rawMinY = Infinity;
  let rawMaxY = -Infinity;

  for (const lm of landmarks) {
    if (!isVisible(lm)) {
      continue;
    }
    visibleCount += 1;
    if (lm.x < rawMinX) rawMinX = lm.x;
    if (lm.x > rawMaxX) rawMaxX = lm.x;
    if (lm.y < rawMinY) rawMinY = lm.y;
    if (lm.y > rawMaxY) rawMaxY = lm.y;
  }

  const visibleFace = getVisibleByIndices(landmarks, FACE_INDICES);
  const visibleTorso = getVisibleByIndices(landmarks, TORSO_INDICES);
  if (visibleCount < 3 || (visibleFace.length === 0 && visibleTorso.length === 0)) {
    return resetNoPerson(tracker);
  }

  const minX = clamp01(rawMinX);
  const maxX = clamp01(rawMaxX);
  const minY = clamp01(rawMinY);
  const maxY = clamp01(rawMaxY);
  const widthRatio = maxX - minX;
  const heightRatio = maxY - minY;

  const rawCenterX = averageField(visibleFace.length > 0 ? visibleFace : visibleTorso, 'x')!;
  const isEdgeOnlyIntrusion =
    side === 'left' ? minX > 1 - DIVIDER_MARGIN : maxX < DIVIDER_MARGIN;
  const inDividerMargin =
    side === 'left' ? rawCenterX > 1 - DIVIDER_MARGIN : rawCenterX < DIVIDER_MARGIN;
  const isAnchorJumpIntrusion =
    tracker.smoothedCenterX !== null &&
    Math.abs(rawCenterX - tracker.smoothedCenterX) > MAX_ANCHOR_JUMP &&
    inDividerMargin;

  if (isEdgeOnlyIntrusion || isAnchorJumpIntrusion) {
    if (tracker.smoothedCenterX !== null) {
      tracker.intrusionHoldSeconds += safeDt;
      if (tracker.intrusionHoldSeconds + HOLD_EPSILON >= INTRUSION_RESET_SECONDS) {
        return resetNoPerson(tracker);
      }
      return {
        detected: true,
        targetX: mapNormalizedXToCourt(side, tracker.smoothedCenterX),
        jump: false,
        widthRatio: tracker.lastWidthRatio,
        heightRatio: tracker.lastHeightRatio,
        gateStatus: tracker.lastGateStatus,
      };
    }
    return resetNoPerson(tracker);
  }

  tracker.intrusionHoldSeconds = 0;
  tracker.lastWidthRatio = widthRatio;
  tracker.lastHeightRatio = heightRatio;

  const gateStatus = updateDistanceGate(tracker, widthRatio, heightRatio, safeDt);

  const clampedCenterX = clamp01(rawCenterX);
  tracker.smoothedCenterX =
    tracker.smoothedCenterX === null
      ? clampedCenterX
      : tracker.smoothedCenterX + EMA_ALPHA * (clampedCenterX - tracker.smoothedCenterX);

  const targetX = mapNormalizedXToCourt(side, tracker.smoothedCenterX);
  const jump = detectJumpAndUpdateBaselines(landmarks, tracker);

  return {
    detected: true,
    targetX,
    jump,
    widthRatio,
    heightRatio,
    gateStatus,
  };
}
