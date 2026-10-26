// My Space › Install the app. The ERP is an installable web app (manifest + service worker); this page offers the
// browser's own install prompt where it exists, explains the steps where it does not (iPhone), and shows store links
// only when real published listings are configured (see marketing/home/config.js).
import { useEffect, useState } from 'react';
import { useFetch } from '../context.jsx';
import { Card, PageHead } from '../components/ui.jsx';
import { APK_URL } from '../installApp.js';
// Native store listings, once published, set at build time (only https links on play.google.com / apps.apple.com are shown).
const STORE_LINKS = { android: import.meta.env.VITE_ANDROID_STORE_URL || '', ios: import.meta.env.VITE_IOS_STORE_URL || '' };

const validStore = (url, host) => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === host ? u.toString() : null; } catch { return null; } };
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
// Inside the Android store app the file download is hidden (Google Play does not allow an app to offer another way to install itself).
const inNativeApp = !!window.Capacitor?.isNativePlatform?.() || /; wv\)/.test(ua);
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);

export default function InstallApp() {
  const links = useFetch('/api/billing/status').data?.app; // Google Play link + direct file, only for paying workspaces
  const [evt, setEvt] = useState(() => window.__erpInstallEvt || null);
  const [state, setState] = useState(() => (standalone() ? 'installed' : 'idle'));
  useEffect(() => {
    const h = (e) => { e.preventDefault(); window.__erpInstallEvt = e; setEvt(e); };
    const done = () => { window.__erpInstallEvt = null; setEvt(null); setState('installed'); };
    window.addEventListener('beforeinstallprompt', h); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done); };
  }, []);
  const install = async () => {
    if (!evt) return;
    setState('asking');
    evt.prompt();
    const choice = await evt.userChoice.catch(() => null);
    window.__erpInstallEvt = null; setEvt(null);
    setState(choice?.outcome === 'accepted' ? 'installed' : 'idle');
  };
  const android = validStore(STORE_LINKS.android, 'play.google.com');
  const ios = validStore(STORE_LINKS.ios, 'apps.apple.com');
  const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  return (
    <>
      <PageHead title="Install the app" sub="Use the ERP like an app on your phone or computer: its own icon, full screen, and reminders." />
      {!inNativeApp && <Card title="Android app">
        {links ? (<>
          <p>Get the Agentify ERP Android app. {links.android_store_url ? 'Install it from Google Play, or use the direct file if your phone has no Google Play.' : 'Download the app file and open it to install. Android may ask you to allow installs from your browser once.'}</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {links.android_store_url && <a className="btn primary" href={links.android_store_url} target="_blank" rel="noreferrer">Get it on Google Play</a>}
            <a className={links.android_store_url ? 'btn' : 'btn primary'} href={links.apk_url || APK_URL} download="agentify-erp.apk">Download for Android (direct file)</a>
          </div>
        </>) : <p className="muted" style={{ margin: 0 }}>The Android app is included with a paid subscription. You can already install the web app on this device below.</p>}
      </Card>}
      <Card title="On this device">
        {state === 'installed' ? <p>The app is installed on this device. Open it from your home screen or app list.</p>
          : evt ? (<><p>Your browser can install the app now.</p><button className="btn primary" onClick={install} disabled={state === 'asking'}>{state === 'asking' ? 'Waiting for your answer…' : 'Install the app'}</button></>)
          : isIOS ? <p>On iPhone or iPad, open this page in <b>Safari</b>, tap <b>Share</b>, then <b>Add to Home Screen</b>. Reminders need iOS 16.4 or later and the app added to the home screen.</p>
          : <p>Your browser has not offered to install the app on this page. In Chrome or Edge, open the browser menu and choose <b>Install app</b> (or <b>Add to Home screen</b> on Android).</p>}
        {!secure && <div className="alert warn" style={{ marginTop: 12 }}>Installing needs a secure (https) address. Ask your administrator for the https address of this workspace.</div>}
      </Card>
      <Card title="Step by step">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          <li><b>Android (Chrome):</b> menu (⋮) › <b>Install app</b>.</li>
          <li><b>iPhone and iPad (Safari):</b> Share › <b>Add to Home Screen</b>.</li>
          <li><b>Windows or Mac (Chrome, Edge):</b> the install icon in the address bar, or menu › <b>Install</b>.</li>
        </ul>
      </Card>
      <Card title="App stores">
        {(android || ios) ? (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{android && <a className="btn" href={android} target="_blank" rel="noreferrer">Get it on Google Play</a>}{ios && <a className="btn" href={ios} target="_blank" rel="noreferrer">Download on the App Store</a>}</div>
        ) : <p className="muted" style={{ margin: 0 }}>Versions for Google Play and the App Store are not published yet. The installed web app above has the same features.</p>}
      </Card>
    </>
  );
}
