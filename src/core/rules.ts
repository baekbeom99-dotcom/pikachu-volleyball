import { WORLD } from './constants';
import { createInitialBall, createInitialPlayer, stepPhysics } from './physics';
import type {
  ControlMode,
  GameState,
  OpponentMode,
  PhysicsEvents,
  PlayerId,
  PlayerInput,
  PlayerState,
} from './types';

const SERVE_READY_DURATION = 0.7;
const POINT_SCORED_DURATION = 1.1;
const TIMER_EPSILON = 1e-6;

export interface CreateGameOptions {
  controlMode: ControlMode;
  opponentMode: OpponentMode;
  targetScore?: number;
  initialPhase?: 'MENU' | 'READY_SERVE' | 'WAITING_DISTANCE';
}

function createEmptyEvents(): PhysicsEvents {
  return {
    spikedBy: null,
    slidBy: null,
    volleyBy: null,
    netHit: false,
    wallHit: false,
    ballHitFloorSide: null,
  };
}

function getPlayerById(players: [PlayerState, PlayerState], id: PlayerId): PlayerState {
  return id === 'p1' ? players[0] : players[1];
}

function applyMatchOverPoses(state: GameState): void {
  if (state.winner === null) {
    return;
  }
  const loser: PlayerId = state.winner === 'p1' ? 'p2' : 'p1';
  const winnerPlayer = getPlayerById(state.players, state.winner);
  const loserPlayer = getPlayerById(state.players, loser);
  winnerPlayer.animState = 'win';
  winnerPlayer.animLock = null;
  winnerPlayer.animLockTimer = 0;
  loserPlayer.animState = 'lose';
  loserPlayer.animLock = null;
  loserPlayer.animLockTimer = 0;
}

function settlePlayerInCelebration(player: PlayerState, dt: number): void {
  player.animTime += dt;
  if (!player.isGrounded) {
    player.vy += WORLD.GRAVITY * dt;
    player.y += player.vy * dt;
    const floorCenterY = WORLD.FLOOR_Y - player.radius;
    if (player.y >= floorCenterY) {
      player.y = floorCenterY;
      player.vy = 0;
      player.isGrounded = true;
    }
  }
}

/** Creates a fresh GameState for a volleyball match. */
export function createGameState(options: CreateGameOptions): GameState {
  const targetScore = options.targetScore ?? 15;
  const initialPhase =
    options.initialPhase ??
    (options.controlMode === 'motion' ? 'WAITING_DISTANCE' : 'READY_SERVE');

  return {
    controlMode: options.controlMode,
    opponentMode: options.opponentMode,
    phase: initialPhase,
    targetScore,
    scores: { p1: 0, p2: 0 },
    serveSide: 'p1',
    winner: null,
    phaseTimer: initialPhase === 'READY_SERVE' ? SERVE_READY_DURATION : 0,
    pausedFromPhase:
      initialPhase === 'WAITING_DISTANCE' ? 'READY_SERVE' : undefined,
    lastScorer: null,
    players: [createInitialPlayer('p1'), createInitialPlayer('p2')],
    ball: createInitialBall('p1'),
    lastEvents: createEmptyEvents(),
  };
}

/** Resets players and ball for a new point with serveSide serving. */
export function resetRound(state: GameState, serveSide: PlayerId): void {
  state.players = [createInitialPlayer('p1'), createInitialPlayer('p2')];
  state.ball = createInitialBall(serveSide);
  state.serveSide = serveSide;
  state.phase = 'READY_SERVE';
  state.phaseTimer = SERVE_READY_DURATION;
  state.pausedFromPhase = undefined;
  state.lastEvents = createEmptyEvents();
}

/** Resumes match progression out of WAITING_DISTANCE back to READY_SERVE or PLAYING. */
export function resumeFromDistanceWait(state: GameState): void {
  if (state.phase !== 'WAITING_DISTANCE') {
    return;
  }
  const resumePhase =
    state.pausedFromPhase ?? (state.phaseTimer > 0 ? 'READY_SERVE' : 'PLAYING');
  state.pausedFromPhase = undefined;
  state.phase = resumePhase;
  if (resumePhase === 'READY_SERVE' && state.phaseTimer <= 0) {
    state.phaseTimer = SERVE_READY_DURATION;
  }
}

/** Advances the match rules state machine and physics by dt seconds. */
export function stepGame(
  state: GameState,
  inputs: [PlayerInput, PlayerInput],
  dt: number,
  motionReady = true,
): PhysicsEvents {
  if (state.phase === 'MATCH_OVER') {
    applyMatchOverPoses(state);
    const safeDt = Math.max(0, dt);
    state.players[0].animTime += safeDt;
    state.players[1].animTime += safeDt;
    state.lastEvents = createEmptyEvents();
    return state.lastEvents;
  }

  if (dt <= 0 || state.phase === 'MENU') {
    return state.lastEvents;
  }

  if (state.controlMode === 'motion') {
    if (!motionReady) {
      if (state.phase === 'READY_SERVE' || state.phase === 'PLAYING') {
        state.pausedFromPhase = state.phase;
        state.phase = 'WAITING_DISTANCE';
      }
      if (state.phase === 'WAITING_DISTANCE') {
        state.lastEvents = createEmptyEvents();
        return state.lastEvents;
      }
    } else if (state.phase === 'WAITING_DISTANCE') {
      resumeFromDistanceWait(state);
    }
  }

  if (state.phase === 'READY_SERVE') {
    // Allow players to position and jump while holding the serve ball motionless.
    const phantomBall = createInitialBall(state.serveSide);
    phantomBall.y = -1000;
    stepPhysics(state.players, phantomBall, inputs, dt);
    state.lastEvents = createEmptyEvents();

    state.phaseTimer -= dt;
    if (state.phaseTimer <= TIMER_EPSILON) {
      state.phaseTimer = 0;
      state.phase = 'PLAYING';
    }
    return state.lastEvents;
  }

  if (state.phase === 'PLAYING') {
    const events = stepPhysics(state.players, state.ball, inputs, dt);
    state.lastEvents = events;

    if (events.ballHitFloorSide !== null) {
      const scorer: PlayerId = events.ballHitFloorSide === 'right' ? 'p1' : 'p2';
      const loser: PlayerId = scorer === 'p1' ? 'p2' : 'p1';
      state.scores[scorer] += 1;
      state.lastScorer = scorer;
      state.serveSide = scorer;
      state.phase = 'POINT_SCORED';
      state.phaseTimer = POINT_SCORED_DURATION;

      const scorerPlayer = getPlayerById(state.players, scorer);
      const loserPlayer = getPlayerById(state.players, loser);
      scorerPlayer.animState = 'win';
      scorerPlayer.animLock = 'win';
      scorerPlayer.animLockTimer = POINT_SCORED_DURATION;
      loserPlayer.animState = 'hurt';
      loserPlayer.animLock = 'hurt';
      loserPlayer.animLockTimer = POINT_SCORED_DURATION;
    }

    return state.lastEvents;
  }

  if (state.phase === 'POINT_SCORED') {
    state.lastEvents = createEmptyEvents();
    const scorer: PlayerId = state.lastScorer ?? state.serveSide;
    const loser: PlayerId = scorer === 'p1' ? 'p2' : 'p1';
    const scorerPlayer = getPlayerById(state.players, scorer);
    const loserPlayer = getPlayerById(state.players, loser);

    settlePlayerInCelebration(scorerPlayer, dt);
    settlePlayerInCelebration(loserPlayer, dt);
    scorerPlayer.animState = 'win';
    loserPlayer.animState = 'hurt';

    state.phaseTimer -= dt;
    if (state.phaseTimer <= TIMER_EPSILON) {
      state.phaseTimer = 0;
      if (state.scores[scorer] >= state.targetScore) {
        state.winner = scorer;
        state.phase = 'MATCH_OVER';
        applyMatchOverPoses(state);
      } else {
        resetRound(state, state.serveSide);
      }
    }

    return state.lastEvents;
  }

  return state.lastEvents;
}
