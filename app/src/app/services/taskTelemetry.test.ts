import { beforeEach, describe, expect, it } from 'vitest';
import { getTaskSuggestions, recordTaskCompletionSample } from './taskTelemetry';

describe('taskTelemetry duration correction model', () => {
  beforeEach(() => {
    window.localStorage.removeItem('taskable:task-telemetry');
  });

  it('applies overrun correction factor to current duration estimate', () => {
    recordTaskCompletionSample({
      title: 'Monthly Reports',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 90,
      startDateTime: '2026-02-24T09:00:00.000Z',
      completedAt: '2026-02-24T10:40:00.000Z',
    });

    const suggestions = getTaskSuggestions({
      title: 'Monthly Reports',
      type: 'quick',
      slotMinutes: 15,
      currentDurationMinutes: 60,
    });

    expect(suggestions.correctionTrend).toBe('overrun');
    expect(suggestions.correctionFactor).toBeGreaterThan(1);
    expect(suggestions.correctedDurationMinutes).toBe(90);
    expect(suggestions.suggestedDurationMinutes).toBe(90);
  });

  it('reports balanced trend when planned and actual are close', () => {
    recordTaskCompletionSample({
      title: 'Daily sync',
      type: 'quick',
      plannedMinutes: 30,
      actualMinutes: 31,
      startDateTime: '2026-02-24T12:00:00.000Z',
      completedAt: '2026-02-24T12:31:00.000Z',
    });

    const suggestions = getTaskSuggestions({
      title: 'Daily sync',
      type: 'quick',
      slotMinutes: 15,
      currentDurationMinutes: 30,
    });

    expect(suggestions.correctionTrend).toBe('balanced');
    expect(suggestions.correctionSampleCount).toBe(1);
    expect(suggestions.suggestedDurationMinutes).toBeGreaterThanOrEqual(30);
  });
});
