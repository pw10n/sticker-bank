import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Artwork } from './Artwork'
import { ArtworkPicker } from './ArtworkPicker'
import { ARTWORK, ARTWORK_LIST, artworkForUse } from './catalog'

const SEED_KEYS = ['whale','lion','panda','unicorn','t-rex','octopus','rocket','ringed-planet','shooting-star','alien','crescent-moon','flying-saucer','taco','pizza','ice-cream','strawberry','doughnut','watermelon','racing-car','fire-engine','helicopter','sailboat','tractor','locomotive','glowing-star']

describe('catalog', () => {
  it('has every seed key as a sticker', () => {
    for (const k of SEED_KEYS) expect(ARTWORK[k]?.uses).toContain('sticker')
  })
  it('has an emoji for every entry', () => {
    for (const e of ARTWORK_LIST) expect(e.emoji.length).toBeGreaterThan(0)
  })
})

describe('Artwork', () => {
  it('renders img when file exists', () => {
    render(<Artwork artKey="whale" size={64} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/artwork/whale.webp')
    expect(img).toHaveAttribute('alt', ARTWORK.whale.name)
  })
  it('renders emoji when no file', () => {
    const original = ARTWORK.whale.file
    ;(ARTWORK.whale as { file: string | null }).file = null
    render(<Artwork artKey="whale" size={50} />)
    expect(screen.getByRole('img')).toHaveTextContent(ARTWORK.whale.emoji)
    ;(ARTWORK.whale as { file: string | null }).file = original
  })
  it('falls back for unknown key', () => {
    render(<Artwork artKey="nope" size={50} />)
    expect(screen.getByRole('img', { name: 'Picture' })).toHaveTextContent('⭐')
  })
  it('decorative has empty alt', () => {
    const { container } = render(<Artwork artKey="whale" size={50} decorative />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})

describe('ArtworkPicker', () => {
  it('lists only entries with the use', () => {
    render(<ArtworkPicker use="avatar" value={null} onChange={() => {}} label="Avatar" />)
    expect(screen.getAllByRole('button')).toHaveLength(artworkForUse('avatar').length)
  })
  it('searches by name and tag', async () => {
    const user = userEvent.setup()
    render(<ArtworkPicker use="sticker" value={null} onChange={() => {}} label="Art" />)
    const box = screen.getByRole('searchbox')
    await user.type(box, 'WHALE')
    expect(screen.getByRole('button', { name: /Happy Whale/ })).toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'ocean')
    expect(screen.getByRole('button', { name: /Happy Whale/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Lion/ })).toBeNull()
  })
  it('calls onChange and marks selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ArtworkPicker use="sticker" value="lion" onChange={onChange} label="Art" />)
    expect(screen.getByRole('button', { name: /Lion/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /Happy Whale/ }))
    expect(onChange).toHaveBeenCalledWith('whale')
  })
})
