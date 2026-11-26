import { WORLD } from './constants';
import type {
  BallState,
  CharacterAnimState,
  HandHitTarget,
  PhysicsEvents,
  PlayerId,
  PlayerInput,
  PlayerState,
} from './types';

export const HAND_HIT_RADIUS = 38;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCourtBounds(id: PlayerId): { minX: number; maxX: number } {
  return id === 'p1'
    ? {
        minX: WORLD.PLAYER_RADIUS,
        maxX: WORLD.NET_LEFT - WORLD.PLAYER_RADIUS,
      }
    : {
        minX: WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS,
        maxX: WORLD.WIDTH - WORLD.PLAYER_RADIUS,
      };
}

/** Creates a player at the center of their half-court. */
export function createInitialPlayer(id: PlayerId): PlayerState {
  const facing: 1 | -1 = id === 'p1' ? 1 : -1;
  return {
    id,
    x: id === 'p1' ? WORLD.NET_X / 2 : WORLD.NET_X + WORLD.NET_X / 2,
    y: WORLD.FLOOR_Y - WORLD.PLAYER_RADIUS,
    vx: 0,
    vy: 0,
    radius: WORLD.PLAYER_RADIUS,
    facing,
    isGrounded: true,
    slideTimer: 0,
    slideCooldown: 0,
    slideDir: facing,
    hitCooldown: 0,
    animState: 'idle',
    animLock: null,
    animLockTimer: 0,
    animTime: 0,
  };
}

/** Creates the ball positioned above the serving player's court. */
export function createInitialBall(serveSide: PlayerId): BallState {
  return {
    x: serveSide === 'p1' ? WORLD.NET_X / 2 : WORLD.NET_X + WORLD.NET_X / 2,
    y: 160,
    vx: 0,
    vy: 0,
    radius: WORLD.BALL_RADIUS,
    isSpiked: false,
    rotation: 0,
    spin: 0,
    trail: [],
  };
}

function updatePlayerTimers(player: PlayerState, dt: number): void {
  player.animTime += dt;

  if (player.animLockTimer > 0) {
    player.animLockTimer = Math.max(0, player.animLockTimer - dt);
    if (player.animLockTimer === 0) {
      player.animLock = null;
    }
  }

  if (player.slideTimer > 0) {
    player.slideTimer = Math.max(0, player.slideTimer - dt);
  }

  if (player.slideCooldown > 0) {
    player.slideCooldown = Math.max(0, player.slideCooldown - dt);
  }

  if (player.hitCooldown > 0) {
    player.hitCooldown = Math.max(0, player.hitCooldown - dt);
  }
}

const TARGET_DEADZONE_PX = 1.5;
const TARGET_DAMP_DISTANCE_PX = 42;
const TARGET_VX_SLEW_RATE = 14;

function resolveMoveRatio(
  player: PlayerState,
  input: PlayerInput,
  minX: number,
  maxX: number,
  dt: number,
): number {
  if (player.slideTimer > 0) {
    return player.slideDir;
  }

  if (input.targetX !== null) {
    const clampedTarget = clamp(input.targetX, minX, maxX);
    const dx = clampedTarget - player.x;
    if (Math.abs(dx) <= TARGET_DEADZONE_PX) {
      return 0;
    }
    const maxStep = WORLD.PLAYER_MOVE_SPEED * dt;
    const dampWindow = Math.max(TARGET_DAMP_DISTANCE_PX, maxStep);
    return clamp(dx / dampWindow, -1, 1);
  }

  return clamp(input.moveX, -1, 1);
}

function tryTriggerAutoSlide(
  player: PlayerState,
  ball: BallState,
  moveRatio: number,
  events: PhysicsEvents,
): void {
  if (!player.isGrounded || player.slideTimer > 0 || player.slideCooldown > 0) {
    return;
  }

  if (Math.abs(moveRatio) < WORLD.AUTO_SLIDE_MIN_MOVE) {
    return;
  }

  const dir: 1 | -1 = moveRatio > 0 ? 1 : -1;
  const ballOnPlayerSide =
    player.id === 'p1' ? ball.x < WORLD.NET_X : ball.x > WORLD.NET_X;
  const ballFallingLow =
    ball.vy > 0 && ball.y >= WORLD.FLOOR_Y - WORLD.AUTO_SLIDE_BALL_HEIGHT;
  const dxAhead = (ball.x - player.x) * dir;

  if (
    ballOnPlayerSide &&
    ballFallingLow &&
    dxAhead >= WORLD.AUTO_SLIDE_MIN_DX &&
    dxAhead <= WORLD.AUTO_SLIDE_MAX_DX
  ) {
    player.slideTimer = WORLD.SLIDE_DURATION;
    player.slideCooldown = WORLD.SLIDE_COOLDOWN;
    player.slideDir = dir;
    player.vx = dir * WORLD.SLIDE_SPEED;
    player.animLock = 'slide';
    player.animLockTimer = WORLD.SLIDE_DURATION;
    player.animTime = 0;
    events.slidBy = player.id;
  }
}

function computeAnimState(player: PlayerState): CharacterAnimState {
  if (player.animLock !== null) {
    return player.animLock;
  }
  if (!player.isGrounded) {
    return player.vy < -120 ? 'jump_launch' : 'air_float';
  }
  const speed = Math.abs(player.vx);
  if (speed >= WORLD.PLAYER_MOVE_SPEED * 0.7) {
    return 'run';
  }
  if (speed > 20) {
    return 'walk';
  }
  return 'idle';
}

function stepPlayer(
  player: PlayerState,
  input: PlayerInput,
  ball: BallState,
  dt: number,
  events: PhysicsEvents,
): void {
  const prevAnimState = player.animState;
  updatePlayerTimers(player, dt);

  if (input.hands !== undefined) {
    player.vx = 0;
    player.vy = 0;
    player.isGrounded = true;
    player.facing = player.id === 'p1' ? 1 : -1;
    player.animState = 'idle';
    player.animTime += dt;
    return;
  }

  const { minX, maxX } = getCourtBounds(player.id);
  const moveRatio = resolveMoveRatio(player, input, minX, maxX, dt);

  const desiredVx =
    player.slideTimer > 0
      ? player.slideDir * WORLD.SLIDE_SPEED
      : moveRatio * WORLD.PLAYER_MOVE_SPEED;

  if (player.slideTimer <= 0 && input.targetX !== null) {
    const blend = Math.min(1, TARGET_VX_SLEW_RATE * dt);
    player.vx = player.vx + (desiredVx - player.vx) * blend;
  } else {
    player.vx = desiredVx;
  }

  player.facing = player.id === 'p1' ? 1 : -1;

  tryTriggerAutoSlide(player, ball, moveRatio, events);

  if (player.isGrounded && input.jump && player.slideTimer <= 0) {
    player.vy = WORLD.PLAYER_JUMP_VY;
    player.isGrounded = false;
  }

  player.vy += WORLD.GRAVITY * dt;
  player.x = clamp(player.x + player.vx * dt, minX, maxX);
  player.y += player.vy * dt;

  const floorCenterY = WORLD.FLOOR_Y - player.radius;
  if (player.y >= floorCenterY) {
    player.y = floorCenterY;
    player.vy = 0;
    player.isGrounded = true;
    if (player.animLock === 'spike') {
      player.animLock = null;
      player.animLockTimer = 0;
    }
  } else {
    player.isGrounded = false;
  }

  const nextAnimState = computeAnimState(player);
  if (nextAnimState !== prevAnimState) {
    player.animTime = 0;
  }
  player.animState = nextAnimState;
}

function stepBall(
  ball: BallState,
  dt: number,
  gravity: number = WORLD.BALL_GRAVITY,
): void {
  ball.vy += gravity * dt;

  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > WORLD.BALL_MAX_SPEED) {
    const scale = WORLD.BALL_MAX_SPEED / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const spinRate = ball.spin !== 0 ? ball.spin : ball.vx * 0.01;
  ball.rotation += spinRate * dt;
}

function recordBallTrail(ball: BallState): void {
  ball.trail.push({ x: ball.x, y: ball.y, isSpiked: ball.isSpiked });
  if (ball.trail.length > 10) {
    ball.trail.shift();
  }
}

function collideBallWalls(ball: BallState, events: PhysicsEvents): void {
  if (ball.y - ball.radius < 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy) * WORLD.BALL_WALL_RESTITUTION;
    events.wallHit = true;
  }

  if (ball.x - ball.radius < 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx) * WORLD.BALL_WALL_RESTITUTION;
    events.wallHit = true;
  } else if (ball.x + ball.radius > WORLD.WIDTH) {
    ball.x = WORLD.WIDTH - ball.radius;
    ball.vx = -Math.abs(ball.vx) * WORLD.BALL_WALL_RESTITUTION;
    events.wallHit = true;
  }
}

function collideBallNet(ball: BallState, events: PhysicsEvents): void {
  if (ball.y <= WORLD.NET_TOP_Y) {
    // 1. Rounded top cap circle (upper hemisphere only)
    const capDx = ball.x - WORLD.NET_X;
    const capDy = ball.y - WORLD.NET_TOP_Y;
    const capDist = Math.hypot(capDx, capDy);
    const capMinDist = ball.radius + WORLD.NET_CAP_RADIUS;

    if (capDist < capMinDist) {
      const nx = capDist > 0.0001 ? capDx / capDist : 0;
      const ny = capDist > 0.0001 ? capDy / capDist : -1;
      ball.x = WORLD.NET_X + nx * capMinDist;
      ball.y = WORLD.NET_TOP_Y + ny * capMinDist;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        const restitution = 0.85;
        ball.vx -= (1 + restitution) * vn * nx;
        ball.vy -= (1 + restitution) * vn * ny;
      }

      ball.isSpiked = false;
      events.netHit = true;
    }
    return;
  }

  // 2. Rectangular net post below NET_TOP_Y
  const closestX = clamp(ball.x, WORLD.NET_LEFT, WORLD.NET_RIGHT);
  const closestY = clamp(ball.y, WORLD.NET_TOP_Y, WORLD.FLOOR_Y);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  const distSq = dx * dx + dy * dy;

  if (distSq < ball.radius * ball.radius) {
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      ball.x = closestX + nx * ball.radius;
      ball.y = closestY + ny * ball.radius;

      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        const restitution = 0.8;
        ball.vx -= (1 + restitution) * vn * nx;
        ball.vy -= (1 + restitution) * vn * ny;
      }
    } else {
      const side = ball.x < WORLD.NET_X ? -1 : 1;
      ball.x =
        side < 0 ? WORLD.NET_LEFT - ball.radius : WORLD.NET_RIGHT + ball.radius;
      ball.vx = side * Math.max(Math.abs(ball.vx) * 0.8, 120);
    }

    ball.isSpiked = false;
    events.netHit = true;
  }
}

function collideBallHands(
  ball: BallState,
  player: PlayerState,
  hands: HandHitTarget[],
  events: PhysicsEvents,
): void {
  if (player.hitCooldown > 0 || hands.length === 0) {
    return;
  }

  const minDist = HAND_HIT_RADIUS + ball.radius;
  const dir = player.id === 'p1' ? 1 : -1;

  for (const hand of hands) {
    if (!hand.canHit) {
      continue;
    }

    const dx = ball.x - hand.x;
    const dy = ball.y - hand.y;
    const dist = Math.hypot(dx, dy);

    if (dist >= minDist) {
      continue;
    }

    const nx = dist > 0.0001 ? dx / dist : 0;
    const ny = dist > 0.0001 ? dy / dist : -1;

    ball.x = clamp(hand.x + nx * minDist, ball.radius, WORLD.WIDTH - ball.radius);
    ball.y = Math.min(WORLD.FLOOR_Y - ball.radius, hand.y + ny * minDist);

    const handSpeed = Math.hypot(hand.vx, hand.vy);
    const isStrikeTiming =
      hand.y <= WORLD.NET_TOP_Y + 60 && handSpeed >= 180 && ball.vy <= 420;
    const isUpperContact = ny <= 0.1;
    const isMovingTowardNet = hand.vx * dir >= 140;

    if (isStrikeTiming && isUpperContact && isMovingTowardNet) {
      const angleRad = ball.y <= WORLD.NET_TOP_Y - 20 ? -0.18 : -0.36;
      ball.vx = dir * Math.cos(angleRad) * WORLD.SPIKE_SPEED;
      ball.vy = Math.sin(angleRad) * WORLD.SPIKE_SPEED;
      ball.isSpiked = true;
      ball.spin = dir * 18;
      player.hitCooldown = WORLD.HIT_COOLDOWN_SPIKE;
      events.spikedBy = player.id;
      return;
    }

    ball.vx = clamp(nx * 290 + hand.vx * 0.45 + dir * 40, -520, 520);
    ball.vy = clamp(ny * 520 + hand.vy * 0.32 - 220, -760, -520);
    ball.isSpiked = false;
    ball.spin = ball.vx * 0.015;
    player.hitCooldown = WORLD.HIT_COOLDOWN_VOLLEY;
    events.volleyBy = player.id;
    return;
  }
}

function collideBallPlayer(
  ball: BallState,
  player: PlayerState,
  input: PlayerInput,
  events: PhysicsEvents,
): void {
  if (input.hands !== undefined) {
    collideBallHands(ball, player, input.hands, events);
    return;
  }

  if (player.hitCooldown > 0) {
    return;
  }

  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy);
  const minDist = player.radius + ball.radius;

  if (dist >= minDist) {
    return;
  }

  const nx = dist > 0.0001 ? dx / dist : 0;
  const ny = dist > 0.0001 ? dy / dist : -1;

  ball.x = player.x + nx * minDist;
  ball.y = player.y + ny * minDist;

  if (!player.isGrounded) {
    const dir = player.id === 'p1' ? 1 : -1;
    const steer =
      Math.abs(input.moveX) > 0.05
        ? clamp(input.moveX, -1, 1)
        : clamp(player.vx / WORLD.PLAYER_MOVE_SPEED, -1, 1);

    // Require genuine jump height, active swing (not late floor-fall), upper contact, and directional steer
    const minSpikeCenterY = WORLD.FLOOR_Y - player.radius - 48;
    const isHighEnough = player.y <= minSpikeCenterY;
    const isStrikeTiming = player.vy <= 260;
    const isUpperContact = ny <= 0.1;
    const hasDirectionalSteer = Math.abs(steer) >= 0.35;

    if (isHighEnough && isStrikeTiming && isUpperContact && hasDirectionalSteer) {
      const towardOpponent = steer * dir;

      let angleRad: number;
      if (towardOpponent > 0.35) {
        angleRad = -0.16; // fast low-arc drive that clears the net cleanly
      } else if (towardOpponent < -0.35) {
        angleRad = -0.4; // high backcourt corner spike
      } else {
        angleRad = -0.26; // balanced upward spike
      }

      ball.vx = dir * Math.cos(angleRad) * WORLD.SPIKE_SPEED;
      ball.vy = Math.sin(angleRad) * WORLD.SPIKE_SPEED;
      ball.isSpiked = true;
      ball.spin = dir * 18;

      player.animLock = 'spike';
      player.animLockTimer = 0.32;
      player.animState = 'spike';
      player.animTime = 0;
      player.hitCooldown = WORLD.HIT_COOLDOWN_SPIKE;
      events.spikedBy = player.id;
      return;
    }

    // Airborne non-spike contact: controlled upward volley
    ball.vx = clamp(nx * 300 + player.vx * 0.45, -420, 420);
    ball.vy = clamp(ny * 560 - 150, -720, -500);
    ball.isSpiked = false;
    ball.spin = ball.vx * 0.015;
    player.animLock = 'attack';
    player.animLockTimer = 0.22;
    player.animState = 'attack';
    player.animTime = 0;
    player.hitCooldown = WORLD.HIT_COOLDOWN_VOLLEY;
    events.volleyBy = player.id;
    return;
  }

  // Grounded volley (including diving slide rescue)
  if (player.slideTimer > 0) {
    ball.vx = clamp(nx * 240 + player.vx * 0.35, -360, 360);
    ball.vy = -620;
  } else {
    ball.vx = clamp(nx * 320 + player.vx * 0.45, -460, 460);
    ball.vy = clamp(ny * 600 - 120, -740, -520);
    player.animLock = 'attack';
    player.animLockTimer = 0.22;
    player.animState = 'attack';
    player.animTime = 0;
  }

  ball.isSpiked = false;
  ball.spin = ball.vx * 0.015;
  player.hitCooldown = WORLD.HIT_COOLDOWN_VOLLEY;
  events.volleyBy = player.id;
}

function collideBallFloor(ball: BallState, events: PhysicsEvents): void {
  if (ball.y + ball.radius >= WORLD.FLOOR_Y) {
    ball.y = WORLD.FLOOR_Y - ball.radius;
    ball.vy = -Math.abs(ball.vy) * 0.45;
    ball.isSpiked = false;
    events.ballHitFloorSide = ball.x < WORLD.NET_X ? 'left' : 'right';
  }
}

/** Advances players and ball physics by dt seconds and returns frame collision events. */
export function stepPhysics(
  players: [PlayerState, PlayerState],
  ball: BallState,
  inputs: [PlayerInput, PlayerInput],
  dt: number,
  ballTimeScale = 1,
): PhysicsEvents {
  const events: PhysicsEvents = {
    spikedBy: null,
    slidBy: null,
    volleyBy: null,
    netHit: false,
    wallHit: false,
    ballHitFloorSide: null,
  };

  if (dt <= 0) {
    return events;
  }

  stepPlayer(players[0], inputs[0], ball, dt, events);
  stepPlayer(players[1], inputs[1], ball, dt, events);

  const isHumanArMode =
    inputs[0].hands !== undefined || inputs[1].hands !== undefined;
  const ballGravity = isHumanArMode
    ? WORLD.HUMAN_BALL_GRAVITY
    : WORLD.BALL_GRAVITY;
  const safeBallScale =
    Number.isFinite(ballTimeScale) && ballTimeScale > 0 ? ballTimeScale : 1;

  stepBall(ball, dt * safeBallScale, ballGravity);
  collideBallWalls(ball, events);
  collideBallNet(ball, events);
  collideBallPlayer(ball, players[0], inputs[0], events);
  collideBallPlayer(ball, players[1], inputs[1], events);
  collideBallFloor(ball, events);
  recordBallTrail(ball);

  return events;
}
