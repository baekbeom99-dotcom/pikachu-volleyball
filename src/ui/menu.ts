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
  onToggleFullscreen?: () => boolean;
  onSwitchToTouch: () => void;
  onRetryMotion: () => void;
}

const FOCUS_ATTRS = [
  'data-action',
  'data-control',
  'data-opponent',
  'data-score',
] as const;

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

function createFullscreenSvg(isFullscreen: boolean): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.6');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');

  const path = document.createElementNS(svgNs, 'path');
  const d = isFullscreen
    ? 'M 9 3 V 9 H 3 M 15 3 V 9 H 21 M 21 15 H 15 V 21 M 3 15 H 9 V 21'
    : 'M 3 9 V 3 H 9 M 15 3 H 21 V 9 M 21 15 V 21 H 15 M 9 21 H 3 V 15';
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

function createMenuSvg(): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.8');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');

  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', 'M 4 6 H 20 M 4 12 H 20 M 4 18 H 20');
  svg.appendChild(path);
  return svg;
}

function createPopIconSvg(
  buildContent: (svgNs: string, svg: SVGSVGElement) => void,
  size = 48,
): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('xmlns', svgNs);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'pop-choice-icon');
  buildContent(svgNs, svg);
  return svg;
}

function svgEl(
  svgNs: string,
  tag: string,
  attrs: Record<string, string | number>,
): Element {
  const el = document.createElementNS(svgNs, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function createJoystickSvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      svgEl(ns, 'rect', {
        x: 4.5,
        y: 14.5,
        width: 15,
        height: 5.5,
        rx: 2,
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 2,
      }),
      svgEl(ns, 'line', {
        x1: 12,
        y1: 9.5,
        x2: 12,
        y2: 14.5,
        stroke: '#111111',
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'circle', {
        cx: 12,
        cy: 7,
        r: 4,
        fill: '#ff2a85',
        stroke: '#111111',
        'stroke-width': 2,
      }),
    );
  });
}

function createMotionSvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      svgEl(ns, 'path', {
        d: 'M 4 8 V 4 H 8 M 16 4 H 20 V 8 M 20 16 V 20 H 16 M 8 20 H 4 V 16',
        fill: 'none',
        stroke: '#111111',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
      svgEl(ns, 'circle', {
        cx: 12,
        cy: 8,
        r: 2.3,
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
      svgEl(ns, 'path', {
        d: 'M 7.5 11.5 Q 12 14.2 16.5 11.5 M 12 13 V 16.5 M 9.2 19.2 L 12 16.5 L 14.8 19.2',
        fill: 'none',
        stroke: '#111111',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
  });
}

function createNpcSvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      svgEl(ns, 'circle', {
        cx: 7.5,
        cy: 8.5,
        r: 2.6,
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
      svgEl(ns, 'path', {
        d: 'M 3.5 19 C 3.5 14.8 11.5 14.8 11.5 19',
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'line', {
        x1: 17,
        y1: 4.2,
        x2: 17,
        y2: 6.5,
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'rect', {
        x: 13.5,
        y: 6.5,
        width: 7,
        height: 5.5,
        rx: 1.6,
        fill: '#00d4ff',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
      svgEl(ns, 'path', {
        d: 'M 13 19 C 13 15 21 15 21 19',
        fill: '#00d4ff',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
    );
  });
}

function createTwoPlayerSvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      svgEl(ns, 'circle', {
        cx: 7.5,
        cy: 8.5,
        r: 2.6,
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
      svgEl(ns, 'path', {
        d: 'M 3.5 19 C 3.5 14.8 11.5 14.8 11.5 19',
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'circle', {
        cx: 16.5,
        cy: 8.5,
        r: 2.6,
        fill: '#00d4ff',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
      svgEl(ns, 'path', {
        d: 'M 12.5 19 C 12.5 14.8 20.5 14.8 20.5 19',
        fill: '#00d4ff',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
    );
  });
}

function createTrophySvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      svgEl(ns, 'path', {
        d: 'M 7.5 5 H 16.5 V 10 C 16.5 12.8 14.5 14.8 12 14.8 C 9.5 14.8 7.5 12.8 7.5 10 Z',
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      }),
      svgEl(ns, 'path', {
        d: 'M 7.5 6.8 H 5 C 5 10.2 6.2 11.2 7.5 11.2 M 16.5 6.8 H 19 C 19 10.2 17.8 11.2 16.5 11.2',
        fill: 'none',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'path', {
        d: 'M 12 14.8 V 18.5 M 8.5 19 H 15.5',
        fill: 'none',
        stroke: '#111111',
        'stroke-width': 2.1,
        'stroke-linecap': 'round',
      }),
    );
  }, 42);
}

function createHumanSvg(): SVGSVGElement {
  return createPopIconSvg((ns, svg) => {
    svg.append(
      // Clean head + shoulders silhouette
      svgEl(ns, 'circle', {
        cx: 9.5,
        cy: 8.5,
        r: 3,
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 2,
      }),
      svgEl(ns, 'path', {
        d: 'M 4 20 C 4 15 15 15 15 20',
        fill: '#ffe600',
        stroke: '#111111',
        'stroke-width': 2,
        'stroke-linecap': 'round',
      }),
      // Raised palm / fingers gesture icon on right
      svgEl(ns, 'path', {
        d: 'M 18 12 V 6.5 M 16 12.5 V 7.5 M 20 12.5 V 8',
        fill: 'none',
        stroke: '#111111',
        'stroke-width': 1.9,
        'stroke-linecap': 'round',
      }),
      svgEl(ns, 'rect', {
        x: 15,
        y: 11.2,
        width: 6,
        height: 5.8,
        rx: 2.4,
        fill: '#ff2a85',
        stroke: '#111111',
        'stroke-width': 1.9,
      }),
    );
  });
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
  private fullscreen = false;
  private showMotionGuide = false;
  private showHumanGuide = false;
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

  /** Updates the active screen ('MENU' or 'IN_GAME') and re-renders #ui-overlay. */
  setScreen(screen: 'MENU' | 'IN_GAME'): void {
    this.screen = screen;
    this.showMotionGuide = false;
    this.showHumanGuide = false;
    this.matchOverSummary = null;
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

  /** Syncs the fullscreen button icon state across menu and HUD. */
  setFullscreen(fullscreen: boolean): void {
    if (this.fullscreen === fullscreen) {
      return;
    }
    this.fullscreen = fullscreen;
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
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    let focusAttr: { name: string; value: string } | null = null;
    if (activeEl instanceof HTMLElement && this.container.contains(activeEl)) {
      for (const attr of FOCUS_ATTRS) {
        const value = activeEl.getAttribute(attr);
        if (value !== null) {
          focusAttr = { name: attr, value };
          break;
        }
      }
    }

    this.container.replaceChildren();

    if (this.screen === 'MENU') {
      this.container.appendChild(this.buildStartMenu());
      if (this.showMotionGuide) {
        this.container.appendChild(this.buildMotionGuideModal());
      } else if (this.showHumanGuide) {
        this.container.appendChild(this.buildHumanGuideModal());
      }
    } else if (this.screen === 'IN_GAME') {
      this.container.appendChild(this.buildHudBar());
    } else if (this.screen === 'MATCH_OVER' && this.matchOverSummary) {
      this.container.appendChild(this.buildHudBar());
      this.container.appendChild(this.buildMatchOverModal(this.matchOverSummary));
    }

    if (this.cameraError !== null) {
      this.container.appendChild(this.buildCameraErrorModal(this.cameraError));
    }

    if (focusAttr !== null) {
      const candidates = this.container.querySelectorAll<HTMLElement>(`[${focusAttr.name}]`);
      for (const el of candidates) {
        if (el.getAttribute(focusAttr.name) === focusAttr.value) {
          el.focus();
          break;
        }
      }
    }
  }

  private buildStartMenu(): HTMLElement {
    const card = document.createElement('section');
    card.className = 'pop-menu-card';
    card.setAttribute('aria-label', 'Game Setup Menu');
    stopPointerPropagation(card);

    const header = document.createElement('header');
    header.className = 'pop-menu-header';

    const topRightActions = document.createElement('div');
    topRightActions.className = 'pop-menu-top-actions';
    topRightActions.appendChild(this.buildFullscreenButton('pop-btn pop-hud-btn pop-icon-btn'));

    const title = document.createElement('h1');
    title.className = 'pop-menu-title';
    title.textContent = 'PIKA VOLLEYBALL';

    header.append(topRightActions, title);

    const sections = document.createElement('div');
    sections.className = 'pop-menu-sections';

    const controlButtons = [
      this.buildIconChoiceButton(
        createJoystickSvg(),
        '터치',
        this.selections.controlMode === 'touch',
        () => {
          this.selections.controlMode = 'touch';
          this.showMotionGuide = false;
          this.showHumanGuide = false;
          this.render();
        },
        {
          'data-control': 'touch',
          'aria-label': '터치패드 모드 (다이나믹 조이스틱)',
          title: '터치패드 모드 (다이나믹 조이스틱)',
        },
      ),
      this.buildIconChoiceButton(
        createMotionSvg(),
        '모션',
        this.selections.controlMode === 'motion',
        () => {
          this.selections.controlMode = 'motion';
          this.showHumanGuide = false;
          this.render();
        },
        {
          'data-control': 'motion',
          'aria-label': '모션인식 모드 (웹캠 좌/우 분할)',
          title: '모션인식 모드 (웹캠 좌/우 분할)',
        },
      ),
      this.buildIconChoiceButton(
        createHumanSvg(),
        '사람',
        this.selections.controlMode === 'human',
        () => {
          this.selections.controlMode = 'human';
          this.showMotionGuide = false;
          this.render();
        },
        {
          'data-control': 'human',
          'aria-label': '사람 모드 (내가 캐릭터 · 손 조작)',
          title: '사람 모드 (내가 캐릭터 · 손 조작)',
        },
      ),
    ];

    const opponentButtons = [
      this.buildIconChoiceButton(
        createNpcSvg(),
        '1P',
        this.selections.opponentMode === 'npc',
        () => {
          this.selections.opponentMode = 'npc';
          this.render();
        },
        {
          'data-opponent': 'npc',
          'aria-label': '1P (vs NPC)',
          title: '1P (vs NPC)',
        },
      ),
      this.buildIconChoiceButton(
        createTwoPlayerSvg(),
        '2P',
        this.selections.opponentMode === '2p',
        () => {
          this.selections.opponentMode = '2p';
          this.render();
        },
        {
          'data-opponent': '2p',
          'aria-label': '2P (로컬 대전)',
          title: '2P (로컬 대전)',
        },
      ),
    ];

    const scoreOptions: TargetScoreOption[] = [5, 10, 15];
    const scoreButtons = scoreOptions.map((score) =>
      this.buildIconChoiceButton(
        createTrophySvg(),
        `${score}`,
        this.selections.targetScore === score,
        () => {
          this.selections.targetScore = score;
          this.render();
        },
        {
          'data-score': String(score),
          'aria-label': `${score}점`,
          title: `${score}점`,
        },
      ),
    );

    sections.append(
      createOptionGroup('MODE', controlButtons),
      createOptionGroup('PLAYERS', opponentButtons),
      createOptionGroup('SCORE', scoreButtons),
    );

    const actions = document.createElement('div');
    actions.className = 'pop-menu-actions';

    if (this.selections.controlMode === 'motion') {
      const guideBtn = createButton(
        '모션 설명',
        'pop-btn pop-btn--cyan pop-guide-btn',
        () => {
          this.showMotionGuide = true;
          this.render();
        },
        { 'data-action': 'open-motion-guide' },
      );
      actions.appendChild(guideBtn);
    } else if (this.selections.controlMode === 'human') {
      const guideBtn = createButton(
        '사람 설명',
        'pop-btn pop-btn--cyan pop-guide-btn',
        () => {
          this.showHumanGuide = true;
          this.render();
        },
        { 'data-action': 'open-human-guide' },
      );
      actions.appendChild(guideBtn);
    }

    const startBtn = createButton(
      'GAME START!',
      'pop-btn pop-btn--magenta pop-start-btn',
      () => this.callbacks.onStartMatch(this.getSelections()),
      { 'data-action': 'start-game' },
    );
    actions.appendChild(startBtn);

    card.append(header, sections, actions);
    return card;
  }

  private buildMotionGuideModal(): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'pop-modal-backdrop';
    stopPointerPropagation(backdrop);

    const card = document.createElement('section');
    card.className = 'pop-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Motion Game Guide');
    stopPointerPropagation(card);

    const badge = document.createElement('span');
    badge.className = 'pop-badge pop-badge--cyan';
    badge.textContent = 'MOTION GUIDE';

    const title = document.createElement('h2');
    title.className = 'pop-guide-title';
    title.textContent = '모션 게임 방법';

    const list = document.createElement('ul');
    list.className = 'pop-guide-list';
    const items = [
      '📷 좌/우 분할: 각 코트 중앙의 카메라 화면에서 내 얼굴을 확인하며 플레이',
      '🏃 좌우 이동: 얼굴(머리)을 좌우로 움직이면 캐릭터가 코트 안에서 이동',
      '🙌 점프 & 스파이크: 제자리 점프 또는 두 손을 머리 위로 들기',
      '😊 인식 안내: 화면에 얼굴이 보이면 거리 제한 없이 바로 시작됩니다',
    ];
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }

    const closeBtn = createButton(
      '확인',
      'pop-btn pop-btn--magenta pop-start-btn',
      () => {
        this.showMotionGuide = false;
        this.render();
      },
      { 'data-action': 'close-motion-guide' },
    );

    card.append(badge, title, list, closeBtn);
    backdrop.appendChild(card);
    return backdrop;
  }

  private buildHumanGuideModal(): HTMLElement {
    const backdrop = document.createElement('div');
    backdrop.className = 'pop-modal-backdrop';
    stopPointerPropagation(backdrop);

    const card = document.createElement('section');
    card.className = 'pop-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Human Hand Mode Guide');
    stopPointerPropagation(card);

    const badge = document.createElement('span');
    badge.className = 'pop-badge pop-badge--cyan';
    badge.textContent = 'HUMAN + HAND';

    const title = document.createElement('h2');
    title.className = 'pop-guide-title';
    title.textContent = '사람 모드 방법';

    const list = document.createElement('ul');
    list.className = 'pop-guide-list';
    const items = [
      '🧑 내가 캐릭터: 웹캠 배경을 지우고 아바타 대신 내 모습이 코트에 들어갑니다',
      '✋ 손 좌우 이동: 카메라 앞에서 손을 좌우로 움직이면 캐릭터가 따라갑니다',
      '🤌 점프 & 스파이크: 엄지·검지 모으기(핀치), 주먹 쥐기 또는 손 들어올리기',
      '✌️ 2P 로컬 대전: 화면 좌/우 절반에서 각자 손 하나로 1:1 대결 가능',
    ];
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }

    const closeBtn = createButton(
      '확인',
      'pop-btn pop-btn--magenta pop-start-btn',
      () => {
        this.showHumanGuide = false;
        this.render();
      },
      { 'data-action': 'close-human-guide' },
    );

    card.append(badge, title, list, closeBtn);
    backdrop.appendChild(card);
    return backdrop;
  }

  private buildIconChoiceButton(
    icon: SVGSVGElement,
    labelText: string,
    selected: boolean,
    onClick: () => void,
    attrs: Record<string, string>,
  ): HTMLButtonElement {
    const btn = createButton(
      '',
      selected
        ? 'pop-btn pop-choice-btn pop-choice-tile is-selected'
        : 'pop-btn pop-choice-btn pop-choice-tile',
      onClick,
      {
        ...attrs,
        'aria-pressed': selected ? 'true' : 'false',
      },
    );
    const label = document.createElement('span');
    label.className = 'pop-choice-tile-label';
    label.textContent = labelText;
    btn.replaceChildren(icon, label);
    return btn;
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

    const fullscreenBtn = this.buildFullscreenButton(
      this.fullscreen
        ? 'pop-btn pop-btn--cyan pop-hud-btn pop-icon-btn'
        : 'pop-btn pop-hud-btn pop-icon-btn',
    );

    const menuBtn = createButton(
      '',
      'pop-btn pop-btn--magenta pop-hud-btn pop-icon-btn',
      () => this.callbacks.onReturnMenu(),
      {
        'data-action': 'open-menu',
        'aria-label': 'Return to menu',
        title: '메뉴',
      },
    );
    menuBtn.replaceChildren(createMenuSvg());

    rightGroup.append(fullscreenBtn, menuBtn);
    bar.append(leftGroup, rightGroup);
    return bar;
  }

  private buildFullscreenButton(className: string): HTMLButtonElement {
    const btn = createButton(
      '',
      className,
      () => {
        if (this.callbacks.onToggleFullscreen) {
          this.fullscreen = this.callbacks.onToggleFullscreen();
        } else {
          this.fullscreen = !this.fullscreen;
        }
        this.render();
      },
      {
        'data-action': 'toggle-fullscreen',
        'aria-label': this.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
        'aria-pressed': this.fullscreen ? 'true' : 'false',
        title: this.fullscreen ? '전체화면 종료' : '전체화면',
      },
    );
    btn.replaceChildren(createFullscreenSvg(this.fullscreen));
    return btn;
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
