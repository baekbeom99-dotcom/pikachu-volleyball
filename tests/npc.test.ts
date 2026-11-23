import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { createInitialBall, createInitialPlayer } from '../src/core/physics';
import { computeNpcInput, predictBallLandingX } from '../src/core/npc';
import { createGameState, resetRound, stepGame } from '../src/core/rules';
import type { PlayerInput } from '../src/core/types';

const IDLE_INPUT: PlayerInput = { moveX: 0, targetX: null, jump: false };

describe('npc AI and ball prediction', () => {
  it('predictBallLandingX predicts direct and wall-bounced landing positions accurately', () => {
    const directBall = createInitialBall('p2');
    directBall.x = 600;
    directBall.y = 200;
    directBall.vx = 120;
    directBall.vy = 0;

    // t = sqrt(2 * (536 - 32 - 200) / 1080) = sqrt(608 / 1080) ~= 0.7503s (~45 steps)
    const directX = predictBallLandingX(directBall);
    expect(directX).toBeGreaterThan(680);
    expect(directX).toBeLessThan(705);

    // Ball heading fast toward right wall should bounce inward
    const bounceBall = createInitialBall('p2');
    bounceBall.x = WORLD.WIDTH - WORLD.BALL_RADIUS - 30;
    bounceBall.y = 180;
    bounceBall.vx = 500;
    bounceBall.vy = -100;

    const bouncedX = predictBallLandingX(bounceBall);
    expect(bouncedX).toBeLessThan(WORLD.WIDTH - WORLD.BALL_RADIUS);
    expect(bouncedX).toBeGreaterThan(WORLD.NET_RIGHT);
  });

  it('tracks predicted landing X when ball enters right court', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });
    state.phase = 'PLAYING';
    state.players[1] = createInitialPlayer('p2');
    state.players[1].x = 520;
    state.ball.x = 680;
    state.ball.y = 220;
    state.ball.vx = 90;
    state.ball.vy = 60;

    const input = computeNpcInput(state, 'p2');
    expect(input.moveX).toBeGreaterThan(0.5);
    expect(input.targetX).toBeNull();
    expect(input.jump).toBe(false);
  });

  it('returns toward defense center when ball is far on P1 side', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });
    state.phase = 'PLAYING';
    const defenseHome = (WORLD.NET_RIGHT + WORLD.WIDTH) / 2;

    state.players[1].x = 500;
    state.ball.x = 140;
    state.ball.y = 240;
    state.ball.vx = -80;
    state.ball.vy = 50;

    const moveRightInput = computeNpcInput(state, 'p2');
    expect(moveRightInput.moveX).toBeGreaterThan(0.5);

    state.players[1].x = 790;
    const moveLeftInput = computeNpcInput(state, 'p2');
    expect(moveLeftInput.moveX).toBeLessThan(-0.5);

    state.players[1].x = defenseHome;
    const settledInput = computeNpcInput(state, 'p2');
    expect(settledInput.moveX).toBe(0);
  });

  it('triggers jump and aims toward opponent when ball is in high near-net strike window', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });
    state.phase = 'PLAYING';
    state.players[1].x = 515;
    state.ball.x = 500;
    state.ball.y = WORLD.FLOOR_Y - 258; // high near net -> steep smash clears net
    state.ball.vx = -40;
    state.ball.vy = 80;

    const input = computeNpcInput(state, 'p2');
    expect(input.jump).toBe(true);
    expect(input.moveX).toBe(-1);
    expect(input.targetX).toBeNull();

    // Also verifies p1 symmetry when computeNpcInput is called with npcId='p1'
    state.players[0].x = 349;
    state.ball.x = 364;
    const p1Input = computeNpcInput(state, 'p1');
    expect(p1Input.jump).toBe(true);
    expect(p1Input.moveX).toBe(1);
  });

  it('returns idle input outside PLAYING and READY_SERVE phases', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });
    state.phase = 'POINT_SCORED';
    state.players[1].x = 500;
    state.ball.x = 750;
    state.ball.y = WORLD.FLOOR_Y - 180;

    const input = computeNpcInput(state, 'p2');
    expect(input).toEqual({ moveX: 0, targetX: null, jump: false });
  });

  it('hits and returns its own serve over the net in multi-frame simulation', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });
    resetRound(state, 'p2');

    let p2HitBall = false;
    let crossedNetToLeft = false;

    for (let i = 0; i < 180; i++) {
      const p2Input = computeNpcInput(state, 'p2');
      const events = stepGame(state, [IDLE_INPUT, p2Input], WORLD.FIXED_DT);
      if (events.spikedBy === 'p2' || events.volleyBy === 'p2') {
        p2HitBall = true;
      }
      if (p2HitBall && state.ball.x < WORLD.NET_X) {
        crossedNetToLeft = true;
        break;
      }
      expect(state.scores.p1).toBe(0);
    }

    expect(p2HitBall).toBe(true);
    expect(crossedNetToLeft).toBe(true);
  });

  it('returns incoming mid-court and fast rightward shots without gifting a floor point', () => {
    const scenarios = [
      {
        name: 'mid-court arc',
        x: WORLD.NET_X + 20,
        y: 220,
        vx: 160,
        vy: -240,
      },
      {
        name: 'fast rightward shot',
        x: WORLD.NET_X + 10,
        y: 250,
        vx: 360,
        vy: -180,
      },
    ];

    for (const shot of scenarios) {
      const state = createGameState({
        controlMode: 'touch',
        opponentMode: 'npc',
      });
      state.phase = 'PLAYING';
      state.phaseTimer = 0;
      state.ball.x = shot.x;
      state.ball.y = shot.y;
      state.ball.vx = shot.vx;
      state.ball.vy = shot.vy;

      let p2Returned = false;
      for (let i = 0; i < 180; i++) {
        const p2Input = computeNpcInput(state, 'p2');
        const events = stepGame(state, [IDLE_INPUT, p2Input], WORLD.FIXED_DT);
        if (events.spikedBy === 'p2' || events.volleyBy === 'p2') {
          p2Returned = true;
          break;
        }
        expect(state.scores.p1).toBe(0);
      }

      expect(p2Returned, shot.name).toBe(true);
    }
  });
});
