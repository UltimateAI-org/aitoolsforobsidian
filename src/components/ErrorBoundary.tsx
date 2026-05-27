import * as React from "react";

interface ErrorBoundaryProps {
	onReset?: () => void;
	children: React.ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Top-level React error boundary for the chat view.
 *
 * Catches unhandled render errors (e.g. malformed diff data, unexpected null)
 * that would otherwise crash the entire side panel to a white screen.
 * Shows a fallback UI with a "Restart Session" button to recover.
 */
export class ErrorBoundary extends React.Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { hasError: false, error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("[AI Tools] React render error:", error, errorInfo);
	}

	handleReset = () => {
		this.setState({ hasError: false, error: null });
		this.props.onReset?.();
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="obsidianaitools-error-boundary">
					<div className="obsidianaitools-error-boundary-content">
						<h3>Something went wrong</h3>
						<p>An unexpected error occurred in the chat view.</p>
						{this.state.error && (
							<pre className="obsidianaitools-error-boundary-details">
								{this.state.error.message}
							</pre>
						)}
						<button
							className="mod-cta"
							onClick={this.handleReset}
						>
							Restart Session
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
