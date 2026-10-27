import { useContext, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, Select, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, MeContext } from './AdminShell.jsx';

const Colour = ({ value, onChange }) => (
  <div className="row" style={{ gap: 8 }}>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Pick a colour" style={{ width: 44, height: 34, padding: 2 }} />
    <TextInput value={value} onChange={onChange} style={{ maxWidth: 120 }} />
  </div>
);

/** Remote configuration of the Android app: what changes on every phone the moment this is saved, with no new app file. */
export default function MobileAppPage() {
  const toast = useToast();
  const me = useContext(MeContext);
  const canManage = me.permissions.includes('system.manage');
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`${A}/app-config`).then(setCfg).catch((e) => setErr(e.message)); }, []);
  if (err && !cfg) return <ErrorBox error={err} />;
  if (!cfg) return <Loading />;
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const mode = (k, patch) => set({ [k]: { ...cfg[k], ...patch } });
  const upd = (patch) => set({ update: { ...cfg.update, ...patch } });
  const save = async () => {
    setBusy(true); setErr('');
    try { setCfg(await api.put(`${A}/app-config`, cfg)); toast('Saved. Phones pick this up the next time they open the app (within about 10 minutes if already open).'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageTitle title="Mobile app" sub="The Android app opens your website, so every screen, fix and feature on the site reaches phones automatically. These settings control the few parts of the app shell that sit around the site." />
      <ErrorBox error={err} />
      <Card title="Looks">
        <Field label="Name shown in the recent-apps list" hint="Workspaces show their own company name instead. The icon and the name under the icon on the home screen are part of the app file and cannot change remotely."><TextInput value={cfg.appName} onChange={(v) => set({ appName: v })} /></Field>
        <div className="grid g2">
          {[['light', 'Light mode'], ['dark', 'Dark mode']].map(([k, label]) => (
            <div key={k} className="stack">
              <b>{label}</b>
              <Field label="Status bar and bottom bar colour"><Colour value={cfg[k].chrome} onChange={(v) => mode(k, { chrome: v })} /></Field>
              <Field label="Clock and battery icons"><Select allowEmpty={false} value={cfg[k].icons} onChange={(v) => mode(k, { icons: v })} options={[{ value: 'dark', label: 'Dark (for light bars)' }, { value: 'light', label: 'Light (for dark bars)' }]} /></Field>
              <Field label="Colour shown while the app opens"><Colour value={cfg[k].background} onChange={(v) => mode(k, { background: v })} /></Field>
            </div>
          ))}
        </div>
        <Field label="Who keeps the page clear of the bars" hint="'App' is safest. Choose 'Page' only when the website lays itself out using the --safe-top / --safe-bottom variables."><Select allowEmpty={false} value={cfg.insets} onChange={(v) => set({ insets: v })} options={[{ value: 'native', label: 'App (default)' }, { value: 'web', label: 'Page' }]} /></Field>
      </Card>
      <Card title="Update notice (rarely needed)">
        <p className="muted">Only a change to the app file itself (a new permission, a new native feature) needs people to install again. Versions are the app's build number: app 1.1.0 is 2 and app 1.2.0 is 3.</p>
        <div className="grid g2">
          <Field label="Newest app version" hint="Phones with an older app see a dismissible banner. 0 = off."><TextInput value={cfg.update.latest} onChange={(v) => upd({ latest: v })} inputMode="numeric" /></Field>
          <Field label="Oldest version still allowed" hint="Phones below this must update before they can continue. 0 = off."><TextInput value={cfg.update.min} onChange={(v) => upd({ min: v })} inputMode="numeric" /></Field>
        </div>
        <Field label="Message (optional)"><TextInput value={cfg.update.message} onChange={(v) => upd({ message: v })} placeholder="Back now steps through screens. Please install the new app." /></Field>
        <Field label="Where the update button goes"><TextInput value={cfg.update.url} onChange={(v) => upd({ url: v })} /></Field>
      </Card>
      {canManage ? <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button> : <p className="muted">Your role can view but not change these settings.</p>}
    </>
  );
}
