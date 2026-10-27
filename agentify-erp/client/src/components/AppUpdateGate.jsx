import { useNativeShell, dismissUpdate, openExternal } from '../nativeShell.js';

/**
 * Only inside the phone app. A rarely needed new app file is announced here: a banner when an update is available, a
 * full screen when this version is too old to work (both set in the console, Mobile app). Everything else updates by itself.
 */
export default function AppUpdateGate() {
  const { update, versionName } = useNativeShell();
  if (update.level === 'none') return null;
  const text = update.message || (update.level === 'required' ? 'This version of the app is too old. Please install the new one to continue.' : 'A new version of the app is available.');
  if (update.level === 'required') {
    return (
      <div className="app-update-block" role="alertdialog" aria-modal="true" aria-label="Update required">
        <div className="card-b stack">
          <h2>Update the app</h2>
          <p>{text}</p>
          <p className="muted" style={{ fontSize: 12 }}>You have version {versionName}. Your data is safe; only the app file needs replacing.</p>
          <button className="btn primary" onClick={() => openExternal(update.url)}>Download the new app</button>
        </div>
      </div>
    );
  }
  return (
    <div className="app-update-bar no-print" role="status">
      <span>{text}</span>
      <button className="btn sm primary" onClick={() => openExternal(update.url)}>Update</button>
      <button className="icon-btn" aria-label="Dismiss" onClick={dismissUpdate}>×</button>
    </div>
  );
}
