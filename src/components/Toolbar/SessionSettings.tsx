import { useEffect, useState } from 'react'
import { useSimStore } from '../../store/simStore'
import { fetchMeta, saveSessionConfig } from '../../api'
import type { SimConfig } from '../../types'
import styles from './Toolbar.module.css'
import { getSpreadInputStep, getSymbolPricePrecision } from '../../lib/marketConfig'
import { roundSymbolPrice } from '../../lib/symbolPrice'

function toDateTimeLocal(value: string) {
  if (!value) return ''
  return value.replace(' ', 'T').slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  return value ? `${value}:00` : ''
}

function formatDatasetDate(value: string) {
  return `${value.replace('T', ' ').replace(/(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/, '').slice(0, 16)} UTC`
}

function timestamp(value: string) {
  const iso = value.replace(' ', 'T')
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`).getTime()
}

function getSpreadDecimals(symbol: string) {
  return getSymbolPricePrecision(symbol)
}

function formatSpread(symbol: string, spread: number) {
  return spread.toFixed(getSpreadDecimals(symbol))
}

export default function SessionSettings() {
  const { config, balance, trades, symbol, setConfig, applySessionSettings } = useSimStore()
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState<SimConfig>(config)
  const [spreadText, setSpreadText] = useState(formatSpread(symbol, config.spread))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [datasetRange, setDatasetRange] = useState<{ start: string; end: string } | null>(null)

  const closedTrades = trades.filter(trade => trade.closePrice !== undefined).length

  function updateNumber(key: keyof Pick<SimConfig, 'balance' | 'leverage' | 'spread'>, value: string) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setDraft(current => ({ ...current, [key]: parsed }))
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSpreadText(formatSpread(symbol, config.spread))
      setDraft(current => ({ ...current, spread: config.spread }))
    })
    return () => cancelAnimationFrame(frame)
  }, [config.spread, symbol])

  useEffect(() => {
    let cancelled = false

    void fetchMeta(symbol)
      .then(meta => {
        if (!cancelled) {
          setDatasetRange(meta.start && meta.end ? { start: meta.start, end: meta.end } : null)
        }
      })
      .catch(() => {
        if (!cancelled) setDatasetRange(null)
      })

    return () => { cancelled = true }
  }, [symbol])

  function normalizeSpread(value: string) {
    const normalized = value.replace(/[^\d.]/g, '')
    const [head, ...tail] = normalized.split('.')
    return tail.length === 0 ? head : `${head}.${tail.join('')}`
  }

  function commitSpread(value = spreadText) {
    const parsed = Number(value)
    const nextSpread = Number.isFinite(parsed)
      ? roundSymbolPrice(symbol, Math.max(0, parsed))
      : config.spread
    const nextText = formatSpread(symbol, nextSpread)
    setSpreadText(nextText)
    setConfig({ ...config, spread: nextSpread })
    setDraft(current => ({ ...current, spread: nextSpread }))
  }

  function nudgeSpread(delta: number) {
    const decimals = getSpreadDecimals(symbol)
    const nextSpread = Math.max(0, Number((config.spread + delta).toFixed(decimals)))
    setSpreadText(formatSpread(symbol, nextSpread))
    setConfig({ ...config, spread: nextSpread })
    setDraft(current => ({ ...current, spread: nextSpread }))
  }

  const selectedStartTime = draft.sessionStart ? timestamp(draft.sessionStart) : null
  const datasetStartTime = datasetRange ? timestamp(datasetRange.start) : null
  const datasetEndTime = datasetRange ? timestamp(datasetRange.end) : null
  const dateOutOfRange = Boolean(
    selectedStartTime !== null &&
    datasetStartTime !== null &&
    datasetEndTime !== null &&
    (selectedStartTime < datasetStartTime || selectedStartTime > datasetEndTime)
  )

  async function apply(configOverride?: SimConfig) {
    const sourceConfig = configOverride ?? draft
    const nextConfig = {
      ...sourceConfig,
      balance: Math.max(0, sourceConfig.balance),
      leverage: Math.max(1, sourceConfig.leverage),
      spread: roundSymbolPrice(symbol, Math.max(0, sourceConfig.spread)),
    }

    if (!configOverride && dateOutOfRange) {
      setError('تاریخ انتخاب‌شده خارج از بازه داده‌های این نماد است.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const savedConfig = await saveSessionConfig(nextConfig)
      applySessionSettings(savedConfig)
      setDraft(savedConfig)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save session settings')
    } finally {
      setSaving(false)
    }
  }

  function restart() {
    applySessionSettings(config)
  }

  function useDatasetStart() {
    const nextDraft = { ...draft, sessionStart: '' }
    setDraft(nextDraft)
    apply(nextDraft)
  }

  return (
    <>
      <button type="button" className={styles.btn} onClick={restart}>شروع دوباره</button>
      <span className={styles.sessionInfo}>
        موجودی ${balance.toFixed(0)} · اهرم {config.leverage}x
      </span>
      <div className={styles.spreadControl} aria-label="تنظیم اسپرد">
        <span className={styles.spreadLabel}>اسپرد</span>
        <button type="button" className={styles.spreadStep} onClick={() => nudgeSpread(-getSpreadInputStep(symbol))} title="کاهش اسپرد">−</button>
        <input
          id="live-spread"
          name="live-spread"
          className={styles.spreadInput}
          inputMode="decimal"
          value={spreadText}
          onChange={event => setSpreadText(normalizeSpread(event.target.value))}
          onBlur={() => commitSpread()}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              nudgeSpread(getSpreadInputStep(symbol))
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              nudgeSpread(-getSpreadInputStep(symbol))
            }
          }}
        />
        <button type="button" className={styles.spreadStep} onClick={() => nudgeSpread(getSpreadInputStep(symbol))} title="افزایش اسپرد">+</button>
      </div>

      {open && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} onMouseDown={event => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalTitle}>شروع جلسه تمرین</div>
                <div className={styles.modalSub}>تنظیمات اولیه را انتخاب کنید و جلسه را شروع کنید.</div>
              </div>
            </div>

            <div className={styles.settingsGrid}>
              <Field label="موجودی اولیه">
                <input
                  id="session-balance"
                  name="session-balance"
                  className={styles.settingInput}
                  type="number"
                  min="0"
                  step="100"
                  value={draft.balance}
                  onChange={event => updateNumber('balance', event.target.value)}
                />
              </Field>

              <Field label="اهرم">
                <input
                  id="session-leverage"
                  name="session-leverage"
                  className={styles.settingInput}
                  type="number"
                  min="1"
                  step="1"
                  value={draft.leverage}
                  onChange={event => updateNumber('leverage', event.target.value)}
                />
              </Field>

              <Field label="اسپرد">
                <input
                  id="session-spread"
                  name="session-spread"
                  className={styles.settingInput}
                  type="number"
                  min="0"
                  step={getSpreadInputStep(symbol)}
                  value={draft.spread}
                  onChange={event => updateNumber('spread', event.target.value)}
                />
              </Field>

              <Field label="شروع از تاریخ">
                <input
                  id="session-start"
                  name="session-start"
                  className={styles.settingInput}
                  type="datetime-local"
                  value={toDateTimeLocal(draft.sessionStart)}
                  min={datasetRange ? toDateTimeLocal(datasetRange.start) : undefined}
                  max={datasetRange ? toDateTimeLocal(datasetRange.end) : undefined}
                  onChange={event => {
                    setError('')
                    setDraft(current => ({ ...current, sessionStart: fromDateTimeLocal(event.target.value) }))
                  }}
                />
              </Field>
            </div>

            {datasetRange && (
              <div className={dateOutOfRange ? styles.sessionError : styles.sessionNote}>
                بازه داده‌های {symbol}: {formatDatasetDate(datasetRange.start)} تا {formatDatasetDate(datasetRange.end)}
                {dateOutOfRange && ' — تاریخ انتخاب‌شده در این بازه نیست.'}
              </div>
            )}

            <div className={styles.sessionNote}>
              شروع دوباره همین تنظیمات را نگه می‌دارد. در این جلسه {trades.length} معامله ثبت شده که {closedTrades} مورد بسته شده است.
            </div>
            {error && <div className={styles.sessionError}>{error}</div>}

            <div className={styles.modalActions}>
              <button type="button" className={styles.btn} onClick={useDatasetStart} disabled={saving}>شروع از ابتدای داده</button>
              <button type="button" className={`${styles.btn} ${styles.active}`} onClick={() => apply()} disabled={saving || dateOutOfRange}>
                {saving ? 'در حال ذخیره...' : 'شروع جلسه'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.settingField}>
      <span>{label}</span>
      {children}
    </label>
  )
}
