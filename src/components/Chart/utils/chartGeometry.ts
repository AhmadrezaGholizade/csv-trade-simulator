function distToSegment(px: number, py: number, a: {x:number,y:number}, b: {x:number,y:number}): number {
    const dx = b.x - a.x, dy = b.y - a.y
    const lenSq = dx*dx + dy*dy
    if (lenSq === 0) return Math.hypot(px - a.x, py - a.y)
    const t = Math.max(0, Math.min(1, ((px-a.x)*dx + (py-a.y)*dy) / lenSq))
    return Math.hypot(px - (a.x + t*dx), py - (a.y + t*dy))
}

function yOnSegmentLineAtX(start: { x: number; y: number }, end: { x: number; y: number }, x: number) {
    const dx = end.x - start.x
    if (Math.abs(dx) < 0.0001) return start.y
    const t = (x - start.x) / dx
    return start.y + (end.y - start.y) * t
}

function getMidpoint(start: { x: number; y: number }, end: { x: number; y: number }) {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
}

function getDisjointInverseEnd(
  start: { x: number; y: number },
  end: { x: number; y: number },
  inverseStart: { x: number; y: number },
) {
  return {
    x: start.x,
    y: inverseStart.y + (end.y - start.y),
  }
}

function getChannelGeometry(pixels: { x: number; y: number }[]) {
    if (pixels.length < 3) return null
    const [start, end, widthPoint] = pixels
    const offsetY = widthPoint.y - yOnSegmentLineAtX(start, end, widthPoint.x)
    const parallelStart = { x: start.x, y: start.y + offsetY }
    const parallelEnd = { x: end.x, y: end.y + offsetY }
    return {
    offsetY,
    parallelStart,
    parallelEnd,
    baseMiddle: getMidpoint(start, end),
    parallelMiddle: getMidpoint(parallelStart, parallelEnd),
    }
}

export { distToSegment, yOnSegmentLineAtX, getMidpoint, getDisjointInverseEnd, getChannelGeometry }