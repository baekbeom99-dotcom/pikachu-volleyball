import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/core/constants';
import { createGameState, resetRound, stepGame } from '../src/core/rules';
import type { PlayerInput } from '../src/core/types';

const IDLE_INPUT: PlayerInput = { moveX: 0, targetX: null, jump: false };

describe('rules state machine', () => {
  it('transitions from READY_SERVE to PLAYING after 0.7s while allowing player movement', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
    });

    expect(state.phase).toBe('READY_SERVE');
    expect(state.phaseTimer).toBeCloseTo(0.7, 5);
    const startBallY = state.ball.y;

    // Step 41 frames (~0.683s): still READY_SERVE, ball hovers, P1 can move
    for (let i = 0; i < 41; i++) {
      const readyEvents = stepGame(
        state,
        [{ moveX: 1, targetX: null, jump: false }, IDLE_INPUT],
        WORLD.FIXED_DT,
      );
      expect(readyEvents.wallHit).toBe(false);
    }

    expect(state.phase).toBe('READY_SERVE');
    expect(state.ball.y).toBe(startBallY);
    expect(state.ball.vy).toBe(0);
    expect(state.players[0].x).toBeGreaterThan(WORLD.NET_X / 2);

    // 42nd frame completes 0.7s -> PLAYING
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    expect(state.phase).toBe('PLAYING');
    expect(state.phaseTimer).toBe(0);

    // Next step advances ball physics
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    expect(state.ball.vy).toBeGreaterThan(0);
  });

  it('awards P1 a point on right floor hit, sets POINT_SCORED, and gives P1 next serve', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: '2p',
      initialPhase: 'READY_SERVE',
    });
    state.phase = 'PLAYING';
    state.phaseTimer = 0;
    state.serveSide = 'p2';
    state.ball.x = WORLD.NET_X + 180;
    state.ball.y = WORLD.FLOOR_Y - WORLD.BALL_RADIUS + 2;
    state.ball.vy = 200;
    state.players[0].y = WORLD.FLOOR_Y - WORLD.PLAYER_RADIUS - 80;
    state.players[0].vy = -50;
    state.players[0].isGrounded = false;

    const events = stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);

    expect(events.ballHitFloorSide).toBe('right');
    expect(state.scores.p1).toBe(1);
    expect(state.scores.p2).toBe(0);
    expect(state.lastScorer).toBe('p1');
    expect(state.serveSide).toBe('p1');
    expect(state.phase).toBe('POINT_SCORED');
    expect(state.phaseTimer).toBeCloseTo(1.1, 5);
    expect(state.players[0].animState).toBe('win');
    expect(state.players[1].animState).toBe('hurt');

    // Step through 1.1s celebration -> airborne P1 settles to floor while keeping win pose
    for (let i = 0; i < 30; i++) {
      stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    }
    expect(state.phase).toBe('POINT_SCORED');
    expect(state.players[0].isGrounded).toBe(true);
    expect(state.players[0].y).toBe(WORLD.FLOOR_Y - WORLD.PLAYER_RADIUS);
    expect(state.players[0].animState).toBe('win');
    expect(state.players[1].animState).toBe('hurt');

    for (let i = 0; i < 36; i++) {
      stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    }

    expect(state.phase).toBe('READY_SERVE');
    expect(state.phaseTimer).toBeCloseTo(0.7, 5);
    expect(state.serveSide).toBe('p1');
    expect(state.ball.x).toBe(WORLD.NET_X / 2);
    expect(state.ball.y).toBe(160);
    expect(state.players[0].animState).toBe('idle');
    expect(state.players[1].animState).toBe('idle');
  });

  it('awards P2 a point on left floor hit', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: '2p',
    });
    state.phase = 'PLAYING';
    state.phaseTimer = 0;
    state.ball.x = WORLD.NET_X - 180;
    state.ball.y = WORLD.FLOOR_Y - WORLD.BALL_RADIUS + 2;
    state.ball.vy = 200;

    const events = stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);

    expect(events.ballHitFloorSide).toBe('left');
    expect(state.scores.p2).toBe(1);
    expect(state.lastScorer).toBe('p2');
    expect(state.serveSide).toBe('p2');
    expect(state.phase).toBe('POINT_SCORED');
    expect(state.players[1].animState).toBe('win');
    expect(state.players[0].animState).toBe('hurt');
  });

  it('transitions to MATCH_OVER when reaching targetScore with win/lose poses', () => {
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      targetScore: 5,
    });
    state.scores.p1 = 4;
    state.phase = 'PLAYING';
    state.phaseTimer = 0;
    state.ball.x = WORLD.NET_X + 180;
    state.ball.y = WORLD.FLOOR_Y - WORLD.BALL_RADIUS + 2;
    state.ball.vy = 200;

    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    expect(state.scores.p1).toBe(5);
    expect(state.phase).toBe('POINT_SCORED');

    for (let i = 0; i < 66; i++) {
      stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT);
    }

    expect(state.phase).toBe('MATCH_OVER');
    expect(state.winner).toBe('p1');
    expect(state.players[0].animState).toBe('win');
    expect(state.players[1].animState).toBe('lose');

    const prevAnimTime = state.players[0].animTime;
    const overEvents = stepGame(state, [IDLE_INPUT, IDLE_INPUT], 0.1);
    expect(state.phase).toBe('MATCH_OVER');
    expect(state.players[0].animTime).toBeCloseTo(prevAnimTime + 0.1, 5);
    expect(state.players[0].animState).toBe('win');
    expect(state.players[1].animState).toBe('lose');
    expect(overEvents).toEqual({
      spikedBy: null,
      slidBy: null,
      volleyBy: null,
      netHit: false,
      wallHit: false,
      ballHitFloorSide: null,
    });
  });

  it('gates motion mode via WAITING_DISTANCE, freezing physics when motionReady=false and resuming when true', () => {
    const state = createGameState({
      controlMode: 'motion',
      opponentMode: 'npc',
    });

    expect(state.phase).toBe('WAITING_DISTANCE');
    expect(state.phaseTimer).toBe(0);

    // Remains frozen while motionReady=false
    const p1StartX = state.players[0].x;
    const frozenEvents = stepGame(
      state,
      [{ moveX: 1, targetX: null, jump: true }, IDLE_INPUT],
      WORLD.FIXED_DT,
      false,
    );
    expect(state.phase).toBe('WAITING_DISTANCE');
    expect(state.players[0].x).toBe(p1StartX);
    expect(state.players[0].isGrounded).toBe(true);
    expect(frozenEvents.ballHitFloorSide).toBeNull();

    // When motionReady becomes true from initial WAITING_DISTANCE, enters READY_SERVE
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT, true);
    expect(state.phase).toBe('READY_SERVE');

    // Finish countdown to enter PLAYING
    for (let i = 0; i < 42; i++) {
      stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT, true);
    }
    expect(state.phase).toBe('PLAYING');

    // Step a couple frames so ball moves
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT, true);
    const activeBallY = state.ball.y;
    const activeBallVy = state.ball.vy;

    // Lose motionReady mid-play -> enters WAITING_DISTANCE and freezes
    stepGame(
      state,
      [{ moveX: 1, targetX: null, jump: true }, IDLE_INPUT],
      WORLD.FIXED_DT,
      false,
    );
    expect(state.phase).toBe('WAITING_DISTANCE');
    expect(state.ball.y).toBe(activeBallY);
    expect(state.ball.vy).toBe(activeBallVy);
    expect(state.players[0].isGrounded).toBe(true);

    // Regain motionReady -> resumes PLAYING and advances physics
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], WORLD.FIXED_DT, true);
    expect(state.phase).toBe('PLAYING');
    expect(state.ball.y).toBeGreaterThan(activeBallY);
    expect(state.ball.vy).toBeGreaterThan(activeBallVy);

    // Pause mid-READY_SERVE preserves remaining phaseTimer
    resetRound(state, 'p1');
    stepGame(state, [IDLE_INPUT, IDLE_INPUT], 0.3, true);
    expect(state.phase).toBe('READY_SERVE');
    expect(state.phaseTimer).toBeCloseTo(0.4, 5);

    stepGame(state, [IDLE_INPUT, IDLE_INPUT], 0.1, false);
    expect(state.phase).toBe('WAITING_DISTANCE');
    expect(state.phaseTimer).toBeCloseTo(0.4, 5);

    stepGame(state, [IDLE_INPUT, IDLE_INPUT], 0.1, true);
    expect(state.phase).toBe('READY_SERVE');
    expect(state.phaseTimer).toBeCloseTo(0.3, 5);
  });

  it('handles MENU, dt <= 0, and resetRound cleanly', () => {
    const menuState = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'MENU',
    });
    const ballY = menuState.ball.y;
    stepGame(menuState, [{ moveX: 1, targetX: null, jump: true }, IDLE_INPUT], 0.1);
    expect(menuState.phase).toBe('MENU');
    expect(menuState.ball.y).toBe(ballY);

    resetRound(menuState, 'p2');
    expect(menuState.phase).toBe('READY_SERVE');
    expect(menuState.phaseTimer).toBeCloseTo(0.7, 5);
    expect(menuState.serveSide).toBe('p2');
    expect(menuState.ball.x).toBe(WORLD.NET_X + WORLD.NET_X / 2);

    const beforeTimer = menuState.phaseTimer;
    stepGame(menuState, [IDLE_INPUT, IDLE_INPUT], 0);
    expect(menuState.phaseTimer).toBe(beforeTimer);
  });
});
