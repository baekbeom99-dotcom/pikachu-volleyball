// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combineInputs } from '../src/main';
import { MenuUI, type MenuCallbacks } from '../src/ui/menu';

function createCallbacks(overrides: Partial<MenuCallbacks> = {}): MenuCallbacks {
  let muted = false;
  let placeholder = false;
  return {
    onStartMatch: vi.fn(),
    onRematch: vi.fn(),
    onReturnMenu: vi.fn(),
    onToggleMute: vi.fn(() => {
      muted = !muted;
      return muted;
    }),
    onToggleModel: vi.fn(() => {
      placeholder = !placeholder;
      return placeholder;
    }),
    onSwitchToTouch: vi.fn(),
    onRetryMotion: vi.fn(),
    ...overrides,
  };
}

describe('combineInputs', () => {
  it('gives priority to non-zero primary moveX and falls back to secondary moveX', () => {
    expect(
      combineInputs(
        { moveX: 0.75, targetX: null, jump: false },
        { moveX: -1, targetX: null, jump: false },
      ),
    ).toEqual({ moveX: 0.75, targetX: null, jump: false });

    expect(
      combineInputs(
        { moveX: 0, targetX: null, jump: false },
        { moveX: -1, targetX: null, jump: false },
      ),
    ).toEqual({ moveX: -1, targetX: null, jump: false });
  });

  it('combines jump with OR and guards non-finite moveX', () => {
    expect(
      combineInputs(
        { moveX: Number.NaN, targetX: null, jump: false },
        { moveX: 1, targetX: 240, jump: true },
      ),
    ).toEqual({ moveX: 1, targetX: 240, jump: true });

    expect(
      combineInputs(
        { moveX: 0, targetX: 180, jump: true },
        { moveX: 0, targetX: 240, jump: false },
      ),
    ).toEqual({ moveX: 0, targetX: 180, jump: true });
  });
});

describe('MenuUI', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders Start Menu defaults and emits selected options on GAME START!', () => {
    const callbacks = createCallbacks();
    const ui = new MenuUI(container, callbacks);

    expect(container.textContent).toContain('PIKA VOLLEYBALL');
    expect(container.textContent).not.toContain('POP ART EDITION');
    expect(container.textContent).not.toContain('캐릭터 외형');
    expect(container.textContent).not.toContain('공중 스파이크');
    expect(container.querySelector('[data-action="open-motion-guide"]')).toBeNull();
    for (const sel of [
      '[data-control="touch"]',
      '[data-control="motion"]',
      '[data-opponent="npc"]',
      '[data-opponent="2p"]',
      '[data-score="5"]',
      '[data-score="10"]',
      '[data-score="15"]',
    ]) {
      expect(container.querySelector(`${sel} svg`)).not.toBeNull();
    }
    expect(ui.getSelections()).toEqual({
      controlMode: 'touch',
      opponentMode: 'npc',
      targetScore: 15,
      usePlaceholderModel: false,
    });

    container.querySelector<HTMLButtonElement>('[data-control="motion"]')?.click();
    const guideBtn = container.querySelector<HTMLButtonElement>('[data-action="open-motion-guide"]')!;
    expect(guideBtn).not.toBeNull();
    guideBtn.click();
    expect(container.textContent).toContain('모션 게임 방법');
    expect(container.textContent).toContain('STEP BACK!');
    container.querySelector<HTMLButtonElement>('[data-action="close-motion-guide"]')?.click();
    expect(container.textContent).not.toContain('모션 게임 방법');

    container.querySelector<HTMLButtonElement>('[data-opponent="2p"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-score="10"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-action="start-game"]')?.click();

    expect(callbacks.onStartMatch).toHaveBeenCalledWith({
      controlMode: 'motion',
      opponentMode: '2p',
      targetScore: 10,
      usePlaceholderModel: false,
    });

    ui.dispose();
  });

  it('renders floating HUD bar, stops pointerdown propagation, and toggles mute/model/menu', () => {
    const callbacks = createCallbacks();
    const ui = new MenuUI(container, callbacks);
    ui.setScreen('IN_GAME');

    const parentPointerSpy = vi.fn();
    container.addEventListener('pointerdown', parentPointerSpy);

    const muteBtn = container.querySelector<HTMLButtonElement>('[data-action="toggle-mute"]')!;
    const modelBtn = container.querySelector<HTMLButtonElement>('[data-action="toggle-model"]')!;
    const menuBtn = container.querySelector<HTMLButtonElement>('[data-action="open-menu"]')!;

    expect(muteBtn.textContent).toBe('🔊');
    expect(modelBtn.textContent).toBe('033');
    expect(menuBtn.querySelector('svg')).not.toBeNull();
    expect(menuBtn.getAttribute('aria-label')).toBe('Return to menu');

    muteBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(parentPointerSpy).not.toHaveBeenCalled();

    muteBtn.click();
    expect(callbacks.onToggleMute).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="toggle-mute"]')?.textContent,
    ).toBe('🔇');

    container.querySelector<HTMLButtonElement>('[data-action="toggle-model"]')?.click();
    expect(callbacks.onToggleModel).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="toggle-model"]')?.textContent,
    ).toBe('MODEL');

    container.querySelector<HTMLButtonElement>('[data-action="open-menu"]')?.click();
    expect(callbacks.onReturnMenu).toHaveBeenCalledTimes(1);

    ui.dispose();
  });

  it('renders Match Over overlay for P1, P2, and NPC winners and triggers REMATCH! / MENU', () => {
    const callbacks = createCallbacks();
    const ui = new MenuUI(container, callbacks);

    ui.showMatchOver('p2', { p1: 9, p2: 15 }, 'npc');
    expect(container.textContent).toContain('NPC WINS!');
    expect(container.textContent).toContain('P1 9 : 15 NPC');

    ui.showMatchOver('p2', { p1: 12, p2: 15 }, '2p');
    expect(container.textContent).toContain('P2 WINS!');
    expect(container.textContent).toContain('P1 12 : 15 P2');

    ui.showMatchOver('p1', { p1: 15, p2: 7 }, 'npc');
    expect(container.textContent).toContain('P1 WINS!');

    container.querySelector<HTMLButtonElement>('[data-action="rematch"]')?.click();
    expect(callbacks.onRematch).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('[data-action="return-menu"]')?.click();
    expect(callbacks.onReturnMenu).toHaveBeenCalledTimes(1);

    ui.dispose();
  });

  it('renders camera error modal and triggers switch-to-touch, retry, and menu actions', () => {
    const callbacks = createCallbacks();
    const ui = new MenuUI(container, callbacks, { controlMode: 'motion' });
    ui.setScreen('IN_GAME');
    ui.showCameraError('카메라 권한이 거부되었습니다. (Camera permission denied)');

    expect(container.textContent).toContain('Camera permission denied');

    container.querySelector<HTMLButtonElement>('[data-action="switch-to-touch"]')?.click();
    expect(callbacks.onSwitchToTouch).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('[data-action="retry-motion"]')?.click();
    expect(callbacks.onRetryMotion).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('[data-action="error-menu"]')?.click();
    expect(callbacks.onReturnMenu).toHaveBeenCalledTimes(1);

    ui.clearCameraError();
    expect(container.querySelector('[data-action="switch-to-touch"]')).toBeNull();

    ui.dispose();
  });

  it('preserves keyboard focus across MenuUI option and HUD toggles', () => {
    const callbacks = createCallbacks();
    const ui = new MenuUI(container, callbacks);

    const selectors = [
      '[data-control="motion"]',
      '[data-opponent="2p"]',
      '[data-score="10"]',
    ];
    for (const selector of selectors) {
      const btn = container.querySelector<HTMLButtonElement>(selector)!;
      btn.focus();
      expect(document.activeElement).toBe(btn);
      btn.click();
      const rerendered = container.querySelector<HTMLButtonElement>(selector)!;
      expect(rerendered).not.toBe(btn);
      expect(document.activeElement).toBe(rerendered);
    }

    ui.setScreen('IN_GAME');
    const muteBtn = container.querySelector<HTMLButtonElement>('[data-action="toggle-mute"]')!;
    muteBtn.focus();
    muteBtn.click();
    const rerenderedMute = container.querySelector<HTMLButtonElement>('[data-action="toggle-mute"]')!;
    expect(document.activeElement).toBe(rerenderedMute);

    ui.dispose();
  });

  it('renders SVG fullscreen icon toggle in both MENU and IN_GAME HUD and syncs state', () => {
    const container = document.createElement('div');
    let isFull = false;
    const onToggleFullscreen = vi.fn(() => {
      isFull = !isFull;
      return isFull;
    });

    const ui = new MenuUI(container, {
      onStartMatch: vi.fn(),
      onRematch: vi.fn(),
      onReturnMenu: vi.fn(),
      onToggleMute: () => false,
      onToggleModel: () => false,
      onToggleFullscreen,
      onSwitchToTouch: vi.fn(),
      onRetryMotion: vi.fn(),
    });

    const menuFullBtn = container.querySelector<HTMLButtonElement>('[data-action="toggle-fullscreen"]')!;
    expect(menuFullBtn).not.toBeNull();
    expect(menuFullBtn.querySelector('svg')).not.toBeNull();
    expect(menuFullBtn.getAttribute('aria-pressed')).toBe('false');

    menuFullBtn.click();
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="toggle-fullscreen"]')!.getAttribute('aria-pressed'),
    ).toBe('true');

    ui.setScreen('IN_GAME');
    const hudFullBtn = container.querySelector<HTMLButtonElement>('[data-action="toggle-fullscreen"]')!;
    expect(hudFullBtn.querySelector('svg')).not.toBeNull();
    expect(hudFullBtn.getAttribute('aria-pressed')).toBe('true');

    ui.setFullscreen(false);
    expect(
      container.querySelector<HTMLButtonElement>('[data-action="toggle-fullscreen"]')!.getAttribute('aria-pressed'),
    ).toBe('false');

    ui.dispose();
  });
});
