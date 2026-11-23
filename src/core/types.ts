export type PlayerId = 'p1' | 'p2';

export type ControlMode = 'touch' | 'motion';

export type OpponentMode = 'npc' | '2p';

export type MatchPhase =
  | 'MENU'
  | 'WAITING_DISTANCE'
  | 'READY_SERVE'
  | 'PLAYING'
  | 'POINT_SCORED'
  | 'MATCH_OVER';

export type CharacterAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump_launch'
  | 'air_float'
  | 'spike'
  | 'slide'
  | 'attack'
  | 'hurt'
  | 'win'
  | 'lose';

export interface PlayerInput {
  moveX: number;
  targetX: number | null;
  jump: boolean;
}

export interface PlayerState {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  facing: 1 | -1;
  isGrounded: boolean;
  slideTimer: number;
  slideCooldown: number;
  slideDir: 1 | -1;
  hitCooldown: number;
  animState: CharacterAnimState;
  animLock: CharacterAnimState | null;
  animLockTimer: number;
  animTime: number;
}

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isSpiked: boolean;
  rotation: number;
  spin: number;
  trail: Array<{ x: number; y: number; isSpiked: boolean }>;
}

export type MotionGateStatus = 'NO_PERSON' | 'TOO_CLOSE' | 'OK';

export interface MotionSideStatus {
  side: 'left' | 'right';
  detected: boolean;
  widthRatio: number;
  heightRatio: number;
  gateStatus: MotionGateStatus;
}

export interface PhysicsEvents {
  spikedBy: PlayerId | null;
  slidBy: PlayerId | null;
  volleyBy: PlayerId | null;
  netHit: boolean;
  wallHit: boolean;
  ballHitFloorSide: 'left' | 'right' | null;
}

export interface GameState {
  controlMode: ControlMode;
  opponentMode: OpponentMode;
  phase: MatchPhase;
  targetScore: number;
  scores: { p1: number; p2: number };
  serveSide: PlayerId;
  winner: PlayerId | null;
  phaseTimer: number;
  pausedFromPhase?: 'READY_SERVE' | 'PLAYING';
  lastScorer: PlayerId | null;
  players: [PlayerState, PlayerState];
  ball: BallState;
  lastEvents: PhysicsEvents;
}

/** Active virtual joystick state for Pop-Art canvas rendering (coordinates in element CSS pixels). */
export interface VisualJoystick {
  playerId: PlayerId;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
  maxRadius: number;
  normX: number;
  normY: number;
  jumpActive: boolean;
}

export interface MotionOverlayData {
  statuses: [MotionSideStatus, MotionSideStatus];
  isReady: boolean;
  error: string | null;
  activeSide?: 'left' | 'right';
}
