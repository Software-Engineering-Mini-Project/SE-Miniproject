import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand-mark" aria-hidden="true">T</span>
        <span>Task Manager</span>
      </header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">Workspace</p>
        <h1 id="welcome-title">Your work, in one place.</h1>
        <p className="intro">The project foundation is ready. Task and project features will be added here.</p>
        <div className="starter-card">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>Application is running</strong>
            <p>Frontend starter connected to the development setup.</p>
          </div>
        </div>
      </section>
      <footer>SE-Miniproject · Development starter</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);