interface PrimitiveMetaValue {
  [key: string]: string | number | boolean | null;
}

export type ProductAnalyticsMode = 'local' | 'cloud' | 'unknown';

export type ProductAnalyticsEventType =
  | 'landing_viewed'
  | 'landing_continue_local_clicked'
  | 'landing_sign_in_clicked'
  | 'landing_sign_up_clicked'
  | 'demo_viewed'
  | 'security_viewed'
  | 'support_viewed'
  | 'planner_viewed'
  | 'team_viewed'
  | 'compact_viewed'
  | 'tutorial_viewed'
  | 'tutorial_skipped'
  | 'tutorial_completed'
  | 'task_created'
  | 'activation_first_task_created';

export interface ProductAnalyticsEventInput {
  eventType: ProductAnalyticsEventType;
  mode?: ProductAnalyticsMode;
  metadata?: PrimitiveMetaValue;
  recordedAt?: string;
}

export interface ProductAnalyticsEvent extends ProductAnalyticsEventInput {
  id: string;
  recordedAt: string;
}

interface ProductAnalyticsPayload {
  schemaVersion: number;
  events: ProductAnalyticsEvent[];
}

export interface ProductAnalyticsSummary {
  counts: {
    landingViews: number;
    localStarts: number;
    signInClicks: number;
    signUpClicks: number;
    demoViews: number;
    securityViews: number;
    supportViews: number;
    plannerViews: number;
    teamViews: number;
    compactViews: number;
    tutorialViews: number;
    tutorialSkips: number;
    tutorialCompletions: number;
    taskCreates: number;
    firstTaskActivations: number;
  };
  activation: {
    localStartRatePercent: number | null;
    signUpRatePercent: number | null;
    tutorialCompletionRatePercent: number | null;
    firstTaskActivationRatePercent: number | null;
  };
  retention: {
    activeDaysLast7: number;
    activeDaysLast30: number;
    plannerDaysLast7: number;
    plannerDaysLast30: number;
    lastActiveAt: string | null;
  };
}

const STORAGE_KEY = 'taskable:product-analytics:v1';
const SCHEMA_VERSION = 1;
const MAX_EVENTS = 2000;
const REDACTED_KEYS = new Set([
  'title',
  'tasktitle',
  'subject',
  'description',
  'body',
  'content',
  'note',
  'text',
  'email',
  'username',
  'name',
  'token',
]);

function buildDefaultPayload(): ProductAnalyticsPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    events: [],
  };
}

function sanitizeMetadata(metadata?: PrimitiveMetaValue): PrimitiveMetaValue | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const sanitizedEntries = Object.entries(metadata)
    .filter(([rawKey, value]) => {
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (REDACTED_KEYS.has(key)) return false;
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

  if (sanitizedEntries.length === 0) return undefined;
  return Object.fromEntries(sanitizedEntries);
}

function buildEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `product_${Math.random().toString(36).slice(2, 11)}`;
}

function loadPayload(): ProductAnalyticsPayload {
  if (typeof window === 'undefined') return buildDefaultPayload();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultPayload();
    const parsed = JSON.parse(raw) as Partial<ProductAnalyticsPayload>;

    if (!Array.isArray(parsed.events)) return buildDefaultPayload();

    const events = parsed.events.filter((entry): entry is ProductAnalyticsEvent => {
      return (
        typeof entry?.id === 'string' &&
        typeof entry?.eventType === 'string' &&
        typeof entry?.recordedAt === 'string'
      );
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      events: events.slice(-MAX_EVENTS),
    };
  } catch {
    return buildDefaultPayload();
  }
}

function savePayload(payload: ProductAnalyticsPayload) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage write issues.
  }
}

function countEvents(events: ProductAnalyticsEvent[], eventType: ProductAnalyticsEventType): number {
  return events.reduce((total, event) => total + (event.eventType === eventType ? 1 : 0), 0);
}

function toPercent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 100);
}

function getUniqueDayCount(events: ProductAnalyticsEvent[], days: number): number {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const dayKeys = new Set<string>();

  events.forEach((event) => {
    const eventMs = Date.parse(event.recordedAt);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) return;
    dayKeys.add(event.recordedAt.slice(0, 10));
  });

  return dayKeys.size;
}

export function recordProductEvent(input: ProductAnalyticsEventInput) {
  if (!input.eventType || typeof input.eventType !== 'string') return;

  const payload = loadPayload();
  const nextEvent: ProductAnalyticsEvent = {
    id: buildEventId(),
    eventType: input.eventType,
    mode: input.mode ?? 'unknown',
    metadata: sanitizeMetadata(input.metadata),
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };

  const events = [...payload.events, nextEvent];
  savePayload({
    schemaVersion: SCHEMA_VERSION,
    events: events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events,
  });
}

export function getProductAnalyticsEvents(): ProductAnalyticsEvent[] {
  return loadPayload().events;
}

export function getProductAnalyticsSummary(): ProductAnalyticsSummary {
  const events = getProductAnalyticsEvents();
  const plannerActivityEvents = events.filter((event) => {
    return (
      event.eventType === 'planner_viewed' ||
      event.eventType === 'team_viewed' ||
      event.eventType === 'compact_viewed' ||
      event.eventType === 'task_created' ||
      event.eventType === 'activation_first_task_created'
    );
  });

  const plannerViewEvents = events.filter((event) => {
    return (
      event.eventType === 'planner_viewed' ||
      event.eventType === 'team_viewed' ||
      event.eventType === 'compact_viewed'
    );
  });

  const sortedPlannerActivity = [...plannerActivityEvents].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt)
  );

  const landingViews = countEvents(events, 'landing_viewed');
  const localStarts = countEvents(events, 'landing_continue_local_clicked');
  const signInClicks = countEvents(events, 'landing_sign_in_clicked');
  const signUpClicks = countEvents(events, 'landing_sign_up_clicked');
  const demoViews = countEvents(events, 'demo_viewed');
  const securityViews = countEvents(events, 'security_viewed');
  const supportViews = countEvents(events, 'support_viewed');
  const plannerViews = countEvents(events, 'planner_viewed');
  const teamViews = countEvents(events, 'team_viewed');
  const compactViews = countEvents(events, 'compact_viewed');
  const tutorialViews = countEvents(events, 'tutorial_viewed');
  const tutorialSkips = countEvents(events, 'tutorial_skipped');
  const tutorialCompletions = countEvents(events, 'tutorial_completed');
  const taskCreates = countEvents(events, 'task_created');
  const firstTaskActivations = countEvents(events, 'activation_first_task_created');

  return {
    counts: {
      landingViews,
      localStarts,
      signInClicks,
      signUpClicks,
      demoViews,
      securityViews,
      supportViews,
      plannerViews,
      teamViews,
      compactViews,
      tutorialViews,
      tutorialSkips,
      tutorialCompletions,
      taskCreates,
      firstTaskActivations,
    },
    activation: {
      localStartRatePercent: toPercent(localStarts, landingViews),
      signUpRatePercent: toPercent(signUpClicks, landingViews),
      tutorialCompletionRatePercent: toPercent(tutorialCompletions, tutorialViews),
      firstTaskActivationRatePercent: toPercent(firstTaskActivations, landingViews),
    },
    retention: {
      activeDaysLast7: getUniqueDayCount(plannerActivityEvents, 7),
      activeDaysLast30: getUniqueDayCount(plannerActivityEvents, 30),
      plannerDaysLast7: getUniqueDayCount(plannerViewEvents, 7),
      plannerDaysLast30: getUniqueDayCount(plannerViewEvents, 30),
      lastActiveAt:
        sortedPlannerActivity.length > 0
          ? sortedPlannerActivity[sortedPlannerActivity.length - 1].recordedAt
          : null,
    },
  };
}
