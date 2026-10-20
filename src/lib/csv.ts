import type { Candle } from '../types/index.ts'

function cells(line: string, delimiter: string): string[] {
  const result: string[] = []; let value = ''; let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (c === delimiter && !quoted) { result.push(value.trim()); value = '' }
    else value += c
  }
  if (quoted) throw new Error('Unclosed CSV quote')
  result.push(value.trim()); return result
}

export function parseCsv(text: string): Candle[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())
  if (lines.length < 3) throw new Error('CSV must contain a header and at least two candles.')
  const delimiter = ['\t', ';', ','].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0]
  const headers = cells(lines[0], delimiter).map(h => h.toLowerCase().replace(/[<>\s_]/g, ''))
  const column = (...names: string[]) => headers.findIndex(h => names.includes(h))
  const ts = column('ts', 'timestamp', 'datetime', 'date', 'time'); const time = column('time')
  const o = column('open'); const h = column('high'); const l = column('low'); const c = column('close'); const v = column('volume', 'vol', 'tickvol', 'tickvolume')
  if ([ts, o, h, l, c].some(i => i < 0)) throw new Error('Required columns: timestamp/date, open, high, low, close.')
  const seen = new Set<number>()
  const candles = lines.slice(1).map((line, index) => {
    const row = cells(line, delimiter)
    let raw = row[ts] ?? ''
    if (headers[ts] === 'date' && time >= 0 && time !== ts) raw += 'T' + row[time]
    let millis: number
    if (/^\d{10,13}$/.test(raw)) millis = Number(raw) * (raw.length === 10 ? 1000 : 1)
    else {
      raw = raw.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3').replace(' ', 'T')
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00'
      if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += 'Z'
      millis = Date.parse(raw)
    }
    const number = (i: number) => row[i]?.trim() ? Number(row[i]) : NaN
    const candle = { ts: '', open: number(o), high: number(h), low: number(l), close: number(c), volume: v < 0 ? 0 : number(v) }
    if (!Number.isFinite(millis) || Object.entries(candle).some(([key, value]) => key !== 'ts' && !Number.isFinite(value)) || candle.volume < 0 || candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close) || candle.low > candle.high) throw new Error(`Invalid candle on CSV row ${index + 2}.`)
    if (seen.has(millis)) throw new Error(`Duplicate timestamp on CSV row ${index + 2}.`)
    seen.add(millis); candle.ts = new Date(millis).toISOString(); return candle
  })
  return candles.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  const buckets: Candle[] = []; const size = minutes * 60000
  for (const candle of candles) {
    const ts = new Date(Math.floor(Date.parse(candle.ts) / size) * size).toISOString()
    const last = buckets.at(-1)
    if (last?.ts === ts) { last.high = Math.max(last.high, candle.high); last.low = Math.min(last.low, candle.low); last.close = candle.close; last.volume += candle.volume }
    else buckets.push({ ...candle, ts })
  }
  return buckets
}
