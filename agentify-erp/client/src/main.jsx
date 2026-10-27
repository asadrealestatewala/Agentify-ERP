import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProviders } from './context.jsx';
import './installApp.js';
import './theme.js';
import './supabase.js';
import { registerSW } from './components/Push.jsx';
import './styles.css';
import './styles2.css';
import './styles3.css';
import './mobile.css';
import { setRegion } from './format.js';
import { setLanguage, pickLanguage } from './i18n.js';
import { seedHomeEntry } from './backNav.js';
import { watchTables } from './mobileTables.js';
import { startNativeShell } from './nativeShell.js';
import AppUpdateGate from './components/AppUpdateGate.jsx';

registerSW();
seedHomeEntry();
watchTables();
startNativeShell();

// The workspace's region (formats, units, terms) is applied before anything renders an amount. Failing to load it
// leaves the Pakistan defaults, which is what the app always used.
async function start() {
  try {
    const r = await fetch('/api/auth/region', { credentials: 'same-origin' });
    if (r.ok) {
      const cfg = await r.json();
      setRegion(cfg);
      setLanguage(pickLanguage(cfg));
    }
  } catch { /* offline or old server: keep defaults */ }
  createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
        <AppUpdateGate />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
);
}
start();
