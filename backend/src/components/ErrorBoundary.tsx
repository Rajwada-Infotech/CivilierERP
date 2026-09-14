import React from "react";
import { ErrorPage } from "@/pages/ErrorPage";

interface Props {
  children: React.ReactNode;
  /** Optional fallback — defaults to full-page ErrorPage */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Render error caught:", error);
    console.error("[ErrorBoundary] Component stack:", info.componentStack);
  }

  public reset = () => this.setState({ hasError: false, error: null });

  public render() {
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
