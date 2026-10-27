import { useContext, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, Select, TextInput } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, MeContext } from './AdminShell.jsx';

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const PRIVACY = { unlisted: 'Unlisted (anyone with the link)', public: 'Public (appears in YouTube search)', private: 'Private (only the channel owner)' };

function AddForm({ data, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', category: data.categories[0] });
  const [file, setFile] = useState(null); const [roles, setRoles] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    if (!file) return setErr('Choose a video file (MP4, WebM or MOV, up to 500 MB)');
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('title', f.title); fd.append('description', f.description); fd.append('category', f.category); fd.append('roles', JSON.stringify(roles)); fd.append('file', file);
      await api.upload(`${A}/training-videos`, fd); toast('Added to the library. Post it to YouTube when ready.'); onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Card title="Add a video to the library">
      <ErrorBox error={err} />
      <Field label="Video file" hint="MP4, WebM or MOV"><input type="file" accept="video/mp4,video/webm,video/quicktime" aria-label="Video file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <Field label="Title" hint="Shown to everyone, and used as the YouTube title (100 characters at most)"><TextInput value={f.title} onChange={(v) => setF({ ...f, title: v })} /></Field>
      <Field label="Topic"><Select allowEmpty={false} value={f.category} onChange={(v) => setF({ ...f, category: v })} options={data.categories.map((c) => ({ value: c, label: c }))} /></Field>
      <Field label="Description" hint="Shown to everyone, and used as the YouTube description"><textarea className="textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Roles that see it in a new workspace (each workspace can change this)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))', gap: 6 }}>{data.roles.map((r) => <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])} /> {r}</label>)}</div>
      </Field>
      <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Uploading…' : 'Add video'}</button><button className="btn" onClick={onCancel}>Cancel</button></div>
    </Card>
  );
}

function YoutubeCard({ yt, canManage, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [expected, setExpected] = useState(yt.expected_channel || '');
  const saveExpected = async () => { setBusy(true); setErr(''); try { await api.put(`${A}/training-videos/youtube/expected-channel`, { channel_id: expected }); toast(expected ? 'Expected channel saved' : 'Channel check switched off'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const connect = async () => { setBusy(true); setErr(''); try { const { url } = await api.get(`${A}/training-videos/youtube/connect`); window.location.assign(url); } catch (e) { setErr(e.message); setBusy(false); } };
  const disconnect = async () => { setBusy(true); try { await api.del(`${A}/training-videos/youtube`); toast('YouTube disconnected'); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <Card title="YouTube channel">
      <ErrorBox error={err} />
      {yt.state === 'not_configured' && <>
        <p><b>Not configured.</b> Videos cannot be posted until the Google sign-in app has a client ID and secret. Nothing else is affected: workspaces keep playing the videos from this server meanwhile.</p>
        <ol className="muted">
          <li>In Google Cloud, create a project and switch on <b>YouTube Data API v3</b> (APIs &amp; Services &gt; Library).</li>
          <li>Set up the OAuth consent screen, then create an OAuth client of type <b>Web application</b> with the redirect address <span className="mono">{`${window.location.origin}${yt.redirect_path}`}</span>.</li>
          <li>Enter its client ID and secret under <a href="/platform/integrations">Integrations &gt; Google</a> (or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server), then come back and connect the channel.</li>
        </ol>
      </>}
      {yt.state === 'not_connected' && <><p><b>Google is set up, but no YouTube channel is connected.</b> Sign in with the Google account that owns the channel the videos should go to.</p>{canManage && <button className="btn primary" disabled={busy} onClick={connect}>Connect YouTube</button>}</>}
      {yt.state === 'connected' && <>
        <p><span className="pill green">Connected</span> {yt.account ? <>as <b>{yt.account}</b>. </> : null}{yt.channel?.id ? <>Uploads go to the channel <b>{yt.channel.title || 'unnamed'}</b> <span className="mono">({yt.channel.id})</span>.</> : 'The channel could not be read. Disconnect and connect again to see which channel uploads go to.'}</p>
        {canManage && <>
          <Field label="Expected channel ID (optional safety)" hint="When set, posting is refused unless the connected channel matches, so nothing lands on the wrong channel. Find it in YouTube Studio > Settings > Channel > Advanced settings."><TextInput value={expected} onChange={setExpected} placeholder="UC…" /></Field>
          <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy} onClick={saveExpected}>Save expected channel</button><button className="btn" disabled={busy} onClick={disconnect}>Disconnect</button></div>
        </>}</>}
      <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Google limits uploads: the default quota allows about 6 uploads a day. YouTube also keeps videos from a new Google project private until the project passes YouTube's API compliance review, so unlisted and public only take effect after that review.</p>
    </Card>
  );
}

function Row({ v, yt, canManage, reload }) {
  const toast = useToast();
  const [privacy, setPrivacy] = useState(v.privacy || 'unlisted'); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [link, setLink] = useState(null); const [edit, setEdit] = useState(false); const [f, setF] = useState({ title: v.title, description: v.description || '' });
  const act = async (fn, ok) => { setBusy(true); setErr(''); try { await fn(); if (ok) toast(ok); reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const post = () => act(() => api.post(`${A}/training-videos/${v.key}/post`, { privacy }), 'Posting started. This can take a few minutes for large videos.');
  const posting = v.status === 'posting';
  return (
    <Card>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 650 }}>{v.title}</div>
          <div className="cell-sub">{v.category}{v.seconds ? ` · ${v.seconds < 90 ? `${v.seconds} sec` : `${Math.round(v.seconds / 60)} min`}` : ''}{v.server_copy ? ` · server copy ${mb(v.size)}` : ' · no server copy'}</div>
          {v.description && <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5 }}>{v.description}</p>}
        </div>
        <div>{v.youtube_url ? <span className="pill green">On YouTube</span> : posting ? <span className="pill amber">Posting…</span> : v.status === 'failed' ? <span className="pill red">Failed</span> : <span className="pill grey">Not on YouTube</span>}</div>
      </div>
      {v.status === 'failed' && v.error && <div className="alert err" role="alert" style={{ marginTop: 8 }}>{v.error}</div>}
      <ErrorBox error={err} />
      {v.youtube_url && <p style={{ margin: '8px 0 0' }}><a href={v.youtube_url} target="_blank" rel="noopener noreferrer">{v.youtube_url}</a> <span className="muted">· {v.privacy}{v.posted_by ? ` · posted by ${v.posted_by}` : ''}{v.youtube_channel ? ` · channel ${v.youtube_channel}` : ''}. Every workspace shows this link, title and description.</span></p>}
      {edit && <div className="stack" style={{ marginTop: 10 }}>
        <Field label="Title"><TextInput value={f.title} onChange={(x) => setF({ ...f, title: x })} /></Field>
        <Field label="Description"><textarea className="textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <p className="muted" style={{ fontSize: 12.5 }}>{v.youtube_url ? 'Workspaces pick up the new wording. The title and description on YouTube itself are not changed; edit them in YouTube Studio.' : 'Used for the YouTube post and for every workspace.'}</p>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} onClick={() => act(async () => { await api.put(`${A}/training-videos/${v.key}`, f); setEdit(false); }, 'Saved')}>Save</button><button className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
      </div>}
      {link !== null && <div className="stack" style={{ marginTop: 10 }}>
        <Field label="YouTube link" hint="For a video you uploaded yourself in YouTube Studio (for example to a channel the console cannot reach)."><TextInput value={link} onChange={setLink} placeholder="https://www.youtube.com/watch?v=…" /></Field>
        <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} onClick={() => act(async () => { await api.post(`${A}/training-videos/${v.key}/link`, { url: link }); setLink(null); }, 'Linked')}>Use this link</button><button className="btn" onClick={() => setLink(null)}>Cancel</button></div>
      </div>}
      {canManage && !edit && link === null && (
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {!v.youtube_url && !posting && <button className="btn" onClick={() => setLink('')}>Link a YouTube video</button>}
          {!v.youtube_url && <>
            <select className="select" aria-label="Visibility on YouTube" value={privacy} onChange={(e) => setPrivacy(e.target.value)} style={{ maxWidth: 280 }}>{Object.entries(PRIVACY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <button className="btn primary" disabled={busy || posting || yt.state !== 'connected' || !v.server_copy} title={yt.state !== 'connected' ? 'Set up and connect YouTube first' : undefined} onClick={post}>{posting ? 'Posting…' : v.status === 'failed' ? 'Post again' : 'Post to YouTube'}</button>
          </>}
          {v.server_copy && <a className="btn" href={`${A}/training-videos/${v.key}/file`} download>Download MP4</a>}
          <button className="btn" onClick={() => setEdit(true)}>Edit wording</button>
          {v.youtube_url && v.server_copy && <button className="btn" disabled={busy} onClick={() => confirm(`Delete the copy of "${v.title}" from this server? The YouTube link stays.`) && act(() => api.del(`${A}/training-videos/${v.key}/copy`), 'Server copy deleted')}>Delete server copy</button>}
          {v.youtube_url && <button className="btn" disabled={busy} onClick={() => confirm(`Forget the YouTube link for "${v.title}"? The video stays on YouTube until you delete it in YouTube Studio. Workspaces go back to the server copy if there is one.`) && act(async () => { const o = await api.del(`${A}/training-videos/${v.key}/youtube`); if (!o.server_copy) toast('Unlinked. There is no server copy left, so add the video again to post it.'); }, 'Unlinked')}>Unlink from YouTube</button>}
          {v.uploaded && !posting && <button className="btn ghost danger" disabled={busy} onClick={() => confirm(`Remove "${v.title}" from the library? Workspaces will keep the YouTube link only until they next refresh.`) && act(() => api.del(`${A}/training-videos/${v.key}`), 'Removed')}>Remove</button>}
        </div>)}
    </Card>
  );
}

/** The console's training library: post each video to YouTube once; workspaces then show the YouTube link, title and description. */
export default function TrainingVideosPage() {
  const me = useContext(MeContext);
  const toast = useToast();
  const canManage = me.permissions.includes('system.manage');
  const [d, setD] = useState(null); const [err, setErr] = useState(''); const [add, setAdd] = useState(false);
  const load = () => api.get(`${A}/training-videos`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search).get('youtube');
    if (q) { toast(q === 'connected' ? 'YouTube connected' : q === 'cancelled' ? 'YouTube connection cancelled' : 'YouTube could not be connected. Check the Google settings and try again.'); window.history.replaceState({}, '', window.location.pathname); }
  }, []);
  useEffect(() => { if (!d?.rows.some((r) => r.status === 'posting')) return undefined; const t = setInterval(load, 4000); return () => clearInterval(t); }, [d]);
  if (err && !d) return <ErrorBox error={err} />;
  if (!d) return <Loading />;
  return (
    <>
      <PageTitle title="Training videos" sub="Post each video to YouTube once. Every workspace then shows the YouTube link with the title and description saved here, so the server does not serve video files.">
        {canManage && !add && <button className="btn primary" onClick={() => setAdd(true)}>Add a video</button>}
      </PageTitle>
      <ErrorBox error={err} />
      <YoutubeCard yt={d.youtube} canManage={canManage} reload={load} />
      {add && <AddForm data={d} onDone={() => { setAdd(false); load(); }} onCancel={() => setAdd(false)} />}
      {d.rows.map((v) => <Row key={v.key} v={v} yt={d.youtube} canManage={canManage} reload={load} />)}
    </>
  );
}
