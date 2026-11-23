// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KeyboardInputProvider } from '../src/input/keyboard';

function pressKey(code: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function releaseKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true }));
}

describe('KeyboardInputProvider', () => {
  let provider: KeyboardInputProvider | null = null;

  afterEach(() => {
    provider?.dispose();
    provider = null;
  });

  it('maps both WASD and Arrow keys to P1 in npc mode while keeping P2 idle', () => {
    provider = new KeyboardInputProvider('npc');

    pressKey('KeyD');
    pressKey('KeyW');
    let [p1, p2] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: 1, targetX: null, jump: true });
    expect(p2).toEqual({ moveX: 0, targetX: null, jump: false });

    releaseKey('KeyD');
    releaseKey('KeyW');

    pressKey('ArrowLeft');
    pressKey('ArrowUp');
    [p1, p2] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: -1, targetX: null, jump: true });
    expect(p2).toEqual({ moveX: 0, targetX: null, jump: false });
  });

  it('splits WASD (P1) and Arrow keys (P2) in 2p mode', () => {
    provider = new KeyboardInputProvider('2p');

    pressKey('KeyA');
    pressKey('ArrowRight');
    pressKey('ArrowUp');

    const [p1, p2] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: -1, targetX: null, jump: false });
    expect(p2).toEqual({ moveX: 1, targetX: null, jump: true });

    provider.setOpponentMode('npc');
    const [combinedP1, combinedP2] = provider.getInputs(1 / 60);
    expect(combinedP1).toEqual({ moveX: 0, targetX: null, jump: true });
    expect(combinedP2).toEqual({ moveX: 0, targetX: null, jump: false });
  });

  it('cancels opposing horizontal keys and resets keys on window blur', () => {
    provider = new KeyboardInputProvider('npc');

    pressKey('KeyA');
    pressKey('KeyD');
    pressKey('KeyW');

    let [p1] = provider.getInputs(1 / 60);
    expect(p1.moveX).toBe(0);
    expect(p1.jump).toBe(true);

    window.dispatchEvent(new Event('blur'));
    [p1] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: 0, targetX: null, jump: false });
  });

  it('calls preventDefault on Arrow keys and stops listening after dispose', () => {
    provider = new KeyboardInputProvider('2p');

    const leftEv = pressKey('ArrowLeft');
    const rightEv = pressKey('ArrowRight');
    const upEv = pressKey('ArrowUp');
    const wasdEv = pressKey('KeyW');

    expect(leftEv.defaultPrevented).toBe(true);
    expect(rightEv.defaultPrevented).toBe(true);
    expect(upEv.defaultPrevented).toBe(true);
    expect(wasdEv.defaultPrevented).toBe(false);

    provider.dispose();
    const [p1, p2] = provider.getInputs(1 / 60);
    expect(p1).toEqual({ moveX: 0, targetX: null, jump: false });
    expect(p2).toEqual({ moveX: 0, targetX: null, jump: false });

    pressKey('KeyD');
    expect(provider.getInputs(1 / 60)[0]).toEqual({
      moveX: 0,
      targetX: null,
      jump: false,
    });
  });
});
