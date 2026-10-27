// Remote configuration of the Android app. The app is a thin shell around the website, so everything the site serves
// already updates on its own; this adds the few native things the shell lets the web layer change without a new app file:
// status-bar / background colours (light and dark), the title in the recent-apps list, safe-area handling and an
// "update the app" notice. Edited by the platform owner in the console, read by every phone through /api/auth/app-config.
import { platformDb } from '../platform.js';
import { bad } from '../util.js';

const KEY = 'app_config';
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_APP_CONFIG = {
  appName: 'Agentify ERP',
  // chrome = colour behind the status bar and the gesture bar; icons = colour of the clock/battery icons drawn on it
  light: { chrome: '#ffffff', icons: 'dark', background: '#f4f9f7' },
  dark: { chrome: '#131c2e', icons: 'light', background: '#0b1220' },
  // 'native' = the shell pads the page below the bars; 'web' = the page pads itself using --safe-* variables
  insets: 'native',
  // versions are the app's versionCode (1.2.0 = 3). min blocks old apps until updated, latest only shows a notice.
  update: { min: 0, latest: 0, url: 'https://agentifyerp.co/download-app', message: '' },
};

function clean(input, base = DEFAULT_APP_CONFIG) {
  const i = input && typeof input === 'object' ? input : {};
  const mode = (m, b) => {
    const x = m && typeof m === 'object' ? m : {};
    if (x.chrome !== undefined && !COLOR.test(x.chrome)) throw bad('Colours must look like #0e7c6b');
    if (x.background !== undefined && !COLOR.test(x.background)) throw bad('Colours must look like #0e7c6b');
    if (x.icons !== undefined && !['dark', 'light'].includes(x.icons)) throw bad('Status bar icons are dark or light');
    return { chrome: x.chrome ?? b.chrome, icons: x.icons ?? b.icons, background: x.background ?? b.background };
  };
  const u = i.update && typeof i.update === 'object' ? i.update : {};
  const num = (v, b) => { if (v === undefined || v === '') return b; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 99999) throw bad('App versions are whole numbers'); return n; };
  const update = { min: num(u.min, base.update.min), latest: num(u.latest, base.update.latest), url: u.url === undefined ? base.update.url : String(u.url).trim(), message: u.message === undefined ? base.update.message : String(u.message).trim().slice(0, 200) };
  if (!/^https:\/\/[^\s]+$/.test(update.url)) throw bad('The update link must start with https://');
  if (update.min > update.latest && update.latest) throw bad('The latest version cannot be lower than the minimum');
  if (i.insets !== undefined && !['native', 'web'].includes(i.insets)) throw bad('Safe-area handling is native or web');
  const appName = i.appName === undefined ? base.appName : String(i.appName).trim().slice(0, 40);
  if (!appName) throw bad('Give the app a name');
  return { appName, light: mode(i.light, base.light), dark: mode(i.dark, base.dark), insets: i.insets ?? base.insets, update };
}

export function getAppConfig() {
  const v = platformDb().prepare('SELECT value FROM platform_settings WHERE key=?').get(KEY)?.value;
  if (!v) return DEFAULT_APP_CONFIG;
  try { return clean(JSON.parse(v)); } catch { return DEFAULT_APP_CONFIG; }
}
export function saveAppConfig(input, actor) {
  const next = clean(input, getAppConfig());
  platformDb().prepare("INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at").run(KEY, JSON.stringify(next), actor || null);
  return next;
}
/** What a phone receives: the platform settings, with the workspace's company name as the app title when it is in a workspace. */
export const publicAppConfig = (workspaceName) => ({ ...getAppConfig(), appName: workspaceName || getAppConfig().appName });
