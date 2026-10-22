/**
 * Game sound effects synthesised with the Web Audio API (no audio files), sharing one AudioContext.
 * Graph: oscillators → sfxGain → masterGain → destination; muting ramps masterGain to 0.
 */
import { useSyncExternalStore } from 'react';

// Context and gain graph (created lazily)

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

const SFX_LEVEL = 0.5;
const MUTE_KEY = 'learnsync.games.muted';

function readMutedPref(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMutedPref();

/** Ensures the shared AudioContext and gain nodes exist; null without Web Audio (audio becomes a no-op). */
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;

  const AC: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 1;
  masterGain.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = SFX_LEVEL;
  sfxGain.connect(masterGain);

  return ctx;
}

/** Browsers suspend the context until a user gesture; resume whenever we can. */
function resume(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

// One-time gesture listener so audio unlocks on the first interaction.
if (typeof window !== 'undefined') {
  const unlock = () => {
    ensureContext();
    resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

// Mute state (persisted, observable by the header toggle)

const muteListeners = new Set<() => void>();

export function subscribeMuted(cb: () => void): () => void {
  muteListeners.add(cb);
  return () => {
    muteListeners.delete(cb);
  };
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* ignore storage failures (private mode etc.) */
  }
  if (masterGain && ctx) {
    // A short ramp avoids a click.
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(next ? 0 : 1, ctx.currentTime, 0.02);
  }
  muteListeners.forEach((cb) => cb());
}

// Sound effects

export type SfxName = 'correct' | 'wrong' | 'click' | 'tick' | 'hint' | 'victory';

/** Plays a single tone with a percussive attack/decay envelope. */
function tone(freq: number, start: number, duration: number, type: OscillatorType, peak: number): void {
  if (!ctx || !sfxGain) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(sfxGain);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** A tone whose pitch slides from `from` to `to` (used for the "wrong" buzz). */
function sweep(from: number, to: number, start: number, duration: number, type: OscillatorType, peak: number): void {
  if (!ctx || !sfxGain) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(peak, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(sfxGain);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const SEMITONE = Math.pow(2, 1 / 12);

/** Plays a sound effect; `step` raises the pitch by semitones (for combos). No-op without Web Audio. */
export function play(name: SfxName, step = 0): void {
  const context = ensureContext();
  if (!context) return;
  resume();
  const t = context.currentTime;
  const shift = Math.pow(SEMITONE, Math.min(step, 12));

  switch (name) {
    case 'correct': {
      // Bright two-note rise, brightened further as the combo climbs.
      tone(523.25 * shift, t, 0.12, 'triangle', 0.6); // C5
      tone(783.99 * shift, t + 0.09, 0.18, 'triangle', 0.6); // G5
      break;
    }
    case 'wrong': {
      // Low descending buzz.
      sweep(220, 110, t, 0.28, 'sawtooth', 0.5);
      break;
    }
    case 'click': {
      // Very short soft blip.
      tone(660, t, 0.06, 'sine', 0.35);
      break;
    }
    case 'tick': {
      // Short, dry clock tick for the countdown.
      tone(1050, t, 0.04, 'square', 0.45);
      break;
    }
    case 'hint': {
      // Fast ascending sparkle.
      tone(880, t, 0.08, 'triangle', 0.4);
      tone(1174.66, t + 0.06, 0.08, 'triangle', 0.4);
      tone(1567.98, t + 0.12, 0.12, 'triangle', 0.4);
      break;
    }
    case 'victory': {
      // Four-note ascending jingle.
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((f, i) => tone(f, t + i * 0.13, 0.28, 'triangle', 0.55));
      break;
    }
  }
}

// React bindings

/** Returns `play` for triggering sound effects. */
export function useGameAudio(): { play: (name: SfxName, step?: number) => void } {
  return { play };
}

/** Subscribes a component to the shared mute state. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribeMuted, isMuted, isMuted);
}
