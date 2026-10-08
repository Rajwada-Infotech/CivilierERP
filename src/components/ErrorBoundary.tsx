import React from "react";
import { ErrorPage } from "@/pages/ErrorPage";
import { isChunkLoadError, reloadForNewVersion } from "@/lib/chunkReload";

interface Props {
  children: React.ReactNode;
  /** Optional fallback — defaults to full-page ErrorPage */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** The error is a missing page file from an older build and a reload is under way. */
  updating?: boolean;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Render error caught:", error);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
    if (isChunkLoadError(error) && reloadForNewVersion()) this.setState({ updating: true });
  }

  public reset = () => this.setState({ hasError: false, error: null, updating: false });

  public render() {
    if (this.state.hasError && this.state.updating) {
      return (
        <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
          A new version is available. Refreshing…
        </div>
      );
    }
    if (this.state.hasError) {
      if (this.props.fallback && this.state.error) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <ErrorPage error={this.state.error} />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
export { ErrorBoundary, ErrorBoundary as RouteErrorBoundary };
