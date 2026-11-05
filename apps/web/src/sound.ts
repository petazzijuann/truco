/**
 * Sound effects, synthesised rather than sampled.
 *
 * Everything here is built out of oscillators and filtered noise, so the app ships no
 * audio files, nothing to license, and nothing to download. Each effect is a short
 * gesture rather than a literal recording: a card is a filtered noise burst, a call
 * is a two-note rise, a point is a soft click.
 *
 * The context is created lazily on the first play, because browsers only allow audio
 * to start after the user has interacted with the page.
 */
export type Effect = 'shuffle' | 'card' | 'call' | 'point' | 'win' | 'lose';

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context !== null) return context;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor === undefined) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** A short burst of band-passed white noise -- the texture of cards on cloth. */
function noise(
  ctx: AudioContext,
  at: number,
  duration: number,
  centre: number,
  gain: number,
): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Fade in and out so there is no click at either edge.
    const envelope = Math.sin((Math.PI * i) / frames);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = centre;
  filter.Q.value = 0.8;

  const volume = ctx.createGain();
  volume.gain.value = gain;

  source.connect(filter).connect(volume).connect(ctx.destination);
  source.start(at);
  source.stop(at + duration);
}

/** A single soft tone with a percussive envelope. */
function tone(
  ctx: AudioContext,
  at: number,
  frequency: number,
  duration: number,
  gain = 0.1,
  type: OscillatorType = 'triangle',
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = frequency;

  const volume = ctx.createGain();
  volume.gain.setValueAtTime(0, at);
  volume.gain.linearRampToValueAtTime(gain, at + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  osc.connect(volume).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

export function playSound(effect: Effect, enabled: boolean): void {
  if (!enabled) return;
  const ctx = audio();
  if (ctx === null) return;
  // Some browsers start the context suspended until a gesture resumes it.
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  switch (effect) {
    case 'shuffle':
      for (let i = 0; i < 7; i++) {
        noise(ctx, now + i * 0.045, 0.05, 1_400 + Math.random() * 900, 0.055);
      }
      break;

    case 'card':
      noise(ctx, now, 0.07, 1_100, 0.09);
      tone(ctx, now, 180, 0.06, 0.03, 'sine');
      break;

    case 'call':
      tone(ctx, now, 392, 0.1, 0.07);
      tone(ctx, now + 0.09, 523.25, 0.14, 0.06);
      break;

    case 'point':
      tone(ctx, now, 880, 0.07, 0.05, 'sine');
      break;

    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        tone(ctx, now + index * 0.1, frequency, 0.28, 0.07);
      });
      break;

    case 'lose':
      [392, 329.63, 261.63].forEach((frequency, index) => {
        tone(ctx, now + index * 0.13, frequency, 0.34, 0.07);
      });
      break;
  }
}

/** Nudge the audio context awake on the first interaction, so later cues are instant. */
export function primeAudio(): void {
  const ctx = audio();
  if (ctx !== null && ctx.state === 'suspended') void ctx.resume();
}
