export const CANDLE_SIZE_GROUPS = [
  {
    label: 'MINUTES',
    items: [
      { id: '1m', label: '1 minute' },
      { id: '2m', label: '2 minutes' },
      { id: '3m', label: '3 minutes' },
      { id: '5m', label: '5 minutes' },
      { id: '10m', label: '10 minutes' },
      { id: '15m', label: '15 minutes' },
      { id: '20m', label: '20 minutes' },
      { id: '30m', label: '30 minutes' },
      { id: '45m', label: '45 minutes' },
    ],
  },
  {
    label: 'HOURS',
    items: [
      { id: '1h', label: '1 hour' },
      { id: '2h', label: '2 hours' },
      { id: '3h', label: '3 hours' },
      { id: '4h', label: '4 hours' },
      { id: '6h', label: '6 hours' },
      { id: '8h', label: '8 hours' },
      { id: '12h', label: '12 hours' },
    ],
  },
  {
    label: 'DAYS',
    items: [
      { id: '1d', label: '1 day' },
      { id: '1w', label: '1 week' },
    ],
  },
]

export const CANDLE_SIZE_OPTIONS = CANDLE_SIZE_GROUPS.flatMap(group => group.items)
