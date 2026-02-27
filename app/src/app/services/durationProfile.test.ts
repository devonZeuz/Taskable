import { beforeEach, describe, expect, it } from 'vitest';
import {
  getDurationProfileBuckets,
  suggestDuration,
  updateDurationProfileOnCompletion,
} from './durationProfile';

describe('durationProfile', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('taskable:mode', 'local');
  });

  it('updates correction factor with repeated completions', () => {
    updateDurationProfileOnCompletion({
      title: 'Monthly Reports',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 90,
    });
    updateDurationProfileOnCompletion({
      title: 'Monthly Reports',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 84,
    });
    const bucket = updateDurationProfileOnCompletion({
      title: 'Monthly Reports',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 78,
    });

    expect(bucket).not.toBeNull();
    expect(bucket?.count).toBe(3);
    expect(bucket?.correctionFactor).toBeGreaterThan(1);
  });

  it('clamps correction factor into supported bounds', () => {
    const upper = updateDurationProfileOnCompletion({
      title: 'Deep work',
      type: 'large',
      plannedMinutes: 30,
      actualMinutes: 200,
    });
    expect(upper?.correctionFactor).toBeLessThanOrEqual(2.5);

    updateDurationProfileOnCompletion({
      title: 'Fast standup',
      type: 'quick',
      plannedMinutes: 120,
      actualMinutes: 5,
    });
    updateDurationProfileOnCompletion({
      title: 'Fast standup',
      type: 'quick',
      plannedMinutes: 120,
      actualMinutes: 5,
    });
    const lower = updateDurationProfileOnCompletion({
      title: 'Fast standup',
      type: 'quick',
      plannedMinutes: 120,
      actualMinutes: 5,
    });
    expect(lower?.correctionFactor).toBeGreaterThanOrEqual(0.5);
  });

  it('produces snapped duration suggestions when sample count is sufficient', () => {
    updateDurationProfileOnCompletion({
      title: 'Sprint Planning',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 95,
    });
    updateDurationProfileOnCompletion({
      title: 'Sprint Planning',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 90,
    });
    updateDurationProfileOnCompletion({
      title: 'Sprint Planning',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 85,
    });

    const suggestion = suggestDuration({
      title: 'Sprint Planning',
      type: 'quick',
      plannedMinutes: 60,
      slotMinutes: 15,
    });

    expect(suggestion.sampleCount).toBeGreaterThanOrEqual(3);
    expect(suggestion.suggestedDurationMinutes).toBe(90);
  });

  it('returns no suggestion when history is insufficient', () => {
    updateDurationProfileOnCompletion({
      title: 'Weekly review',
      type: 'quick',
      plannedMinutes: 60,
      actualMinutes: 70,
    });

    const suggestion = suggestDuration({
      title: 'Weekly review',
      type: 'quick',
      plannedMinutes: 60,
      slotMinutes: 15,
    });

    expect(suggestion.suggestedDurationMinutes).toBeNull();
    expect(getDurationProfileBuckets()[0]?.count).toBe(1);
  });
});
