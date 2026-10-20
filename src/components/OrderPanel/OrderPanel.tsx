import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSimStore } from '../../store/simStore'
import styles from './OrderPanel.module.css'
import type { OrderKind, OrderPriceField, PendingOrder, Trade } from '../../types'
import { toFarsi, fromFarsi } from '../../lib/farsi'
import {
  getDefaultEntryPrice,
  getDraftEntryPrice,
  getDraftLimitPrice,
  getPlannedOpenPrice,
  parsePrice,
  validateOrderDraft,
  validateOrderLots,
  validateOrderPriceField,
} from '../../lib/orderValidation'
import { calculateRequiredMargin, calculateSymbolPnl, getDefaultSpreadForSymbol, getOrderLevelStep } from '../../lib/marketConfig'
import { formatSymbolPrice, roundSymbolPrice } from '../../lib/symbolPrice'

function uuid() {
  return Math.random().toString(36).slice(2, 10)
}

function ChartPickIcon() {
  return (
    <svg viewBox="0 0 28 28" width="18" height="18" aria-hidden="true">
      <g fill="currentColor">
        <path d="M18 15h8v-1h-8z" />
        <path d="M14 18v8h1v-8zM14 3v8h1v-8zM3 15h8v-1h-8z" />
      </g>
    </svg>
  )
}

export default function OrderPanel() {
  const { candles, visibleIndex, symbol, trades, pendingOrders, orderDraft, activeOrderPriceField, orderPriceFieldError, balance, config, addTrade, addPendingOrder, cancelPendingOrder, closeTrade, partialCloseTrade, setOrderDraft, setActiveOrderPriceField, setOrderPriceFieldError, setOrderPriceFieldErrors } = useSimStore()
  const [partialLots, setPartialLots] = useState<Record<string, string>>({})

  const currentCandle = candles[visibleIndex - 1]
  const bidPrice = currentCandle?.close ?? 0
  const currentPrice = bidPrice
  const spread = config.spread ?? getDefaultSpreadForSymbol(symbol)

  const side = orderDraft.type
  const orderKind = orderDraft.orderKind
  const entryPrice = orderDraft.entryPrice
  const limitPrice = orderDraft.limitPrice
  const lots = orderDraft.lots
  const sl = orderDraft.sl
  const tp = orderDraft.tp
  const slEnabled = orderDraft.slEnabled
  const tpEnabled = orderDraft.tpEnabled

  // Current candle close is bid; ask is bid plus spread.
  const askPrice = bidPrice + spread
  const fillPrice = side === 'buy' ? askPrice : bidPrice
  const defaultEntryPrice = getDefaultEntryPrice(orderDraft, bidPrice, spread, symbol)
  const requestedEntry = getDraftEntryPrice(orderDraft, bidPrice, spread, symbol)
  const requestedLimit = getDraftLimitPrice(orderDraft, bidPrice, spread, symbol)
  const lotsNum = parseFloat(lots)
  const lotsError = validateOrderLots(lots)
  const lotsValid = !lotsError
  const levelStep = getOrderLevelStep(symbol, spread, 50)

  function autoSl(price: number) {
    return side === 'buy'
      ? roundSymbolPrice(symbol, price - levelStep)
      : roundSymbolPrice(symbol, price + levelStep)
  }

  function autoTp(price: number) {
    return side === 'buy'
      ? roundSymbolPrice(symbol, price + levelStep * 2)
      : roundSymbolPrice(symbol, price - levelStep * 2)
  }

  const defaultSl = currentPrice ? formatSymbolPrice(symbol, autoSl(fillPrice)) : ''
  const defaultTp = currentPrice ? formatSymbolPrice(symbol, autoTp(fillPrice)) : ''

  const normalizeNumericInput = (value: string) => {
    const normalized = fromFarsi(value).replace(/[^\d.]/g, '')
    const [head, ...tail] = normalized.split('.')
    return tail.length === 0 ? head : `${head}.${tail.join('')}`
  }

  const handlePriceInputChange = (field: OrderPriceField, rawValue: string) => {
    const next = normalizeNumericInput(rawValue)
    const updates = {
      [field]: next,
      ...(field === 'sl' ? { slEnabled: next.trim().length > 0 || slEnabled } : {}),
      ...(field === 'tp' ? { tpEnabled: next.trim().length > 0 || tpEnabled } : {}),
    }
    setOrderDraft(updates)

    if (!next.trim()) {
      setOrderPriceFieldError(field, '')
      return
    }

    const price = parsePrice(next)
    const nextDraft = { ...orderDraft, ...updates }
    const error = price === undefined
      ? 'قیمت معتبر نیست'
      : validateOrderPriceField(field, price, nextDraft, bidPrice, spread, symbol)
    setOrderPriceFieldError(field, error)
  }

  function handleSubmit() {
    if (!currentCandle || currentPrice === 0) return
    if (!lotsValid) return
    if (!Number.isFinite(requestedEntry)) return
    if (requiredMargin > equity) return

    const validationErrors = validateOrderDraft(orderDraft, bidPrice, spread, symbol)
    setOrderPriceFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    const slNum = slEnabled ? parsePrice(sl) : undefined
    const tpNum = tpEnabled ? parsePrice(tp) : undefined

    if (orderKind === 'market') {
      const trade: Trade = {
        id: uuid(),
        type: side,
        orderKind,
        openPrice: roundSymbolPrice(symbol, fillPrice),
        sl: slNum,
        tp: tpNum,
        lots: lotsNum,
        openTime: currentCandle.ts,
      }
      addTrade(trade)
      setOrderDraft({ entryPrice: '', limitPrice: '', sl: '', tp: '', slEnabled: false, tpEnabled: false })
      setActiveOrderPriceField(null)
      return
    }

    const order: PendingOrder = {
      id: uuid(),
      type: side,
      orderKind,
      entryPrice: roundSymbolPrice(symbol, requestedEntry),
      limitPrice: orderKind === 'stop-limit' ? roundSymbolPrice(symbol, requestedLimit) : undefined,
      sl: slNum,
      tp: tpNum,
      lots: lotsNum,
      createdTime: currentCandle.ts,
      status: 'pending',
    }
    addPendingOrder(order)
    setOrderDraft({ entryPrice: '', limitPrice: '', sl: '', tp: '', slEnabled: false, tpEnabled: false })
    setActiveOrderPriceField(null)
  }

  // Open trades only
  const openTrades = useMemo(
    () => trades.filter(t => t.closePrice === undefined),
    [trades]
  )
  const activePendingOrders = useMemo(
    () => pendingOrders.filter(order => order.status === 'pending'),
    [pendingOrders]
  )

  // Compute live PnL for each open trade
  function livePnl(t: Trade) {
    const exitPrice = t.type === 'buy' ? bidPrice : askPrice
    return calculateSymbolPnl(symbol, t.type, t.openPrice, exitPrice, t.lots)
  }

  function handleClose(t: Trade) {
    const exitPrice = t.type === 'buy' ? bidPrice : askPrice
    closeTrade(t.id, roundSymbolPrice(symbol, exitPrice), currentCandle?.ts ?? '')
  }

  function handlePartialClose(t: Trade, closeLots: number) {
    if (!currentCandle || closeLots <= 0) return
    const exitPrice = t.type === 'buy' ? bidPrice : askPrice
    partialCloseTrade(
      t.id,
      parseFloat(Math.min(closeLots, t.lots).toFixed(4)),
      roundSymbolPrice(symbol, exitPrice),
      currentCandle.ts,
    )
    setPartialLots(prev => ({ ...prev, [t.id]: '' }))
  }

  // Total floating PnL
  const floatingPnl = openTrades.reduce((sum, t) => sum + livePnl(t), 0)
  const equity = balance + floatingPnl
  const plannedOpenPrice = getPlannedOpenPrice(orderDraft, bidPrice, spread, symbol)
  const requiredMargin = currentPrice && Number.isFinite(lotsNum) && lotsNum > 0
    ? calculateRequiredMargin(symbol, plannedOpenPrice, lotsNum, config.leverage)
    : 0

  const formatLevel = (value?: number) => value === undefined ? '-' : formatSymbolPrice(symbol, value)
  const setLevelEnabled = (field: 'sl' | 'tp', enabled: boolean) => {
    const nextValue = field === 'sl'
      ? (sl || defaultSl)
      : (tp || defaultTp)

    if (field === 'sl') {
      setOrderDraft({
        slEnabled: enabled,
        sl: enabled ? nextValue : '',
      })
    } else {
      setOrderDraft({
        tpEnabled: enabled,
        tp: enabled ? nextValue : '',
      })
    }

    if (!enabled) {
      setOrderPriceFieldError(field, '')
      if (activeOrderPriceField === field) setActiveOrderPriceField(null)
      return
    }

    const price = parsePrice(nextValue)
    const nextDraft = {
      ...orderDraft,
      [field]: nextValue,
      ...(field === 'sl' ? { slEnabled: true } : { tpEnabled: true }),
    }
    const error = price === undefined
      ? 'قیمت معتبر نیست'
      : validateOrderPriceField(field, price, nextDraft, bidPrice, spread, symbol)
    setOrderPriceFieldError(field, error)
  }
  const activatePriceField = (field: OrderPriceField) => {
    if (field === 'sl' && !slEnabled) setLevelEnabled('sl', true)
    if (field === 'tp' && !tpEnabled) setLevelEnabled('tp', true)
    setActiveOrderPriceField(field)
  }
  const priceFieldClass = (field: OrderPriceField, base = styles.fieldInput) =>
    `${base} ${activeOrderPriceField === field ? styles.priceInputActive : ''}`
  const renderFieldError = (field: OrderPriceField) =>
    orderPriceFieldError[field] ? <div className={styles.fieldError}>{orderPriceFieldError[field]}</div> : null
  const clearDraftPrices = useCallback(() => {
    setOrderDraft({ entryPrice: '', limitPrice: '', sl: '', tp: '', slEnabled: false, tpEnabled: false })
    setOrderPriceFieldErrors({})
  }, [setOrderDraft, setOrderPriceFieldErrors])

  useEffect(() => {
    const clearPickOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-price-picker="true"]')) return
      if (target.closest('.sim-chart-root')) return
      if (useSimStore.getState().activeOrderPriceField) clearDraftPrices()
      setActiveOrderPriceField(null)
    }

    document.addEventListener('pointerdown', clearPickOnOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', clearPickOnOutsidePointerDown, true)
  }, [clearDraftPrices, setActiveOrderPriceField])

  return (
    <div className={styles.panel}>
      {/* ── Order Entry ── */}
      <div className={styles.entry}>
        <div className={styles.sectionTitle}>سفارش جدید</div>

        <div className={styles.typeTabs}>
          <button
            type="button"
            className={`${styles.tabBuy} ${side === 'buy' ? styles.activeTab : ''}`}
            onClick={() => setOrderDraft({ type: 'buy', sl: '', tp: '', slEnabled: false, tpEnabled: false })}
          >
            خرید
          </button>
          <button
            type="button"
            className={`${styles.tabSell} ${side === 'sell' ? styles.activeTab : ''}`}
            onClick={() => setOrderDraft({ type: 'sell', sl: '', tp: '', slEnabled: false, tpEnabled: false })}
          >
            فروش
          </button>
        </div>

        <div className={styles.orderKindGrid}>
          {[
            ['market', 'بازار'],
            ['limit', 'لیمیت'],
            ['stop', 'استاپ'],
            ['stop-limit', 'استاپ لیمیت'],
          ].map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className={`${styles.kindBtn} ${orderKind === kind ? styles.activeKind : ''}`}
              onClick={() => setOrderDraft({ orderKind: kind as OrderKind })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.fieldGroup}>
          {orderKind !== 'market' && (
            <div className={styles.fieldStack}>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>ورود</span>
                <div className={styles.priceInputWrap}>
                  <input
                    id="order-entry"
                    name="order-entry"
                    className={priceFieldClass('entryPrice')}
                    type="text"
                    value={toFarsi(entryPrice)}
                    onFocus={() => activatePriceField('entryPrice')}
                    data-price-picker="true"
                    inputMode="decimal"
                    onChange={e => handlePriceInputChange('entryPrice', e.target.value)}
                    placeholder={toFarsi(formatSymbolPrice(symbol, defaultEntryPrice))}
                  />
                  <span className={styles.pickIcon}><ChartPickIcon /></span>
                </div>
              </div>
              {renderFieldError('entryPrice')}
            </div>
          )}
          {orderKind === 'stop-limit' && (
            <div className={styles.fieldStack}>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>لیمیت</span>
                <div className={styles.priceInputWrap}>
                  <input
                    id="order-limit"
                    name="order-limit"
                    className={priceFieldClass('limitPrice')}
                    type="text"
                    value={toFarsi(limitPrice)}
                    onFocus={() => activatePriceField('limitPrice')}
                    data-price-picker="true"
                    inputMode="decimal"
                    onChange={e => handlePriceInputChange('limitPrice', e.target.value)}
                    placeholder={toFarsi(formatSymbolPrice(symbol, requestedEntry))}
                  />
                  <span className={styles.pickIcon}><ChartPickIcon /></span>
                </div>
              </div>
              {renderFieldError('limitPrice')}
            </div>
          )}
          <div className={styles.fieldStack}>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>حجم</span>
              <input
                id="order-lots"
                name="order-lots"
                className={styles.fieldInput}
                type="text"
                value={toFarsi(lots)}
                inputMode="decimal"
                onChange={e => setOrderDraft({ lots: normalizeNumericInput(e.target.value) })}
              />
            </div>
            {lotsError && <div className={styles.fieldError}>{lotsError}</div>}
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>حد ضرر</span>
            <div className={styles.levelInputWrap} data-price-picker="true">
              <input
                id="order-sl"
                name="order-sl"
                className={priceFieldClass('sl', `${styles.fieldInput} ${styles.levelInput}`)}
                type="text"
                value={toFarsi(slEnabled ? sl : '')}
                onFocus={() => activatePriceField('sl')}
                inputMode="decimal"
                onChange={e => handlePriceInputChange('sl', e.target.value)}
                placeholder={currentPrice ? toFarsi(defaultSl) : 'خودکار'}
              />
              <button
                type="button"
                className={`${styles.levelSwitch} ${slEnabled ? styles.levelSwitchOn : ''}`}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => setLevelEnabled('sl', !slEnabled)}
                aria-pressed={slEnabled}
                title="فعال‌سازی حد ضرر"
              >
                <span />
              </button>
              <span className={styles.pickIcon}><ChartPickIcon /></span>
            </div>
          </div>
          {renderFieldError('sl')}
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>هدف</span>
            <div className={styles.levelInputWrap} data-price-picker="true">
              <input
                id="order-tp"
                name="order-tp"
                className={priceFieldClass('tp', `${styles.fieldInput} ${styles.levelInput}`)}
                type="text"
                value={toFarsi(tpEnabled ? tp : '')}
                onFocus={() => activatePriceField('tp')}
                inputMode="decimal"
                onChange={e => handlePriceInputChange('tp', e.target.value)}
                placeholder={currentPrice ? toFarsi(defaultTp) : 'خودکار'}
              />
              <button
                type="button"
                className={`${styles.levelSwitch} ${tpEnabled ? styles.levelSwitchOn : ''}`}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => setLevelEnabled('tp', !tpEnabled)}
                aria-pressed={tpEnabled}
                title="فعال‌سازی هدف"
              >
                <span />
              </button>
              <span className={styles.pickIcon}><ChartPickIcon /></span>
            </div>
          </div>
          {renderFieldError('tp')}
        </div>

        <div className={styles.fieldRow} style={{ marginBottom: 8, justifyContent: 'space-between' }}>
          <span className={styles.fieldLabel} style={{ width: 'auto' }}>
            {orderKind === 'market' ? (side === 'buy' ? 'قیمت خرید' : 'قیمت فروش') : 'قیمت تریگر'}
          </span>
          <span style={{ color: side === 'buy' ? 'var(--trade-buy)' : 'var(--trade-sell)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>
            {toFarsi(currentPrice ? formatSymbolPrice(symbol, orderKind === 'market' ? fillPrice : requestedEntry) : '—')}
          </span>
        </div>
        <div className={styles.fieldRow} style={{ marginBottom: 8, justifyContent: 'space-between' }}>
          <span className={styles.fieldLabel} style={{ width: 'auto' }}>مارجین</span>
          <span style={{ color: requiredMargin > equity ? 'var(--trade-sell)' : 'var(--text-muted)', fontFamily: 'inherit', fontSize: 12 }}>
            {toFarsi(requiredMargin.toFixed(2))}
          </span>
        </div>

        <button
          type="button"
          className={`${styles.submitBtn} ${side === 'buy' ? styles.submitBuy : styles.submitSell}`}
          onClick={handleSubmit}
          disabled={!currentPrice || !lotsValid || requiredMargin > equity}
        >
          {orderKind === 'market' ? (side === 'buy' ? '▲ خرید' : '▼ فروش') : 'ثبت سفارش شرطی'}
        </button>
      </div>

      <div className={styles.listScroll}>
        <div className={styles.sectionTitle} style={{ padding: '10px 12px 0', flexShrink: 0 }}>
          سفارش‌های شرطی ({activePendingOrders.length})
        </div>
        <div className={styles.pendingList}>
          {activePendingOrders.length === 0 && <div className={styles.noTrades}>سفارش شرطی وجود ندارد</div>}
          {activePendingOrders.map(order => (
            <div key={order.id} className={styles.tradeCard}>
              <div className={styles.tradeHeader}>
                <span className={`${styles.tradeBadge} ${order.type === 'buy' ? styles.buy : styles.sell}`}>
                  {order.type.toUpperCase()} {order.orderKind}
                </span>
                <button type="button" className={styles.miniCloseBtn} onClick={() => cancelPendingOrder(order.id)}>لغو</button>
              </div>
              <div className={styles.tradeRow}><span>تریگر</span><span className={styles.tradeRowValue}>{formatSymbolPrice(symbol, order.entryPrice)}</span></div>
              {order.limitPrice !== undefined && <div className={styles.tradeRow}><span>لیمیت</span><span className={styles.tradeRowValue}>{formatSymbolPrice(symbol, order.limitPrice)}</span></div>}
              <div className={styles.tradeRow}><span>حد ضرر / هدف</span><span className={styles.tradeRowValue}>{formatLevel(order.sl)} / {formatLevel(order.tp)}</span></div>
            </div>
          ))}
        </div>

        {/* ── Open Positions ── */}
        <div className={styles.sectionTitle} style={{ padding: '10px 12px 0', flexShrink: 0 }}>
          پوزیشن‌ها ({openTrades.length})
        </div>
        <div className={styles.trades}>
          {openTrades.length === 0 && (
            <div className={styles.noTrades}>پوزیشن باز وجود ندارد</div>
          )}
          {openTrades.map(t => {
            const pnl = livePnl(t)
            const customPartialLots = parseFloat(partialLots[t.id] ?? '')
            return (
              <div key={t.id} className={styles.tradeCard}>
                <div className={styles.tradeHeader}>
                  <span className={`${styles.tradeBadge} ${t.type === 'buy' ? styles.buy : styles.sell}`}>
                    {t.type.toUpperCase()}
                  </span>
                  <span className={styles.tradeId}>#{t.id}</span>
                </div>
                <div className={styles.tradeRow}>
                  <span>ورود</span>
                  <span className={styles.tradeRowValue}>{formatSymbolPrice(symbol, t.openPrice)}</span>
                </div>
                <div className={styles.tradeRow}>
                  <span>حد ضرر / هدف</span>
                  <span className={styles.tradeRowValue}>{formatLevel(t.sl)} / {formatLevel(t.tp)}</span>
                </div>
                <div className={styles.tradeRow}>
                  <span>حجم</span>
                  <span className={styles.tradeRowValue}>{t.lots.toFixed(2)}</span>
                </div>
                <div className={`${styles.pnl} ${pnl >= 0 ? styles.pnlPos : styles.pnlNeg}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USD
                </div>
                <div className={styles.partialBox}>
                  <div className={styles.partialQuick}>
                    {[0.25, 0.5, 0.75].map(ratio => (
                      <button
                        key={ratio}
                        type="button"
                        className={styles.partialQuickBtn}
                        onClick={() => handlePartialClose(t, t.lots * ratio)}
                      >
                        {Math.round(ratio * 100)}%
                      </button>
                    ))}
                  </div>
                  <div className={styles.partialCustom}>
                    <input
                      className={styles.partialInput}
                      type="text"
                      inputMode="decimal"
                      value={toFarsi(partialLots[t.id] ?? '')}
                      onChange={event => setPartialLots(prev => ({
                        ...prev,
                        [t.id]: fromFarsi(event.target.value),
                      }))}
                      placeholder={toFarsi(Math.min(0.01, t.lots).toFixed(2))}
                    />
                    <button
                      type="button"
                      className={styles.partialBtn}
                      disabled={!Number.isFinite(customPartialLots) || customPartialLots <= 0 || customPartialLots > t.lots}
                      onClick={() => handlePartialClose(t, customPartialLots)}
                    >
                      جزئی
                    </button>
                  </div>
                </div>
                <button type="button" className={styles.closeBtn} onClick={() => handleClose(t)}>
                  بستن @ {formatSymbolPrice(symbol, t.type === 'buy' ? bidPrice : askPrice)}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className={styles.footer}>
        <div>
          <div className={styles.footerLabel}>موجودی</div>
          <div style={{ fontSize: 11, color: 'rgba(219,211,216,0.48)', fontFamily: 'inherit' }}>
            ارزش خالص: <span style={{ color: equity >= balance ? 'var(--trade-buy)' : 'var(--trade-sell)' }}>{equity.toFixed(2)}</span>
          </div>
        </div>
        <div className={styles.balanceVal}>${balance.toFixed(2)}</div>
      </div>
    </div>
  )
}
