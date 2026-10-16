export type SoundName = 'pop' | 'fanfare' | 'stick' | 'tap' | 'error'

type Shape = OscillatorType

function blip(
  ctx: AudioContext,
  opts: { type: Shape; from: number; to?: number; start?: number; dur: number; gain: number },
) {
  const t0 = ctx.currentTime + (opts.start ?? 0)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.from, t0)
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(opts.gain, t0 + Math.min(0.01, opts.dur / 4))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + opts.dur + 0.02)
}

const NOTES = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6

export function synthesize(ctx: AudioContext, name: SoundName): void {
  switch (name) {
    case 'pop':
      blip(ctx, { type: 'sine', from: 600, to: 900, dur: 0.08, gain: 0.35 })
      break
    case 'tap':
      blip(ctx, { type: 'sine', from: 1200, to: 800, dur: 0.04, gain: 0.2 })
      break
    case 'stick':
      blip(ctx, { type: 'sine', from: 900, to: 200, dur: 0.12, gain: 0.3 })
      break
    case 'error':
      blip(ctx, { type: 'square', from: 140, dur: 0.15, gain: 0.08 })
      break
    case 'fanfare':
      NOTES.forEach((f, i) => {
        const last = i === NOTES.length - 1
        blip(ctx, { type: 'triangle', from: f, start: i * 0.2, dur: last ? 0.6 : 0.25, gain: 0.3 })
      })
      break
  }
}
