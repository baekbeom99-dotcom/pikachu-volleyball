import { WORLD } from '../core/constants';
import type { HandHitTarget, HumanHandVisual, OpponentMode } from '../core/types';
import type { NormalizedLandmark } from './motionMath';

export interface CourtRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackedHandSlot {
  x: number;
  y: number;
  isFist: boolean;
  fistHoldSeconds: number;
}

export interface SideHandsTrackerState {
  slots: TrackedHandSlot[];
}

export interface EvaluatedArHand extends HandHitTarget {
  isFist: boolean;
  fistRemainingRatio: number;
}

export interface LocalHandObservation {
  localNormX: number;
  localNormY: number;
  isFist: boolean;
}

export const HUMAN_COURT_TOP_Y = 76;
export const HUMAN_COURT_HEIGHT = WORLD.FLOOR_Y - HUMAN_COURT_TOP_Y;

export const HUMAN_LEFT_RECT: CourtRect = {
  x: 0,
  y: HUMAN_COURT_TOP_Y,
  width: WORLD.NET_LEFT,
  height: HUMAN_COURT_HEIGHT,
};

export const HUMAN_RIGHT_RECT: CourtRect = {
  x: WORLD.NET_RIGHT,
  y: HUMAN_COURT_TOP_Y,
  width: WORLD.WIDTH - WORLD.NET_RIGHT,
  height: HUMAN_COURT_HEIGHT,
};

export const AR_HAND_EMA_ALPHA = 0.65;
export const FIST_MAX_HOLD_SECONDS = 1.0;

const MAX_HAND_VELOCITY = 1400;
const HAND_FLOOR_CLEARANCE = 10;
const MATCH_MAX_DISTANCE = 220;
const FIST_EXPIRE_EPSILON = 1e-6;

const WRIST = 0;
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

const STRIKE_INDICES = [WRIST, INDEX_MCP, MIDDLE_MCP, PINKY_MCP, MIDDLE_PIP] as const;
const FINGER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [INDEX_TIP, INDEX_PIP],
  [MIDDLE_TIP, MIDDLE_PIP],
  [RING_TIP, RING_PIP],
  [PINKY_TIP, PINKY_PIP],
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function isValidLandmark(lm: NormalizedLandmark | undefined): lm is NormalizedLandmark {
  return lm !== undefined && Number.isFinite(lm.x) && Number.isFinite(lm.y);
}

function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function createSideHandsTrackerState(): SideHandsTrackerState {
  return { slots: [] };
}

/** Returns the 1:1 AR camera destination rectangle in world coordinates for a half-court. */
export function getHumanCourtRect(side: 'left' | 'right'): CourtRect {
  return side === 'left' ? HUMAN_LEFT_RECT : HUMAN_RIGHT_RECT;
}

/**
 * Computes the palm/strike center `[0..1, 0..1]` from MediaPipe hand landmarks.
 */
export function computeHandStrikePoint(
  landmarks: NormalizedLandmark[] | null | undefined,
): { x: number; y: number } | null {
  if (!landmarks || landmarks.length === 0) {
    return null;
  }

  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const idx of STRIKE_INDICES) {
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
 * Detects whether the hand is closed into a fist (at least 3 of 4 fingers curled).
 * Open hands return false so the ball passes through without colliding.
 */
export function isClosedFist(landmarks: NormalizedLandmark[]): boolean {
  const wrist = landmarks[WRIST];
  const midMcp = landmarks[MIDDLE_MCP];
  if (!isValidLandmark(wrist) || !isValidLandmark(midMcp)) {
    return false;
  }

  const palmSize = distance2D(wrist, midMcp);
  if (palmSize <= 1e-4) {
    return false;
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

/**
 * Maps local normalized `[0, 1]` hand coordinates directly onto the 1:1 court camera rectangle.
 */
export function mapHandNormalizedToWorld(
  side: 'left' | 'right',
  localNormX: number,
  localNormY: number,
): { x: number; y: number } {
  const rect = getHumanCourtRect(side);
  const nx = clamp01(localNormX);
  const ny = clamp01(localNormY);
  return {
    x: clamp(rect.x + nx * rect.width, rect.x + 8, rect.x + rect.width - 8),
    y: clamp(
      rect.y + ny * rect.height,
      rect.y + 8,
      WORLD.FLOOR_Y - HAND_FLOOR_CLEARANCE,
    ),
  };
}

/**
 * Partitions full-frame hand landmarks `[0..1]` into left ('p1') and right ('p2') local observations.
 */
export function partitionHandsForArPlayers(
  allHands: NormalizedLandmark[][],
  opponentMode: OpponentMode,
): {
  left: LocalHandObservation[];
  right: LocalHandObservation[];
} {
  const left: LocalHandObservation[] = [];
  const right: LocalHandObservation[] = [];

  for (const landmarks of allHands) {
    const center = computeHandStrikePoint(landmarks);
    if (!center) {
      continue;
    }
    const isFist = isClosedFist(landmarks);

    if (opponentMode === 'npc') {
      if (left.length < 2) {
        left.push({
          localNormX: clamp01(center.x),
          localNormY: clamp01(center.y),
          isFist,
        });
      }
    } else if (center.x < 0.5) {
      if (left.length < 2) {
        left.push({
          localNormX: clamp01(center.x * 2),
          localNormY: clamp01(center.y),
          isFist,
        });
      }
    } else if (right.length < 2) {
      right.push({
        localNormX: clamp01((center.x - 0.5) * 2),
        localNormY: clamp01(center.y),
        isFist,
      });
    }
  }

  return { left, right };
}

/**
 * Smooths raw hand observations into world-space hit targets and enforces the 1-second fist hit limit:
 * - Open hand -> cannot hit (`canHit = false`, timer resets)
 * - Closed fist -> can hit (`canHit = true`) for up to `1.0s`
 * - Held closed fist > `1.0s` -> expires (`canHit = false`) until opened and clenched again
 */
export function evaluateArHands(
  side: 'left' | 'right',
  observations: LocalHandObservation[],
  tracker: SideHandsTrackerState,
  dt: number,
): EvaluatedArHand[] {
  if (observations.length === 0) {
    tracker.slots = [];
    return [];
  }

  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const velDt = safeDt > 1e-4 ? safeDt : 1 / 60;

  const rawTargets = observations.map((obs) => ({
    ...mapHandNormalizedToWorld(side, obs.localNormX, obs.localNormY),
    isFist: obs.isFist,
  }));

  const prevUsed = new Set<number>();
  const nextSlots: TrackedHandSlot[] = [];
  const results: EvaluatedArHand[] = [];

  for (const target of rawTargets) {
    let bestPrevIdx = -1;
    let bestDist = MATCH_MAX_DISTANCE;

    for (let i = 0; i < tracker.slots.length; i++) {
      if (prevUsed.has(i)) {
        continue;
      }
      const prev = tracker.slots[i];
      const d = Math.hypot(target.x - prev.x, target.y - prev.y);
      if (d < bestDist) {
        bestDist = d;
        bestPrevIdx = i;
      }
    }

    if (bestPrevIdx >= 0) {
      prevUsed.add(bestPrevIdx);
      const prev = tracker.slots[bestPrevIdx];
      const smoothedX = prev.x + AR_HAND_EMA_ALPHA * (target.x - prev.x);
      const smoothedY = prev.y + AR_HAND_EMA_ALPHA * (target.y - prev.y);
      const vx = clamp((smoothedX - prev.x) / velDt, -MAX_HAND_VELOCITY, MAX_HAND_VELOCITY);
      const vy = clamp((smoothedY - prev.y) / velDt, -MAX_HAND_VELOCITY, MAX_HAND_VELOCITY);

      const fistHoldSeconds = target.isFist
        ? prev.isFist
          ? prev.fistHoldSeconds + safeDt
          : 0
        : 0;
      const canHit = target.isFist && fistHoldSeconds <= FIST_MAX_HOLD_SECONDS + FIST_EXPIRE_EPSILON;
      const fistRemainingRatio = target.isFist
        ? clamp01(1 - fistHoldSeconds / FIST_MAX_HOLD_SECONDS)
        : 0;

      nextSlots.push({
        x: smoothedX,
        y: smoothedY,
        isFist: target.isFist,
        fistHoldSeconds,
      });
      results.push({
        x: smoothedX,
        y: smoothedY,
        vx,
        vy,
        canHit,
        isFist: target.isFist,
        fistRemainingRatio,
      });
    } else {
      const fistHoldSeconds = 0;
      const canHit = target.isFist;
      const fistRemainingRatio = target.isFist ? 1 : 0;

      nextSlots.push({
        x: target.x,
        y: target.y,
        isFist: target.isFist,
        fistHoldSeconds,
      });
      results.push({
        x: target.x,
        y: target.y,
        vx: 0,
        vy: 0,
        canHit,
        isFist: target.isFist,
        fistRemainingRatio,
      });
    }
  }

  tracker.slots = nextSlots;
  return results;
}

/**
 * Advances active fist hold timers at fixed simulation ticks between camera frames
 * so the 1-second fist expiration stays accurate regardless of webcam frame rate.
 */
export function advanceSideHandsTimers(
  tracker: SideHandsTrackerState,
  hitTargets: HandHitTarget[] | undefined,
  visuals: HumanHandVisual[],
  playerId: 'p1' | 'p2',
  dt: number,
): void {
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (safeDt <= 0 || tracker.slots.length === 0) {
    return;
  }

  let visualIdx = 0;
  for (let i = 0; i < tracker.slots.length; i++) {
    const slot = tracker.slots[i];
    if (slot.isFist) {
      slot.fistHoldSeconds += safeDt;
    } else {
      slot.fistHoldSeconds = 0;
    }
    const canHit =
      slot.isFist && slot.fistHoldSeconds <= FIST_MAX_HOLD_SECONDS + FIST_EXPIRE_EPSILON;
    const remainingRatio = slot.isFist
      ? clamp01(1 - slot.fistHoldSeconds / FIST_MAX_HOLD_SECONDS)
      : 0;

    if (hitTargets && hitTargets[i]) {
      hitTargets[i].canHit = canHit;
    }

    while (visualIdx < visuals.length && visuals[visualIdx].playerId !== playerId) {
      visualIdx += 1;
    }
    if (visualIdx < visuals.length) {
      visuals[visualIdx].isFist = slot.isFist;
      visuals[visualIdx].canHit = canHit;
      visuals[visualIdx].fistRemainingRatio = remainingRatio;
      visualIdx += 1;
    }
  }
}
