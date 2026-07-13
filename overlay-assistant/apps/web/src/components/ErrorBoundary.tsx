import React, { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; error: Error | null; errorInfo: ErrorInfo | null };

/**
 * React Error Boundary — catches render errors and shows a recovery UI
 * instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">⚠</div>
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-text">
              An unexpected interface error occurred. Try again, or reload to reconnect.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="error-boundary-detail">
                {this.state.error.message}
                {this.state.errorInfo?.componentStack && (
                  <>{"\n"}{this.state.errorInfo.componentStack}</>
                )}
              </pre>
            )}
            <div className="error-boundary-actions">
              <button className="btn-luxury btn-luxury--primary" onClick={this.handleReload}>
                Try Again
              </button>
              <button className="btn-luxury btn-luxury--secondary" onClick={() => window.location.reload()}>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
