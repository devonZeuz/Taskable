export const typographyTokens = {
  family: "'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', sans-serif",
  size: {
    xs: '11px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    display: '48px',
  },
  lineHeight: {
    tight: '1.05',
    compact: '1.2',
    normal: '1.4',
    relaxed: '1.55',
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  tracking: {
    tight: '-0.03em',
    normal: '-0.01em',
    wide: '0.06em',
  },
  compact: {
    titleScale: '0.92',
    bodyScale: '0.94',
  },
} as const;
