import type { ControlMode, OpponentMode, PlayerId } from '../core/types';

export type TargetScoreOption = 5 | 10 | 15;
export type MenuScreen = 'MENU' | 'IN_GAME' | 'MATCH_OVER';

export interface MenuSelections {
  controlMode: ControlMode;
  opponentMode: OpponentMode;
  targetScore: TargetScoreOption;
  usePlaceholderModel: boolean;
}

export interface MatchOverSummary {
  winner: PlayerId;
  scores: { p1: number; p2: number };
  opponentMode: OpponentMode;
}

export interface MenuCallbacks {
  onStartMatch: (selections: MenuSelections) => void;
  onRematch: () => void;
  onReturnMenu: () => void;
  onToggleMute: () => boolean;
  onToggleModel: () => boolean;
  onSwitchToTouch: () => void;
  onRetryMotion: () => void;
}

function stopPointerPropagation(el: HTMLElement): void {
  el.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
}

function createButton(
  label: string,
  className: string,
  onClick: () => void,
  attrs: Record<string, string> = {},
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  for (const [key, value] of Object.entries(attrs)) {
    btn.setAttribute(key, value);
  }
  stopPointerPropagation(btn);
  btn.addEventListener('click', onClick);
  return btn;
}

function createOptionGroup(
  labelText: string,
  buttons: HTMLButtonElement[],
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'pop-option-group';

  const label = document.createElement('div');
  label.className = 'pop-option-label';
  label.textContent = labelText;

  const row = document.createElement('div');
  row.className = 'pop-option-row';
  for (const btn of buttons) {
    row.appendChild(btn);
  }

  group.append(label, row);
  return group;
}

function formatWinnerBanner(winner: PlayerId, opponentMode: OpponentMode): string {
  if (winner === 'p1') {
    return 'P1 WINS!';
  }
  return opponentMode === 'npc' ? 'NPC WINS!' : 'P2 WINS!';
}

/**
 * Pop-Art comic UI controller managing Start Menu, In-Game HUD,
 * Match Over overlay, and Camera Error fallback modal inside #ui-overlay.
 */
export class MenuUI {
  private readonly container: HTMLElement;
  private readonly callbacks: MenuCallbacks;

  private selections: MenuSelections;
  private screen: MenuScreen = 'MENU';
  private muted = false;
  private matchOverSummary: MatchOverSummary | null = null;
  private cameraError: string | null = null;

  constructor(
    container: HTMLElement,
    callbacks: MenuCallbacks,
    initialSelections: Partial<MenuSelections> = {},
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.selections = {
      controlMode: initialSelections.controlMode ?? 'touch',
      opponentMode: initialSelections.opponentMode ?? 'npc',
      targetScore: initialSelections.targetScore ?? 15,
      usePlaceholderModel: initialSelections.usePlaceholderModel ?? false,
    };
    this.render();
  }

  /** Returns a snapshot of the currently selected menu options. */
  getSelections(): MenuSelections {
    return { ...this.selections };
  }

  /** Returns the current active UI screen. */
  getScreen(): MenuScreen {
    return this.screen;
  }

  /** Updates the active screen and re-renders #ui-overlay. */
  setScreen(screen: MenuScreen): void {
    this.screen = screen;
    if (screen !== 'MATCH_OVER') {
      this.matchOverSummary = null;
    }
    this.render();
  }

  /** Syncs the control mode option (e.g. after camera fallback to touch). */
  setControlMode(mode: ControlMode): void {
    if (this.selections.controlMode === mode) {
      return;
    }
    this.selections.controlMode = mode;
    this.render();
  }

  /** Syncs the mute button state in the HUD. */
  setMuted(muted: boolean): void {
    if (this.muted === muted) {
      return;
    }
    this.muted = muted;
    this.render();
  }

  /** Syncs the character model toggle state across menu and HUD. */
  setUsePlaceholderModel(usePlaceholder: boolean): void {
    if (this.selections.usePlaceholderModel === usePlaceholder) {
      return;
    }
    this.selections.usePlaceholderModel = usePlaceholder;
    this.render();
  }

  /** Transitions the overlay to the Match Over modal with winner and score. */
  showMatchOver(
    winner: PlayerId,
    scores: { p1: number; p2: number },
    opponentMode: OpponentMode,
  ): void {
    this.screen = 'MATCH_OVER';
    this.matchOverSummary = {
      winner,
      scores: { p1: scores.p1, p2: scores.p2 },
      opponentMode,
    };
    this.render();
  }

  /** Displays the camera error / fallback modal with the given bilingual message. */
  showCameraError(message: string): void {
    if (this.cameraError === message) {
      return;
    }
    this.cameraError = message;
    this.render();
  }

  /** Hides the camera error modal if visible. */
  clearCameraError(): void {
    if (this.cameraError === null) {
      return;
    }
    this.cameraError = null;
    this.render();
  }

  /** Clears all rendered UI nodes. */
  dispose(): void {
    this.container.replaceChildren();
  }

  private render(): void {
    this.container.replaceChildren();

    if (this.screen === 'MENU') {
      this.container.appendChild(this.buildStartMenu());
    } else if (this.screen === 'IN_GAME') {
      this.container.appendChild(this.buildHudBar());
    } else if (this.screen === 'MATCH_OVER' && this.matchOverSummary) {
      this.container.appendChild(this.buildHudBar());
      this.container.appendChild(this.buildMatchOverModal(this.matchOverSummary));
    }

    if (this.cameraError !== null) {
      this.container.appendChild(this.buildCameraErrorModal(this.cameraError));
    }
  }

  private buildStartMenu(): HTMLElement {
    const card = document.createElement('section');
    card.className = 'pop-menu-card';
    card.setAttribute('aria-label', 'Game Setup Menu');
    stopPointerPropagation(card);

    const header = document.createElement('header');
    header.className = 'pop-menu-header';

    const badge = document.createElement('span');
    badge.className = 'pop-badge pop-badge--magenta';
    badge.textContent = 'POP ART EDITION';

    const title = document.createElement('h1');
    title.className = 'pop-menu-title';
    title.textContent = 'PIKA VOLLEYBALL';

    header.append(badge, title);

    const sections = document.createElement('div');
    sections.className = 'pop-menu-sections';

    const controlButtons = [
      this.buildChoiceButton(
        '터치패드 모드 (다이나믹 조이스틱)',
        this.selections.controlMode === 'touch',
        () => {
          this.selections.controlMode = 'touch';
          this.render();
        },
        { 'data-control': 'touch' },
      ),
      this.buildChoiceButton(
        '모션인식 모드 (웹캠 좌/우 분할)',
        this.selections.controlMode === 'motion',
        () => {
          this.selections.controlMode = 'motion';
          this.render();
        },
        { 'data-control': 'motion' },
      ),
    ];

    const opponentButtons = [
      this.buildChoiceButton(
        '1P (vs NPC)',
        this.selections.opponentMode === 'npc',
        () => {
          this.selections.opponentMode = 'npc';
          this.render();
        },
        { 'data-opponent': 'npc' },
      ),
      this.buildChoiceButton(
        '2P (로컬 대전)',
        this.selections.opponentMode === '2p',
        () => {
          this.selections.opponentMode = '2p';
          this.render();
        },
        { 'data-opponent': '2p' },
      ),
    ];

    const scoreOptions: TargetScoreOption[] = [5, 10, 15];
    const scoreButtons = scoreOptions.map((score) =>
      this.buildChoiceButton(
        `${score}점`,
        this.selections.targetScore === score,
        () => {
          this.selections.targetScore = score;
          this.render();
        },
        { 'data-score': String(score) },
      ),
    );

    const modelButtons = [
      this.buildChoiceButton(
        '033 스프라이트',
        !this.selections.usePlaceholderModel,
        () => {
          this.selections.usePlaceholderModel = false;
          this.render();
        },
        { 'data-model': '033' },
      ),
      this.buildChoiceButton(
        '임시 테스트 모델',
        this.selections.usePlaceholderModel,
        () => {
          this.selections.usePlaceholderModel = true;
          this.render();
        },
        { 'data-model': 'placeholder' },
      ),
    ];

    sections.append(
      createOptionGroup('조작 모드', controlButtons),
      createOptionGroup('플레이어 모드', opponentButtons),
      createOptionGroup('목표 점수', scoreButtons),
      createOptionGroup('캐릭터 외형', modelButtons),
    );

    const hintBox = document.createElement('div');
    hintBox.className = 'pop-hint-box';

    const touchHint = document.createElement('div');
    touchHint.className =
      this.selections.controlMode === 'touch'
        ? 'pop-hint-item is-highlighted'
        : 'pop-hint-item';
    const touchStrong = document.createElement('strong');
    touchStrong.textContent = '[터치패드]';
    touchHint.append(
      touchStrong,
      document.createTextNode(
        '드래그로 이동, 위쪽으로 점프, 공중 자동 스파이크 & 낮은 공 질주 시 자동 다이빙 (PC 키보드 WASD / 방향키 병행 가능).',
      ),
    );

    const motionHint = document.createElement('div');
    motionHint.className =
      this.selections.controlMode === 'motion'
        ? 'pop-hint-item is-highlighted'
        : 'pop-hint-item';
    const motionStrong = document.createElement('strong');
    motionStrong.textContent = '[모션인식]';
    motionHint.append(
      motionStrong,
      document.createTextNode(
        '카메라 좌/우 분할, 중앙선을 넘어도 상대에게 영향 없음, 너무 가까우면 "STEP BACK!" 안내 후 자동 대기.',
      ),
    );

    hintBox.append(touchHint, motionHint);

    const startBtn = createButton(
      'GAME START!',
      'pop-btn pop-btn--magenta pop-start-btn',
      () => this.callbacks.onStartMatch(this.getSelections()),
      { 'data-action': 'start-game' },
    );

    card.append(header, sections, hintBox, startBtn);
    return card;
  }

  private buildChoiceButton(
    label: string,
    selected: boolean,
    onClick: () => void,
    attrs: Record<string, string>,
  ): HTMLButtonElement {
    return createButton(
      label,
      selected ? 'pop-btn pop-choice-btn is-selected' : 'pop-btn pop-choice-btn',
      onClick,
      {
        ...attrs,
        'aria-pressed': selected ? 'true' : 'false',
      },
    );
  }

  private buildHudBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pop-hud-bar';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'pop-hud-group';
    stopPointerPropagation(leftGroup);

    const muteBtn = createButton(
      this.muted ? '🔇' : '🔊',
      this.muted
        ? 'pop-btn pop-btn--cyan pop-hud-btn'
        : 'pop-btn pop-hud-btn',
      () => {
        this.muted = this.callbacks.onToggleMute();
        this.render();
      },
      {
        'data-action': 'toggle-mute',
        'aria-label': this.muted ? 'Unmute sound' : 'Mute sound',
        'aria-pressed': this.muted ? 'true' : 'false',
        title: this.muted ? '소리 켜기' : '음소거',
      },
    );

    const modelBtn = createButton(
      this.selections.usePlaceholderModel ? 'MODEL' : '033',
      this.selections.usePlaceholderModel
        ? 'pop-btn pop-btn--cyan pop-hud-btn'
        : 'pop-btn pop-hud-btn',
      () => {
        this.selections.usePlaceholderModel = this.callbacks.onToggleModel();
        this.render();
      },
      {
        'data-action': 'toggle-model',
        'aria-label': 'Switch character model',
        'aria-pressed': this.selections.usePlaceholderModel ? 'true' : 'false',
        title: this.selections.usePlaceholderModel
          ? '033 스프라이트로 전환'
          : '임시 테스트 모델로 전환',
      },
    );

    leftGroup.append(muteBtn, modelBtn);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'pop-hud-group';
    stopPointerPropagation(rightGroup);

    const menuBtn = createButton(
      'MENU',
      'pop-btn pop-btn--magenta pop-hud-btn',
      () => this.callbacks.onReturnMenu(),
      {
        'data-action': 'open-menu',
        'aria-label': 'Return to menu',
      },
    );

    rightGroup.appendChild(menuBtn);
    bar.append(leftGroup, rightGroup);
    return bar;
  }

  private buildMatchOverModal(summary: MatchOverSummary): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'pop-modal-backdrop';
    stopPointerPropagation(backdrop);

    const card = document.createElement('section');
    card.className = 'pop-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Match Over');
    stopPointerPropagation(card);

    const badge = document.createElement('span');
    badge.className = 'pop-badge';
    badge.textContent = 'MATCH OVER';

    const banner = document.createElement('h2');
    banner.className = 'pop-winner-banner';
    banner.textContent = formatWinnerBanner(summary.winner, summary.opponentMode);

    const opponentLabel = summary.opponentMode === 'npc' ? 'NPC' : 'P2';
    const scoreBox = document.createElement('div');
    scoreBox.className = 'pop-final-score';
    scoreBox.textContent = `P1 ${summary.scores.p1} : ${summary.scores.p2} ${opponentLabel}`;

    const actions = document.createElement('div');
    actions.className = 'pop-modal-actions';

    const rematchBtn = createButton(
      'REMATCH!',
      'pop-btn pop-btn--magenta',
      () => this.callbacks.onRematch(),
      { 'data-action': 'rematch' },
    );

    const menuBtn = createButton(
      'MENU',
      'pop-btn pop-btn--cyan',
      () => this.callbacks.onReturnMenu(),
      { 'data-action': 'return-menu' },
    );

    actions.append(rematchBtn, menuBtn);
    card.append(badge, banner, scoreBox, actions);
    backdrop.appendChild(card);
    return backdrop;
  }

  private buildCameraErrorModal(message: string): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'pop-modal-backdrop pop-modal-backdrop--error';
    stopPointerPropagation(backdrop);

    const card = document.createElement('section');
    card.className = 'pop-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Camera Error');
    stopPointerPropagation(card);

    const badge = document.createElement('span');
    badge.className = 'pop-badge pop-badge--magenta';
    badge.textContent = 'CAMERA ERROR';

    const msg = document.createElement('p');
    msg.className = 'pop-error-message';
    msg.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'pop-modal-actions';

    const switchBtn = createButton(
      '터치패드 모드로 전환',
      'pop-btn pop-btn--magenta',
      () => this.callbacks.onSwitchToTouch(),
      { 'data-action': 'switch-to-touch' },
    );

    const retryBtn = createButton(
      '다시 시도',
      'pop-btn',
      () => this.callbacks.onRetryMotion(),
      { 'data-action': 'retry-motion' },
    );

    const menuBtn = createButton(
      '메뉴로',
      'pop-btn pop-btn--cyan',
      () => this.callbacks.onReturnMenu(),
      { 'data-action': 'error-menu' },
    );

    actions.append(switchBtn, retryBtn, menuBtn);
    card.append(badge, msg, actions);
    backdrop.appendChild(card);
    return backdrop;
  }
}
