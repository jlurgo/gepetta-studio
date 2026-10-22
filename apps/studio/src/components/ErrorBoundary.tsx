import { Component, type ReactNode } from "react";

/** Keeps one broken panel from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[gepetta] ${this.props.label} crashed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <p>Algo salió mal en {this.props.label}.</p>
        <button className="btn small" onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    );
  }
}
