import React, { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Changing this key resets the boundary — pass `location.pathname`
   * to auto-reset on every navigation.
   */
  resetKey?: string | number;
  /**
   * Custom fallback UI. Receives the caught error and a reset callback.
   * Falls back to the default card UI when omitted.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /**
   * Called whenever an error is caught — wire up Sentry / logging here.
   */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Forward to caller-supplied logger (Sentry, Datadog, console, …)
    this.props.onError?.(error, info);

    // Always emit to console so devs see it in the browser DevTools
    console.error(
      "[ErrorBoundary] Uncaught error:",
      error,
      info.componentStack,
    );
  }

  /**
   * When the consumer changes `resetKey` (e.g. on route change) we clear
   * the error so the new page renders fresh instead of showing a stale
   * error screen from the previous route.
   */
  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.reset();
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  reset() {
    this.setState({ error: null });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) {
        return fallback(error, this.reset);
      }
      return <DefaultFallback error={error} reset={this.reset} />;
    }

    return children;
  }
}

// ─── Default Fallback UI ──────────────────────────────────────────────────────

function DefaultFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 p-8 text-center">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10">
        <AlertTriangle className="w-7 h-7 text-destructive" />
      </div>

      <div className="space-y-1.5">
        <p className="font-semibold text-lg text-foreground">
          Something went wrong
        </p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error.message || "An unexpected error occurred on this page."}
        </p>
      </div>

      <button
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        onClick={reset}
      >
        <RefreshCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}

// ─── Hook-friendly wrapper ────────────────────────────────────────────────────
// Lets function components pass the current pathname as resetKey without
// needing to import Component themselves.

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

/**
 * Drop-in wrapper that automatically resets the boundary whenever the
 * browser URL changes. Use this inside route wrappers (ProtectedRoute,
 * AdminRoute, etc.) instead of the bare ErrorBoundary.
 */
export function RouteErrorBoundary({
  children,
  onError,
  fallback,
}: RouteErrorBoundaryProps) {
  // We need useLocation, which is a hook — so we wrap ErrorBoundary in a
  // thin functional component that reads the pathname and passes it down.
  return (
    <LocationAwareErrorBoundary onError={onError} fallback={fallback}>
      {children}
    </LocationAwareErrorBoundary>
  );
}

// Internal component that can use hooks
import { useLocation } from "react-router-dom";

function LocationAwareErrorBoundary({
  children,
  onError,
  fallback,
}: RouteErrorBoundaryProps) {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} onError={onError} fallback={fallback}>
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
