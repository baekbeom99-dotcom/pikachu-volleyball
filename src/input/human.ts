import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import type {
  HandOverlayPoint,
  HumanOverlayData,
  OpponentMode,
  PlayerInput,
} from '../core/types';
import {
  assignHandsToSides,
  createHandTrackerState,
  evaluateHandInput,
  smoothCropBounds,
  type CropBounds,
  type HandTrackerState,
} from './handMath';
import type { NormalizedLandmark } from './motionMath';
import { idleInput, type InputProvider } from './types';

const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const WORK_WIDTH = 256;
const WORK_HEIGHT = 192;
const CUTOUT_WIDTH = 180;
const CUTOUT_HEIGHT = 220;

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
 * Webcam provider for Human mode:
 * 1) Tracks hands via MediaPipe HandLandmarker so the game is playable using hands only.
 * 2) Extracts background-removed person cutouts via ImageSegmenter so the real player replaces the avatar.
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

  private leftTracker: HandTrackerState = createHandTrackerState();
  private rightTracker: HandTrackerState = createHandTrackerState();
  private cropBoundsP1: CropBounds | null = null;
  private cropBoundsP2: CropBounds | null = null;

  private cachedInputs: [PlayerInput, PlayerInput] = [idleInput(), idleInput()];
  private cachedHands: HandOverlayPoint[] = [
    { side: 'left', detected: false, normX: 0.5, normY: 0.5, jumpActive: false },
  ];

  private lastVideoTime = -1;
  private lastTimestampMs = -1;
  private initError: string | null = null;
  private initialized = false;
  private disposed = false;

  constructor(options: HumanInputOptions) {
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

    const work = createOffscreenCanvas(WORK_WIDTH, WORK_HEIGHT);
    const masked = createOffscreenCanvas(WORK_WIDTH, WORK_HEIGHT);
    const cutout1 = createOffscreenCanvas(CUTOUT_WIDTH, CUTOUT_HEIGHT);
    const cutout2 = createOffscreenCanvas(CUTOUT_WIDTH, CUTOUT_HEIGHT);
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

  /** Switches between 1P ('npc') and 2P ('2p') mode, updating hand count accordingly. */
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

  /** Returns true once webcam + HandLandmarker + ImageSegmenter are ready. */
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
      hands: this.cachedHands.map((h) => ({ ...h })),
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

    const currentVideoTime = this.videoEl.currentTime;
    if (currentVideoTime !== this.lastVideoTime) {
      this.lastVideoTime = currentVideoTime;
      drawMirroredAspectFit(this.workCtx, this.videoEl, WORK_WIDTH, WORK_HEIGHT);

      const nowMs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      const timestampMs =
        nowMs > this.lastTimestampMs ? nowMs : this.lastTimestampMs + 1;
      this.lastTimestampMs = timestampMs;

      this.updateHandTracking(timestampMs, dt);
      this.updateSegmentationCutouts(timestampMs);
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
    const assigned = assignHandsToSides(
      allHands,
      this.opponentMode,
      this.leftTracker.smoothedX,
    );

    const leftEval = evaluateHandInput(
      'left',
      assigned.left,
      this.leftTracker,
      dt,
      this.opponentMode === '2p' ? { minX: 0, maxX: 0.5 } : { minX: 0, maxX: 1 },
    );

    this.cachedInputs[0] = {
      moveX: 0,
      targetX: leftEval.targetX,
      jump: leftEval.jump,
    };

    const handsOverlay: HandOverlayPoint[] = [
      {
        side: 'left',
        detected: leftEval.detected,
        normX: leftEval.normX,
        normY: leftEval.normY,
        jumpActive: leftEval.jump,
      },
    ];

    if (this.opponentMode === '2p') {
      const rightEval = evaluateHandInput(
        'right',
        assigned.right,
        this.rightTracker,
        dt,
        { minX: 0.5, maxX: 1 },
      );
      this.cachedInputs[1] = {
        moveX: 0,
        targetX: rightEval.targetX,
        jump: rightEval.jump,
      };
      handsOverlay.push({
        side: 'right',
        detected: rightEval.detected,
        normX: rightEval.normX,
        normY: rightEval.normY,
        jumpActive: rightEval.jump,
      });
    } else {
      this.cachedInputs[1] = idleInput();
    }

    this.cachedHands = handsOverlay;
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
      masks.length >= 2
        ? personLabelIndex >= 0
          ? personLabelIndex
          : 1
        : 0;
    const mask = masks[maskIndex];
    const conf = mask.getAsFloat32Array();
    const maskW = mask.width || WORK_WIDTH;
    const maskH = mask.height || WORK_HEIGHT;

    const srcData = this.workCtx.getImageData(0, 0, WORK_WIDTH, WORK_HEIGHT);
    const pixels = srcData.data;

    let minX1 = WORK_WIDTH;
    let minY1 = WORK_HEIGHT;
    let maxX1 = -1;
    let maxY1 = -1;
    let minX2 = WORK_WIDTH;
    let minY2 = WORK_HEIGHT;
    let maxX2 = -1;
    let maxY2 = -1;

    const splitX = Math.floor(WORK_WIDTH * 0.5);
    const sameSize = maskW === WORK_WIDTH && maskH === WORK_HEIGHT;

    for (let y = 0; y < WORK_HEIGHT; y++) {
      const my = sameSize ? y : Math.min(maskH - 1, Math.floor((y * maskH) / WORK_HEIGHT));
      for (let x = 0; x < WORK_WIDTH; x++) {
        const mx = sameSize ? x : Math.min(maskW - 1, Math.floor((x * maskW) / WORK_WIDTH));
        const raw = conf[my * maskW + mx] ?? 0;
        const personProb = singleIsBackground ? 1 - raw : raw;
        const alphaFloat = smoothstep(0.35, 0.72, personProb);
        const alphaByte = Math.round(alphaFloat * 255);

        const idx = (y * WORK_WIDTH + x) * 4;
        pixels[idx + 3] = alphaByte;

        if (alphaByte >= 96) {
          if (this.opponentMode === 'npc' || x < splitX) {
            if (x < minX1) minX1 = x;
            if (y < minY1) minY1 = y;
            if (x > maxX1) maxX1 = x;
            if (y > maxY1) maxY1 = y;
          } else {
            if (x < minX2) minX2 = x;
            if (y < minY2) minY2 = y;
            if (x > maxX2) maxX2 = x;
            if (y > maxY2) maxY2 = y;
          }
        }
      }
    }

    this.maskedCtx.putImageData(srcData, 0, 0);

    for (const m of masks) {
      if (typeof m.close === 'function') {
        m.close();
      }
    }

    const crop1 = this.resolveTargetCrop(
      this.cropBoundsP1,
      minX1,
      minY1,
      maxX1,
      maxY1,
      0,
      this.opponentMode === '2p' ? splitX : WORK_WIDTH,
    );
    this.cropBoundsP1 = crop1;
    this.drawCutout(this.cutoutP1Ctx, crop1);

    if (this.opponentMode === '2p') {
      const crop2 = this.resolveTargetCrop(
        this.cropBoundsP2,
        minX2,
        minY2,
        maxX2,
        maxY2,
        splitX,
        WORK_WIDTH,
      );
      this.cropBoundsP2 = crop2;
      this.drawCutout(this.cutoutP2Ctx, crop2);
    }
  }

  private resolveTargetCrop(
    prev: CropBounds | null,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    regionMinX: number,
    regionMaxX: number,
  ): CropBounds {
    const regionWidth = Math.max(1, regionMaxX - regionMinX);
    if (maxX <= minX || maxY <= minY) {
      return (
        prev ?? {
          sx: regionMinX,
          sy: 0,
          sw: regionWidth,
          sh: WORK_HEIGHT,
        }
      );
    }

    const rawW = maxX - minX + 1;
    const rawH = maxY - minY + 1;
    const padX = Math.max(10, rawW * 0.14);
    const padTop = Math.max(10, rawH * 0.12);
    const padBottom = Math.max(4, rawH * 0.04);

    const sx = Math.max(regionMinX, minX - padX);
    const sy = Math.max(0, minY - padTop);
    const ex = Math.min(regionMaxX, maxX + padX);
    const ey = Math.min(WORK_HEIGHT, maxY + padBottom);

    const next: CropBounds = {
      sx,
      sy,
      sw: Math.max(24, ex - sx),
      sh: Math.max(24, ey - sy),
    };

    return smoothCropBounds(prev, next, 0.25);
  }

  private drawCutout(targetCtx: CanvasRenderingContext2D, crop: CropBounds): void {
    if (!this.maskedCanvas) {
      return;
    }

    targetCtx.clearRect(0, 0, CUTOUT_WIDTH, CUTOUT_HEIGHT);

    const scale = Math.min(CUTOUT_WIDTH / crop.sw, CUTOUT_HEIGHT / crop.sh);
    const drawW = crop.sw * scale;
    const drawH = crop.sh * scale;
    const dx = (CUTOUT_WIDTH - drawW) * 0.5;
    // Anchor cutout toward bottom of canvas so feet/waist rest cleanly on player ring
    const dy = CUTOUT_HEIGHT - drawH;

    targetCtx.drawImage(
      this.maskedCanvas,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      dx,
      dy,
      drawW,
      drawH,
    );
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
