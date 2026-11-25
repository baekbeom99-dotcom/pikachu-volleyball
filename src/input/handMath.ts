import { WORLD } from '../core/constants';
import type { OpponentMode } from '../core/types';
import type { NormalizedLandmark } from './motionMath';

export interface HandTrackerState {
  smoothedX: number | null;
  smoothedY: number | null;
  baselineY: number | null;
}

export interface HandEvaluation {
  detected: boolean;
  targetX: number | null;
  jump: boolean;
  normX: number;
  normY: number;
}

export interface CropBounds {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export const HAND_EMA_ALPHA = 0.45;
export const HAND_MOVE_GAIN = 1.35;
export const HAND_RISE_THRESHOLD = 0.065;
export const PINCH_RATIO_THRESHOLD = 0.42;

const BASELINE_ALPHA = 0.05;
const COURT_EDGE_PADDING = 8;

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

const PALM_INDICES = [WRIST, INDEX_MCP, MIDDLE_MCP, PINKY_MCP] as const;
const FINGER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [INDEX_TIP, INDEX_PIP],
  [MIDDLE_TIP, MIDDLE_PIP],
  [RING_TIP, RING_PIP],
  [PINKY_TIP, PINKY_PIP],
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isValidLandmark(lm: NormalizedLandmark | undefined): lm is NormalizedLandmark {
  return lm !== undefined && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createHandTrackerState(): HandTrackerState {
  return {
    smoothedX: null,
    smoothedY: null,
    baselineY: null,
  };
}

/**
 * Computes the average palm center (`x`, `y`) from wrist and knuckle landmarks.
 * Returns null if landmarks are empty or invalid.
 */
export function computePalmCenter(
  landmarks: NormalizedLandmark[] | null | undefined,
): { x: number; y: number } | null {
  if (!landmarks || landmarks.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const idx of PALM_INDICES) {
    const lm = landmarks[idx];
    if (isValidLandmark(lm)) {
      sumX += lm.x;
      sumY += lm.y;
      count += 1;
    }
  }

  if (count === 0) {
    return null;
  }
  return { x: sumX / count, y: sumY / count };
}

/**
 * Detects whether the hand is making a pinch (thumb-index touch) or closed fist gesture.
 */
export function isHandActionGesture(landmarks: NormalizedLandmark[]): boolean {
  const wrist = landmarks[WRIST];
  const midMcp = landmarks[MIDDLE_MCP];
  if (!isValidLandmark(wrist) || !isValidLandmark(midMcp)) {
    return false;
  }

  const palmSize = distance2D(wrist, midMcp);
  if (palmSize <= 1e-4) {
    return false;
  }

  const thumbTip = landmarks[THUMB_TIP];
  const indexTip = landmarks[INDEX_TIP];
  if (
    isValidLandmark(thumbTip) &&
    isValidLandmark(indexTip) &&
    distance2D(thumbTip, indexTip) / palmSize < PINCH_RATIO_THRESHOLD
  ) {
    return true;
  }

  let curledCount = 0;
  let validFingers = 0;
  for (const [tipIdx, pipIdx] of FINGER_PAIRS) {
    const tip = landmarks[tipIdx];
    const pip = landmarks[pipIdx];
    if (isValidLandmark(tip) && isValidLandmark(pip)) {
      validFingers += 1;
      if (distance2D(tip, wrist) < distance2D(pip, wrist) * 1.05) {
        curledCount += 1;
      }
    }
  }

  return validFingers >= 3 && curledCount >= 3;
}

function mapNormalizedXToCourt(side: 'left' | 'right', normalizedX: number): number {
  const weightedX = clamp01(0.5 + (clamp01(normalizedX) - 0.5) * HAND_MOVE_GAIN);
  const margin = WORLD.PLAYER_RADIUS + COURT_EDGE_PADDING;
  const minX = side === 'left' ? margin : WORLD.NET_RIGHT + margin;
  const maxX = side === 'left' ? WORLD.NET_LEFT - margin : WORLD.WIDTH - margin;
  return minX + weightedX * (maxX - minX);
}

/**
 * Evaluates a single player's hand landmarks in local `[0, 1]` coordinates.
 * Smooths palm X for responsive court tracking and triggers jump via pinch/fist or hand rise.
 */
export function evaluateHandInput(
  side: 'left' | 'right',
  landmarks: NormalizedLandmark[] | null,
  tracker: HandTrackerState,
  dt: number,
  localRange: { minX: number; maxX: number } = { minX: 0, maxX: 1 },
): HandEvaluation {
  const _safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  void _safeDt;

  const palm = computePalmCenter(landmarks);
  if (!landmarks || !palm) {
    tracker.smoothedX = null;
    tracker.smoothedY = null;
    tracker.baselineY = null;
    return {
      detected: false,
      targetX: null,
      jump: false,
      normX: 0.5,
      normY: 0.5,
    };
  }

  const spanX = Math.max(1e-4, localRange.maxX - localRange.minX);
  const localX = clamp01((palm.x - localRange.minX) / spanX);
  const localY = clamp01(palm.y);

  tracker.smoothedX =
    tracker.smoothedX === null
      ? localX
      : tracker.smoothedX + HAND_EMA_ALPHA * (localX - tracker.smoothedX);
  tracker.smoothedY =
    tracker.smoothedY === null
      ? localY
      : tracker.smoothedY + HAND_EMA_ALPHA * (localY - tracker.smoothedY);

  if (tracker.baselineY === null) {
    tracker.baselineY = tracker.smoothedY;
  }

  const handRise = tracker.baselineY - tracker.smoothedY;
  const gestureActive = isHandActionGesture(landmarks);
  const jump = gestureActive || handRise > HAND_RISE_THRESHOLD;

  if (!jump) {
    tracker.baselineY =
      tracker.baselineY + BASELINE_ALPHA * (tracker.smoothedY - tracker.baselineY);
  }

  return {
    detected: true,
    targetX: mapNormalizedXToCourt(side, tracker.smoothedX),
    jump,
    normX: tracker.smoothedX,
    normY: tracker.smoothedY,
  };
}

/**
 * Assigns detected hands from the full mirrored frame to P1 ('left') and P2 ('right').
 * In `'npc'` mode, selects the active hand across the entire frame for P1.
 * In `'2p'` mode, partitions left `[0, 0.5)` and right `[0.5, 1]` halves independently.
 */
export function assignHandsToSides(
  allHands: NormalizedLandmark[][],
  opponentMode: OpponentMode,
  preferredLeftX: number | null = null,
): {
  left: NormalizedLandmark[] | null;
  right: NormalizedLandmark[] | null;
} {
  if (opponentMode === 'npc') {
    if (allHands.length === 0) {
      return { left: null, right: null };
    }
    if (allHands.length === 1 || preferredLeftX === null) {
      return { left: allHands[0], right: null };
    }

    let bestHand = allHands[0];
    let bestDist = Infinity;
    for (const hand of allHands) {
      const center = computePalmCenter(hand);
      const dist = center ? Math.abs(center.x - preferredLeftX) : Infinity;
      if (dist < bestDist) {
        bestDist = dist;
        bestHand = hand;
      }
    }
    return { left: bestHand, right: null };
  }

  let left: NormalizedLandmark[] | null = null;
  let right: NormalizedLandmark[] | null = null;
  let bestLeftDist = Infinity;
  let bestRightDist = Infinity;

  for (const hand of allHands) {
    const center = computePalmCenter(hand);
    if (!center) {
      continue;
    }
    if (center.x < 0.5) {
      const d = Math.abs(center.x - 0.25);
      if (d < bestLeftDist) {
        bestLeftDist = d;
        left = hand;
      }
    } else {
      const d = Math.abs(center.x - 0.75);
      if (d < bestRightDist) {
        bestRightDist = d;
        right = hand;
      }
    }
  }

  return { left, right };
}

/**
 * Smoothly blends segmented person crop bounds so the human cutout stays stable on court.
 */
export function smoothCropBounds(
  prev: CropBounds | null,
  next: CropBounds,
  alpha = 0.25,
): CropBounds {
  if (!prev) {
    return next;
  }
  const a = clamp01(alpha);
  return {
    sx: prev.sx + a * (next.sx - prev.sx),
    sy: prev.sy + a * (next.sy - prev.sy),
    sw: prev.sw + a * (next.sw - prev.sw),
    sh: prev.sh + a * (next.sh - prev.sh),
  };
}
