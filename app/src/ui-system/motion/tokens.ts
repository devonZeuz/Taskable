export const motionTokens = {
  duration: {
    instant: '80ms',
    fast: '140ms',
    normal: '220ms',
    slow: '320ms',
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    entrance: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  },
  compact: {
    duration: '120ms',
    easing: 'cubic-bezier(0.24, 0, 0.2, 1)',
  },
} as const;
