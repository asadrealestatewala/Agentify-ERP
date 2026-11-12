import { Component } from 'react';

// A screen that fails to draw no longer blanks the whole app: the person sees a short message and can reload or go home.
// A new app version that changed a page's file name (lazy-loaded chunk missing after a deploy) is fixed by one reload.
const isStaleChunk = (e) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(e?.message || e));

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('[screen error]', error, info?.componentStack);
    // reload once by itself for a missing chunk after a deploy; a second failure shows the message
    try {
      if (isStaleChunk(error) && !sessionStorage.getItem('chunk-reload')) { sessionStorage.setItem('chunk-reload', '1'); window.location.reload(); }
    } catch { /* storage blocked: the message below still shows */ }
  }

  componentDidUpdate(prev) {
    // moving to another screen clears the message
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ maxWidth: 460, margin: '12vh auto', padding: '0 16px', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 8 }}>This screen could not be shown</h2>
        <p className="muted" style={{ marginBottom: 20 }}>Something went wrong while drawing this page. Your data is safe. Reload to try again, or go back to the home screen.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary" onClick={() => { try { sessionStorage.removeItem('chunk-reload'); } catch { /* ignore */ } window.location.reload(); }}>Reload the page</button>
          <a className="btn" href="/">Go to home</a>
        </div>
      </div>
    );
  }
}
