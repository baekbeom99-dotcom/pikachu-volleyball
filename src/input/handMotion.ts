import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  HandMotionOverlayData,
  HandMotionSideStatus,
  OpponentMode,
  PlayerInput,
} from '../core/types';
import {
  createSingleHandTrackerState,
  evaluateSingleHandMotion,
  selectSingleHandBySide,
  stepSmoothDirectionalInput,
  type SingleHandTrackerState,
} from './handMotionMath';
import type { NormalizedLandmark } from './motionMath';
import { idleInput, type InputProvider } from './types';

const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 360;

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface HandMotionInputOptions {
  videoEl: HTMLVideoElement;
  opponentMode: OpponentMode;
}

function createInitialStatus(side: 'left' | 'right'): HandMotionSideStatus {
  return {
    side,
    detected: false,
    moveX: 0,
    normX: 0.5,
    normY: 0.5,
    jumpActive: false,
  };
}

function createOffscreenCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  return { canvas, ctx };
}

function drawMirroredAspectFit(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  destWidth: number,
  destHeight: number,
): void {
  const srcWidth = video.videoWidth;
  const srcHeight = video.videoHeight;
  if (srcWidth <= 0 || srcHeight <= 0) {
    return;
  }

  const scale = Math.max(destWidth / srcWidth, destHeight / srcHeight);
  const drawWidth = srcWidth * scale;
  const drawHeight = srcHeight * scale;
  const dx = (destWidth - drawWidth) * 0.5;
  const dy = (destHeight - drawHeight) * 0.5;

  ctx.save();
  ctx.clearRect(0, 0, destWidth, destHeight);
  ctx.translate(destWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, dx, dy, drawWidth, drawHeight);
  ctx.restore();
}

function formatHandMotionError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용하거나 터치패드 모드를 사용해 주세요. (Camera permission denied)';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '웹캠을 찾을 수 없습니다. 카메라 연결을 확인하거나 터치패드 모드를 사용해 주세요. (No camera device found)';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '다른 앱에서 카메라를 사용 중입니다. 사용 중인 앱을 닫고 다시 시도해 주세요. (Camera is in use)';
  }
  if (name === 'OverconstrainedError') {
    return '지원되는 카메라 해상도를 찾을 수 없습니다. (Unsupported camera constraints)';
  }
  return `핸드 모션 초기화에 실패했습니다. (${message || 'Hand motion initialization failed'})`;
}

/**
 * Webcam provider for Hand Motion mode ('hand'):
 * Tracks ONE hand per active player via HandLandmarker and converts directional hand
 * movement (left/right velocity & upward motion) smoothly into avatar input.
 */
export class HandMotionInputProvider implements InputProvider {
  private readonly videoEl: HTMLVideoElement;
  private opponentMode: OpponentMode;

  private stream: MediaStream | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private initPromise: Promise<void> | null = null;

  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;

  private leftTracker: SingleHandTrackerState = createSingleHandTrackerState();
  private rightTracker: SingleHandTrackerState = createSingleHandTrackerState();

  private desiredMoves: [number, number] = [0, 0];
  private cachedStatuses: [HandMotionSideStatus, HandMotionSideStatus] = [
    createInitialStatus('left'),
    createInitialStatus('right'),
  ];

  private lastVideoTime = -1;
  private lastTimestampMs = -1;
  private lastDetectMs = -1;
  private initError: string | null = null;
  private initialized = false;
  private disposed = false;

  constructor(options: HandMotionInputOptions) {
    this.videoEl = options.videoEl;
    this.opponentMode = options.opponentMode;
  }

  private async createHandLandmarker(fileset: VisionFileset): Promise<HandLandmarker> {
    const baseConfig = {
      runningMode: 'VIDEO' as const,
      numHands: this.opponentMode === '2p' ? 2 : 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      return await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
          delegate: 'GPU',
        },
        ...baseConfig,
      });
    } catch {
      return await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
        },
        ...baseConfig,
      });
    }
  }

  /** Requests webcam access and loads single-hand HandLandmarker. */
  async init(): Promise<void> {
    if (this.disposed || this.initialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.runInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async runInit(): Promise<void> {
    this.initError = null;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.initError =
        '이 브라우저는 웹캠을 지원하지 않습니다. 터치패드 모드를 사용해 주세요. (Webcam API unavailable)';
      return;
    }

    const preview = createOffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    if (!preview) {
      this.initError =
        '캔버스 컨텍스트를 생성할 수 없습니다. (Canvas 2D context unavailable)';
      return;
    }

    this.previewCanvas = preview.canvas;
    this.previewCtx = preview.ctx;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (this.disposed) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      this.stream = stream;
      this.videoEl.srcObject = stream;
      this.videoEl.playsInline = true;
      this.videoEl.muted = true;
      await this.videoEl.play();

      if (this.disposed) {
        this.stopMediaTracks();
        return;
      }

      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
      if (this.disposed) {
        this.stopMediaTracks();
        return;
      }

      const handLandmarker = await this.createHandLandmarker(fileset);
      if (this.disposed) {
        handLandmarker.close();
        this.stopMediaTracks();
        return;
      }

      this.handLandmarker = handLandmarker;
      this.initialized = true;
    } catch (err) {
      this.initError = formatHandMotionError(err);
      this.closeLandmarker();
      this.stopMediaTracks();
    }
  }

  /** Switches between 1P ('npc') and 2P ('2p') mode, updating tracked hand limit. */
  setOpponentMode(mode: OpponentMode): void {
    if (this.opponentMode === mode) {
      return;
    }
    this.opponentMode = mode;
    if (this.handLandmarker && typeof this.handLandmarker.setOptions === 'function') {
      void this.handLandmarker
        .setOptions({ numHands: mode === '2p' ? 2 : 1 })
        .catch(() => {});
    }
  }

  isReady(): boolean {
    return this.initialized && this.initError === null;
  }

  getError(): string | null {
    return this.initError;
  }

  getPreviewCanvas(): HTMLCanvasElement | null {
    return this.initialized ? this.previewCanvas : null;
  }

  getOverlayData(): HandMotionOverlayData {
    return {
      isReady: this.isReady(),
      error: this.initError,
      statuses: [
        { ...this.cachedStatuses[0] },
        { ...this.cachedStatuses[1] },
      ],
    };
  }

  getInputs(dt: number): [PlayerInput, PlayerInput] {
    if (
      this.disposed ||
      !this.initialized ||
      !this.handLandmarker ||
      !this.previewCanvas ||
      !this.previewCtx ||
      this.videoEl.readyState < 2 ||
      this.videoEl.videoWidth <= 0 ||
      this.videoEl.videoHeight <= 0
    ) {
      return [idleInput(), idleInput()];
    }

    const currentVideoTime = this.videoEl.currentTime;
    if (currentVideoTime !== this.lastVideoTime) {
      this.lastVideoTime = currentVideoTime;
      drawMirroredAspectFit(
        this.previewCtx,
        this.videoEl,
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
      );

      const nowMs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const timestampMs =
        nowMs > this.lastTimestampMs ? nowMs : this.lastTimestampMs + 1;
      this.lastTimestampMs = timestampMs;

      this.detectSingleHands(timestampMs);
    }

    const smoothP1 = stepSmoothDirectionalInput(this.leftTracker, this.desiredMoves[0], dt);
    this.cachedStatuses[0].moveX = smoothP1.moveX;
    this.cachedStatuses[0].jumpActive = smoothP1.jump;
    const p1Input: PlayerInput = {
      moveX: smoothP1.moveX,
      targetX: null,
      jump: smoothP1.jump,
    };

    if (this.opponentMode === '2p') {
      const smoothP2 = stepSmoothDirectionalInput(this.rightTracker, this.desiredMoves[1], dt);
      this.cachedStatuses[1].moveX = smoothP2.moveX;
      this.cachedStatuses[1].jumpActive = smoothP2.jump;
      const p2Input: PlayerInput = {
        moveX: smoothP2.moveX,
        targetX: null,
        jump: smoothP2.jump,
      };
      return [p1Input, p2Input];
    }

    return [p1Input, idleInput()];
  }

  private detectSingleHands(timestampMs: number): void {
    if (!this.handLandmarker || !this.previewCanvas) {
      return;
    }

    const frameDt =
      this.lastDetectMs >= 0
        ? Math.max(1 / 120, Math.min(0.25, (timestampMs - this.lastDetectMs) / 1000))
        : 1 / 30;
    this.lastDetectMs = timestampMs;

    const result = this.handLandmarker.detectForVideo(this.previewCanvas, timestampMs);
    const allHands = (result.landmarks ?? []) as NormalizedLandmark[][];
    const selected = selectSingleHandBySide(
      allHands,
      this.opponentMode,
      this.leftTracker.smoothedX,
      this.rightTracker.smoothedX !== null ? 0.5 + this.rightTracker.smoothedX * 0.5 : null,
    );

    const leftEval = evaluateSingleHandMotion(
      selected.left,
      this.leftTracker,
      frameDt,
      this.opponentMode === '2p' ? { minX: 0, maxX: 0.5 } : { minX: 0, maxX: 1 },
    );

    this.desiredMoves[0] = leftEval.moveX;
    this.cachedStatuses[0] = {
      side: 'left',
      detected: leftEval.detected,
      moveX: this.cachedStatuses[0].moveX,
      normX: leftEval.normX,
      normY: leftEval.normY,
      jumpActive: leftEval.jump,
    };

    if (this.opponentMode === '2p') {
      const rightEval = evaluateSingleHandMotion(
        selected.right,
        this.rightTracker,
        frameDt,
        { minX: 0.5, maxX: 1 },
      );
      this.desiredMoves[1] = rightEval.moveX;
      this.cachedStatuses[1] = {
        side: 'right',
        detected: rightEval.detected,
        moveX: this.cachedStatuses[1].moveX,
        normX: rightEval.normX,
        normY: rightEval.normY,
        jumpActive: rightEval.jump,
      };
    } else {
      this.desiredMoves[1] = 0;
      this.cachedStatuses[1] = createInitialStatus('right');
    }
  }

  private closeLandmarker(): void {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }

  private stopMediaTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl.srcObject) {
      this.videoEl.srcObject = null;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.initialized = false;
    this.closeLandmarker();
    this.stopMediaTracks();
  }
}
