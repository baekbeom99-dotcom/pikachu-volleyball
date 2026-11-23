import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { WORLD } from '../core/constants';
import type {
  MotionOverlayData,
  MotionSideStatus,
  OpponentMode,
  PlayerInput,
} from '../core/types';
import {
  createSideTrackerState,
  evaluateSidePose,
  type NormalizedLandmark,
  type SideTrackerState,
} from './motionMath';
import { idleInput, type InputProvider } from './types';

const WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 360;
const ROI_WIDTH = 240;
const ROI_HEIGHT = 360;

const COURT_EDGE_PADDING = 8;
const P1_MARGIN = WORLD.PLAYER_RADIUS + COURT_EDGE_PADDING;
const P1_MIN_X = P1_MARGIN;
const P1_MAX_X = WORLD.NET_LEFT - P1_MARGIN;
const P2_MIN_X = WORLD.NET_RIGHT + P1_MARGIN;
const P2_MAX_X = WORLD.WIDTH - P1_MARGIN;

type Side = 'left' | 'right';
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface MotionInputOptions {
  videoEl: HTMLVideoElement;
  opponentMode: OpponentMode;
  activeSide?: Side;
}

function createInitialSideStatus(side: Side): MotionSideStatus {
  return {
    side,
    detected: false,
    widthRatio: 0,
    heightRatio: 0,
    gateStatus: 'NO_PERSON',
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

function projectRightTargetToP1Court(rightTargetX: number | null): number | null {
  if (rightTargetX === null) {
    return null;
  }
  const span = P2_MAX_X - P2_MIN_X;
  const ratio = span > 0 ? (rightTargetX - P2_MIN_X) / span : 0.5;
  const clamped = Math.max(0, Math.min(1, ratio));
  return P1_MIN_X + clamped * (P1_MAX_X - P1_MIN_X);
}

function formatMotionError(err: unknown): string {
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
  return `모션 인식 초기화에 실패했습니다. (${message || 'Motion initialization failed'})`;
}

/**
 * Dual-ROI MediaPipe PoseLandmarker provider.
 * Mirrors webcam input into an aspect-preserving 480x360 buffer, crops 0..240 (left)
 * and 240..480 (right), and runs independent single-pose landmarkers per active side.
 */
export class MotionInputProvider implements InputProvider {
  private readonly videoEl: HTMLVideoElement;
  private opponentMode: OpponentMode;
  readonly activeSide: Side;

  private stream: MediaStream | null = null;
  private visionFileset: VisionFileset | null = null;
  private leftLandmarker: PoseLandmarker | null = null;
  private rightLandmarker: PoseLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private secondaryInitPromise: Promise<void> | null = null;

  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private leftRoiCanvas: HTMLCanvasElement | null = null;
  private leftRoiCtx: CanvasRenderingContext2D | null = null;
  private rightRoiCanvas: HTMLCanvasElement | null = null;
  private rightRoiCtx: CanvasRenderingContext2D | null = null;

  private leftTracker: SideTrackerState = createSideTrackerState();
  private rightTracker: SideTrackerState = createSideTrackerState();

  private cachedInputs: [PlayerInput, PlayerInput] = [idleInput(), idleInput()];
  private cachedStatuses: [MotionSideStatus, MotionSideStatus] = [
    createInitialSideStatus('left'),
    createInitialSideStatus('right'),
  ];

  private lastVideoTime = -1;
  private lastTimestampMs = -1;
  private pendingEvalDt = 0;
  private initError: string | null = null;
  private secondaryInitError: string | null = null;
  private initialized = false;
  private disposed = false;

  constructor(options: MotionInputOptions) {
    this.videoEl = options.videoEl;
    this.opponentMode = options.opponentMode;
    this.activeSide = options.activeSide ?? 'left';
  }

  private getLandmarker(side: Side): PoseLandmarker | null {
    return side === 'left' ? this.leftLandmarker : this.rightLandmarker;
  }

  private setLandmarker(side: Side, landmarker: PoseLandmarker | null): void {
    if (side === 'left') {
      this.leftLandmarker = landmarker;
    } else {
      this.rightLandmarker = landmarker;
    }
  }

  private async createPoseLandmarker(fileset: VisionFileset): Promise<PoseLandmarker> {
    const baseConfig = {
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          delegate: 'GPU',
        },
        ...baseConfig,
      });
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
        },
        ...baseConfig,
      });
    }
  }

  private async ensureSecondaryLandmarker(side: Side): Promise<void> {
    if (
      this.disposed ||
      this.getLandmarker(side) !== null ||
      this.visionFileset === null
    ) {
      return;
    }
    if (this.secondaryInitPromise) {
      return this.secondaryInitPromise;
    }

    this.secondaryInitPromise = (async () => {
      try {
        const landmarker = await this.createPoseLandmarker(this.visionFileset!);
        if (this.disposed) {
          landmarker.close();
          return;
        }
        this.setLandmarker(side, landmarker);
        this.secondaryInitError = null;
      } catch (err) {
        this.secondaryInitError = formatMotionError(err);
      } finally {
        this.secondaryInitPromise = null;
      }
    })();

    return this.secondaryInitPromise;
  }

  /** Requests webcam access and initializes MediaPipe PoseLandmarker instances. */
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
    this.secondaryInitError = null;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.initError =
        '이 브라우저는 웹캠을 지원하지 않습니다. 터치패드 모드를 사용해 주세요. (Webcam API unavailable)';
      return;
    }

    const preview = createOffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const leftRoi = createOffscreenCanvas(ROI_WIDTH, ROI_HEIGHT);
    const rightRoi = createOffscreenCanvas(ROI_WIDTH, ROI_HEIGHT);
    if (!preview || !leftRoi || !rightRoi) {
      this.initError =
        '캔버스 컨텍스트를 생성할 수 없습니다. (Canvas 2D context unavailable)';
      return;
    }

    this.previewCanvas = preview.canvas;
    this.previewCtx = preview.ctx;
    this.leftRoiCanvas = leftRoi.canvas;
    this.leftRoiCtx = leftRoi.ctx;
    this.rightRoiCanvas = rightRoi.canvas;
    this.rightRoiCtx = rightRoi.ctx;

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
      this.visionFileset = fileset;

      const primarySide: Side = this.activeSide;
      const secondarySide: Side = primarySide === 'left' ? 'right' : 'left';

      const primaryLandmarker = await this.createPoseLandmarker(fileset);
      if (this.disposed) {
        primaryLandmarker.close();
        this.stopMediaTracks();
        return;
      }
      this.setLandmarker(primarySide, primaryLandmarker);

      if (this.opponentMode === '2p') {
        const secondaryLandmarker = await this.createPoseLandmarker(fileset);
        if (this.disposed) {
          secondaryLandmarker.close();
          this.closeLandmarkers();
          this.stopMediaTracks();
          return;
        }
        this.setLandmarker(secondarySide, secondaryLandmarker);
      }

      this.initialized = true;
    } catch (err) {
      this.initError = formatMotionError(err);
      this.closeLandmarkers();
      this.visionFileset = null;
      this.stopMediaTracks();
    }
  }

  /** Switches between 1P ('npc') and 2P ('2p') mode, lazy-initializing missing landmarker if needed. */
  setOpponentMode(mode: OpponentMode): void {
    if (this.opponentMode === mode) {
      return;
    }
    this.opponentMode = mode;

    if (mode === 'npc') {
      this.secondaryInitError = null;
      const inactiveSide: Side = this.activeSide === 'left' ? 'right' : 'left';
      if (inactiveSide === 'left') {
        this.leftTracker = createSideTrackerState();
        this.cachedInputs[0] = idleInput();
        this.cachedStatuses[0] = createInitialSideStatus('left');
      } else {
        this.rightTracker = createSideTrackerState();
        this.cachedStatuses[1] = createInitialSideStatus('right');
      }
      this.cachedInputs[1] = idleInput();
      return;
    }

    this.secondaryInitError = null;
    this.rightTracker = createSideTrackerState();
    this.cachedInputs[1] = idleInput();
    this.cachedStatuses[1] = createInitialSideStatus('right');
    if (this.activeSide === 'right') {
      this.leftTracker = createSideTrackerState();
      this.cachedInputs[0] = idleInput();
      this.cachedStatuses[0] = createInitialSideStatus('left');
    }

    if (this.initialized) {
      const missingSide: Side | null =
        this.leftLandmarker === null
          ? 'left'
          : this.rightLandmarker === null
            ? 'right'
            : null;
      if (missingSide !== null) {
        void this.ensureSecondaryLandmarker(missingSide);
      }
    }
  }

  private evaluateSingleRoi(
    side: Side,
    landmarker: PoseLandmarker,
    roiCanvas: HTMLCanvasElement,
    roiCtx: CanvasRenderingContext2D,
    tracker: SideTrackerState,
    timestampMs: number,
    dt: number,
  ): { input: PlayerInput; status: MotionSideStatus } {
    const sx = side === 'left' ? 0 : ROI_WIDTH;
    roiCtx.drawImage(
      this.previewCanvas!,
      sx,
      0,
      ROI_WIDTH,
      ROI_HEIGHT,
      0,
      0,
      ROI_WIDTH,
      ROI_HEIGHT,
    );

    let landmarks: NormalizedLandmark[] | null = null;
    try {
      const result = landmarker.detectForVideo(roiCanvas, timestampMs);
      const pose = result.landmarks?.[0];
      landmarks = pose && pose.length > 0 ? pose : null;
    } catch {
      landmarks = null;
    }

    const evaluation = evaluateSidePose(side, landmarks, tracker, dt);
    return {
      input: {
        moveX: 0,
        targetX: evaluation.targetX,
        jump: evaluation.jump,
      },
      status: {
        side,
        detected: evaluation.detected,
        widthRatio: evaluation.widthRatio,
        heightRatio: evaluation.heightRatio,
        gateStatus: evaluation.gateStatus,
      },
    };
  }

  /** Evaluates active webcam ROIs when video frames advance and returns cached [P1, P2] inputs. */
  getInputs(dt: number): [PlayerInput, PlayerInput] {
    if (
      this.disposed ||
      this.getError() !== null ||
      !this.initialized ||
      !this.previewCanvas ||
      !this.previewCtx ||
      !this.leftRoiCanvas ||
      !this.leftRoiCtx ||
      !this.rightRoiCanvas ||
      !this.rightRoiCtx
    ) {
      return [idleInput(), idleInput()];
    }

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.pendingEvalDt += safeDt;

    if (
      this.videoEl.readyState < 2 ||
      this.videoEl.videoWidth <= 0 ||
      this.videoEl.videoHeight <= 0
    ) {
      return [this.cachedInputs[0], this.cachedInputs[1]];
    }

    const currentTime = this.videoEl.currentTime;
    if (currentTime === this.lastVideoTime) {
      return [this.cachedInputs[0], this.cachedInputs[1]];
    }
    this.lastVideoTime = currentTime;

    const evalDt = Math.min(this.pendingEvalDt, 0.25);
    this.pendingEvalDt = 0;

    const nowMs = Math.max(this.lastTimestampMs + 1, Math.round(performance.now()));
    this.lastTimestampMs = nowMs;

    drawMirroredAspectFit(
      this.previewCtx,
      this.videoEl,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT,
    );

    if (this.opponentMode === 'npc') {
      if (this.activeSide === 'left') {
        if (this.leftLandmarker) {
          const leftOut = this.evaluateSingleRoi(
            'left',
            this.leftLandmarker,
            this.leftRoiCanvas,
            this.leftRoiCtx,
            this.leftTracker,
            nowMs,
            evalDt,
          );
          this.cachedInputs[0] = leftOut.input;
          this.cachedStatuses[0] = leftOut.status;
        }
        this.cachedStatuses[1] = createInitialSideStatus('right');
      } else {
        if (this.rightLandmarker) {
          const rightOut = this.evaluateSingleRoi(
            'right',
            this.rightLandmarker,
            this.rightRoiCanvas,
            this.rightRoiCtx,
            this.rightTracker,
            nowMs,
            evalDt,
          );
          this.cachedInputs[0] = {
            moveX: 0,
            targetX: projectRightTargetToP1Court(rightOut.input.targetX),
            jump: rightOut.input.jump,
          };
          this.cachedStatuses[1] = rightOut.status;
        }
        this.cachedStatuses[0] = createInitialSideStatus('left');
      }
      this.cachedInputs[1] = idleInput();
      return [this.cachedInputs[0], this.cachedInputs[1]];
    }

    if (this.leftLandmarker) {
      const leftOut = this.evaluateSingleRoi(
        'left',
        this.leftLandmarker,
        this.leftRoiCanvas,
        this.leftRoiCtx,
        this.leftTracker,
        nowMs,
        evalDt,
      );
      this.cachedInputs[0] = leftOut.input;
      this.cachedStatuses[0] = leftOut.status;
    } else {
      this.cachedInputs[0] = idleInput();
      this.cachedStatuses[0] = createInitialSideStatus('left');
    }

    if (this.rightLandmarker) {
      const rightOut = this.evaluateSingleRoi(
        'right',
        this.rightLandmarker,
        this.rightRoiCanvas,
        this.rightRoiCtx,
        this.rightTracker,
        nowMs,
        evalDt,
      );
      this.cachedInputs[1] = rightOut.input;
      this.cachedStatuses[1] = rightOut.status;
    } else {
      this.cachedInputs[1] = idleInput();
      this.cachedStatuses[1] = createInitialSideStatus('right');
    }

    return [this.cachedInputs[0], this.cachedInputs[1]];
  }

  /** Returns true when all active human player sides satisfy the distance gate ('OK'). */
  isMotionReady(): boolean {
    if (this.disposed || this.getError() !== null) {
      return false;
    }
    if (this.opponentMode === '2p') {
      return (
        this.cachedStatuses[0].gateStatus === 'OK' &&
        this.cachedStatuses[1].gateStatus === 'OK'
      );
    }
    const activeStatus =
      this.activeSide === 'left' ? this.cachedStatuses[0] : this.cachedStatuses[1];
    return activeStatus.gateStatus === 'OK';
  }

  /** Returns the latest distance/detection statuses for [left, right] ROIs. */
  getSideStatuses(): [MotionSideStatus, MotionSideStatus] {
    return [{ ...this.cachedStatuses[0] }, { ...this.cachedStatuses[1] }];
  }

  /** Returns a plain DTO summary for Pop-Art HUD rendering without exposing input classes. */
  getOverlayData(): MotionOverlayData {
    return {
      statuses: this.getSideStatuses(),
      isReady: this.isMotionReady(),
      error: this.getError(),
      activeSide: this.activeSide,
    };
  }

  /** Returns the mirrored 480x360 preview canvas for HUD display, or null if uninitialized. */
  getPreviewCanvas(): HTMLCanvasElement | null {
    return this.previewCanvas;
  }

  /** Returns a user-facing error message if webcam or active MediaPipe initialization failed. */
  getError(): string | null {
    if (this.initError !== null) {
      return this.initError;
    }
    if (this.opponentMode === '2p' && this.secondaryInitError !== null) {
      return this.secondaryInitError;
    }
    return null;
  }

  private stopMediaTracks(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track cleanup failures.
        }
      }
      this.stream = null;
    }
    if (this.videoEl.srcObject) {
      this.videoEl.srcObject = null;
    }
  }

  private closeLandmarkers(): void {
    if (this.leftLandmarker) {
      try {
        this.leftLandmarker.close();
      } catch {
        // Ignore close errors.
      }
      this.leftLandmarker = null;
    }

    if (this.rightLandmarker) {
      try {
        this.rightLandmarker.close();
      } catch {
        // Ignore close errors.
      }
      this.rightLandmarker = null;
    }
  }

  /** Stops webcam tracks and closes both PoseLandmarker instances. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopMediaTracks();
    this.closeLandmarkers();

    this.visionFileset = null;
    this.previewCanvas = null;
    this.previewCtx = null;
    this.leftRoiCanvas = null;
    this.leftRoiCtx = null;
    this.rightRoiCanvas = null;
    this.rightRoiCtx = null;
    this.cachedInputs = [idleInput(), idleInput()];
    this.cachedStatuses = [
      createInitialSideStatus('left'),
      createInitialSideStatus('right'),
    ];
  }
}
