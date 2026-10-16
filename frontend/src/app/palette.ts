export const PALETTE = [
  { key: 'sunshine', hex: '#FFB703' },
  { key: 'tangerine', hex: '#FB8500' },
  { key: 'strawberry', hex: '#FF6B8B' },
  { key: 'bubblegum', hex: '#F7A8D8' },
  { key: 'grape', hex: '#B388EB' },
  { key: 'sky', hex: '#90CAF9' },
  { key: 'ocean', hex: '#4CC9F0' },
  { key: 'mint', hex: '#56CFA1' },
  { key: 'leaf', hex: '#8BC34A' },
  { key: 'sand', hex: '#E9C46A' },
] as const

export const INK = '#1B1B2F'

export type PaletteKey = (typeof PALETTE)[number]['key']

export function paletteByHex(hex: string | null | undefined) {
  if (!hex) return undefined
  const wanted = hex.toUpperCase()
  return PALETTE.find((entry) => entry.hex === wanted)
}
