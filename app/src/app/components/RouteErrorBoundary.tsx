import { useMemo } from 'react';
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router';
import { AlertTriangle, Bug, Home, RefreshCcw, RotateCw } from 'lucide-react';
import { Button } from './ui/button';

type ErrorDiagnostics = {
  title: string;
  message: string;
  statusLabel: string;
  requestId: string;
  details: string;
};

function extractRequestId(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    const responseData = error.data;
    if (
      responseData &&
      typeof responseData === 'object' &&
      'requestId' in responseData &&
      typeof responseData.requestId === 'string'
    ) {
      return responseData.requestId;
    }
  }

  if (!error || typeof error !== 'object') return 'n/a';

  if ('requestId' in error && typeof error.requestId === 'string') {
    return error.requestId;
  }

  if ('headers' in error && error.headers && typeof error.headers === 'object') {
    const headers = error.headers as { get?: (name: string) => string | null };
    const headerValue =
      headers.get?.('x-request-id') ??
      headers.get?.('X-Request-Id') ??
      headers.get?.('x-requestid') ??
      null;
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      return headerValue;
    }
  }

  return 'n/a';
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  if (isRouteErrorResponse(error)) {
    return JSON.stringify(
      {
        status: error.status,
        statusText: error.statusText,
        data: error.data,
      },
      null,
      2
    );
  }

  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function buildDiagnostics(error: unknown): ErrorDiagnostics {
  if (isRouteErrorResponse(error)) {
    return {
      title: 'Route load failed',
      message:
        typeof error.data?.message === 'string'
          ? error.data.message
          : `The requested route failed with status ${error.status}.`,
      statusLabel: `${error.status} ${error.statusText || ''}`.trim(),
      requestId: extractRequestId(error),
      details: formatErrorDetails(error),
    };
  }

  const fallbackMessage =
    error instanceof Error && error.message
      ? error.message
      : 'Taskable could not load this view. Try retrying or reloading.';

  return {
    title: 'Unexpected application error',
    message: fallbackMessage,
    statusLabel: 'Runtime error',
    requestId: extractRequestId(error),
    details: formatErrorDetails(error),
  };
}

export default function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();
  const diagnostics = useMemo(() => buildDiagnostics(error), [error]);

  const handleRetry = () => {
    navigate(0);
  };

  const handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleGoHome = () => {
    navigate('/', { replace: true });
  };

  return (
    <div
      data-testid="route-error-boundary"
      className="flex min-h-[100dvh] items-center justify-center bg-[var(--board-bg)] p-6 text-[var(--board-text)]"
    >
      <section className="ui-hud-shell w-full max-w-3xl rounded-3xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-[color:var(--hud-border)] bg-[var(--hud-alert-bg)] p-3 text-[color:var(--hud-alert-text)]">
            <AlertTriangle className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--hud-muted)]">
              Taskable
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{diagnostics.title}</h1>
            <p className="mt-2 text-sm text-[color:var(--hud-muted)]">{diagnostics.message}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            type="button"
            data-testid="route-error-retry"
            onClick={handleRetry}
            className="ui-hud-btn-accent rounded-xl px-4"
          >
            <RotateCw className="size-4" />
            Retry
          </Button>
          <Button
            type="button"
            data-testid="route-error-reload"
            onClick={handleReload}
            className="ui-hud-btn rounded-xl px-4"
          >
            <RefreshCcw className="size-4" />
            Reload
          </Button>
          <Button
            type="button"
            data-testid="route-error-home"
            onClick={handleGoHome}
            className="ui-hud-btn rounded-xl px-4"
          >
            <Home className="size-4" />
            Go Home
          </Button>
        </div>

        <div
          data-testid="route-error-diagnostics"
          className="ui-hud-section mt-6 space-y-3 rounded-2xl p-4 text-sm"
        >
          <div className="flex items-center gap-2 text-[color:var(--hud-text)]">
            <Bug className="size-4" />
            Diagnostics
          </div>
          <dl className="space-y-2 text-[color:var(--hud-muted)]">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Status</dt>
              <dd>{diagnostics.statusLabel}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Request ID</dt>
              <dd data-testid="route-error-request-id">{diagnostics.requestId}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>Route</dt>
              <dd>{location.pathname}</dd>
            </div>
          </dl>
          <details>
            <summary className="cursor-pointer select-none text-[color:var(--hud-text)]">
              Show technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-black/20 p-3 text-xs text-[color:var(--hud-muted)]">
              {diagnostics.details}
            </pre>
          </details>
        </div>
      </section>
    </div>
  );
}
