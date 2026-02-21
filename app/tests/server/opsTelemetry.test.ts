// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  aggregateOperationalSlo,
  evaluateOperationalAlerts,
  isoAtRetentionCutoff,
  sanitizeOperationalMetadata,
} from '../../server/src/opsTelemetry.js';

describe('ops telemetry aggregation', () => {
  it('aggregates sync, realtime, import, and dnd metrics', () => {
    const events = [
      { event_type: 'sync.success', duration_ms: 120, created_at: '2026-02-20T10:00:00.000Z' },
      { event_type: 'sync.success', duration_ms: 80, created_at: '2026-02-20T10:01:00.000Z' },
      { event_type: 'sync.fail', created_at: '2026-02-20T10:02:00.000Z' },
      { event_type: 'sse.connected', created_at: '2026-02-20T10:03:00.000Z' },
      { event_type: 'sse.reconnect', created_at: '2026-02-20T10:04:00.000Z' },
      { event_type: 'outlook.import.success', created_at: '2026-02-20T10:05:00.000Z' },
      { event_type: 'outlook.import.fail', created_at: '2026-02-20T10:06:00.000Z' },
      {
        event_type: 'dnd.drop.performance',
        duration_ms: 44,
        created_at: '2026-02-20T10:07:00.000Z',
      },
      {
        event_type: 'dnd.resize.performance',
        duration_ms: 66,
        created_at: '2026-02-20T10:08:00.000Z',
      },
    ];

    const aggregate = aggregateOperationalSlo(events);

    expect(aggregate.sync.total).toBe(3);
    expect(aggregate.sync.success).toBe(2);
    expect(aggregate.sync.failures).toBe(1);
    expect(aggregate.sync.errorRate).toBeCloseTo(1 / 3, 4);
    expect(aggregate.sync.latencyMs.count).toBe(2);
    expect(aggregate.sync.latencyMs.p50).toBe(80);
    expect(aggregate.sync.latencyMs.p95).toBe(120);

    expect(aggregate.realtime.sseConnectedEvents).toBe(1);
    expect(aggregate.realtime.sseReconnectEvents).toBe(1);
    expect(aggregate.imports.outlookSuccess).toBe(1);
    expect(aggregate.imports.outlookFailure).toBe(1);
    expect(aggregate.plannerInteraction.dragResizeLatencyMs.count).toBe(2);
  });

  it('raises alerts when thresholds are exceeded', () => {
    const events = [
      { event_type: 'sync.fail' },
      { event_type: 'sync.fail' },
      { event_type: 'sync.fail' },
      { event_type: 'sync.fail' },
      { event_type: 'sync.fail' },
      { event_type: 'sync.success', duration_ms: 100 },
      { event_type: 'sync.success', duration_ms: 120 },
      { event_type: 'sync.success', duration_ms: 90 },
      { event_type: 'sse.connected' },
      { event_type: 'sse.reconnect' },
      { event_type: 'sse.reconnect' },
      { event_type: 'sse.reconnect' },
      { event_type: 'sse.reconnect' },
      { event_type: 'outlook.import.fail' },
      { event_type: 'outlook.import.fail' },
      { event_type: 'outlook.import.fail' },
      { event_type: 'outlook.import.fail' },
    ];

    const alerts = evaluateOperationalAlerts(events, {
      windowMinutes: 15,
      thresholds: {
        syncErrorRate: 0.3,
        sseDisconnectRatio: 0.6,
        outlookImportFailures: 3,
      },
    });

    expect(alerts.map((alert: { code: string }) => alert.code)).toEqual(
      expect.arrayContaining([
        'SYNC_ERROR_RATE_SPIKE',
        'SSE_RECONNECT_RATIO_SPIKE',
        'OUTLOOK_IMPORT_FAILURE_SPIKE',
      ])
    );
  });
});

describe('ops telemetry helpers', () => {
  it('strips sensitive metadata and bounds values', () => {
    const metadata = sanitizeOperationalMetadata({
      title: 'Sensitive title',
      subject: 'Sensitive subject',
      operation: 'sync_push',
      retries: 4,
      ok: true,
      payload: { nested: true },
      long: 'x'.repeat(400),
      weird: Number.NaN,
    });

    expect(metadata).toEqual({
      operation: 'sync_push',
      retries: 4,
      ok: true,
      long: 'x'.repeat(120),
      weird: 0,
    });
  });

  it('builds a retention cutoff in the past', () => {
    const cutoff = isoAtRetentionCutoff(7);
    const cutoffMs = Date.parse(cutoff);
    const nowMs = Date.now();
    expect(Number.isFinite(cutoffMs)).toBe(true);
    expect(cutoffMs).toBeLessThan(nowMs - 6 * 24 * 60 * 60 * 1000);
  });
});
