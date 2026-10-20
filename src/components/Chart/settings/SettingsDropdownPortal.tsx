import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SettingsDropdownPortalProps {
  anchor: HTMLButtonElement | null
  ariaLabel: string
  children: ReactNode
}

export function SettingsDropdownPortal({ anchor, ariaLabel, children }: SettingsDropdownPortalProps) {
  if (!anchor || typeof document === 'undefined') return null

  const rect = anchor.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  const roomBelow = viewportHeight - rect.bottom - 12
  const roomAbove = rect.top - 12
  const openUpward = roomBelow < 220 && roomAbove > roomBelow
  const availableHeight = Math.max(96, Math.min(360, (openUpward ? roomAbove : roomBelow) - 4))

  return createPortal(
    <div
      className="sim-chart-settings-dropdown-menu"
      role="listbox"
      aria-label={ariaLabel}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      style={{
        position: 'fixed',
        left: rect.left,
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? viewportHeight - rect.top + 4 : undefined,
        width: rect.width,
        maxHeight: availableHeight,
        zIndex: 100000,
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
