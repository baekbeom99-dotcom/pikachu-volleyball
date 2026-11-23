import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { createInitialBall, createInitialPlayer, stepPhysics } from '../src/core/physics';

describe('stepPhysics', () => {
  it('keeps P1 inside left court and P2 inside right court', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = WORLD.NET_LEFT - WORLD.PLAYER_RADIUS - 1;
    p2.x = WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS + 1;
    const ball = createInitialBall('p1');

    for (let i = 0; i < 20; i++) {
      stepPhysics(
        [p1, p2],
        ball,
        [
          { moveX: 1, targetX: null, jump: false },
          { moveX: -1, targetX: null, jump: false },
        ],
        WORLD.FIXED_DT,
      );
    }

    expect(p1.x).toBeLessThanOrEqual(WORLD.NET_LEFT - WORLD.PLAYER_RADIUS);
    expect(p2.x).toBeGreaterThanOrEqual(WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS);

    p1.x = WORLD.PLAYER_RADIUS + 2;
    p2.x = WORLD.WIDTH - WORLD.PLAYER_RADIUS - 2;
    for (let i = 0; i < 20; i++) {
      stepPhysics(
        [p1, p2],
        ball,
        [
          { moveX: -1, targetX: null, jump: false },
          { moveX: 1, targetX: null, jump: false },
        ],
        WORLD.FIXED_DT,
      );
    }

    expect(p1.x).toBeGreaterThanOrEqual(WORLD.PLAYER_RADIUS);
    expect(p2.x).toBeLessThanOrEqual(WORLD.WIDTH - WORLD.PLAYER_RADIUS);
  });

  it('tracks targetX clamped inside the player court', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');

    for (let i = 0; i < 60; i++) {
      stepPhysics(
        [p1, p2],
        ball,
        [
          { moveX: 0, targetX: 700, jump: false },
          { moveX: 0, targetX: 100, jump: false },
        ],
        WORLD.FIXED_DT,
      );
    }

    expect(p1.x).toBe(WORLD.NET_LEFT - WORLD.PLAYER_RADIUS);
    expect(p2.x).toBe(WORLD.NET_RIGHT + WORLD.PLAYER_RADIUS);
  });

  it('triggers jump when grounded and jump=true', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: true },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );
    expect(p1.isGrounded).toBe(false);
    expect(p1.vy).toBeLessThan(0);
  });

  it('automatically triggers spike when airborne player hits the ball', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = 220;
    p1.y = 320;
    p1.isGrounded = false;
    const ball = createInitialBall('p1');
    ball.x = 250;
    ball.y = 290;
    ball.vx = 0;
    ball.vy = 100;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.spikedBy).toBe('p1');
    expect(ball.isSpiked).toBe(true);
    expect(ball.vx).toBeGreaterThan(500);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(WORLD.SPIKE_SPEED, 1);
    expect(p1.animLock).toBe('spike');
  });

  it('automatically triggers diving slide when sprinting toward low falling ball', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = 120;
    const ball = createInitialBall('p1');
    ball.x = 220;
    ball.y = WORLD.FLOOR_Y - 110;
    ball.vy = 260;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.slidBy).toBe('p1');
    expect(p1.slideTimer).toBeGreaterThan(0);
    expect(p1.animLock).toBe('slide');
  });

  it('bounces ball upward with attack animLock on grounded volley', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    ball.x = p1.x + 10;
    ball.y = p1.y - WORLD.PLAYER_RADIUS - WORLD.BALL_RADIUS + 8;
    ball.vx = 40;
    ball.vy = 220;
    ball.isSpiked = true;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.volleyBy).toBe('p1');
    expect(ball.isSpiked).toBe(false);
    expect(ball.vy).toBeLessThan(-400);
    expect(p1.animLock).toBe('attack');
  });

  it('bounces ball off net top cap and rectangular net post', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');

    // Net top cap hit from above-left
    const topBall = createInitialBall('p1');
    topBall.x = WORLD.NET_X - 6;
    topBall.y = WORLD.NET_TOP_Y - WORLD.NET_CAP_RADIUS - WORLD.BALL_RADIUS + 4;
    topBall.vx = 100;
    topBall.vy = 200;

    const topEvents = stepPhysics(
      [p1, p2],
      topBall,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(topEvents.netHit).toBe(true);
    expect(topBall.vy).toBeLessThan(0);

    // Net post hit from left side
    const postBall = createInitialBall('p1');
    postBall.x = WORLD.NET_LEFT - WORLD.BALL_RADIUS + 4;
    postBall.y = WORLD.NET_TOP_Y + 80;
    postBall.vx = 300;
    postBall.vy = 0;

    const postEvents = stepPhysics(
      [p1, p2],
      postBall,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(postEvents.netHit).toBe(true);
    expect(postBall.vx).toBeLessThan(0);
    expect(postBall.x).toBeLessThanOrEqual(WORLD.NET_LEFT - WORLD.BALL_RADIUS);
  });

  it('reports ground contact side for scoring', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p2');
    ball.x = WORLD.NET_X + 180;
    ball.y = WORLD.FLOOR_Y - WORLD.BALL_RADIUS + 4;
    ball.vy = 200;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.ballHitFloorSide).toBe('right');
  });

  it('bounces ball off ceiling and side walls and caps trail at 10 points', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    ball.x = WORLD.BALL_RADIUS - 4;
    ball.y = WORLD.BALL_RADIUS - 4;
    ball.vx = -200;
    ball.vy = -300;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.wallHit).toBe(true);
    expect(ball.x).toBeGreaterThanOrEqual(WORLD.BALL_RADIUS);
    expect(ball.y).toBeGreaterThanOrEqual(WORLD.BALL_RADIUS);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.vy).toBeGreaterThan(0);

    for (let i = 0; i < 15; i++) {
      stepPhysics(
        [p1, p2],
        ball,
        [
          { moveX: 0, targetX: null, jump: false },
          { moveX: 0, targetX: null, jump: false },
        ],
        WORLD.FIXED_DT,
      );
    }
    expect(ball.trail.length).toBe(10);
  });

  it('rescues ball upward while preserving slide animLock during diving slide', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.slideTimer = 0.2;
    p1.slideCooldown = 0.3;
    p1.slideDir = 1;
    p1.animLock = 'slide';
    p1.animLockTimer = 0.2;

    const ball = createInitialBall('p1');
    ball.x = p1.x + 20;
    ball.y = p1.y - 20;
    ball.vx = -50;
    ball.vy = 200;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.volleyBy).toBe('p1');
    expect(ball.vy).toBeLessThan(-500);
    expect(p1.animLock).toBe('slide');
  });

  it('angles P2 airborne spike toward left court based on moveX', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p2.x = 640;
    p2.y = 300;
    p2.isGrounded = false;

    const deepBall = createInitialBall('p2');
    deepBall.x = 610;
    deepBall.y = 280;
    deepBall.vy = 50;

    const deepEvents = stepPhysics(
      [p1, p2],
      deepBall,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 1, targetX: null, jump: false }, // away from net -> deep drive
      ],
      WORLD.FIXED_DT,
    );

    expect(deepEvents.spikedBy).toBe('p2');
    expect(deepBall.vx).toBeLessThan(-500);
    expect(deepBall.vy).toBeLessThan(0);

    const steepBall = createInitialBall('p2');
    steepBall.x = 610;
    steepBall.y = p2.y - 20;
    steepBall.vy = 50;

    const steepEvents = stepPhysics(
      [p1, p2],
      steepBall,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: -1, targetX: null, jump: false }, // toward net -> steep downward smash
      ],
      WORLD.FIXED_DT,
    );

    expect(steepEvents.spikedBy).toBe('p2');
    expect(steepBall.vx).toBeLessThan(-500);
    expect(steepBall.vy).toBeGreaterThan(200);
  });
});
