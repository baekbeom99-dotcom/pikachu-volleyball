import { afterEach, describe, expect, it, vi } from 'vitest';
import { PopArtAudio } from '../src/audio/sound';
import { WORLD } from '../src/core/constants';
import { createGameState } from '../src/core/rules';
import { EffectsManager } from '../src/render/effects';
import { PopArtSceneRenderer } from '../src/render/sceneRenderer';

function createMockCanvas2D(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
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

describe('EffectsManager', () => {
  it('spawns comic bursts and shake from consumePhysicsEvents and decays over time', () => {
    const effects = new EffectsManager();
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'READY_SERVE',
    });

    state.lastEvents = {
      spikedBy: 'p1',
      slidBy: 'p2',
      volleyBy: null,
      netHit: true,
      wallHit: false,
      ballHitFloorSide: 'right',
    };

    effects.consumePhysicsEvents(state);
    const ctx = createMockCanvas2D();
    effects.render(ctx);

    const renderedTexts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(renderedTexts).toContain('SMASH!');
    expect(renderedTexts).toContain('DIVE!');
    expect(renderedTexts).toContain('NET!');
    expect(renderedTexts).toContain('POINT!');

    // Shake active immediately after spike/score
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const initialShake = effects.getShakeOffset();
    expect(Math.abs(initialShake.x)).toBeGreaterThan(0);

    // After 0.12s (> 0.1s shake duration), shake decays to 0
    effects.update(0.12);
    expect(effects.getShakeOffset()).toEqual({ x: 0, y: 0 });

    // Bursts still visible at 0.3s, expired after 0.65s total
    effects.update(0.2);
    const midCtx = createMockCanvas2D();
    effects.render(midCtx);
    expect((midCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    effects.update(0.4);
    const endCtx = createMockCanvas2D();
    effects.render(endCtx);
    expect(endCtx.fillText).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('spawns POW! on grounded volley when not spiked', () => {
    const effects = new EffectsManager();
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'READY_SERVE',
    });
    state.lastEvents = {
      spikedBy: null,
      slidBy: null,
      volleyBy: 'p1',
      netHit: false,
      wallHit: false,
      ballHitFloorSide: null,
    };

    effects.consumePhysicsEvents(state);
    const ctx = createMockCanvas2D();
    effects.render(ctx);
    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain('POW!');
    expect(texts).not.toContain('SMASH!');
  });
});

describe('PopArtSceneRenderer', () => {
  it('renders touch mode with CSS-to-world scaled VisualJoysticks and guards zero canvas dimensions', () => {
    const renderer = new PopArtSceneRenderer({ preloadSprites: false });
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: '2p',
      initialPhase: 'READY_SERVE',
    });
    state.phase = 'PLAYING';

    const ctx = createMockCanvas2D();
    renderer.render(ctx, state, {
      joysticks: [
        {
          playerId: 'p1',
          originX: 100,
          originY: 200,
          knobX: 125,
          knobY: 165,
          maxRadius: 56,
          normX: 0.45,
          normY: -0.62,
          jumpActive: true,
        },
      ],
      canvasCssWidth: 432,
      canvasCssHeight: 304,
      motionOverlay: null,
      motionPreviewCanvas: null,
      showPlaceholders: true,
    });

    // 100, 200 in 432x304 CSS maps to 200, 400 in 864x608 world
    const arcCalls = (ctx.arc as ReturnType<typeof vi.fn>).mock.calls;
    expect(arcCalls.some(([x, y]) => Math.abs(x - 200) < 0.01 && Math.abs(y - 400) < 0.01)).toBe(true);
    const texts = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(texts).toContain('JUMP');
    expect(texts).toContain('P1  0');
    expect(texts).toContain('P2  0');

    // Zero CSS width must not produce NaN transforms or joystick arcs
    const zeroCtx = createMockCanvas2D();
    renderer.render(zeroCtx, state, {
      joysticks: [
        {
          playerId: 'p1',
          originX: 100,
          originY: 200,
          knobX: 100,
          knobY: 200,
          maxRadius: 56,
          normX: 0,
          normY: 0,
          jumpActive: false,
        },
      ],
      canvasCssWidth: 0,
      canvasCssHeight: 304,
      motionOverlay: null,
      motionPreviewCanvas: null,
      showPlaceholders: true,
    });
    const zeroTexts = (zeroCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(zeroTexts).not.toContain('JUMP');
  });

  it('renders motion mode WAITING_DISTANCE warnings and PLAYING preview without errors', () => {
    const renderer = new PopArtSceneRenderer({ preloadSprites: false });
    const state = createGameState({
      controlMode: 'motion',
      opponentMode: '2p',
      initialPhase: 'WAITING_DISTANCE',
    });
    const fakePreview = { width: 480, height: 360 } as unknown as HTMLCanvasElement;

    const waitingCtx = createMockCanvas2D();
    renderer.render(waitingCtx, state, {
      joysticks: [],
      canvasCssWidth: WORLD.WIDTH,
      canvasCssHeight: WORLD.HEIGHT,
      motionOverlay: {
        statuses: [
          {
            side: 'left',
            detected: true,
            widthRatio: 0.72,
            heightRatio: 0.65,
            gateStatus: 'TOO_CLOSE',
          },
          {
            side: 'right',
            detected: false,
            widthRatio: 0,
            heightRatio: 0,
            gateStatus: 'NO_PERSON',
          },
        ],
        isReady: false,
        error: null,
      },
      motionPreviewCanvas: fakePreview,
      showPlaceholders: true,
    });

    expect(waitingCtx.drawImage).toHaveBeenCalledWith(
      fakePreview,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    const waitingTexts = (waitingCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(waitingTexts).toContain('STEP BACK!');
    expect(waitingTexts).toContain('멀리 떨어지세요');
    expect(waitingTexts).toContain('STEP IN!');
    expect(waitingTexts).toContain('카메라 안으로 들어오세요');

    // PLAYING mode should hide WAITING_DISTANCE banners
    state.phase = 'PLAYING';
    const playingCtx = createMockCanvas2D();
    renderer.render(playingCtx, state, {
      joysticks: [],
      canvasCssWidth: WORLD.WIDTH,
      canvasCssHeight: WORLD.HEIGHT,
      motionOverlay: {
        statuses: [
          { side: 'left', detected: true, widthRatio: 0.35, heightRatio: 0.55, gateStatus: 'OK' },
          { side: 'right', detected: true, widthRatio: 0.35, heightRatio: 0.55, gateStatus: 'OK' },
        ],
        isReady: true,
        error: null,
      },
      motionPreviewCanvas: fakePreview,
      showPlaceholders: true,
    });
    const playingTexts = (playingCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(playingTexts).not.toContain('STEP BACK!');
    expect(playingTexts).not.toContain('STEP IN!');
  });
});

describe('PopArtAudio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('safely no-ops in non-DOM environments and tracks mute state', () => {
    const audio = new PopArtAudio();
    expect(audio.isMuted()).toBe(false);
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);

    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'READY_SERVE',
    });
    expect(() => {
      audio.unlock();
      audio.playJump();
      audio.playSpike();
      audio.playWin();
      audio.consumeEvents(state, 'PLAYING');
    }).not.toThrow();
  });

  it('does not queue sounds while AudioContext is suspended and plays once unlocked/running', () => {
    const createdOscillators: Array<{ start: ReturnType<typeof vi.fn> }> = [];
    const createdBuffers: Array<{ start: ReturnType<typeof vi.fn> }> = [];
    const mockCtx = {
      state: 'suspended' as AudioContextState,
      currentTime: 10,
      sampleRate: 44100,
      destination: {},
      resume: vi.fn(async () => {
        mockCtx.state = 'running';
      }),
      createOscillator: vi.fn(() => {
        const osc = {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        createdOscillators.push(osc);
        return osc;
      }),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      })),
      createBuffer: vi.fn(() => ({
        getChannelData: () => new Float32Array(256),
      })),
      createBufferSource: vi.fn(() => {
        const src = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        createdBuffers.push(src);
        return src;
      }),
      createBiquadFilter: vi.fn(() => ({
        type: 'bandpass',
        frequency: { value: 0 },
        Q: { value: 0 },
        connect: vi.fn(),
      })),
    };

    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => mockCtx),
    });

    const audio = new PopArtAudio();
    // While suspended before unlock(), readyContext() must drop SFX instead of queuing at t=0
    audio.playSpike();
    expect(createdOscillators).toHaveLength(0);
    expect(createdBuffers).toHaveLength(0);

    // Unlock resumes the context
    audio.unlock();
    expect(mockCtx.resume).toHaveBeenCalledTimes(1);
    expect(mockCtx.state).toBe('running');

    // Now consumeEvents triggers jump, spike, dive, net, and score SFX
    const state = createGameState({
      controlMode: 'touch',
      opponentMode: 'npc',
      initialPhase: 'READY_SERVE',
    });
    state.phase = 'POINT_SCORED';
    state.players[0].isGrounded = false;
    state.players[0].vy = -500;
    state.lastEvents = {
      spikedBy: 'p1',
      slidBy: 'p2',
      volleyBy: null,
      netHit: true,
      wallHit: false,
      ballHitFloorSide: 'right',
    };

    audio.consumeEvents(state, 'PLAYING');
    expect(createdOscillators.length).toBeGreaterThanOrEqual(5);
    expect(createdBuffers.length).toBeGreaterThanOrEqual(2);

    // Muting blocks further SFX
    const countBeforeMute = createdOscillators.length;
    audio.setMuted(true);
    audio.playWin();
    expect(createdOscillators.length).toBe(countBeforeMute);
  });
});
