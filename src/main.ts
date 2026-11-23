import './style.css';
import { PopArtAudio } from './audio/sound';
import { WORLD } from './core/constants';
import { computeNpcInput } from './core/npc';
import { createGameState, stepGame } from './core/rules';
import type { GameState, PlayerInput } from './core/types';
import { KeyboardInputProvider } from './input/keyboard';
import { MotionInputProvider } from './input/motion';
import { TouchJoystickProvider } from './input/touchJoystick';
import { idleInput } from './input/types';
import { PlaceholderCharacterRenderer } from './render/characterRenderer';
import { EffectsManager } from './render/effects';
import { PopArtSceneRenderer, type SceneOverlayContext } from './render/sceneRenderer';
import { Sprite033Renderer } from './render/sprite033Renderer';
import { MenuUI, type MenuSelections } from './ui/menu';

const MAX_FRAME_DT = 0.05;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Combines primary (touch joystick) and secondary (keyboard) inputs for the same player.
 * Non-zero primary moveX takes priority; jump triggers if either input requests a jump.
 */
export function combineInputs(a: PlayerInput, b: PlayerInput): PlayerInput {
  const moveA = finiteOrZero(a.moveX);
  const moveB = finiteOrZero(b.moveX);
  const moveX = moveA !== 0 ? moveA : moveB;
  const targetX =
    a.targetX !== null && Number.isFinite(a.targetX)
      ? a.targetX
      : b.targetX !== null && Number.isFinite(b.targetX)
        ? b.targetX
        : null;

  return {
    moveX,
    targetX,
    jump: Boolean(a.jump || b.jump),
  };
}

function getSafeDpr(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(Math.max(1, raw), 2);
}

/** Initializes the Pop-Art Volleyball app, DOM UI, input providers, audio, and 60Hz loop. */
export function startApp(): () => void {
  const canvasEl = document.getElementById('game-canvas');
  const uiOverlayEl = document.getElementById('ui-overlay');
  const videoEl = document.getElementById('webcam-video');

  if (
    !(canvasEl instanceof HTMLCanvasElement) ||
    !(uiOverlayEl instanceof HTMLElement) ||
    !(videoEl instanceof HTMLVideoElement)
  ) {
    return () => {};
  }

  const ctx = canvasEl.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  let currentDpr = getSafeDpr();
  const syncCanvasResolution = (): void => {
    currentDpr = getSafeDpr();
    const targetW = Math.round(WORLD.WIDTH * currentDpr);
    const targetH = Math.round(WORLD.HEIGHT * currentDpr);
    if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
      canvasEl.width = targetW;
      canvasEl.height = targetH;
    }
  };
  syncCanvasResolution();
  window.addEventListener('resize', syncCanvasResolution);

  const spriteRenderer = new Sprite033Renderer();
  const placeholderRenderer = new PlaceholderCharacterRenderer();
  const effects = new EffectsManager();
  const sceneRenderer = new PopArtSceneRenderer({
    characterRenderer: spriteRenderer,
    placeholderRenderer,
    effects,
    preloadSprites: false,
  });
  void spriteRenderer.load();

  const audio = new PopArtAudio();
  const touchProvider = new TouchJoystickProvider('npc');
  const keyboardProvider = new KeyboardInputProvider('npc');
  let motionProvider: MotionInputProvider | null = null;

  let usePlaceholderModel = false;
  let lastSurfacedMotionError: string | null = null;
  let state: GameState = createGameState({
    controlMode: 'touch',
    opponentMode: 'npc',
    targetScore: 15,
    initialPhase: 'MENU',
  });

  const disposeMotionProvider = (): void => {
    if (motionProvider) {
      motionProvider.dispose();
      motionProvider = null;
    }
    lastSurfacedMotionError = null;
  };

  const initMotionProvider = (opponentMode: GameState['opponentMode']): void => {
    disposeMotionProvider();
    motionProvider = new MotionInputProvider({
      videoEl,
      opponentMode,
    });
    void motionProvider.init();
  };

  const startNewMatch = (selections: MenuSelections): void => {
    usePlaceholderModel = selections.usePlaceholderModel;
    effects.reset();
    menuUI.clearCameraError();
    lastSurfacedMotionError = null;

    touchProvider.setOpponentMode(selections.opponentMode);
    keyboardProvider.setOpponentMode(selections.opponentMode);

    if (selections.controlMode === 'motion') {
      touchProvider.dispose();
      initMotionProvider(selections.opponentMode);
    } else {
      disposeMotionProvider();
      touchProvider.attach(canvasEl);
    }

    state = createGameState({
      controlMode: selections.controlMode,
      opponentMode: selections.opponentMode,
      targetScore: selections.targetScore,
    });
    menuUI.setScreen('IN_GAME');
  };

  const menuUI = new MenuUI(uiOverlayEl, {
    onStartMatch: (selections) => {
      audio.unlock();
      startNewMatch(selections);
    },
    onRematch: () => {
      audio.unlock();
      effects.reset();
      menuUI.clearCameraError();
      lastSurfacedMotionError = null;

      if (state.controlMode === 'touch') {
        touchProvider.attach(canvasEl);
      } else if (!motionProvider) {
        initMotionProvider(state.opponentMode);
      }

      state = createGameState({
        controlMode: state.controlMode,
        opponentMode: state.opponentMode,
        targetScore: state.targetScore,
      });
      menuUI.setScreen('IN_GAME');
    },
    onReturnMenu: () => {
      disposeMotionProvider();
      touchProvider.dispose();
      effects.reset();
      menuUI.clearCameraError();

      const selections = menuUI.getSelections();
      state = createGameState({
        controlMode: selections.controlMode,
        opponentMode: selections.opponentMode,
        targetScore: selections.targetScore,
        initialPhase: 'MENU',
      });
      menuUI.setScreen('MENU');
    },
    onToggleMute: () => {
      audio.unlock();
      const nextMuted = !audio.isMuted();
      audio.setMuted(nextMuted);
      return nextMuted;
    },
    onToggleModel: () => {
      usePlaceholderModel = !usePlaceholderModel;
      return usePlaceholderModel;
    },
    onSwitchToTouch: () => {
      audio.unlock();
      disposeMotionProvider();
      menuUI.clearCameraError();
      menuUI.setControlMode('touch');

      state.controlMode = 'touch';
      if (state.phase === 'WAITING_DISTANCE') {
        const resumePhase = state.pausedFromPhase ?? 'READY_SERVE';
        state.pausedFromPhase = undefined;
        state.phase = resumePhase;
        if (resumePhase === 'READY_SERVE' && state.phaseTimer <= 0) {
          state.phaseTimer = 0.7;
        }
      }
      touchProvider.setOpponentMode(state.opponentMode);
      keyboardProvider.setOpponentMode(state.opponentMode);
      touchProvider.attach(canvasEl);

      if (state.phase === 'MATCH_OVER') {
        menuUI.showMatchOver(state.winner ?? 'p1', state.scores, state.opponentMode);
      } else {
        menuUI.setScreen('IN_GAME');
      }
    },
    onRetryMotion: () => {
      audio.unlock();
      menuUI.clearCameraError();
      if (state.controlMode === 'motion') {
        initMotionProvider(state.opponentMode);
      }
    },
  });

  const handleAudioUnlock = (): void => {
    audio.unlock();
  };
  window.addEventListener('pointerdown', handleAudioUnlock, { passive: true });
  window.addEventListener('keydown', handleAudioUnlock, { passive: true });

  let rafId = 0;
  let lastFrameMs: number | null = null;
  let accumulator = 0;
  let disposed = false;

  const stepFixed = (dt: number): void => {
    if (state.phase === 'MENU') {
      return;
    }

    let p1Input: PlayerInput = idleInput();
    let p2Input: PlayerInput = idleInput();
    let motionReady = true;

    if (state.phase !== 'MATCH_OVER') {
      if (state.controlMode === 'touch') {
        const [touchP1, touchP2] = touchProvider.getInputs(dt);
        const [keyP1, keyP2] = keyboardProvider.getInputs(dt);
        p1Input = combineInputs(touchP1, keyP1);
        p2Input = combineInputs(touchP2, keyP2);
      } else if (motionProvider) {
        const [motionP1, motionP2] = motionProvider.getInputs(dt);
        p1Input = motionP1;
        p2Input = motionP2;
        motionReady = motionProvider.isMotionReady();
      } else {
        motionReady = false;
      }

      if (state.opponentMode === 'npc') {
        p2Input = computeNpcInput(state, 'p2');
      }
    }

    const prevPhase = state.phase;
    stepGame(state, [p1Input, p2Input], dt, motionReady);
    effects.consumePhysicsEvents(state);
    effects.update(dt);
    audio.consumeEvents(state, prevPhase);

    if (state.controlMode === 'motion' && motionProvider) {
      const motionError = motionProvider.getError();
      if (motionError !== null && motionError !== lastSurfacedMotionError) {
        lastSurfacedMotionError = motionError;
        menuUI.showCameraError(motionError);
      }
    }

    if (prevPhase !== 'MATCH_OVER' && state.phase === 'MATCH_OVER') {
      touchProvider.reset();
      menuUI.showMatchOver(state.winner ?? 'p1', state.scores, state.opponentMode);
    }
  };

  const renderFrame = (): void => {
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    const rect = canvasEl.getBoundingClientRect();
    const overlayContext: SceneOverlayContext = {
      joysticks:
        state.controlMode === 'touch' &&
        state.phase !== 'MENU' &&
        state.phase !== 'MATCH_OVER'
          ? touchProvider.getVisualJoysticks()
          : [],
      canvasCssWidth: rect.width || WORLD.WIDTH,
      canvasCssHeight: rect.height || WORLD.HEIGHT,
      motionOverlay:
        state.controlMode === 'motion' && motionProvider
          ? motionProvider.getOverlayData()
          : null,
      motionPreviewCanvas:
        state.controlMode === 'motion' && motionProvider
          ? motionProvider.getPreviewCanvas()
          : null,
      showPlaceholders: usePlaceholderModel,
    };

    sceneRenderer.render(ctx, state, overlayContext);
  };

  const loop = (nowMs: number): void => {
    if (disposed) {
      return;
    }

    if (lastFrameMs === null) {
      lastFrameMs = nowMs;
    }
    const rawDt = Math.max(0, (nowMs - lastFrameMs) / 1000);
    lastFrameMs = nowMs;
    const frameDt = Math.min(rawDt, MAX_FRAME_DT);
    accumulator += frameDt;

    while (accumulator >= WORLD.FIXED_DT) {
      stepFixed(WORLD.FIXED_DT);
      accumulator -= WORLD.FIXED_DT;
    }

    renderFrame();
    rafId = window.requestAnimationFrame(loop);
  };

  rafId = window.requestAnimationFrame(loop);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', syncCanvasResolution);
    window.removeEventListener('pointerdown', handleAudioUnlock);
    window.removeEventListener('keydown', handleAudioUnlock);
    disposeMotionProvider();
    touchProvider.dispose();
    keyboardProvider.dispose();
    menuUI.dispose();
  };
}

if (
  typeof document !== 'undefined' &&
  document.getElementById('game-canvas') &&
  document.getElementById('ui-overlay') &&
  document.getElementById('webcam-video')
) {
  startApp();
}
