import { describe, expect, it, vi } from 'vitest'
import { synthesize, type SoundName } from './synth'

function fakeCtx() {
  const param = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })
  const node = () => ({ connect: (n: unknown) => n })
  const osc = vi.fn(() => ({ ...node(), type: 'sine', frequency: param(), start: vi.fn(), stop: vi.fn() }))
  const gain = vi.fn(() => ({ ...node(), gain: param() }))
  const ctx = { currentTime: 0, destination: {}, createOscillator: osc, createGain: gain }
  return { ctx: ctx as unknown as AudioContext, osc }
}

describe('synthesize', () => {
  it('plays a two-note chime', () => {
    const name: SoundName = 'chime'
    const { ctx, osc } = fakeCtx()
    synthesize(ctx, name)
    expect(osc).toHaveBeenCalledTimes(2)
  })
})
