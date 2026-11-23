import type { GameState, MatchPhase } from '../core/types';

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Web Audio API Pop-Art arcade synthesizer for volleyball gameplay SFX.
 * Safely no-ops in headless/Node environments or while muted.
 */
export class PopArtAudio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private prevGrounded: [boolean, boolean] = [true, true];

  /** Unlocks and resumes the AudioContext on user gesture. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Ignore browser autoplay policy errors until next user gesture.
      });
    }
  }

  /** Mutes or unmutes all synthesized sound effects. */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Returns whether audio playback is currently muted. */
  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) {
      return null;
    }
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private readyContext(): AudioContext | null {
    if (this.muted) {
      return null;
    }
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') {
      return null;
    }
    return ctx;
  }

  private playTone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    gainPeak: number,
    startOffset = 0,
  ): void {
    const ctx = this.readyContext();
    if (!ctx) {
      return;
    }

    const now = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, startFreq), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoiseBurst(duration: number, filterFreq: number, gainPeak: number): void {
    const ctx = this.readyContext();
    if (!ctx) {
      return;
    }

    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
    source.stop(now + duration + 0.01);
  }

  /** Crisp upward arcade boing for jumping. */
  playJump(): void {
    this.playTone('triangle', 260, 580, 0.14, 0.18);
  }

  /** Snappy pop for regular ball volleys. */
  playVolley(): void {
    this.playTone('triangle', 380, 190, 0.09, 0.22);
    this.playNoiseBurst(0.04, 1400, 0.08);
  }

  /** Punchy comic smash impact for aerial spikes. */
  playSpike(): void {
    this.playTone('square', 220, 68, 0.16, 0.24);
    this.playNoiseBurst(0.11, 950, 0.22);
  }

  /** Quick whoosh for diving slides. */
  playDive(): void {
    this.playNoiseBurst(0.14, 720, 0.14);
    this.playTone('triangle', 320, 140, 0.12, 0.1);
  }

  /** Hollow rubber thud for net collisions. */
  playNet(): void {
    this.playTone('triangle', 175, 110, 0.11, 0.2);
  }

  /** Bright two-note chime for scoring a point. */
  playScore(): void {
    this.playTone('square', 523.25, 523.25, 0.1, 0.14, 0);
    this.playTone('square', 659.25, 659.25, 0.18, 0.16, 0.09);
  }

  /** Upbeat 4-note arcade fanfare for winning the match. */
  playWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      this.playTone('square', freq, freq, idx === 3 ? 0.34 : 0.11, 0.15, idx * 0.1);
    });
  }

  /** Consumes frame physics events and phase transitions to play matching SFX. */
  consumeEvents(state: GameState, prevPhase: MatchPhase): void {
    for (let i = 0; i < 2; i++) {
      const player = state.players[i];
      if (this.prevGrounded[i] && !player.isGrounded && player.vy < 0) {
        this.playJump();
      }
      this.prevGrounded[i] = player.isGrounded;
    }

    const events = state.lastEvents;
    if (events.spikedBy) {
      this.playSpike();
    } else if (events.volleyBy) {
      this.playVolley();
    }

    if (events.slidBy) {
      this.playDive();
    }

    if (events.netHit) {
      this.playNet();
    }

    if (state.phase === 'POINT_SCORED' && prevPhase !== 'POINT_SCORED') {
      this.playScore();
    } else if (state.phase === 'MATCH_OVER' && prevPhase !== 'MATCH_OVER') {
      this.playWin();
    }
  }
}
