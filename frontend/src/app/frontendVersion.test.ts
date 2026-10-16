import { describe, expect, it } from 'vitest'
import { isFrontendOutdated } from './frontendVersion'

describe('isFrontendOutdated', () => {
  it('is true only when the build is older than the minimum', () => {
    expect(isFrontendOutdated('1.0.0', '1.1.0')).toBe(true)
    expect(isFrontendOutdated('1.9.9', '2.0.0')).toBe(true)
    expect(isFrontendOutdated('1.1.0', '1.1.1')).toBe(true)
    expect(isFrontendOutdated('1.1.0', '1.1.0')).toBe(false)
    expect(isFrontendOutdated('1.2.0', '1.1.9')).toBe(false)
    expect(isFrontendOutdated('2.0.0', '1.99.99')).toBe(false)
  })

  it('compares numbers, not text', () => {
    expect(isFrontendOutdated('1.9.0', '1.10.0')).toBe(true)
    expect(isFrontendOutdated('1.10.0', '1.9.0')).toBe(false)
  })

  it('uses only the numeric x.y.z part', () => {
    expect(isFrontendOutdated('1.1.0-rc1', '1.1.0')).toBe(false)
    expect(isFrontendOutdated('1.0.0+build5', '1.1.0')).toBe(true)
  })

  it('never forces a reload for a dev build, a missing minimum, or anything unparseable', () => {
    expect(isFrontendOutdated('dev', '9.9.9')).toBe(false)
    expect(isFrontendOutdated('1.0.0', null)).toBe(false)
    expect(isFrontendOutdated('1.0.0', 'latest')).toBe(false)
    expect(isFrontendOutdated('1.0', '1.1.0')).toBe(false)
    expect(isFrontendOutdated('', '')).toBe(false)
  })
})
