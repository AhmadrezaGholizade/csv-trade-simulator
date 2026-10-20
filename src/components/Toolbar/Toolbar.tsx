import { useEffect, useRef } from 'react'
import { useSimStore } from '../../store/simStore'
import styles from './Toolbar.module.css'
import SessionSettings from './SessionSettings'

export default function Toolbar() {
  const barRef = useRef<HTMLDivElement>(null)
  const { playing, speed, visibleIndex, candles, setPlaying, setSpeed } = useSimStore()
  const candleStep = Math.max(1, Math.trunc(speed))

  function stepForward() {
    const state = useSimStore.getState()
    state.setVisibleIndex(state.visibleIndex + candleStep)
  }

  function stepBackward() {
    const state = useSimStore.getState()
    state.setVisibleIndex(Math.max(1, state.visibleIndex - candleStep))
  }

  useEffect(() => {
    if (!window.matchMedia('(max-width: 900px)').matches) return
    const bar = barRef.current
    if (!bar) return
    requestAnimationFrame(() => {
      bar.scrollLeft = -bar.scrollWidth
    })
  }, [])

  return (
    <div ref={barRef} className={`${styles.bar} simPlaybackBar`}>
      <div className={styles.sessionSummary}>
        <SessionSettings />

        <span className={styles.ts}>
          {candles[visibleIndex - 1]?.ts?.slice(0, 16) ?? '--'}
        </span>
      </div>

      <div className={styles.playbackControls}>
        <div className={styles.speedWrap}>
          {[20, 10, 5, 2, 1].map(s => (
            <button type="button" key={s} onClick={() => setSpeed(s)}
              className={`${styles.btn} ${speed === s ? styles.active : ''}`}>
              {s}x
            </button>
          ))}
        </div>

        <div className={styles.stepControls}>
          <button type="button" onClick={stepForward} className={styles.iconBtn} title={`${candleStep} کندل بعد`}>▶</button>
          <button type="button" onClick={stepBackward} className={styles.iconBtn} title={`${candleStep} کندل قبل`}>◀</button>
          <button type="button" onClick={() => setPlaying(!playing)} className={styles.playBtn}>
            {playing ? '⏸' : '▶'}
          </button>
        </div>
      </div>
    </div>
  )
}
