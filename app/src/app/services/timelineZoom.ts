import type { TimelineZoomLevel } from '../context/UserPreferencesContext';

export const TIMELINE_ZOOM_LEVELS: TimelineZoomLevel[] = [50, 75, 100, 125, 150];

export function getNextTimelineZoom(
  current: TimelineZoomLevel,
  direction: 'in' | 'out'
): TimelineZoomLevel {
  const index = TIMELINE_ZOOM_LEVELS.indexOf(current);
  if (index === -1) return 100;
  if (direction === 'in') {
    return TIMELINE_ZOOM_LEVELS[Math.min(TIMELINE_ZOOM_LEVELS.length - 1, index + 1)];
  }
  return TIMELINE_ZOOM_LEVELS[Math.max(0, index - 1)];
}
