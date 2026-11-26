import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import type {
  HumanHandVisual,
  HumanOverlayData,
  OpponentMode,
  PlayerInput,
} from '../core/types';
import {
  advanceSideHandsTimers,
  createSideHandsTrackerState,
  evaluateArHands,
  partitionHandsForArPlayers,
  type SideHandsTrackerState,
} from './handMath';
import type { NormalizedLandmark } from './motionMath';
import { idleInput, type InputProvider } from './types';

const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const HALF_COURT_W = 212;
const HALF_COURT_H = 230;
const TWO_PLAYER_WORK_W = HALF_COURT_W * 2;

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface HumanInputOptions {
  videoEl: HTMLVideoElement;
  opponentMode: OpponentMode;
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d');
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function formatHumanError(err: unknown): string {
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
  return `사람/손 인식 초기화에 실패했습니다. (${message || 'Human mode initialization failed'})`;
}

/**
 * 1:1 AR webcam provider for Human mode:
 * - Removes background via MediaPipe Selfie ImageSegmenter without shrinking or cropping onto an avatar.
 * - Tracks hands via HandLandmarker so players strike the volleyball directly with their hands.
 */
export class HumanInputProvider implements InputProvider {
  private readonly videoEl: HTMLVideoElement;
  private opponentMode: OpponentMode;

  private stream: MediaStream | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private imageSegmenter: ImageSegmenter | null = null;
  private segmenterLabels: string[] = [];
  private initPromise: Promise<void> | null = null;

  private workCanvas: HTMLCanvasElement | null = null;
  private workCtx: CanvasRenderingContext2D | null = null;
  private maskedCanvas: HTMLCanvasElement | null = null;
  private maskedCtx: CanvasRenderingContext2D | null = null;
  private cutoutP1Canvas: HTMLCanvasElement | null = null;
  private cutoutP1Ctx: CanvasRenderingContext2D | null = null;
  private cutoutP2Canvas: HTMLCanvasElement | null = null;
  private cutoutP2Ctx: CanvasRenderingContext2D | null = null;

  private leftTracker: SideHandsTrackerState = createSideHandsTrackerState();
  private rightTracker: SideHandsTrackerState = createSideHandsTrackerState();

  private cachedInputs: [PlayerInput, PlayerInput] = [
    { ...idleInput(), hands: [] },
    idleInput(),
  ];
  private cachedHandVisuals: HumanHandVisual[] = [];

  private lastVideoTime = -1;
  private lastTimestampMs = -1;
  private pendingEvalDt = 0;
  private initError: string | null = null;
  private initialized = false;
  private disposed = false;

  constructor(options: HumanInputOptions) {
    this.videoEl = options.videoEl;
    this.opponentMode = options.opponentMode;
  }

  private getWorkWidth(): number {
    return this.opponentMode === '2p' ? TWO_PLAYER_WORK_W : HALF_COURT_W;
  }

  private syncWorkBufferSizes(): void {
    const targetW = this.getWorkWidth();
    if (this.workCanvas && this.workCanvas.width !== targetW) {
      this.workCanvas.width = targetW;
      this.workCanvas.height = HALF_COURT_H;
    }
    if (this.maskedCanvas && this.maskedCanvas.width !== targetW) {
      this.maskedCanvas.width = targetW;
      this.maskedCanvas.height = HALF_COURT_H;
    }
  }

  private async createHandLandmarker(fileset: VisionFileset): Promise<HandLandmarker> {
    const baseConfig = {
      runningMode: 'VIDEO' as const,
      numHands: this.opponentMode === '2p' ? 4 : 2,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
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

  private async createImageSegmenter(fileset: VisionFileset): Promise<ImageSegmenter> {
    const baseConfig = {
      runningMode: 'VIDEO' as const,
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    };

    try {
      return await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTER_MODEL_URL,
          delegate: 'GPU',
        },
        ...baseConfig,
      });
    } catch {
      return await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: SEGMENTER_MODEL_URL,
        },
        ...baseConfig,
      });
    }
  }

  /** Requests webcam access and loads HandLandmarker + Selfie ImageSegmenter. */
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

    const workW = this.getWorkWidth();
    const work = createOffscreenCanvas(workW, HALF_COURT_H);
    const masked = createOffscreenCanvas(workW, HALF_COURT_H);
    const cutout1 = createOffscreenCanvas(HALF_COURT_W, HALF_COURT_H);
    const cutout2 = createOffscreenCanvas(HALF_COURT_W, HALF_COURT_H);
    if (!work || !masked || !cutout1 || !cutout2) {
      this.initError =
        '캔버스 컨텍스트를 생성할 수 없습니다. (Canvas 2D context unavailable)';
      return;
    }

    this.workCanvas = work.canvas;
    this.workCtx = work.ctx;
    this.maskedCanvas = masked.canvas;
    this.maskedCtx = masked.ctx;
    this.cutoutP1Canvas = cutout1.canvas;
    this.cutoutP1Ctx = cutout1.ctx;
    this.cutoutP2Canvas = cutout2.canvas;
    this.cutoutP2Ctx = cutout2.ctx;

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

      const [handLandmarker, imageSegmenter] = await Promise.all([
        this.createHandLandmarker(fileset),
        this.createImageSegmenter(fileset),
      ]);

      if (this.disposed) {
        handLandmarker.close();
        imageSegmenter.close();
        this.stopMediaTracks();
        return;
      }

      this.handLandmarker = handLandmarker;
      this.imageSegmenter = imageSegmenter;
      this.segmenterLabels =
        typeof imageSegmenter.getLabels === 'function' ? imageSegmenter.getLabels() : [];
      this.initialized = true;
    } catch (err) {
      this.initError = formatHumanError(err);
      this.closeVisionTasks();
      this.stopMediaTracks();
    }
  }

  /** Switches between 1P ('npc') and 2P ('2p') mode cleanly. */
  setOpponentMode(mode: OpponentMode): void {
    if (this.opponentMode === mode) {
      return;
    }
    this.opponentMode = mode;
    this.syncWorkBufferSizes();
    if (this.handLandmarker && typeof this.handLandmarker.setOptions === 'function') {
      void this.handLandmarker
        .setOptions({ numHands: mode === '2p' ? 4 : 2 })
        .catch(() => {});
    }
  }

  isHumanReady(): boolean {
    return this.initialized && this.initError === null;
  }

  getError(): string | null {
    return this.initError;
  }

  getOverlayData(): HumanOverlayData {
    return {
      isReady: this.isHumanReady(),
      error: this.initError,
      cutouts: [
        this.initialized ? this.cutoutP1Canvas : null,
        this.initialized && this.opponentMode === '2p' ? this.cutoutP2Canvas : null,
      ],
      hands: this.cachedHandVisuals.map((h) => ({ ...h })),
    };
  }

  getInputs(dt: number): [PlayerInput, PlayerInput] {
    if (
      this.disposed ||
      !this.initialized ||
      !this.handLandmarker ||
      !this.workCanvas ||
      !this.workCtx ||
      this.videoEl.readyState < 2 ||
      this.videoEl.videoWidth <= 0 ||
      this.videoEl.videoHeight <= 0
    ) {
      return [
        { ...this.cachedInputs[0] },
        this.opponentMode === '2p' ? { ...this.cachedInputs[1] } : idleInput(),
      ];
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.pendingEvalDt += safeDt;

    const currentVideoTime = this.videoEl.currentTime;
    if (currentVideoTime !== this.lastVideoTime) {
      this.lastVideoTime = currentVideoTime;
      const evalDt = this.pendingEvalDt;
      this.pendingEvalDt = 0;
      this.syncWorkBufferSizes();
      drawMirroredAspectFit(
        this.workCtx,
        this.videoEl,
        this.workCanvas.width,
        HALF_COURT_H,
      );

      const nowMs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const timestampMs =
        nowMs > this.lastTimestampMs ? nowMs : this.lastTimestampMs + 1;
      this.lastTimestampMs = timestampMs;

      this.updateHandTracking(timestampMs, evalDt);
      this.updateSegmentationCutouts(timestampMs);
    } else if (safeDt > 0) {
      advanceSideHandsTimers(
        this.leftTracker,
        this.cachedInputs[0].hands,
        this.cachedHandVisuals,
        'p1',
        safeDt,
      );
      if (this.opponentMode === '2p') {
        advanceSideHandsTimers(
          this.rightTracker,
          this.cachedInputs[1].hands,
          this.cachedHandVisuals,
          'p2',
          safeDt,
        );
      }
    }

    return [
      { ...this.cachedInputs[0] },
      this.opponentMode === '2p' ? { ...this.cachedInputs[1] } : idleInput(),
    ];
  }

  private updateHandTracking(timestampMs: number, dt: number): void {
    if (!this.handLandmarker || !this.workCanvas) {
      return;
    }

    const result = this.handLandmarker.detectForVideo(this.workCanvas, timestampMs);
    const allHands = (result.landmarks ?? []) as NormalizedLandmark[][];
    const partitioned = partitionHandsForArPlayers(allHands, this.opponentMode);

    const p1Hands = evaluateArHands('left', partitioned.left, this.leftTracker, dt);
    this.cachedInputs[0] = {
      moveX: 0,
      targetX: null,
      jump: false,
      hands: p1Hands.map((h) => ({
        x: h.x,
        y: h.y,
        vx: h.vx,
        vy: h.vy,
        canHit: h.canHit,
      })),
    };

    const visuals: HumanHandVisual[] = p1Hands.map((h) => ({
      playerId: 'p1',
      x: h.x,
      y: h.y,
      isFist: h.isFist,
      canHit: h.canHit,
      fistRemainingRatio: h.fistRemainingRatio,
    }));

    if (this.opponentMode === '2p') {
      const p2Hands = evaluateArHands('right', partitioned.right, this.rightTracker, dt);
      this.cachedInputs[1] = {
        moveX: 0,
        targetX: null,
        jump: false,
        hands: p2Hands.map((h) => ({
          x: h.x,
          y: h.y,
          vx: h.vx,
          vy: h.vy,
          canHit: h.canHit,
        })),
      };
      for (const h of p2Hands) {
        visuals.push({
          playerId: 'p2',
          x: h.x,
          y: h.y,
          isFist: h.isFist,
          canHit: h.canHit,
          fistRemainingRatio: h.fistRemainingRatio,
        });
      }
    } else {
      this.cachedInputs[1] = idleInput();
    }

    this.cachedHandVisuals = visuals;
  }

  private updateSegmentationCutouts(timestampMs: number): void {
    if (
      !this.imageSegmenter ||
      !this.workCanvas ||
      !this.workCtx ||
      !this.maskedCanvas ||
      !this.maskedCtx ||
      !this.cutoutP1Canvas ||
      !this.cutoutP1Ctx ||
      !this.cutoutP2Canvas ||
      !this.cutoutP2Ctx
    ) {
      return;
    }

    const segResult = this.imageSegmenter.segmentForVideo(this.workCanvas, timestampMs);
    const masks = segResult.confidenceMasks;
    if (!masks || masks.length === 0) {
      return;
    }

    const personLabelIndex = this.segmenterLabels.findIndex((label) =>
      /person|selfie|foreground/i.test(label),
    );
    const singleIsBackground =
      masks.length === 1 &&
      this.segmenterLabels.length > 0 &&
      /background/i.test(this.segmenterLabels[0] ?? '');

    const maskIndex =
      masks.length >= 2 ? (personLabelIndex >= 0 ? personLabelIndex : 1) : 0;
    const mask = masks[maskIndex];
    const conf = mask.getAsFloat32Array();
    const maskW = mask.width || this.workCanvas.width;
    const maskH = mask.height || HALF_COURT_H;

    const workW = this.workCanvas.width;
    const srcData = this.workCtx.getImageData(0, 0, workW, HALF_COURT_H);
    const pixels = srcData.data;
    const sameSize = maskW === workW && maskH === HALF_COURT_H;

    for (let y = 0; y < HALF_COURT_H; y++) {
      const my = sameSize ? y : Math.min(maskH - 1, Math.floor((y * maskH) / HALF_COURT_H));
      for (let x = 0; x < workW; x++) {
        const mx = sameSize ? x : Math.min(maskW - 1, Math.floor((x * maskW) / workW));
        const raw = conf[my * maskW + mx] ?? 0;
        const personProb = singleIsBackground ? 1 - raw : raw;
        const alphaByte = Math.round(smoothstep(0.35, 0.72, personProb) * 255);
        pixels[(y * workW + x) * 4 + 3] = alphaByte;
      }
    }

    this.maskedCtx.putImageData(srcData, 0, 0);

    for (const m of masks) {
      if (typeof m.close === 'function') {
        m.close();
      }
    }

    // 1:1 natural projection into P1 (left half-court) and P2 (right half-court) without resizing/cropping onto an avatar
    this.cutoutP1Ctx.clearRect(0, 0, HALF_COURT_W, HALF_COURT_H);
    this.cutoutP1Ctx.drawImage(
      this.maskedCanvas,
      0,
      0,
      HALF_COURT_W,
      HALF_COURT_H,
      0,
      0,
      HALF_COURT_W,
      HALF_COURT_H,
    );

    if (this.opponentMode === '2p') {
      this.cutoutP2Ctx.clearRect(0, 0, HALF_COURT_W, HALF_COURT_H);
      this.cutoutP2Ctx.drawImage(
        this.maskedCanvas,
        HALF_COURT_W,
        0,
        HALF_COURT_W,
        HALF_COURT_H,
        0,
        0,
        HALF_COURT_W,
        HALF_COURT_H,
      );
    }
  }

  private closeVisionTasks(): void {
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
    if (this.imageSegmenter) {
      this.imageSegmenter.close();
      this.imageSegmenter = null;
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
    this.closeVisionTasks();
    this.stopMediaTracks();
  }
}
