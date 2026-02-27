export const compactTokens = {
  spacing: {
    inset: 'var(--ui-v1-compact-space-sm)',
    laneGap: '8px',
    cardPaddingX: '10px',
    cardPaddingY: '8px',
  },
  typography: {
    dayTitle: 'var(--ui-v1-compact-title-size)',
    daySubtitle: 'var(--ui-v1-compact-subtitle-size)',
    taskTitle: 'var(--ui-v1-compact-task-title-size)',
    taskMeta: 'var(--ui-v1-compact-task-meta-size)',
  },
  motion: {
    hoverDuration: 'var(--ui-v1-motion-fast)',
    transitionEase: 'var(--ui-v1-motion-standard)',
  },
} as const;
