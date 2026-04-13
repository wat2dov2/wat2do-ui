import React, { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { withTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/shared/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  t?: TFunction;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught render error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { t } = this.props;

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t?.("errorBoundary.title") || "Something went wrong"}
          </h2>
          <p className="text-muted-foreground mb-6 max-w-md">
            {this.state.error?.message || (t?.("errorBoundary.message") || "An unexpected error occurred. Please try refreshing the page.")}
          </p>
          <div className="flex gap-3">
            <Button onClick={this.handleReset} variant="outline">
              {t?.("errorBoundary.tryAgain") || "Try again"}
            </Button>
            <Button onClick={() => window.location.reload()} variant="default">
              {t?.("errorBoundary.refreshPage") || "Refresh page"}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default withTranslation()(ErrorBoundary);