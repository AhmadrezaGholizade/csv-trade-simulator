export const DEFAULT_SYMBOL = 'EUR_USD'
export const DEFAULT_TIMEFRAME = '5m'

type SymbolMarket = 'forex' | 'metal' | 'crypto'

type SymbolConfig = {
  market: SymbolMarket
  precision: number
  spreadTicks: number
  pnlMultiplier: number
}

const DEFAULT_PNL_MULTIPLIER = 1000

const BASE_SYMBOL_CONFIGS: Record<string, SymbolConfig> = {
  EUR_USD: { market: 'forex', precision: 5, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  GBP_USD: { market: 'forex', precision: 5, spreadTicks: 12, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_JPY: { market: 'forex', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  AUD_USD: { market: 'forex', precision: 5, spreadTicks: 12, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_CAD: { market: 'forex', precision: 5, spreadTicks: 15, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_CHF: { market: 'forex', precision: 5, spreadTicks: 15, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  NZD_USD: { market: 'forex', precision: 5, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  EUR_JPY: { market: 'forex', precision: 3, spreadTicks: 12, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  GBP_JPY: { market: 'forex', precision: 3, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  EUR_GBP: { market: 'forex', precision: 5, spreadTicks: 12, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_CNH: { market: 'forex', precision: 5, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  AUD_JPY: { market: 'forex', precision: 3, spreadTicks: 15, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  EUR_AUD: { market: 'forex', precision: 5, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  EUR_CHF: { market: 'forex', precision: 5, spreadTicks: 15, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  CAD_JPY: { market: 'forex', precision: 3, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  GBP_AUD: { market: 'forex', precision: 5, spreadTicks: 22, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  AUD_NZD: { market: 'forex', precision: 5, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  AUD_CAD: { market: 'forex', precision: 5, spreadTicks: 18, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_MXN: { market: 'forex', precision: 5, spreadTicks: 35, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_ZAR: { market: 'forex', precision: 5, spreadTicks: 40, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  USD_TRY: { market: 'forex', precision: 5, spreadTicks: 50, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  XAU_USD: { market: 'metal', precision: 3, spreadTicks: 20, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  XAG_USD: { market: 'metal', precision: 3, spreadTicks: 20, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  XPT_USD: { market: 'metal', precision: 3, spreadTicks: 30, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  BTC_USDT: { market: 'crypto', precision: 2, spreadTicks: 50, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  ETH_USDT: { market: 'crypto', precision: 2, spreadTicks: 50, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  BNB_USDT: { market: 'crypto', precision: 2, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  SOL_USDT: { market: 'crypto', precision: 2, spreadTicks: 5, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  XRP_USDT: { market: 'crypto', precision: 4, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  DOGE_USDT: { market: 'crypto', precision: 5, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  ADA_USDT: { market: 'crypto', precision: 4, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  SUI_USDT: { market: 'crypto', precision: 4, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  TRX_USDT: { market: 'crypto', precision: 4, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  LINK_USDT: { market: 'crypto', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  AVAX_USDT: { market: 'crypto', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  TON_USDT: { market: 'crypto', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  LTC_USDT: { market: 'crypto', precision: 2, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  DOT_USDT: { market: 'crypto', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  SHIB_USDT: { market: 'crypto', precision: 8, spreadTicks: 1, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
  PEPE_USDT: { market: 'crypto', precision: 8, spreadTicks: 1, pnlMultiplier: DEFAULT_PNL_MULTIPLIER },
}

function inferSymbolConfig(symbol: string): SymbolConfig {
  if (symbol.endsWith('_JPY')) return { market: 'forex', precision: 3, spreadTicks: 15, pnlMultiplier: DEFAULT_PNL_MULTIPLIER }
  if (symbol.startsWith('X')) return { market: 'metal', precision: 3, spreadTicks: 20, pnlMultiplier: DEFAULT_PNL_MULTIPLIER }
  if (symbol.endsWith('_USDT')) return { market: 'crypto', precision: 3, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER }
  return { market: 'forex', precision: 5, spreadTicks: 10, pnlMultiplier: DEFAULT_PNL_MULTIPLIER }
}

export function getSymbolConfig(symbol: string) {
  const normalized = symbol.trim().toUpperCase()
  return BASE_SYMBOL_CONFIGS[normalized] ?? inferSymbolConfig(normalized)
}

export function getSymbolPricePrecision(symbol: string) {
  return getSymbolConfig(symbol).precision
}

export function getSymbolMinMove(symbol: string) {
  return 10 ** -getSymbolPricePrecision(symbol)
}

export function getDefaultSpreadForSymbol(symbol: string) {
  const config = getSymbolConfig(symbol)
  return config.spreadTicks * getSymbolMinMove(symbol)
}

export function getSpreadInputStep(symbol: string) {
  return getSymbolMinMove(symbol)
}

export function getOrderLevelStep(symbol: string, spread: number, multiplier = 50) {
  return Math.max(getSymbolMinMove(symbol) * multiplier, spread * multiplier)
}

export function getSymbolPnlMultiplier(symbol: string) {
  return getSymbolConfig(symbol).pnlMultiplier
}

export function calculateSymbolPnl(symbol: string, side: 'buy' | 'sell', openPrice: number, closePrice: number, lots: number) {
  const direction = side === 'buy' ? 1 : -1
  return direction * (closePrice - openPrice) * lots * getSymbolPnlMultiplier(symbol)
}

export function calculateRequiredMargin(symbol: string, price: number, lots: number, leverage: number) {
  return price * lots * getSymbolPnlMultiplier(symbol) / Math.max(1, leverage)
}
