import { useState } from 'react'
import { useSimStore } from '../../store/simStore'
import type { IndicatorConfig } from '../../types'

type ToggleKey = {
  [K in keyof IndicatorConfig]: IndicatorConfig[K] extends boolean ? K : never
}[keyof IndicatorConfig]

type NumberKey = {
  [K in keyof IndicatorConfig]: IndicatorConfig[K] extends number ? K : never
}[keyof IndicatorConfig]

const indicators: { label: string; key: ToggleKey }[] = [
  { label: 'Ichimoku', key: 'ichimoku' },
  { label: 'CCI', key: 'cci' },
  { label: 'MA', key: 'ma' },
  { label: 'BB', key: 'bollinger' },
  { label: 'Stoch RSI', key: 'stochRsi' },
  { label: 'Stochastic', key: 'stochastic' },
  { label: 'MFI', key: 'mfi' },
]

export default function IndicatorBar() {
  const { indicators: config, setIndicators } = useSimStore()
  const [open, setOpen] = useState(false)

  const toggle = (key: ToggleKey) =>
    setIndicators({ ...config, [key]: !config[key] })

  const setNumber = (key: NumberKey, value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setIndicators({ ...config, [key]: parsed })
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '5px 16px', background: '#203541', borderBottom: '1px solid #294553', flexShrink: 0, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'rgba(219,211,216,0.48)', marginRight: 4 }}>اندیکاتورها:</span>
        {indicators.map(item => (
          <button
            type="button"
            key={item.key}
            onClick={() => toggle(item.key)}
            style={{
              background: config[item.key] ? '#D77A61' : '#294553',
              border: `1px solid ${config[item.key] ? '#D77A61' : 'rgba(239,241,243,0.16)'}`,
              borderRadius: 5,
              color: config[item.key] ? '#EFF1F3' : 'rgba(219,211,216,0.68)',
              padding: '3px 9px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            marginLeft: 6,
            background: '#203541',
            border: '1px solid rgba(239,241,243,0.16)',
            borderRadius: 5,
            color: '#DBD3D8',
            padding: '3px 10px',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Settings
        </button>
      </div>

      {open && (
        <div
          onMouseDown={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <div
            onMouseDown={event => event.stopPropagation()}
            style={{
              width: 'min(680px, calc(100vw - 32px))',
              maxHeight: 'calc(100vh - 48px)',
              overflow: 'auto',
              background: '#203541',
              border: '1px solid rgba(239,241,243,0.16)',
              borderRadius: 8,
              boxShadow: '0 24px 80px rgba(0,0,0,.45)',
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#EFF1F3' }}>Indicator Settings</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: '#294553', border: '1px solid rgba(239,241,243,0.16)', color: '#DBD3D8', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <Section title="Ichimoku">
                <Field name="ichimoku-conversion" label="Conversion" value={config.ichimokuConversion} onChange={value => setNumber('ichimokuConversion', value)} />
                <Field name="ichimoku-base" label="Base" value={config.ichimokuBase} onChange={value => setNumber('ichimokuBase', value)} />
                <Field name="ichimoku-span-b" label="Span B" value={config.ichimokuSpanB} onChange={value => setNumber('ichimokuSpanB', value)} />
                <Field name="ichimoku-cloud-opacity" label="Cloud Opacity" value={config.ichimokuCloudOpacity} min="0" step="0.05" onChange={value => setNumber('ichimokuCloudOpacity', value)} />
              </Section>

              <Section title="CCI">
                <Field name="cci-period" label="Period" value={config.cciPeriod} onChange={value => setNumber('cciPeriod', value)} />
              </Section>

              <Section title="Moving Average">
                <Field name="ma-period" label="Period" value={config.maPeriod} onChange={value => setNumber('maPeriod', value)} />
                <label style={fieldStyle}>
                  <span style={labelStyle}>Type</span>
                  <select
                    id="ma-type"
                    name="ma-type"
                    value={config.maType}
                    onChange={event => setIndicators({ ...config, maType: event.target.value as IndicatorConfig['maType'] })}
                    style={inputStyle}
                  >
                    <option value="sma">SMA</option>
                    <option value="ema">EMA</option>
                  </select>
                </label>
              </Section>

              <Section title="Bollinger Band">
                <Field name="bollinger-period" label="Period" value={config.bollingerPeriod} onChange={value => setNumber('bollingerPeriod', value)} />
                <Field name="bollinger-std" label="Std Dev" value={config.bollingerStd} step="0.1" onChange={value => setNumber('bollingerStd', value)} />
              </Section>

              <Section title="Stoch RSI">
                <Field name="stoch-rsi-period" label="RSI Period" value={config.stochRsiPeriod} onChange={value => setNumber('stochRsiPeriod', value)} />
                <Field name="stoch-rsi-k" label="Smooth K" value={config.stochRsiK} onChange={value => setNumber('stochRsiK', value)} />
              </Section>

              <Section title="Stochastic">
                <Field name="stochastic-period" label="Period" value={config.stochasticPeriod} onChange={value => setNumber('stochasticPeriod', value)} />
                <Field name="stochastic-k" label="Smooth K" value={config.stochasticK} onChange={value => setNumber('stochasticK', value)} />
              </Section>

              <Section title="MFI">
                <Field name="mfi-period" label="Period" value={config.mfiPeriod} onChange={value => setNumber('mfiPeriod', value)} />
              </Section>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #294553', borderRadius: 6, padding: 10, background: '#182933' }}>
      <h3 style={{ fontSize: 12, color: '#DBD3D8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0 }}>{title}</h3>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </section>
  )
}

function Field({ name, label, value, min = '1', step = '1', onChange }: { name: string; label: string; value: number; min?: string; step?: string; onChange: (value: string) => void }) {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        id={name}
        name={name}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={event => onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  )
}

const fieldStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 96px',
  alignItems: 'center',
  gap: 8,
} as const

const labelStyle = {
  fontSize: 12,
  color: 'rgba(219,211,216,0.68)',
} as const

const inputStyle = {
  width: '100%',
  background: '#203541',
  border: '1px solid rgba(239,241,243,0.16)',
  borderRadius: 5,
  color: '#EFF1F3',
  padding: '5px 7px',
  fontSize: 12,
} as const
