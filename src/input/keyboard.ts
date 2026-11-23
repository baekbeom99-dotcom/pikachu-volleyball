import type { OpponentMode, PlayerInput } from '../core/types';
import { idleInput, type InputProvider } from './types';

/**
 * Keyboard input provider supporting WASD (P1) and Arrow keys
 * (shared P1 in 1P/NPC mode, or independent P2 in 2P mode).
 */
export class KeyboardInputProvider implements InputProvider {
  private mode: OpponentMode;
  private readonly pressedKeys = new Set<string>();
  private disposed = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressedKeys.clear();
  };

  constructor(mode: OpponentMode = 'npc') {
    this.mode = mode;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    }
  }

  /** Updates opponent mode ('npc' shares arrows with P1; '2p' splits WASD/Arrows). */
  setOpponentMode(mode: OpponentMode): void {
    this.mode = mode;
  }

  private readBindings(
    leftCodes: readonly string[],
    rightCodes: readonly string[],
    jumpCodes: readonly string[],
  ): PlayerInput {
    const left = leftCodes.some((code) => this.pressedKeys.has(code));
    const right = rightCodes.some((code) => this.pressedKeys.has(code));
    const jump = jumpCodes.some((code) => this.pressedKeys.has(code));
    const moveX = (right ? 1 : 0) - (left ? 1 : 0);

    return {
      moveX,
      targetX: null,
      jump,
    };
  }

  /** Returns [P1, P2] inputs sampled from currently held keyboard keys. */
  getInputs(_dt = 0): [PlayerInput, PlayerInput] {
    if (this.disposed) {
      return [idleInput(), idleInput()];
    }

    if (this.mode === 'npc') {
      const p1 = this.readBindings(
        ['KeyA', 'ArrowLeft'],
        ['KeyD', 'ArrowRight'],
        ['KeyW', 'ArrowUp'],
      );
      return [p1, idleInput()];
    }

    const p1 = this.readBindings(['KeyA'], ['KeyD'], ['KeyW']);
    const p2 = this.readBindings(['ArrowLeft'], ['ArrowRight'], ['ArrowUp']);
    return [p1, p2];
  }

  /** Detaches window keyboard/blur listeners and clears key state. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    }
    this.pressedKeys.clear();
  }
}
