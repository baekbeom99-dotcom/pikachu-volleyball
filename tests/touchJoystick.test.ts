import { describe, expect, it, vi } from 'vitest';
import {
  JOYSTICK_DEADZONE,
  JOYSTICK_JUMP_THRESHOLD,
  JOYSTICK_MAX_RADIUS,
  TouchJoystickProvider,
} from '../src/input/touchJoystick';

describe('TouchJoystickProvider', () => {
  it('spawns P1 joystick anywhere in 1p (npc) mode and computes moveX & jump', () => {
    const provider = new TouchJoystickProvider('npc');

    // Even on the right half of the viewport, 1P mode binds to P1
    provider.handlePointerDown(1, 820, 400, 1000);
    provider.handlePointerMove(1, 820 + 45, 400 - 35);

    const [p1, p2] = provider.getInputs(1 / 60);
    expect(p1.moveX).toBeGreaterThan(0.7);
    expect(p1.jump).toBe(true);
    expect(p1.targetX).toBeNull();
    expect(p2).toEqual({ moveX: 0, targetX: null, jump: false });
  });

  it('applies deadzone so small drags yield moveX === 0 and jump === false', () => {
    const provider = new TouchJoystickProvider('npc');

    provider.handlePointerDown(1, 300, 300, 1000);
    provider.handlePointerMove(1, 300 + 5, 300 + 4);

    const [p1] = provider.getInputs(1 / 60);
    expect(p1.moveX).toBe(0);
    expect(p1.jump).toBe(false);
    expect(JOYSTICK_DEADZONE).toBe(0.15);
    expect(JOYSTICK_JUMP_THRESHOLD).toBe(-0.45);
  });

  it('supports simultaneous independent P1 and P2 joysticks in 2p mode and resets only released player', () => {
    const provider = new TouchJoystickProvider('2p');

    provider.handlePointerDown(1, 200, 350, 1000);
    provider.handlePointerDown(2, 800, 380, 1000);

    provider.handlePointerMove(1, 200 + 40, 350 - 30);
    provider.handlePointerMove(2, 800 - 50, 380);

    let [p1, p2] = provider.getInputs(1 / 60);
    expect(p1.moveX).toBeGreaterThan(0.6);
    expect(p1.jump).toBe(true);
    expect(p2.moveX).toBeLessThan(-0.8);
    expect(p2.jump).toBe(false);

    // Releasing pointer 1 resets P1 without affecting P2
    provider.handlePointerUp(1);
    [p1, p2] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: 0, targetX: null, jump: false });
    expect(p2.moveX).toBeLessThan(-0.8);
    expect(p2.jump).toBe(false);
  });

  it('ignores extra touch in the same half-zone in 2p mode so active pointer is not overwritten', () => {
    const provider = new TouchJoystickProvider('2p');

    provider.handlePointerDown(1, 150, 300, 1000);
    provider.handlePointerMove(1, 150 + 35, 300);

    // Second touch on P1 side should not replace pointer 1
    provider.handlePointerDown(99, 250, 400, 1000);
    provider.handlePointerMove(99, 250 - 50, 400 - 50);

    const [p1] = provider.getInputs(1 / 60);
    expect(p1.moveX).toBeCloseTo(35 / JOYSTICK_MAX_RADIUS, 4);
    expect(p1.jump).toBe(false);

    const visuals = provider.getVisualJoysticks();
    expect(visuals).toHaveLength(1);
    expect(visuals[0].originX).toBe(150);
  });

  it('circularly clamps drag distance to maxRadius and reports accurate VisualJoystick DTOs', () => {
    const provider = new TouchJoystickProvider('npc');

    provider.handlePointerDown(1, 100, 200, 800);
    provider.handlePointerMove(1, 100 + 120, 200 - 90);

    const visuals = provider.getVisualJoysticks();
    expect(visuals).toHaveLength(1);

    const v = visuals[0];
    expect(v.playerId).toBe('p1');
    expect(v.originX).toBe(100);
    expect(v.originY).toBe(200);
    expect(v.maxRadius).toBe(JOYSTICK_MAX_RADIUS);

    const normLen = Math.hypot(v.normX, v.normY);
    expect(normLen).toBeLessThanOrEqual(1 + 1e-6);
    expect(normLen).toBeCloseTo(1, 5);
    expect(v.knobX).toBeCloseTo(100 + v.normX * JOYSTICK_MAX_RADIUS, 4);
    expect(v.knobY).toBeCloseTo(200 + v.normY * JOYSTICK_MAX_RADIUS, 4);
    expect(v.jumpActive).toBe(true);
  });

  it('attaches to element with relative coordinates and cleans up listeners on dispose', () => {
    const provider = new TouchJoystickProvider('2p');
    const listeners = new Map<string, Set<(e: unknown) => void>>();

    const fakeElement = {
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
      setPointerCapture: vi.fn(),
      addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
        listeners.get(type)?.delete(cb);
      }),
    } as unknown as HTMLElement;

    provider.attach(fakeElement);

    const fire = (type: string, event: Record<string, unknown>) => {
      for (const cb of listeners.get(type) ?? []) {
        cb(event);
      }
    };

    fire('pointerdown', { pointerId: 7, clientX: 600, clientY: 250 });
    fire('pointermove', { pointerId: 7, clientX: 600, clientY: 250 - 40 });

    const visuals = provider.getVisualJoysticks();
    expect(visuals).toHaveLength(1);
    expect(visuals[0].playerId).toBe('p2');
    expect(visuals[0].originX).toBe(500);
    expect(visuals[0].originY).toBe(200);
    expect(visuals[0].jumpActive).toBe(true);

    provider.dispose();
    expect(provider.getVisualJoysticks()).toHaveLength(0);
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0);
    expect(listeners.get('pointermove')?.size ?? 0).toBe(0);
    expect(listeners.get('pointerup')?.size ?? 0).toBe(0);
    expect(listeners.get('pointercancel')?.size ?? 0).toBe(0);
  });
});
