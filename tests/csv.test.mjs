import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, aggregateCandles } from '../src/lib/csv.ts'
const header = 'timestamp,open,high,low,close,volume\n'
const csv = header + '2025-01-01T00:01:00Z,2,3,1,2,5\n2025-01-01T00:00:00Z,1,2,1,2,4'
test('sorts and aggregates OHLCV', () => { const bars = parseCsv(csv); assert.equal(bars[0].open, 1); assert.deepEqual(aggregateCandles(bars, 5), [{ ts: '2025-01-01T00:00:00.000Z', open: 1, high: 3, low: 1, close: 2, volume: 9 }]) })
test('rejects malformed candles and duplicates', () => { assert.throws(() => parseCsv(csv.replace(',3,1,', ',1,1,'))); assert.throws(() => parseCsv(csv.replace('00:01:', '00:00:'))); assert.throws(() => parseCsv(csv.replace(',2,3,', ',,3,'))) })
test('accepts MetaTrader TSV and flat bars', () => { const bars = parseCsv('<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n2025.01.01\t00:00:00\t1\t1\t1\t1\n2025.01.01\t00:01:00\t1\t1\t1\t1'); assert.equal(bars.length, 2); assert.equal(bars[0].volume, 0) })
test('accepts Unix seconds and quoted semicolon CSV', () => { const bars = parseCsv('timestamp;open;high;low;close\n"1735689600";1;2;1;2\n1735689660;2;3;1;2'); assert.equal(bars[0].ts, '2025-01-01T00:00:00.000Z') })
