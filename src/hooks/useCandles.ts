import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCandles, fetchMeta } from '../api'
import { useSimStore } from '../store/simStore'

const CANDLE_CHUNK_SIZE = 1000
const WINDOW_CANDLE_LIMIT = 2000
const PREFETCH_THRESHOLD = 20
const BACKFILL_THRESHOLD = 1500
const INITIAL_VISIBLE_CANDLES = 30

function validCandles(candles: Awaited<ReturnType<typeof fetchCandles>>) {
  return candles.filter(candle =>
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    !Number.isNaN(new Date(candle.ts).getTime())
  )
}

function getLastTimestamp(candles: Awaited<ReturnType<typeof fetchCandles>>) {
  return candles.at(-1)?.ts ?? null
}

function getFirstTimestamp(candles: Awaited<ReturnType<typeof fetchCandles>>) {
  return candles[0]?.ts ?? null
}

function mergeCandles(...groups: Awaited<ReturnType<typeof fetchCandles>>[]) {
  const byTime = new Map<string, Awaited<ReturnType<typeof fetchCandles>>[number]>()
  groups.flat().forEach(candle => byTime.set(candle.ts, candle))
  return [...byTime.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
}

function afterTimestamp(candles: Awaited<ReturnType<typeof fetchCandles>>, ts: string) {
  const time = new Date(ts).getTime()
  return candles.filter(candle => new Date(candle.ts).getTime() > time)
}

function fromTimestamp(candles: Awaited<ReturnType<typeof fetchCandles>>, ts: string) {
  const time = new Date(ts).getTime()
  return candles.filter(candle => new Date(candle.ts).getTime() >= time)
}

function timestampReached(ts: string | null, target: string | null) {
  if (!target) return true
  if (!ts) return false
  return new Date(ts).getTime() >= new Date(target).getTime()
}

function hasCandlesBefore(cursor: string | null, datasetStart: string | null) {
  if (!cursor || !datasetStart) return false
  const cursorTime = new Date(cursor).getTime()
  const datasetStartTime = new Date(datasetStart).getTime()
  return Number.isFinite(cursorTime) && Number.isFinite(datasetStartTime) && cursorTime > datasetStartTime
}

async function collectInitialCandles(symbol: string, timeframe: string, cursor: string, targetTs: string | null = null) {
  let currentCursor = cursor
  let collected: Awaited<ReturnType<typeof fetchCandles>> = []
  let hasMoreData = true
  let reachedTarget = timestampReached(cursor, targetTs)

  while ((collected.length < INITIAL_VISIBLE_CANDLES || !reachedTarget) && hasMoreData) {
    const rawChunk = await fetchCandles({ symbol, timeframe, from_ts: currentCursor, limit: CANDLE_CHUNK_SIZE })
    const nextRaw = collected.length === 0 ? fromTimestamp(rawChunk, currentCursor) : afterTimestamp(rawChunk, currentCursor)
    const nextValid = validCandles(nextRaw)
    collected = [...collected, ...nextValid]

    const lastRawTs = getLastTimestamp(rawChunk)
    reachedTarget = timestampReached(lastRawTs, targetTs)
    hasMoreData = Boolean(lastRawTs) && lastRawTs !== currentCursor && rawChunk.length >= CANDLE_CHUNK_SIZE
    if (lastRawTs) currentCursor = lastRawTs
  }

  return { candles: collected, cursor: currentCursor, hasMoreData }
}

async function collectWindowAroundTarget(symbol: string, timeframe: string, targetTs: string) {
  const beforeRaw = await fetchCandles({ symbol, timeframe, before_ts: targetTs, limit: WINDOW_CANDLE_LIMIT })
  const afterRaw = await fetchCandles({ symbol, timeframe, from_ts: targetTs, limit: CANDLE_CHUNK_SIZE })
  const before = validCandles(beforeRaw)
  const after = validCandles(afterRaw)
  const candles = mergeCandles(before, after)
  const cursor = getLastTimestamp(candles) ?? targetTs
  const hasMoreData = afterRaw.length >= CANDLE_CHUNK_SIZE
  const hasPreviousData = beforeRaw.length >= WINDOW_CANDLE_LIMIT
  return { candles, cursor, hasMoreData, hasPreviousData }
}

export function useCandles() {
  const setCandles = useSimStore(s => s.setCandles)
  const appendCandles = useSimStore(s => s.appendCandles)
  const prependCandles = useSimStore(s => s.prependCandles)
  const candles = useSimStore(s => s.candles)
  const visibleIndex = useSimStore(s => s.visibleIndex)
  const symbol = useSimStore(s => s.symbol)
  const timeframe = useSimStore(s => s.timeframe)
  const candleReloadTarget = useSimStore(s => s.candleReloadTarget)
  const sessionStart = useSimStore(s => s.config.sessionStart)
  const sessionVersion = useSimStore(s => s.sessionVersion)
  const firstCandleTs = candles[0]?.ts ?? null
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingPrevious, setLoadingPrevious] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [hasPrevious, setHasPrevious] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadMoreCursorRef = useRef<string | null>(null)
  const loadPreviousCursorRef = useRef<string | null>(null)
  const sessionKeyRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const sessionKey = sessionKeyRef.current + 1
        sessionKeyRef.current = sessionKey
        loadMoreCursorRef.current = null
        loadPreviousCursorRef.current = null
        setLoading(true)
        setHasMore(true)
        setHasPrevious(false)
        setError(null)
        const meta = await fetchMeta(symbol)
        const cursor = sessionStart || meta.start
        if (!cursor) {
          setCandles([])
          setHasMore(false)
          return
        }

        let result = candleReloadTarget
          ? await collectWindowAroundTarget(symbol, timeframe, candleReloadTarget)
          : await collectInitialCandles(symbol, timeframe, cursor)
        const usedFallbackStart = Boolean(
          !cancelled &&
          sessionKeyRef.current === sessionKey &&
          result.candles.length === 0 &&
          sessionStart &&
          meta.start &&
          !candleReloadTarget &&
          sessionStart !== meta.start
        )

        if (usedFallbackStart && meta.start) {
          result = await collectInitialCandles(symbol, timeframe, meta.start)
        }

        if (!cancelled && sessionKeyRef.current === sessionKey) {
          const initialCursor = usedFallbackStart ? meta.start : cursor
          const hasPreviousData = 'hasPreviousData' in result
            ? Boolean((result as { hasPreviousData: boolean }).hasPreviousData)
            : hasCandlesBefore(initialCursor, meta.start)
          loadMoreCursorRef.current = result.cursor
          loadPreviousCursorRef.current = getFirstTimestamp(result.candles)
          setCandles(result.candles)
          setHasMore(result.hasMoreData)
          setHasPrevious(hasPreviousData)
        }
      } catch (err) {
        if (!cancelled) { setCandles([]); setHasMore(false); useSimStore.getState().setPlaying(false); setError(err instanceof Error ? err.message : 'Failed to load candles') }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [candleReloadTarget, sessionStart, sessionVersion, setCandles, symbol, timeframe])

  useEffect(() => {
    if (firstCandleTs) loadPreviousCursorRef.current = firstCandleTs
  }, [firstCandleTs])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return
    const cursor = loadMoreCursorRef.current ?? candles.at(-1)?.ts
    if (!cursor) return

    const sessionKey = sessionKeyRef.current
    setLoadingMore(true)
    setError(null)

    try {
      const rawChunk = await fetchCandles({ symbol, timeframe, from_ts: cursor, limit: CANDLE_CHUNK_SIZE })
      const next = validCandles(afterTimestamp(rawChunk, cursor))
      const lastRawTs = getLastTimestamp(rawChunk)
      const hasMoreData = Boolean(lastRawTs) && lastRawTs !== cursor && rawChunk.length >= CANDLE_CHUNK_SIZE

      if (sessionKeyRef.current !== sessionKey) return
      if (lastRawTs) loadMoreCursorRef.current = lastRawTs
      appendCandles(next)
      if (!hasMoreData) setHasMore(false)
    } catch (err) {
      if (sessionKeyRef.current === sessionKey) {
        setError(err instanceof Error ? err.message : 'Failed to load more candles')
      }
    } finally {
      if (sessionKeyRef.current === sessionKey) setLoadingMore(false)
    }
  }, [appendCandles, candles, hasMore, loading, loadingMore, symbol, timeframe])

  const loadPrevious = useCallback(async () => {
    if (loading || loadingPrevious || !hasPrevious) return
    const cursor = loadPreviousCursorRef.current ?? candles[0]?.ts
    if (!cursor) return

    const sessionKey = sessionKeyRef.current
    setLoadingPrevious(true)
    setError(null)

    try {
      const rawChunk = await fetchCandles({ symbol, timeframe, before_ts: cursor, limit: CANDLE_CHUNK_SIZE })
      const previous = validCandles(rawChunk)
      const firstRawTs = getFirstTimestamp(rawChunk)
      const hasPreviousData = Boolean(firstRawTs) && firstRawTs !== cursor && rawChunk.length >= CANDLE_CHUNK_SIZE

      if (sessionKeyRef.current !== sessionKey) return
      if (firstRawTs) loadPreviousCursorRef.current = firstRawTs
      prependCandles(previous)
      if (!hasPreviousData) setHasPrevious(false)
    } catch (err) {
      if (sessionKeyRef.current === sessionKey) {
        setError(err instanceof Error ? err.message : 'Failed to load previous candles')
      }
    } finally {
      if (sessionKeyRef.current === sessionKey) setLoadingPrevious(false)
    }
  }, [candles, hasPrevious, loading, loadingPrevious, prependCandles, symbol, timeframe])

  useEffect(() => {
    if (visibleIndex < candles.length - PREFETCH_THRESHOLD) return
    const timeout = window.setTimeout(() => {
      void loadMore()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [candles.length, loadMore, visibleIndex])

  useEffect(() => {
    if (visibleIndex > BACKFILL_THRESHOLD) return
    const timeout = window.setTimeout(() => {
      void loadPrevious()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [loadPrevious, visibleIndex])

  return { loading, loadingMore, loadingPrevious, hasMore, hasPrevious, error, loadMore, loadPrevious }
}
