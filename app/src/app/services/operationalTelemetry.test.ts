import { beforeEach, describe, expect, it } from 'vitest';
import { getOperationalTelemetryEvents, recordOperationalEvent } from './operationalTelemetry';

describe('operationalTelemetry', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('records events with safe primitives only', () => {
    recordOperationalEvent({
      eventType: 'sync.success',
      durationMs: 124,
      metadata: {
        operation: 'push',
        retries: 0,
        ok: true,
      },
    });

    const events = getOperationalTelemetryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('sync.success');
    expect(events[0]?.durationMs).toBe(124);
    expect(events[0]?.metadata).toMatchObject({
      operation: 'push',
      retries: 0,
      ok: true,
    });
  });

  it('redacts task content keys from metadata', () => {
    recordOperationalEvent({
      eventType: 'sync.fail',
      metadata: {
        title: 'Client Call',
        subject: 'Invoice email',
        code: 'VERSION_CONFLICT',
      },
    });

    const [entry] = getOperationalTelemetryEvents();
    expect(entry?.metadata).toEqual({
      code: 'VERSION_CONFLICT',
    });
  });
});
