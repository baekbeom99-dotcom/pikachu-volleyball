import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
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
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 240;
const ROI_WIDTH = 320;
const ROI_HEIGHT = 240;

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface MotionInputOptions {
  videoEl: HTMLVideoElement;
  opponentMode: OpponentMode;
  activeSide?: 'left' | 'right';
}

function createInitialSideStatus(side: 'left' | 'right'): MotionSideStatus {
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
 * Mirrors webcam input into a 640x240 buffer, crops 0..320 (P1) and 320..640 (P2),
 * and runs independent single-pose landmarkers per active side.
 */
export class MotionInputProvider implements InputProvider {
  private readonly videoEl: HTMLVideoElement;
  private opponentMode: OpponentMode;
  readonly activeSide: 'left' | 'right';

  private stream: MediaStream | null = null;
  private visionFileset: VisionFileset | null = null;
  private leftLandmarker: PoseLandmarker | null = null;
  private rightLandmarker: PoseLandmarker | null = null;
  private initPromise: Promise<void> | null = null;
  private rightInitPromise: Promise<void> | null = null;

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
  private errorMessage: string | null = null;
  private initialized = false;
  private disposed = false;

  constructor(options: MotionInputOptions) {
    this.videoEl = options.videoEl;
    this.opponentMode = options.opponentMode;
    this.activeSide = options.activeSide ?? 'left';
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

  private async ensureRightLandmarker(): Promise<void> {
    if (
      this.disposed ||
      this.rightLandmarker !== null ||
      this.visionFileset === null
    ) {
      return;
    }
    if (this.rightInitPromise) {
      return this.rightInitPromise;
    }

    this.rightInitPromise = (async () => {
      try {
        const landmarker = await this.createPoseLandmarker(this.visionFileset!);
        if (this.disposed) {
          landmarker.close();
          return;
        }
        this.rightLandmarker = landmarker;
      } catch (err) {
        this.errorMessage = formatMotionError(err);
      } finally {
        this.rightInitPromise = null;
      }
    })();

    return this.rightInitPromise;
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
    this.errorMessage = null;

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.errorMessage =
        '이 브라우저는 웹캠을 지원하지 않습니다. 터치패드 모드를 사용해 주세요. (Webcam API unavailable)';
      return;
    }

    const preview = createOffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const leftRoi = createOffscreenCanvas(ROI_WIDTH, ROI_HEIGHT);
    const rightRoi = createOffscreenCanvas(ROI_WIDTH, ROI_HEIGHT);
    if (!preview || !leftRoi || !rightRoi) {
      this.errorMessage =
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

      const leftLandmarker = await this.createPoseLandmarker(fileset);
      if (this.disposed) {
        leftLandmarker.close();
        this.stopMediaTracks();
        return;
      }
      this.leftLandmarker = leftLandmarker;

      if (this.opponentMode === '2p') {
        const rightLandmarker = await this.createPoseLandmarker(fileset);
        if (this.disposed) {
          rightLandmarker.close();
          this.stopMediaTracks();
          return;
        }
        this.rightLandmarker = rightLandmarker;
      }

      this.initialized = true;
    } catch (err) {
      this.errorMessage = formatMotionError(err);
      this.stopMediaTracks();
    }
  }

  /** Switches between 1P ('npc') and 2P ('2p') mode, lazy-initializing P2 landmarker if needed. */
  setOpponentMode(mode: OpponentMode): void {
    if (this.opponentMode === mode) {
      return;
    }
    this.opponentMode = mode;
    this.rightTracker = createSideTrackerState();
    this.cachedInputs[1] = idleInput();
    this.cachedStatuses[1] = createInitialSideStatus('right');

    if (mode === '2p' && this.initialized && !this.rightLandmarker) {
      void this.ensureRightLandmarker();
    }
  }

  private evaluateSingleRoi(
    side: 'left' | 'right',
    landmarker: PoseLandmarker,
    roiCanvas: HTMLCanvasElement,
    tracker: SideTrackerState,
    timestampMs: number,
    dt: number,
  ): { input: PlayerInput; status: MotionSideStatus } {
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
      this.errorMessage ||
      !this.leftLandmarker ||
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

    // Mirror webcam feed horizontally into 640x240 split preview buffer.
    this.previewCtx.save();
    this.previewCtx.translate(PREVIEW_WIDTH, 0);
    this.previewCtx.scale(-1, 1);
    this.previewCtx.drawImage(this.videoEl, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    this.previewCtx.restore();

    // Crop left half (0..320) for P1.
    this.leftRoiCtx.drawImage(
      this.previewCanvas,
      0,
      0,
      ROI_WIDTH,
      ROI_HEIGHT,
      0,
      0,
      ROI_WIDTH,
      ROI_HEIGHT,
    );

    const leftOut = this.evaluateSingleRoi(
      'left',
      this.leftLandmarker,
      this.leftRoiCanvas,
      this.leftTracker,
      nowMs,
      evalDt,
    );
    this.cachedInputs[0] = leftOut.input;
    this.cachedStatuses[0] = leftOut.status;

    if (this.opponentMode === '2p') {
      // Crop right half (320..640) for P2.
      this.rightRoiCtx.drawImage(
        this.previewCanvas,
        ROI_WIDTH,
        0,
        ROI_WIDTH,
        ROI_HEIGHT,
        0,
        0,
        ROI_WIDTH,
        ROI_HEIGHT,
      );

      if (this.rightLandmarker) {
        const rightOut = this.evaluateSingleRoi(
          'right',
          this.rightLandmarker,
          this.rightRoiCanvas,
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
    } else {
      this.cachedInputs[1] = idleInput();
      this.cachedStatuses[1] = createInitialSideStatus('right');
    }

    return [this.cachedInputs[0], this.cachedInputs[1]];
  }

  /** Returns true when all active human player sides satisfy the distance gate ('OK'). */
  isMotionReady(): boolean {
    if (this.disposed || this.errorMessage !== null) {
      return false;
    }
    const leftOk = this.cachedStatuses[0].gateStatus === 'OK';
    if (this.opponentMode === '2p') {
      return leftOk && this.cachedStatuses[1].gateStatus === 'OK';
    }
    return leftOk;
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
      error: this.errorMessage,
    };
  }

  /** Returns the mirrored 640x240 preview canvas for HUD display, or null if uninitialized. */
  getPreviewCanvas(): HTMLCanvasElement | null {
    return this.previewCanvas;
  }

  /** Returns a user-facing error message if webcam or MediaPipe initialization failed. */
  getError(): string | null {
    return this.errorMessage;
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

  /** Stops webcam tracks and closes both PoseLandmarker instances. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopMediaTracks();

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
