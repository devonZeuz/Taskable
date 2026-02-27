export const spacingTokens = {
  '0': '0px',
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '7': '28px',
  '8': '32px',
  '9': '40px',
  '10': '48px',
  compact: {
    xxs: '2px',
    xs: '6px',
    sm: '10px',
    md: '12px',
    lg: '16px',
  },
} as const;

export type SpacingToken = keyof Omit<typeof spacingTokens, 'compact'>;
