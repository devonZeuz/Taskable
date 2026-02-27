import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushExecutionTelemetry,
  getLocalTelemetryWindow,
  recordExecutionTelemetryEvent,
} from './executionTelemetry';

describe('executionTelemetry', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('enforces bounded retention for local telemetry events', async () => {
    for (let index = 0; index < 5_120; index += 1) {
      recordExecutionTelemetryEvent({
        eventType: 'task_started',
        taskId: `task-${index}`,
        timestamp: new Date().toISOString(),
      });
    }

    await flushExecutionTelemetry();
    expect(getLocalTelemetryWindow(365).length).toBeLessThanOrEqual(5_000);
  });

  it('batches writes until flush and persists events', async () => {
    recordExecutionTelemetryEvent({
      eventType: 'task_started',
      taskId: 'task-a',
      timestamp: '2026-02-25T10:00:00.000Z',
    });
    recordExecutionTelemetryEvent({
      eventType: 'task_paused',
      taskId: 'task-a',
      timestamp: '2026-02-25T10:15:00.000Z',
    });

    expect(window.localStorage.getItem('taskable:telemetry:v1')).toBeNull();
    await flushExecutionTelemetry();

    const stored = window.localStorage.getItem('taskable:telemetry:v1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored ?? '{}') as { events?: unknown[] };
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(parsed.events?.length).toBe(2);
  });

  it('respects telemetryShareEnabled gating for cloud shipping', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    recordExecutionTelemetryEvent({
      eventType: 'task_completed',
      taskId: 'task-c',
      timestamp: '2026-02-25T11:00:00.000Z',
      plannedDurationMinutes: 60,
      actualMinutes: 75,
    });
    await flushExecutionTelemetry({
      mode: 'cloud',
      token: 'token',
      orgId: 'org_1',
      telemetryShareEnabled: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await flushExecutionTelemetry({
      mode: 'cloud',
      token: 'token',
      orgId: 'org_1',
      telemetryShareEnabled: true,
      maxShip: 10,
    });
    expect(fetchSpy).toHaveBeenCalled();

    const stored = JSON.parse(window.localStorage.getItem('taskable:telemetry:v1') ?? '{}') as {
      events?: Array<{ cloudSyncedAt?: string }>;
    };
    expect(stored.events?.[0]?.cloudSyncedAt).toBeTruthy();
  });
});
