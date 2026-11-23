import type { OpponentMode, PlayerId, PlayerInput, VisualJoystick } from '../core/types';
import { idleInput, type InputProvider } from './types';

export const JOYSTICK_MAX_RADIUS = 56;
export const JOYSTICK_DEADZONE = 0.15;
export const JOYSTICK_JUMP_THRESHOLD = -0.45;

interface JoystickState {
  playerId: PlayerId;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
  normX: number;
  normY: number;
  jumpActive: boolean;
}

/**
 * Dynamic virtual touch joystick supporting 1P (anywhere on screen) and
 * 2P (left half P1 / right half P2) simultaneous multi-touch input.
 */
export class TouchJoystickProvider implements InputProvider {
  private mode: OpponentMode;
  private readonly joysticks = new Map<number, JoystickState>();
  private attachedElement: HTMLElement | null = null;

  private readonly onPointerDown = (event: PointerEvent): void => {
    const el = this.attachedElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.handlePointerDown(
      event.pointerId,
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
    );
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore capture errors on synthetic or unsupported pointer events.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const el = this.attachedElement;
    if (!el || !this.joysticks.has(event.pointerId)) return;
    const rect = el.getBoundingClientRect();
    this.handlePointerMove(
      event.pointerId,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.handlePointerUp(event.pointerId);
  };

  constructor(mode: OpponentMode = 'npc') {
    this.mode = mode;
  }

  /** Switches between 1P ('npc') and 2P ('2p') touch zone behavior. */
  setOpponentMode(mode: OpponentMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.reset();
    }
  }

  /** Clears all active touch joysticks. */
  reset(): void {
    this.joysticks.clear();
  }

  private hasActivePlayer(playerId: PlayerId): boolean {
    for (const state of this.joysticks.values()) {
      if (state.playerId === playerId) {
        return true;
      }
    }
    return false;
  }

  /** Starts a dynamic joystick at the pointer position if that player slot is free. */
  handlePointerDown(
    pointerId: number,
    clientX: number,
    clientY: number,
    viewportWidth: number,
  ): void {
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      !Number.isFinite(viewportWidth) ||
      this.joysticks.has(pointerId)
    ) {
      return;
    }

    const playerId: PlayerId =
      this.mode === 'npc' ? 'p1' : clientX < viewportWidth * 0.5 ? 'p1' : 'p2';

    if (this.hasActivePlayer(playerId)) {
      return;
    }

    this.joysticks.set(pointerId, {
      playerId,
      originX: clientX,
      originY: clientY,
      knobX: clientX,
      knobY: clientY,
      normX: 0,
      normY: 0,
      jumpActive: false,
    });
  }

  /** Updates the joystick knob position with circular clamping to maxRadius. */
  handlePointerMove(pointerId: number, clientX: number, clientY: number): void {
    const state = this.joysticks.get(pointerId);
    if (!state || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    let dx = clientX - state.originX;
    let dy = clientY - state.originY;
    const dist = Math.hypot(dx, dy);

    if (dist > JOYSTICK_MAX_RADIUS) {
      const scale = JOYSTICK_MAX_RADIUS / dist;
      dx *= scale;
      dy *= scale;
    }

    state.knobX = state.originX + dx;
    state.knobY = state.originY + dy;
    state.normX = dx / JOYSTICK_MAX_RADIUS;
    state.normY = dy / JOYSTICK_MAX_RADIUS;
    state.jumpActive = state.normY < JOYSTICK_JUMP_THRESHOLD;
  }

  /** Ends and removes the joystick associated with pointerId. */
  handlePointerUp(pointerId: number): void {
    this.joysticks.delete(pointerId);
  }

  /** Returns normalized [P1, P2] player inputs derived from active joysticks. */
  getInputs(_dt = 0): [PlayerInput, PlayerInput] {
    const result: [PlayerInput, PlayerInput] = [idleInput(), idleInput()];

    for (const state of this.joysticks.values()) {
      const moveX = Math.abs(state.normX) < JOYSTICK_DEADZONE ? 0 : state.normX;
      const input: PlayerInput = {
        moveX,
        targetX: null,
        jump: state.jumpActive,
      };
      if (state.playerId === 'p1') {
        result[0] = input;
      } else {
        result[1] = input;
      }
    }

    return result;
  }

  /** Returns plain DTOs for rendering active dynamic joysticks on canvas. */
  getVisualJoysticks(): VisualJoystick[] {
    const visuals: VisualJoystick[] = [];
    for (const state of this.joysticks.values()) {
      visuals.push({
        playerId: state.playerId,
        originX: state.originX,
        originY: state.originY,
        knobX: state.knobX,
        knobY: state.knobY,
        maxRadius: JOYSTICK_MAX_RADIUS,
        normX: state.normX,
        normY: state.normY,
        jumpActive: state.jumpActive,
      });
    }
    return visuals;
  }

  /** Binds pointer event listeners to a target element using element-relative coordinates. */
  attach(element: HTMLElement): void {
    this.dispose();
    this.attachedElement = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerEnd);
    element.addEventListener('pointercancel', this.onPointerEnd);
    element.addEventListener('lostpointercapture', this.onPointerEnd);
  }

  /** Detaches DOM pointer listeners and resets active joysticks. */
  dispose(): void {
    if (this.attachedElement) {
      this.attachedElement.removeEventListener('pointerdown', this.onPointerDown);
      this.attachedElement.removeEventListener('pointermove', this.onPointerMove);
      this.attachedElement.removeEventListener('pointerup', this.onPointerEnd);
      this.attachedElement.removeEventListener('pointercancel', this.onPointerEnd);
      this.attachedElement.removeEventListener('lostpointercapture', this.onPointerEnd);
      this.attachedElement = null;
    }
    this.reset();
  }
}
