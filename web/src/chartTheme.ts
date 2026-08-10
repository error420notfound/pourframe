export function cssColor(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export function displayP3Color(p3: readonly [number, number, number], fallback: readonly [number, number, number], alpha = 1) {
  const supportsP3 = typeof CSS !== 'undefined' && CSS.supports('color', 'color(display-p3 1 1 1)')
  return supportsP3
    ? `color(display-p3 ${p3.join(' ')} / ${alpha})`
    : `rgba(${fallback.join(', ')}, ${alpha})`
}

export function withAlpha(color: string, alpha: number) {
  const value = color.trim()
  const p3 = value.match(/^color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+)?\)$/i)
  if (p3) return `color(display-p3 ${p3[1]} ${p3[2]} ${p3[3]} / ${alpha})`

  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex
    const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16))
    return `rgba(${channels.join(', ')}, ${alpha})`
  }

  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  return value
}
