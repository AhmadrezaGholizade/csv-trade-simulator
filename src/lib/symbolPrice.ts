export { getSymbolMinMove, getSymbolPricePrecision } from './marketConfig.ts'
import { getSymbolPricePrecision } from './marketConfig.ts'

export function roundSymbolPrice(symbol: string, price: number) {
  const precision = getSymbolPricePrecision(symbol)
  return Number(price.toFixed(precision))
}

export function formatSymbolPrice(symbol: string, price: number) {
  return roundSymbolPrice(symbol, price).toFixed(getSymbolPricePrecision(symbol))
}

export function isSymbolPriceAligned(symbol: string, price: number) {
  if (!Number.isFinite(price)) return false
  const factor = 10 ** getSymbolPricePrecision(symbol)
  const scaled = price * factor
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6
}
