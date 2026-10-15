import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/app.css';

// A crash while drawing would otherwise leave a blank page; show what broke instead.
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="home">
        <h1 className="wordmark">Praxis stopped</h1>
        <p className="bad">{error.message}</p>
        <pre className="crash">{error.stack}</pre>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');
createRoot(root).render(<StrictMode><Crash><App /></Crash></StrictMode>);
