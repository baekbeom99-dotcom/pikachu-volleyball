import { WORLD } from './constants';
import type { BallState, GameState, PlayerId, PlayerInput } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Simulates a copy of the ball forward to predict its landing X coordinate. */
export function predictBallLandingX(ball: BallState, maxSteps = 120): number {
  let x = ball.x;
  let y = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;
  const radius = ball.radius;
  const dt = WORLD.FIXED_DT;

  if (y + radius >= WORLD.FLOOR_Y) {
    return x;
  }

  for (let step = 0; step < maxSteps; step++) {
    vy += WORLD.BALL_GRAVITY * dt;
    const speed = Math.hypot(vx, vy);
    if (speed > WORLD.BALL_MAX_SPEED) {
      const scale = WORLD.BALL_MAX_SPEED / speed;
      vx *= scale;
      vy *= scale;
    }

    x += vx * dt;
    y += vy * dt;

    if (y - radius < 0) {
      y = radius;
      vy = Math.abs(vy) * 0.85;
    }

    if (x - radius < 0) {
      x = radius;
      vx = Math.abs(vx) * 0.85;
    } else if (x + radius > WORLD.WIDTH) {
      x = WORLD.WIDTH - radius;
      vx = -Math.abs(vx) * 0.85;
    }

    if (y + radius >= WORLD.FLOOR_Y) {
      break;
    }
  }

  return x;
}

/** Computes reactive volleyball AI movement and spike jump input for the NPC player. */
export function computeNpcInput(
  state: GameState,
  npcId: PlayerId = 'p2',
): PlayerInput {
  if (state.phase !== 'PLAYING' && state.phase !== 'READY_SERVE') {
    return { moveX: 0, targetX: null, jump: false };
  }

  const npc = npcId === 'p1' ? state.players[0] : state.players[1];
  const ball = state.ball;

  const isP2 = npcId === 'p2';
  const minX = isP2
    ? WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS
    : WORLD.PLAYER_RADIUS;
  const maxX = isP2
    ? WORLD.WIDTH - WORLD.PLAYER_RADIUS
    : WORLD.NET_LEFT - WORLD.PLAYER_RADIUS;
  const homeX = isP2
    ? (WORLD.NET_RIGHT + WORLD.WIDTH) / 2
    : WORLD.NET_LEFT / 2;
  const outwardOffset = isP2 ? 14 : -14;
  const opponentDir = isP2 ? -1 : 1;

  const isBallOnNpcSide = isP2 ? ball.x >= WORLD.NET_X : ball.x <= WORLD.NET_X;
  const isApproachingCloseToNet = isP2
    ? ball.x >= WORLD.NET_X - 40 && ball.vx > 40
    : ball.x <= WORLD.NET_X + 40 && ball.vx < -40;

  if (
    (isBallOnNpcSide || isApproachingCloseToNet) &&
    Math.abs(ball.x - npc.x) < 95 &&
    ball.y >= WORLD.FLOOR_Y - 260 &&
    ball.y <= WORLD.FLOOR_Y - 120 &&
    ball.vy > -120
  ) {
    return {
      moveX: opponentDir,
      targetX: null,
      jump: true,
    };
  }

  const predictedX = predictBallLandingX(ball);
  const isPredictedOnNpcSide = isP2
    ? predictedX >= WORLD.NET_X
    : predictedX <= WORLD.NET_X;
  const isHeadingToNpc = isP2
    ? ball.vx > 20 && predictedX >= WORLD.NET_X - 20
    : ball.vx < -20 && predictedX <= WORLD.NET_X + 20;

  const rawTargetX =
    isBallOnNpcSide || isPredictedOnNpcSide || isHeadingToNpc
      ? predictedX + outwardOffset
      : homeX;
  const targetX = clamp(rawTargetX, minX, maxX);
  const dx = targetX - npc.x;
  const moveX = Math.abs(dx) <= 10 ? 0 : clamp(dx / 45, -1, 1);

  return {
    moveX,
    targetX: null,
    jump: false,
  };
}
