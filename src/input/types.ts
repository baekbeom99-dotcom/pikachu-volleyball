import type { PlayerInput } from '../core/types';

export interface InputProvider {
  getInputs(dt: number): [PlayerInput, PlayerInput];
  dispose(): void;
}

/** Returns a neutral PlayerInput with no movement or jump. */
export function idleInput(): PlayerInput {
  return {
    moveX: 0,
    targetX: null,
    jump: false,
  };
}
