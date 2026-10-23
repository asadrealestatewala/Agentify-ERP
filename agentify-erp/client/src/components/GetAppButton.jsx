// "Download app" button for the workspace top bar. One click opens the browser's install dialog where the browser
// offers it; otherwise it opens the Install page, which shows the steps for this device (iPhone: Share > Add to Home Screen).
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { useInstallApp } from '../installApp.js';

export default function GetAppButton() {
  const app = useInstallApp();
  const nav = useNavigate();
  if (app.installed) return null;
  const click = async () => { if (app.canPrompt) await app.install(); else nav('/my/install-app'); };
  return (
    <button type="button" className="btn sm primary no-print get-app-btn" onClick={click} aria-label="Download the app" title="Download the app">
      <Icon name="download" size={14} /><span className="get-app-label">Download app</span>
    </button>
  );
}
