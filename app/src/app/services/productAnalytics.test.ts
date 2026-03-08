import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductAnalyticsEvents,
  getProductAnalyticsSummary,
  recordProductEvent,
} from './productAnalytics';

describe('productAnalytics', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sanitizes sensitive metadata before persisting', () => {
    recordProductEvent({
      eventType: 'landing_viewed',
      metadata: {
        source: 'welcome',
        email: 'private@example.com',
        title: 'Sensitive title',
        duration: 42,
      },
      recordedAt: '2026-03-08T10:00:00.000Z',
    });

    const events = getProductAnalyticsEvents();
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({
      source: 'welcome',
      duration: 42,
    });
  });

  it('builds activation and retention summaries from product events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T12:00:00.000Z'));

    recordProductEvent({ eventType: 'landing_viewed', recordedAt: '2026-03-01T09:00:00.000Z' });
    recordProductEvent({
      eventType: 'landing_continue_local_clicked',
      mode: 'local',
      recordedAt: '2026-03-01T09:01:00.000Z',
    });
    recordProductEvent({
      eventType: 'tutorial_viewed',
      mode: 'local',
      recordedAt: '2026-03-01T09:02:00.000Z',
    });
    recordProductEvent({
      eventType: 'tutorial_completed',
      mode: 'local',
      recordedAt: '2026-03-01T09:05:00.000Z',
    });
    recordProductEvent({
      eventType: 'activation_first_task_created',
      mode: 'local',
      recordedAt: '2026-03-02T10:15:00.000Z',
    });
    recordProductEvent({
      eventType: 'planner_viewed',
      mode: 'local',
      recordedAt: '2026-03-02T10:00:00.000Z',
    });
    recordProductEvent({
      eventType: 'planner_viewed',
      mode: 'local',
      recordedAt: '2026-03-07T08:00:00.000Z',
    });
    recordProductEvent({
      eventType: 'support_viewed',
      recordedAt: '2026-03-07T08:05:00.000Z',
    });

    const summary = getProductAnalyticsSummary();
    expect(summary.counts.landingViews).toBe(1);
    expect(summary.counts.localStarts).toBe(1);
    expect(summary.counts.tutorialCompletions).toBe(1);
    expect(summary.counts.firstTaskActivations).toBe(1);
    expect(summary.counts.supportViews).toBe(1);
    expect(summary.activation.localStartRatePercent).toBe(100);
    expect(summary.activation.tutorialCompletionRatePercent).toBe(100);
    expect(summary.activation.firstTaskActivationRatePercent).toBe(100);
    expect(summary.retention.activeDaysLast7).toBe(2);
    expect(summary.retention.plannerDaysLast30).toBe(2);
    expect(summary.retention.lastActiveAt).toBe('2026-03-07T08:00:00.000Z');
  });

  it(
    'caps the stored analytics window',
    () => {
      for (let index = 0; index < 2_250; index += 1) {
        recordProductEvent({
          eventType: 'landing_viewed',
          recordedAt: `2026-03-08T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        });
      }

      expect(getProductAnalyticsEvents().length).toBeLessThanOrEqual(2_000);
    },
    15_000
  );
});
