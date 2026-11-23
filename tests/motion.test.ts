// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORLD } from '../src/core/constants';
import type { NormalizedLandmark } from '../src/input/motionMath';

const { forVisionTasksMock, createFromOptionsMock } = vi.hoisted(() => ({
  forVisionTasksMock: vi.fn(),
  createFromOptionsMock: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: forVisionTasksMock,
  },
  PoseLandmarker: {
    createFromOptions: createFromOptionsMock,
  },
}));

import { MotionInputProvider } from '../src/input/motion';

interface FakeCtx {
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

function makeOkPose(centerX = 0.5): NormalizedLandmark[] {
  const landmarks: NormalizedLandmark[] = Array.from({ length: 25 }, () => ({
    x: centerX,
    y: 0.45,
    visibility: 0,
  }));
  landmarks[0] = { x: centerX, y: 0.2, visibility: 0.99 };
  landmarks[11] = { x: centerX - 0.1, y: 0.3, visibility: 0.99 };
  landmarks[12] = { x: centerX + 0.1, y: 0.3, visibility: 0.99 };
  landmarks[23] = { x: centerX - 0.1, y: 0.6, visibility: 0.99 };
  landmarks[24] = { x: centerX + 0.1, y: 0.6, visibility: 0.99 };
  return landmarks;
}

function createMockVideo(width = 640, height = 480): HTMLVideoElement {
  return {
    srcObject: null,
    playsInline: false,
    muted: false,
    readyState: 4,
    videoWidth: width,
    videoHeight: height,
    currentTime: 0,
    play: vi.fn().mockResolvedValue(undefined),
  } as unknown as HTMLVideoElement;
}

function createFakeStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function createFakeLandmarker(landmarks: NormalizedLandmark[] = makeOkPose()) {
  return {
    detectForVideo: vi.fn(() => ({ landmarks: [landmarks] })),
    close: vi.fn(),
  };
}

describe('MotionInputProvider', () => {
  let contexts: FakeCtx[] = [];
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    contexts = [];
    forVisionTasksMock.mockReset();
    createFromOptionsMock.mockReset();
    forVisionTasksMock.mockResolvedValue({ wasmLoaderPath: 'mock' });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const ctx: FakeCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        translate: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn(),
      };
      contexts.push(ctx);
      return ctx as unknown as CanvasRenderingContext2D;
    });

    originalMediaDevices = navigator.mediaDevices;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  function setGetUserMedia(fn: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: fn },
    });
  }

  it('reports descriptive error when navigator.mediaDevices is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });

    const provider = new MotionInputProvider({
      videoEl: createMockVideo(),
      opponentMode: 'npc',
    });
    await provider.init();

    expect(provider.getError()).toContain('Webcam API unavailable');
    expect(provider.isMotionReady()).toBe(false);
    expect(provider.getOverlayData().error).toBe(provider.getError());
    provider.dispose();
  });

  it('stores user-friendly Korean/English errors on NotAllowedError and NotFoundError', async () => {
    const deniedErr = new Error('Permission denied');
    deniedErr.name = 'NotAllowedError';
    setGetUserMedia(vi.fn().mockRejectedValue(deniedErr));

    const deniedProvider = new MotionInputProvider({
      videoEl: createMockVideo(),
      opponentMode: 'npc',
    });
    await deniedProvider.init();
    expect(deniedProvider.getError()).toContain('카메라 권한');
    expect(deniedProvider.getError()).toContain('Camera permission denied');
    deniedProvider.dispose();

    const notFoundErr = new Error('Requested device not found');
    notFoundErr.name = 'NotFoundError';
    setGetUserMedia(vi.fn().mockRejectedValue(notFoundErr));

    const notFoundProvider = new MotionInputProvider({
      videoEl: createMockVideo(),
      opponentMode: 'npc',
    });
    await notFoundProvider.init();
    expect(notFoundProvider.getError()).toContain('웹캠을 찾을 수 없습니다');
    expect(notFoundProvider.getError()).toContain('No camera device found');
    notFoundProvider.dispose();
  });

  it('honors activeSide: right in npc mode and projects targetX onto P1 court', async () => {
    const { stream } = createFakeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));

    const rightLandmarker = createFakeLandmarker(makeOkPose(0.5));
    createFromOptionsMock.mockResolvedValue(rightLandmarker);

    const videoEl = createMockVideo(640, 480);
    const provider = new MotionInputProvider({
      videoEl,
      opponentMode: 'npc',
      activeSide: 'right',
    });
    await provider.init();

    // Only one landmarker should be created for npc mode
    expect(createFromOptionsMock).toHaveBeenCalledTimes(1);

    // Advance video frames over > 0.5s to satisfy distance gate OK hold
    videoEl.currentTime = 0.25;
    provider.getInputs(0.25);
    expect(provider.isMotionReady()).toBe(false);

    videoEl.currentTime = 0.55;
    const [p1, p2] = provider.getInputs(0.3);

    expect(provider.isMotionReady()).toBe(true);
    expect(p2).toEqual({ moveX: 0, targetX: null, jump: false });
    expect(p1.targetX).not.toBeNull();
    // Projected onto P1's left half-court around center (~212)
    expect(p1.targetX!).toBeGreaterThanOrEqual(WORLD.PLAYER_RADIUS);
    expect(p1.targetX!).toBeLessThanOrEqual(WORLD.NET_LEFT - WORLD.PLAYER_RADIUS);
    expect(p1.targetX!).toBeCloseTo(212, 0);

    const overlay = provider.getOverlayData();
    expect(overlay.isReady).toBe(true);
    expect(overlay.activeSide).toBe('right');
    expect(overlay.statuses[0].gateStatus).toBe('NO_PERSON');
    expect(overlay.statuses[1].gateStatus).toBe('OK');

    provider.dispose();
  });

  it('clears inactive left cachedInputs slot when activeSide is right and switching from 2p to npc', async () => {
    const { stream } = createFakeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));

    const rightLandmarker = createFakeLandmarker(makeOkPose(0.5));
    const leftLandmarker = createFakeLandmarker(makeOkPose(0.8));
    createFromOptionsMock
      .mockResolvedValueOnce(rightLandmarker)
      .mockResolvedValueOnce(leftLandmarker);

    const videoEl = createMockVideo(640, 480);
    const provider = new MotionInputProvider({
      videoEl,
      opponentMode: '2p',
      activeSide: 'right',
    });
    await provider.init();

    videoEl.currentTime = 0.25;
    const [p1In2p] = provider.getInputs(0.25);
    expect(p1In2p.targetX).not.toBeNull();

    // Switching to npc without advancing videoEl.currentTime must not leak old left-side input
    provider.setOpponentMode('npc');
    const [p1AfterSwitch, p2AfterSwitch] = provider.getInputs(0.016);
    expect(p1AfterSwitch).toEqual({ moveX: 0, targetX: null, jump: false });
    expect(p2AfterSwitch).toEqual({ moveX: 0, targetX: null, jump: false });

    provider.dispose();
  });

  it('closes primary landmarker and stops stream tracks if secondary landmarker fails during 2p init', async () => {
    const { stream, track } = createFakeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));

    const firstLandmarker = createFakeLandmarker();
    createFromOptionsMock
      .mockResolvedValueOnce(firstLandmarker)
      .mockRejectedValueOnce(new Error('GPU/CPU init failed'))
      .mockRejectedValueOnce(new Error('Fallback init failed'));

    const provider = new MotionInputProvider({
      videoEl: createMockVideo(),
      opponentMode: '2p',
    });
    await provider.init();

    expect(provider.getError()).not.toBeNull();
    expect(firstLandmarker.close).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(provider.isMotionReady()).toBe(false);
    provider.dispose();
  });

  it('recovers cleanly to npc mode if upgrading to 2p fails lazily', async () => {
    const { stream } = createFakeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));

    const leftLandmarker = createFakeLandmarker(makeOkPose(0.5));
    createFromOptionsMock
      .mockResolvedValueOnce(leftLandmarker)
      .mockRejectedValueOnce(new Error('2P model load failed'))
      .mockRejectedValueOnce(new Error('2P fallback load failed'));

    const videoEl = createMockVideo();
    const provider = new MotionInputProvider({
      videoEl,
      opponentMode: 'npc',
    });
    await provider.init();
    expect(provider.getError()).toBeNull();

    // Upgrade to 2p triggers lazy secondary landmarker init that fails
    provider.setOpponentMode('2p');
    await vi.waitFor(() => {
      expect(provider.getError()).not.toBeNull();
    });
    expect(provider.isMotionReady()).toBe(false);

    // Switching back to npc clears secondary error and resumes 1P motion tracking
    provider.setOpponentMode('npc');
    expect(provider.getError()).toBeNull();

    videoEl.currentTime = 0.3;
    provider.getInputs(0.3);
    videoEl.currentTime = 0.6;
    const [p1] = provider.getInputs(0.3);
    expect(provider.isMotionReady()).toBe(true);
    expect(p1.targetX).toBeCloseTo(212, 0);

    provider.dispose();
  });

  it('uses 480x360 aspect-preserving preview canvas, requires both OK in 2p, and disposes cleanly', async () => {
    const { stream, track } = createFakeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));

    const leftLandmarker = createFakeLandmarker(makeOkPose(0.5));
    const rightLandmarker = createFakeLandmarker(makeOkPose(0.5));
    createFromOptionsMock
      .mockResolvedValueOnce(leftLandmarker)
      .mockResolvedValueOnce(rightLandmarker);

    // 16:9 video feed to verify aspect-preserving cover fit (640x360 drawn at dx=-80)
    const videoEl = createMockVideo(1280, 720);
    const provider = new MotionInputProvider({
      videoEl,
      opponentMode: '2p',
    });
    await provider.init();

    const preview = provider.getPreviewCanvas();
    expect(preview).not.toBeNull();
    expect(preview!.width).toBe(480);
    expect(preview!.height).toBe(360);

    // Only left reaches OK if right detects no person initially
    rightLandmarker.detectForVideo.mockReturnValueOnce({ landmarks: [] });
    videoEl.currentTime = 0.3;
    provider.getInputs(0.3);

    // Verify previewCtx drew mirrored 16:9 image with aspect-preserving cover fit (640x360 at dx=-80, dy=0)
    const previewCtx = contexts[0];
    expect(previewCtx.scale).toHaveBeenCalledWith(-1, 1);
    expect(previewCtx.drawImage).toHaveBeenCalledWith(videoEl, -80, 0, 640, 360);

    videoEl.currentTime = 0.6;
    provider.getInputs(0.3);
    expect(provider.isMotionReady()).toBe(false);

    // Once right also holds OK for >= 0.5s, 2p is ready
    videoEl.currentTime = 0.9;
    provider.getInputs(0.3);
    expect(provider.isMotionReady()).toBe(true);

    provider.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(leftLandmarker.close).toHaveBeenCalledTimes(1);
    expect(rightLandmarker.close).toHaveBeenCalledTimes(1);
    expect(provider.getPreviewCanvas()).toBeNull();
  });
});
