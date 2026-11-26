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

    p2.hitCooldown = 0;
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
    // Upward spike angle clears the net instead of slamming downward into it
    expect(steepBall.vy).toBeLessThan(0);
    expect(steepBall.vy).toBeGreaterThan(deepBall.vy);
  });

  it('requires sufficient jump height, timing, and steer for spike, and clears the net', () => {
    const idle = { moveX: 0, targetX: null, jump: false };

    // 1. Low jump without enough height becomes a normal airborne volley, not a spike
    const lowP1 = createInitialPlayer('p1');
    const lowP2 = createInitialPlayer('p2');
    lowP1.x = 220;
    lowP1.y = WORLD.FLOOR_Y - WORLD.PLAYER_RADIUS - 18;
    lowP1.isGrounded = false;
    const lowBall = createInitialBall('p1');
    lowBall.x = 240;
    lowBall.y = lowP1.y - 36;
    lowBall.vy = 100;

    const lowEvents = stepPhysics(
      [lowP1, lowP2],
      lowBall,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(lowEvents.spikedBy).toBeNull();
    expect(lowEvents.volleyBy).toBe('p1');
    expect(lowBall.isSpiked).toBe(false);

    // 2. High jump without active directional steer also avoids accidental spike
    const neutralP1 = createInitialPlayer('p1');
    const neutralP2 = createInitialPlayer('p2');
    neutralP1.x = 220;
    neutralP1.y = 320;
    neutralP1.isGrounded = false;
    const neutralBall = createInitialBall('p1');
    neutralBall.x = 240;
    neutralBall.y = 290;
    neutralBall.vy = 100;

    const neutralEvents = stepPhysics(
      [neutralP1, neutralP2],
      neutralBall,
      [idle, idle],
      WORLD.FIXED_DT,
    );
    expect(neutralEvents.spikedBy).toBeNull();
    expect(neutralEvents.volleyBy).toBe('p1');

    // 3. Valid mid-court spike clears the net cleanly without hitting the net post
    const spikeP1 = createInitialPlayer('p1');
    const spikeP2 = createInitialPlayer('p2');
    spikeP1.x = 260;
    spikeP1.y = 350;
    spikeP1.isGrounded = false;
    const spikeBall = createInitialBall('p1');
    spikeBall.x = 290;
    spikeBall.y = 320;
    spikeBall.vy = 80;

    const hitEv = stepPhysics(
      [spikeP1, spikeP2],
      spikeBall,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(hitEv.spikedBy).toBe('p1');

    let clearedNet = false;
    for (let i = 0; i < 40; i++) {
      const stepEv = stepPhysics([spikeP1, spikeP2], spikeBall, [idle, idle], WORLD.FIXED_DT);
      expect(stepEv.netHit).toBe(false);
      if (spikeBall.x > WORLD.NET_RIGHT) {
        clearedNet = true;
        break;
      }
    }
    expect(clearedNet).toBe(true);
  });

  it('reflects horizontally on net post just below NET_TOP_Y without downward cap deflection', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    ball.x = 400;
    ball.y = 375;
    ball.vx = 400;
    ball.vy = 0;

    const events = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(events.netHit).toBe(true);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.vy).toBeGreaterThanOrEqual(0);
    expect(ball.vy).toBeLessThan(30);
  });

  it('handles animLockTimer expiry, slideCooldown re-slide guard, jump suppression during slide, and spike lock clear on landing', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = 120;
    const ball = createInitialBall('p1');
    ball.x = 220;
    ball.y = WORLD.FLOOR_Y - 110;
    ball.vy = 260;

    // Trigger slide
    const slideEvents = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: true },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(slideEvents.slidBy).toBe('p1');
    expect(p1.isGrounded).toBe(true); // jump suppressed while sliding
    expect(p1.vy).toBe(0);

    // Step past SLIDE_DURATION while still within SLIDE_COOLDOWN
    const stepsForSlideEnd = Math.ceil(WORLD.SLIDE_DURATION / WORLD.FIXED_DT) + 1;
    for (let i = 0; i < stepsForSlideEnd; i++) {
      ball.x = p1.x + 80;
      ball.y = WORLD.FLOOR_Y - 110;
      ball.vy = 260;
      const ev = stepPhysics(
        [p1, p2],
        ball,
        [
          { moveX: 1, targetX: null, jump: false },
          { moveX: 0, targetX: null, jump: false },
        ],
        WORLD.FIXED_DT,
      );
      expect(ev.slidBy).toBeNull(); // slideCooldown prevents immediate re-slide
    }

    expect(p1.animLock).toBeNull();
    expect(p1.animState).toBe('run');

    // Clear spike animLock on landing
    p1.y = WORLD.FLOOR_Y - WORLD.PLAYER_RADIUS - 1;
    p1.vy = 100;
    p1.isGrounded = false;
    p1.animLock = 'spike';
    p1.animLockTimer = 0.25;

    stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(p1.isGrounded).toBe(true);
    expect(p1.animLock).toBeNull();
    expect(p1.animLockTimer).toBe(0);
    expect(p1.animState).toBe('idle');
  });

  it('treats dt <= 0 as a safe no-op and records post-collision trail state', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    const startX = ball.x;
    const startY = ball.y;

    const noopEvents = stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: true },
        { moveX: -1, targetX: null, jump: false },
      ],
      0,
    );

    expect(noopEvents).toEqual({
      spikedBy: null,
      slidBy: null,
      volleyBy: null,
      netHit: false,
      wallHit: false,
      ballHitFloorSide: null,
    });
    expect(ball.x).toBe(startX);
    expect(ball.y).toBe(startY);
    expect(ball.trail).toHaveLength(0);

    // Post-collision trail check: airborne spike sets isSpiked=true and pushes post-separation pos
    p1.x = 220;
    p1.y = 320;
    p1.isGrounded = false;
    ball.x = 250;
    ball.y = 290;
    ball.vy = 100;
    ball.isSpiked = false;

    stepPhysics(
      [p1, p2],
      ball,
      [
        { moveX: 1, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );

    expect(ball.trail).toHaveLength(1);
    expect(ball.trail[0]).toEqual({ x: ball.x, y: ball.y, isSpiked: true });
  });

  it('resets animTime to 0 on jump_launch, slide, spike, and attack transitions after > 1.0s', () => {
    const idle = { moveX: 0, targetX: null, jump: false };

    // 1. jump_launch transition resets animTime even after > 1.0s idle
    const jumpP1 = createInitialPlayer('p1');
    const jumpP2 = createInitialPlayer('p2');
    const jumpBall = createInitialBall('p1');
    jumpBall.y = 50;
    jumpP1.animTime = 1.4;
    stepPhysics(
      [jumpP1, jumpP2],
      jumpBall,
      [{ moveX: 0, targetX: null, jump: true }, idle],
      WORLD.FIXED_DT,
    );
    expect(jumpP1.animState).toBe('jump_launch');
    expect(jumpP1.animTime).toBe(0);

    // Subsequent frame in jump_launch advances animTime smoothly
    stepPhysics([jumpP1, jumpP2], jumpBall, [idle, idle], WORLD.FIXED_DT);
    expect(jumpP1.animState).toBe('jump_launch');
    expect(jumpP1.animTime).toBeCloseTo(WORLD.FIXED_DT, 6);

    // 2. slide transition resets animTime even after > 1.0s
    const slideP1 = createInitialPlayer('p1');
    const slideP2 = createInitialPlayer('p2');
    slideP1.x = 120;
    slideP1.animTime = 1.8;
    const slideBall = createInitialBall('p1');
    slideBall.x = 220;
    slideBall.y = WORLD.FLOOR_Y - 110;
    slideBall.vy = 260;
    const slideEvents = stepPhysics(
      [slideP1, slideP2],
      slideBall,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(slideEvents.slidBy).toBe('p1');
    expect(slideP1.animState).toBe('slide');
    expect(slideP1.animTime).toBe(0);

    // 3. spike transition (and repeated spike) resets animTime to 0
    const spikeP1 = createInitialPlayer('p1');
    const spikeP2 = createInitialPlayer('p2');
    spikeP1.x = 220;
    spikeP1.y = 320;
    spikeP1.isGrounded = false;
    spikeP1.animState = 'air_float';
    spikeP1.animTime = 1.6;
    const spikeBall = createInitialBall('p1');
    spikeBall.x = 250;
    spikeBall.y = 290;
    spikeBall.vy = 100;
    const spikeEv1 = stepPhysics(
      [spikeP1, spikeP2],
      spikeBall,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(spikeEv1.spikedBy).toBe('p1');
    expect(spikeP1.animState).toBe('spike');
    expect(spikeP1.animTime).toBe(0);

    // Repeated spike after hitCooldown expires while still in spike state restarts at animTime = 0
    spikeP1.animTime = 0.15;
    spikeP1.hitCooldown = 0;
    spikeBall.x = spikeP1.x + 25;
    spikeBall.y = spikeP1.y - 20;
    const spikeEv2 = stepPhysics(
      [spikeP1, spikeP2],
      spikeBall,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(spikeEv2.spikedBy).toBe('p1');
    expect(spikeP1.animState).toBe('spike');
    expect(spikeP1.animTime).toBe(0);

    // 4. attack transition (and repeated attack after cooldown) resets animTime to 0
    const atkP1 = createInitialPlayer('p1');
    const atkP2 = createInitialPlayer('p2');
    atkP1.animTime = 1.9;
    const atkBall = createInitialBall('p1');
    atkBall.x = atkP1.x + 10;
    atkBall.y = atkP1.y - WORLD.PLAYER_RADIUS - WORLD.BALL_RADIUS + 8;
    atkBall.vy = 220;
    const atkEv1 = stepPhysics([atkP1, atkP2], atkBall, [idle, idle], WORLD.FIXED_DT);
    expect(atkEv1.volleyBy).toBe('p1');
    expect(atkP1.animState).toBe('attack');
    expect(atkP1.animTime).toBe(0);

    atkP1.animTime = 0.12;
    atkP1.hitCooldown = 0;
    atkBall.x = atkP1.x + 10;
    atkBall.y = atkP1.y - WORLD.PLAYER_RADIUS - WORLD.BALL_RADIUS + 8;
    atkBall.vy = 220;
    const atkEv2 = stepPhysics([atkP1, atkP2], atkBall, [idle, idle], WORLD.FIXED_DT);
    expect(atkEv2.volleyBy).toBe('p1');
    expect(atkP1.animState).toBe('attack');
    expect(atkP1.animTime).toBe(0);
  });

  it('prevents consecutive multi-touch hits during spike hitCooldown', () => {
    const idle = { moveX: 0, targetX: null, jump: false };
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = 220;
    p1.y = 320;
    p1.isGrounded = false;
    const ball = createInitialBall('p1');
    ball.x = 250;
    ball.y = 290;
    ball.vy = 100;

    const firstEv = stepPhysics(
      [p1, p2],
      ball,
      [{ moveX: 1, targetX: null, jump: false }, idle],
      WORLD.FIXED_DT,
    );
    expect(firstEv.spikedBy).toBe('p1');
    expect(p1.hitCooldown).toBe(WORLD.HIT_COOLDOWN_SPIKE);

    // Even if the ball overlaps again immediately on the next few frames, no second hit triggers
    for (let i = 0; i < 10; i++) {
      ball.x = p1.x + 20;
      ball.y = p1.y - 20;
      const followEv = stepPhysics(
        [p1, p2],
        ball,
        [{ moveX: 1, targetX: null, jump: false }, idle],
        WORLD.FIXED_DT,
      );
      expect(followEv.spikedBy).toBeNull();
      expect(followEv.volleyBy).toBeNull();
    }
  });

  it('keeps p1 facing right (1) and p2 facing left (-1) toward the net even when retreating or sliding away', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    p1.x = 260;
    p2.x = 600;

    // Retreating away from the net
    const farBall = createInitialBall('p1');
    farBall.y = 120;
    stepPhysics(
      [p1, p2],
      farBall,
      [
        { moveX: -1, targetX: null, jump: false },
        { moveX: 1, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );
    expect(p1.facing).toBe(1);
    expect(p2.facing).toBe(-1);

    // Diving/sliding backward away from the net
    const lowBackBall = createInitialBall('p1');
    lowBackBall.x = 160;
    lowBackBall.y = WORLD.FLOOR_Y - 110;
    lowBackBall.vy = 260;
    const ev = stepPhysics(
      [p1, p2],
      lowBackBall,
      [
        { moveX: -1, targetX: null, jump: false },
        { moveX: 1, targetX: null, jump: false },
      ],
      WORLD.FIXED_DT,
    );
    expect(ev.slidBy).toBe('p1');
    expect(p1.slideDir).toBe(-1);
    expect(p1.facing).toBe(1);
    expect(p2.facing).toBe(-1);
  });

  it('hits ball only when fist canHit is true (ignores open/expired hands and has no hand-gesture spike)', () => {
    const p1 = createInitialPlayer('p1');
    const p2 = createInitialPlayer('p2');
    const ball = createInitialBall('p1');
    const idle = { moveX: 0, targetX: null, jump: false };

    // Open hand or >1s expired fist (`canHit: false`) must NOT hit the ball
    ball.x = 200;
    ball.y = 430;
    ball.vy = 150;
    const missEv = stepPhysics(
      [p1, p2],
      ball,
      [
        {
          ...idle,
          hands: [{ x: 190, y: 455, vx: 200, vy: -200, canHit: false }],
        },
        idle,
      ],
      WORLD.FIXED_DT,
    );
    expect(missEv.volleyBy).toBeNull();
    expect(missEv.spikedBy).toBeNull();
    expect(ball.vy).toBeGreaterThan(0);

    // Closed fist moving away from net triggers normal volley (no spike)
    ball.x = 290;
    ball.y = WORLD.NET_TOP_Y - 10;
    ball.vy = 60;
    const retreatVolleyEv = stepPhysics(
      [p1, p2],
      ball,
      [
        {
          ...idle,
          hands: [{ x: 265, y: WORLD.NET_TOP_Y + 5, vx: -250, vy: -80, canHit: true }],
        },
        idle,
      ],
      WORLD.FIXED_DT,
    );
    expect(retreatVolleyEv.volleyBy).toBe('p1');
    expect(retreatVolleyEv.spikedBy).toBeNull();
    expect(ball.isSpiked).toBe(false);
    expect(ball.vy).toBeLessThan(-500);

    // Closed fist meeting all 3 spike conditions: strike timing (high active swing), upper contact (ny <= 0.1), moving toward net (vx * dir >= 140)
    p1.hitCooldown = 0;
    ball.x = 290;
    ball.y = WORLD.NET_TOP_Y - 25;
    ball.vy = 60;
    const spikeEv = stepPhysics(
      [p1, p2],
      ball,
      [
        {
          ...idle,
          hands: [{ x: 260, y: WORLD.NET_TOP_Y + 5, vx: 320, vy: -40, canHit: true }],
        },
        idle,
      ],
      WORLD.FIXED_DT,
    );
    expect(spikeEv.spikedBy).toBe('p1');
    expect(spikeEv.volleyBy).toBeNull();
    expect(ball.isSpiked).toBe(true);
    expect(ball.vx).toBeGreaterThan(750);

    // Lower contact (`ny > 0.1`) even while moving toward net does NOT spike
    p1.hitCooldown = 0;
    ball.x = 290;
    ball.y = WORLD.NET_TOP_Y + 35;
    ball.vy = 60;
    const underHitEv = stepPhysics(
      [p1, p2],
      ball,
      [
        {
          ...idle,
          hands: [{ x: 260, y: WORLD.NET_TOP_Y + 5, vx: 320, vy: 0, canHit: true }],
        },
        idle,
      ],
      WORLD.FIXED_DT,
    );
    expect(underHitEv.volleyBy).toBe('p1');
    expect(underHitEv.spikedBy).toBeNull();
    expect(ball.isSpiked).toBe(false);

    // Lighter gravity in human mode lets ball stay higher compared to default mode
    const humanBall = createInitialBall('p1');
    humanBall.vy = -500;
    const normalBall = createInitialBall('p1');
    normalBall.vy = -500;
    stepPhysics([p1, p2], humanBall, [{ ...idle, hands: [] }, idle], WORLD.FIXED_DT);
    stepPhysics([p1, p2], normalBall, [idle, idle], WORLD.FIXED_DT);
    expect(humanBall.y).toBeLessThan(normalBall.y);
  });
});
