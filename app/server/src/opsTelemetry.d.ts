export interface OpsEventRow {
  event_type?: string;
  eventType?: string;
  duration_ms?: number;
  created_at?: string;
  createdAt?: string;
}

export interface OperationalAggregate {
  sync: {
    total: number;
    success: number;
    failures: number;
    errorRate: number;
    latencyMs: {
      count: number;
      average: number | null;
      p50: number | null;
      p95: number | null;
    };
  };
  realtime: {
    sseConnectedEvents: number;
    sseReconnectEvents: number;
    sseConnectedRatio: number;
  };
  imports: {
    outlookSuccess: number;
    outlookFailure: number;
  };
  plannerInteraction: {
    dragResizeLatencyMs: {
      count: number;
      average: number | null;
      p50: number | null;
      p95: number | null;
    };
  };
  events: {
    byType: Record<string, number>;
    lastEventAt: string | null;
  };
}

export interface OperationalAlert {
  code: 'SYNC_ERROR_RATE_SPIKE' | 'SSE_RECONNECT_RATIO_SPIKE' | 'OUTLOOK_IMPORT_FAILURE_SPIKE';
  severity: 'warning';
  message: string;
  value: number;
  threshold: number;
  windowMinutes: number;
}

export function pushMetricSample(samples: number[], value: number): void;
export function computePercentile(values: number[], percentile: number): number | null;
export function computeAverage(values: number[]): number | null;
export function isoAtWindowStart(minutes: number): string;
export function isoAtRetentionCutoff(days: number): string;
export function aggregateOperationalSlo(events: OpsEventRow[]): OperationalAggregate;
export function evaluateOperationalAlerts(
  events: OpsEventRow[],
  options: {
    windowMinutes: number;
    thresholds?: {
      syncErrorRate: number;
      sseDisconnectRatio: number;
      outlookImportFailures: number;
    };
  }
): OperationalAlert[];
export function sanitizeOperationalMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, string | number | boolean | null> | undefined;
