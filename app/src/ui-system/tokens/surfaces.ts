export const surfaceTokens = {
  radius: {
    sm: '10px',
    md: '14px',
    lg: '18px',
    xl: '24px',
  },
  borderWidth: '1px',
  elevation: {
    0: 'none',
    1: '0 6px 14px rgba(0, 0, 0, 0.18)',
    2: '0 10px 24px rgba(0, 0, 0, 0.24)',
    3: '0 16px 34px rgba(0, 0, 0, 0.3)',
  },
  compact: {
    elevation: 'var(--ui-v1-elevation-3)',
    radius: '12px',
    borderOpacity: '0.14',
  },
} as const;
