export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function stickerWord(n: number): string {
  return `${n} ${n === 1 ? 'sticker' : 'stickers'}`
}
