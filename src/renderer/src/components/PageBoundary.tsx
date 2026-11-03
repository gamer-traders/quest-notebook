import { Component, type ReactNode } from 'react';

/** A page the editor can't build says what went wrong, and the rest of the window keeps working. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const cause = error.cause instanceof Error ? `\n${error.cause.message}` : '';
    return (
      <div className="page-broken" role="alert">
        <p>This page couldn’t be shown. Its file is as it was; other pages open as usual.</p>
        <pre className="unreadable-error">{error.message + cause}</pre>
      </div>
    );
  }
}
