const OP_METRIC_SAMPLE_LIMIT = 600;

export function pushMetricSample(samples, value) {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > OP_METRIC_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - OP_METRIC_SAMPLE_LIMIT);
  }
}

export function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

export function computeAverage(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

export function isoAtWindowStart(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes, 0, 0);
  return date.toISOString();
}

export function isoAtRetentionCutoff(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function aggregateOperationalSlo(events) {
  const syncLatencySamples = [];
  const dragResizeLatencySamples = [];
  const byType = new Map();
  let syncSuccess = 0;
  let syncFailures = 0;
  let sseConnectedEvents = 0;
  let sseReconnectEvents = 0;
  let outlookSuccess = 0;
  let outlookFailure = 0;

  events.forEach((event) => {
    const eventType = String(event.event_type || event.eventType || '');
    byType.set(eventType, (byType.get(eventType) ?? 0) + 1);

    if (eventType === 'sync.success') {
      syncSuccess += 1;
      if (typeof event.duration_ms === 'number') {
        pushMetricSample(syncLatencySamples, event.duration_ms);
      }
      return;
    }

    if (eventType === 'sync.fail') {
      syncFailures += 1;
      return;
    }

    if (eventType === 'sse.connected') {
      sseConnectedEvents += 1;
      return;
    }

    if (eventType === 'sse.reconnect') {
      sseReconnectEvents += 1;
      return;
    }

    if (eventType === 'outlook.import.success') {
      outlookSuccess += 1;
      return;
    }

    if (eventType === 'outlook.import.fail') {
      outlookFailure += 1;
      return;
    }

    if (
      (eventType === 'dnd.drop.performance' || eventType === 'dnd.resize.performance') &&
      typeof event.duration_ms === 'number'
    ) {
      pushMetricSample(dragResizeLatencySamples, event.duration_ms);
    }
  });

  const syncTotal = syncSuccess + syncFailures;
  const sseTotal = sseConnectedEvents + sseReconnectEvents;
  return {
    sync: {
      total: syncTotal,
      success: syncSuccess,
      failures: syncFailures,
      errorRate: syncTotal === 0 ? 0 : syncFailures / syncTotal,
      latencyMs: {
        count: syncLatencySamples.length,
        average: computeAverage(syncLatencySamples),
        p50: computePercentile(syncLatencySamples, 50),
        p95: computePercentile(syncLatencySamples, 95),
      },
    },
    realtime: {
      sseConnectedEvents,
      sseReconnectEvents,
      sseConnectedRatio: sseTotal === 0 ? 1 : sseConnectedEvents / sseTotal,
    },
    imports: {
      outlookSuccess,
      outlookFailure,
    },
    plannerInteraction: {
      dragResizeLatencyMs: {
        count: dragResizeLatencySamples.length,
        average: computeAverage(dragResizeLatencySamples),
        p50: computePercentile(dragResizeLatencySamples, 50),
        p95: computePercentile(dragResizeLatencySamples, 95),
      },
    },
    events: {
      byType: Object.fromEntries(byType.entries()),
      lastEventAt: events[0]?.created_at ?? events[0]?.createdAt ?? null,
    },
  };
}

export function evaluateOperationalAlerts(
  events,
  {
    windowMinutes,
    thresholds = {
      syncErrorRate: 0.25,
      sseDisconnectRatio: 0.3,
      outlookImportFailures: 3,
    },
  }
) {
  const aggregate = aggregateOperationalSlo(events);
  const alerts = [];

  if (aggregate.sync.total >= 8 && aggregate.sync.errorRate > thresholds.syncErrorRate) {
    alerts.push({
      code: 'SYNC_ERROR_RATE_SPIKE',
      severity: 'warning',
      message: 'Sync error rate is above threshold.',
      value: aggregate.sync.errorRate,
      threshold: thresholds.syncErrorRate,
      windowMinutes,
    });
  }

  const sseTotal = aggregate.realtime.sseConnectedEvents + aggregate.realtime.sseReconnectEvents;
  const sseDisconnectRatio = sseTotal === 0 ? 0 : aggregate.realtime.sseReconnectEvents / sseTotal;
  if (sseTotal >= 5 && sseDisconnectRatio > thresholds.sseDisconnectRatio) {
    alerts.push({
      code: 'SSE_RECONNECT_RATIO_SPIKE',
      severity: 'warning',
      message: 'Realtime reconnect ratio is above threshold.',
      value: sseDisconnectRatio,
      threshold: thresholds.sseDisconnectRatio,
      windowMinutes,
    });
  }

  if (aggregate.imports.outlookFailure >= thresholds.outlookImportFailures) {
    alerts.push({
      code: 'OUTLOOK_IMPORT_FAILURE_SPIKE',
      severity: 'warning',
      message: 'Outlook import failures exceeded threshold.',
      value: aggregate.imports.outlookFailure,
      threshold: thresholds.outlookImportFailures,
      windowMinutes,
    });
  }

  return alerts;
}

export function sanitizeOperationalMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const blockedKeys = ['title', 'subject', 'description', 'body', 'content', 'text'];
  const entries = Object.entries(metadata)
    .filter(([key, value]) => {
      const normalized = key.toLowerCase();
      if (blockedKeys.some((blocked) => normalized.includes(blocked))) return false;
      const valueType = typeof value;
      return (
        value === null ||
        valueType === 'string' ||
        valueType === 'number' ||
        valueType === 'boolean'
      );
    })
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value.slice(0, 120)];
      }
      if (typeof value === 'number') {
        return [key, Number.isFinite(value) ? value : 0];
      }
      return [key, value];
    });

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}
