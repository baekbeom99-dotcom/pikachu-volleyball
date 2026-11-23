// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { motionInstances } = vi.hoisted(() => ({
  motionInstances: [] as Array<{
    init: ReturnType<typeof vi.fn>;
    getInputs: ReturnType<typeof vi.fn>;
    isMotionReady: ReturnType<typeof vi.fn>;
    getOverlayData: ReturnType<typeof vi.fn>;
    getPreviewCanvas: ReturnType<typeof vi.fn>;
    getError: ReturnType<typeof vi.fn>;
    setOpponentMode: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../src/input/motion', () => ({
  MotionInputProvider: vi.fn(() => {
    const instance = {
      init: vi.fn().mockResolvedValue(undefined),
      getInputs: vi.fn(() => [
        { moveX: 0, targetX: null, jump: false },
        { moveX: 0, targetX: null, jump: false },
      ]),
      isMotionReady: vi.fn(() => false),
      getOverlayData: vi.fn(() => ({
        statuses: [
          {
            side: 'left' as const,
            detected: false,
            widthRatio: 0,
            heightRatio: 0,
            gateStatus: 'NO_PERSON' as const,
          },
          {
            side: 'right' as const,
            detected: false,
            widthRatio: 0,
            heightRatio: 0,
            gateStatus: 'NO_PERSON' as const,
          },
        ],
        isReady: false,
        error: null,
        activeSide: 'left' as const,
      })),
      getPreviewCanvas: vi.fn(() => null),
      getError: vi.fn(() => null),
      setOpponentMode: vi.fn(),
      dispose: vi.fn(),
    };
    motionInstances.push(instance);
    return instance;
  }),
}));

import { startApp } from '../src/main';
import { MenuUI } from '../src/ui/menu';

function createMockCanvas2D(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    roundRect: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    drawImage: vi.fn(),
    createPattern: vi.fn(() => null),
    measureText: vi.fn(() => ({ width: 20 })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    miterLimit: 10,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe('startApp integration', () => {
  let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextRafId = 1;
  let nowMs = 0;
  let mockCtx: CanvasRenderingContext2D;
  let cleanup: (() => void) | null = null;

  function stepFrames(count: number, dtMs = 1000 / 60): void {
    for (let i = 0; i < count; i++) {
      nowMs += dtMs;
      const current = rafQueue.shift();
      if (current) {
        current.cb(nowMs);
      }
    }
  }

  beforeEach(() => {
    motionInstances.length = 0;
    rafQueue = [];
    nextRafId = 1;
    nowMs = 1000;
    mockCtx = createMockCanvas2D();

    document.body.innerHTML = `
      <div id="app">
        <div class="pop-stage">
          <canvas id="game-canvas"></canvas>
          <div id="ui-overlay"></div>
        </div>
      </div>
      <video id="webcam-video" playsinline muted style="display:none"></video>
    `;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 864,
      bottom: 608,
      width: 864,
      height: 608,
      toJSON: () => ({}),
    });

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('surfaces camera errors once without re-opening and resumes WAITING_DISTANCE -> READY_SERVE on switch to touch', () => {
    const showErrorSpy = vi.spyOn(MenuUI.prototype, 'showCameraError');
    cleanup = startApp();

    const overlay = document.getElementById('ui-overlay')!;
    overlay.querySelector<HTMLButtonElement>('[data-control="motion"]')?.click();
    overlay.querySelector<HTMLButtonElement>('[data-action="start-game"]')?.click();

    expect(motionInstances).toHaveLength(1);
    const motion = motionInstances[0];
    motion.getError.mockReturnValue('카메라 권한이 거부되었습니다. (Camera permission denied)');

    // Step initial frames; error modal should open exactly once despite repeated ticks
    stepFrames(6, 20);
    expect(showErrorSpy).toHaveBeenCalledTimes(1);
    expect(overlay.textContent).toContain('Camera permission denied');
    expect(overlay.querySelector('[data-action="switch-to-touch"]')).not.toBeNull();

    // Switching to touch disposes MotionInputProvider, closes error modal, and resumes READY_SERVE -> PLAYING
    overlay.querySelector<HTMLButtonElement>('[data-action="switch-to-touch"]')?.click();
    expect(motion.dispose).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector('[data-action="switch-to-touch"]')).toBeNull();

    // Verify rendered canvas enters READY_SERVE ('READY!'/'GO!') and transitions to PLAYING
    const renderedTexts = () =>
      (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

    stepFrames(2, 20);
    expect(renderedTexts()).toContain('READY!');

    // Advance past SERVE_READY_DURATION (0.7s) while P1 moves aside so ball can drop
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    stepFrames(90, 20);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));

    expect(renderedTexts()).toContain('NPC POINT!');
  });

  it('reaches MATCH_OVER and resets scores cleanly on REMATCH!', () => {
    cleanup = startApp();

    const overlay = document.getElementById('ui-overlay')!;
    overlay.querySelector<HTMLButtonElement>('[data-score="5"]')?.click();
    overlay.querySelector<HTMLButtonElement>('[data-action="start-game"]')?.click();

    // Keep P1 tucked against the left wall so NPC scores 5 points cleanly
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    for (let i = 0; i < 1500; i++) {
      stepFrames(1, 20);
      if (overlay.querySelector('[data-action="rematch"]')) {
        break;
      }
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }));

    expect(overlay.textContent).toContain('NPC WINS!');
    expect(overlay.textContent).toContain('P1 0 : 5 NPC');

    const rematchBtn = overlay.querySelector<HTMLButtonElement>('[data-action="rematch"]')!;
    expect(rematchBtn).not.toBeNull();
    rematchBtn.click();

    // Modal should close and next rendered frame should display reset 0-0 scoreboard
    expect(overlay.querySelector('[data-action="rematch"]')).toBeNull();
    (mockCtx.fillText as ReturnType<typeof vi.fn>).mockClear();
    stepFrames(2, 20);

    const texts = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain('P1  0');
    expect(texts).toContain('NPC  0');
    expect(texts).toContain('READY!');
  });
});
