import type { Point } from '../chartTypes'

type PixelPoint = { x: number; y: number }

function perpendicularDistance(point: PixelPoint, start: PixelPoint, end: PixelPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 0.000001) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function simplifyRdp(points: Point[], pixels: PixelPoint[], epsilon: number): Point[] {
  if (points.length <= 2) return points

  let maxDistance = 0
  let maxIndex = 0
  const start = pixels[0]
  const end = pixels[pixels.length - 1]

  for (let i = 1; i < pixels.length - 1; i += 1) {
    const distance = perpendicularDistance(pixels[i], start, end)
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = i
    }
  }

  if (maxDistance <= epsilon) return [points[0], points[points.length - 1]]

  const left = simplifyRdp(points.slice(0, maxIndex + 1), pixels.slice(0, maxIndex + 1), epsilon)
  const right = simplifyRdp(points.slice(maxIndex), pixels.slice(maxIndex), epsilon)
  return [...left.slice(0, -1), ...right]
}

function thinByDistance(points: Point[], pointToPixel: (point: Point) => PixelPoint, minDistance: number) {
  if (points.length <= 2) return points

  const thinned: Point[] = [points[0]]
  let lastPixel = pointToPixel(points[0])

  for (let i = 1; i < points.length - 1; i += 1) {
    const pixel = pointToPixel(points[i])
    if (Math.hypot(pixel.x - lastPixel.x, pixel.y - lastPixel.y) < minDistance) continue
    thinned.push(points[i])
    lastPixel = pixel
  }

  thinned.push(points[points.length - 1])
  return thinned
}

export function simplifyFreehandDrawingPoints(
  points: Point[],
  pointToPixel: (point: Point) => PixelPoint,
  options: { minDistance: number; epsilon: number; maxPoints: number },
) {
  if (points.length <= 2) return points

  const thinned = thinByDistance(points, pointToPixel, options.minDistance)
  const pixels = thinned.map(pointToPixel)
  let simplified = simplifyRdp(thinned, pixels, options.epsilon)

  if (simplified.length > options.maxPoints) {
    const step = Math.ceil(simplified.length / options.maxPoints)
    simplified = simplified.filter((_, index) => index === 0 || index === simplified.length - 1 || index % step === 0)
  }

  return simplified.length >= 2 ? simplified : points.slice(0, 2)
}
