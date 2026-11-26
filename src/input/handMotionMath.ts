import type { OpponentMode } from '../core/types';
import { computeHandStrikePoint } from './handMath';
import type { NormalizedLandmark } from './motionMath';

export interface SingleHandTrackerState {
  anchorX: number | null;
  smoothedX: number | null;
  smoothedY: number | null;
  smoothedMoveX: number;
  jumpTimer: number;
}

export interface SingleHandMotionEvaluation {
  detected: boolean;
  moveX: number;
  jump: boolean;
  normX: number;
  normY: number;
}

export const HAND_MOTION_X_ALPHA = 0.45;
export const HAND_MOTION_Y_ALPHA = 0.5;
export const HAND_JOYSTICK_DEADZONE = 0.02;
export const HAND_JOYSTICK_RADIUS = 0.09;
export const HAND_JUMP_UPWARD_VY = 0.26;
export const HAND_JUMP_STRONG_UPWARD_VY = 0.55;
export const HAND_JUMP_VERTICAL_DOMINANCE = 0.75;
export const HAND_JUMP_CANCEL_DOWN_VY = 0.14;
export const HAND_JUMP_PULSE_SEC = 0.12;
export const HAND_MOVE_ATTACK_RATE = 18;
export const HAND_MOVE_RELEASE_RATE = 14;

const MIN_FRAME_DT = 1 / 120;
const MAX_FRAME_DT = 0.25;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createSingleHandTrackerState(): SingleHandTrackerState {
  return {
    anchorX: null,
    smoothedX: null,
    smoothedY: null,
    smoothedMoveX: 0,
    jumpTimer: 0,
  };
}

/**
 * Picks at most ONE hand per side from detected landmarks:
 * - In `'npc'` mode: picks 1 hand across the full frame, preferring closest to previous X.
 * - In `'2p'` mode: partitions left `[0, 0.5)` and right `[0.5, 1]`, picking 1 hand per side.
 */
export function selectSingleHandBySide(
  allHands: NormalizedLandmark[][],
  opponentMode: OpponentMode,
  preferredLeftX: number | null = null,
  preferredRightX: number | null = null,
): {
  left: NormalizedLandmark[] | null;
  right: NormalizedLandmark[] | null;
} {
  if (allHands.length === 0) {
    return { left: null, right: null };
  }

  if (opponentMode === 'npc') {
    let bestHand = allHands[0];
    if (allHands.length > 1 && preferredLeftX !== null) {
      let bestDist = Infinity;
      for (const hand of allHands) {
        const center = computeHandStrikePoint(hand);
        const dist = center ? Math.abs(center.x - preferredLeftX) : Infinity;
        if (dist < bestDist) {
          bestDist = dist;
          bestHand = hand;
        }
      }
    }
    return { left: bestHand, right: null };
  }

  let left: NormalizedLandmark[] | null = null;
  let right: NormalizedLandmark[] | null = null;
  let bestLeftDist = Infinity;
  let bestRightDist = Infinity;

  const leftAnchor = preferredLeftX ?? 0.25;
  const rightAnchor = preferredRightX ?? 0.75;

  for (const hand of allHands) {
    const center = computeHandStrikePoint(hand);
    if (!center) {
      continue;
    }
    if (center.x < 0.5) {
      const dist = Math.abs(center.x - leftAnchor);
      if (dist < bestLeftDist) {
        bestLeftDist = dist;
        left = hand;
      }
    } else {
      const dist = Math.abs(center.x - rightAnchor);
      if (dist < bestRightDist) {
        bestRightDist = dist;
        right = hand;
      }
    }
  }

  return { left, right };
}

/**
 * Evaluates a single hand using a **dragged air-joystick** model (`anchorX` + clamped radius)
 * and **upward-dominant jump gating**, ignoring absolute frame coordinates.
 */
export function evaluateSingleHandMotion(
  landmarks: NormalizedLandmark[] | null,
  tracker: SingleHandTrackerState,
  dt: number = 1 / 30,
  localRange: { minX: number; maxX: number } = { minX: 0, maxX: 1 },
): SingleHandMotionEvaluation {
  const palm = computeHandStrikePoint(landmarks);
  if (!landmarks || !palm) {
    tracker.anchorX = null;
    tracker.smoothedX = null;
    tracker.smoothedY = null;
    tracker.jumpTimer = 0;
    return {
      detected: false,
      moveX: 0,
      jump: false,
      normX: 0.5,
      normY: 0.5,
    };
  }

  const spanX = Math.max(1e-4, localRange.maxX - localRange.minX);
  const localX = clamp01((palm.x - localRange.minX) / spanX);
  const localY = clamp01(palm.y);

  // First detection sets anchorX right where the hand appeared -> zero initial offset/jump.
  if (
    tracker.anchorX === null ||
    tracker.smoothedX === null ||
    tracker.smoothedY === null
  ) {
    tracker.anchorX = localX;
    tracker.smoothedX = localX;
    tracker.smoothedY = localY;
    tracker.jumpTimer = 0;
    return {
      detected: true,
      moveX: 0,
      jump: false,
      normX: localX,
      normY: localY,
    };
  }

  const safeDt = Number.isFinite(dt)
    ? Math.max(MIN_FRAME_DT, Math.min(MAX_FRAME_DT, dt))
    : 1 / 30;

  const prevX = tracker.smoothedX;
  const prevY = tracker.smoothedY;
  const nextX = prevX + HAND_MOTION_X_ALPHA * (localX - prevX);
  const nextY = prevY + HAND_MOTION_Y_ALPHA * (localY - prevY);

  // Dragged air-joystick: clamp anchor within +-HAND_JOYSTICK_RADIUS of hand
  // so pulling back slightly immediately stops or reverses direction.
  let offset = nextX - tracker.anchorX;
  if (offset > HAND_JOYSTICK_RADIUS) {
    tracker.anchorX = nextX - HAND_JOYSTICK_RADIUS;
    offset = HAND_JOYSTICK_RADIUS;
  } else if (offset < -HAND_JOYSTICK_RADIUS) {
    tracker.anchorX = nextX + HAND_JOYSTICK_RADIUS;
    offset = -HAND_JOYSTICK_RADIUS;
  }

  const absOffset = Math.abs(offset);
  let moveX = 0;
  if (absOffset > HAND_JOYSTICK_DEADZONE) {
    const magnitude = Math.min(
      1,
      (absOffset - HAND_JOYSTICK_DEADZONE) /
        (HAND_JOYSTICK_RADIUS - HAND_JOYSTICK_DEADZONE),
    );
    moveX = Math.sign(offset) * magnitude;
  }

  const horizontalSpeed = Math.abs((nextX - prevX) / safeDt);
  const upwardVy = (prevY - nextY) / safeDt;

  tracker.smoothedX = nextX;
  tracker.smoothedY = nextY;

  const isDominantUpwardLift =
    upwardVy >= HAND_JUMP_UPWARD_VY &&
    (upwardVy >= horizontalSpeed * HAND_JUMP_VERTICAL_DOMINANCE ||
      upwardVy >= HAND_JUMP_STRONG_UPWARD_VY);

  if (isDominantUpwardLift) {
    tracker.jumpTimer = HAND_JUMP_PULSE_SEC;
  } else if (upwardVy <= -HAND_JUMP_CANCEL_DOWN_VY) {
    tracker.jumpTimer = 0;
  } else {
    tracker.jumpTimer = Math.max(0, tracker.jumpTimer - safeDt);
  }

  return {
    detected: true,
    moveX,
    jump: tracker.jumpTimer > 0,
    normX: nextX,
    normY: nextY,
  };
}

/**
 * Continuously interpolates directional `moveX` and ticks jump pulse at 60Hz
 * between webcam frames for smooth avatar acceleration and deceleration.
 */
export function stepSmoothDirectionalInput(
  tracker: SingleHandTrackerState,
  desiredMoveX: number,
  dt: number,
): { moveX: number; jump: boolean } {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (safeDt <= 0) {
    tracker.smoothedMoveX = desiredMoveX;
    return { moveX: desiredMoveX, jump: tracker.jumpTimer > 0 };
  }

  const rate =
    Math.abs(desiredMoveX) > Math.abs(tracker.smoothedMoveX)
      ? HAND_MOVE_ATTACK_RATE
      : HAND_MOVE_RELEASE_RATE;
  const alpha = Math.min(1, rate * safeDt);
  tracker.smoothedMoveX =
    tracker.smoothedMoveX + alpha * (desiredMoveX - tracker.smoothedMoveX);

  if (Math.abs(desiredMoveX) === 0 && Math.abs(tracker.smoothedMoveX) < 0.02) {
    tracker.smoothedMoveX = 0;
  }

  if (tracker.jumpTimer > 0) {
    tracker.jumpTimer = Math.max(0, tracker.jumpTimer - safeDt);
  }

  return {
    moveX: tracker.smoothedMoveX,
    jump: tracker.jumpTimer > 0,
  };
}
