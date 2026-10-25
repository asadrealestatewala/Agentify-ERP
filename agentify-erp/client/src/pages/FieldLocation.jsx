import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ConfirmDialog, Empty, ErrorBox, Field, KV, Loading, PageHead, Select, StatusBadge, Toggle } from '../components/ui.jsx';
import { api } from '../api.js';
import { useAuth, useFetch, useToast } from '../context.jsx';
import { t } from '../i18n.js';
import { getRegion } from '../format.js';
import {
  subscribe, getSharing, shareOnce, startForeground, stopSharing, ERROR_TEXT, whenText, accuracyText, ageText,
  FRESH_TONE, FRESH_LABEL, AVAIL_LABEL, AVAIL_TONE,
} from '../fieldLocation.js';

export function useSharing() {
  const [s, setS] = useState(getSharing());
  useEffect(() => subscribe(setS), []);
  return s;
}

const tzName = () => getRegion().config.timezone;
const AVAIL_OPTS = ['available', 'busy', 'on_break', 'off_duty'].map((v) => ({ value: v, label: AVAIL_LABEL[v] }));

/** Top-bar indicator: visible whenever this app is sending location, with a one-tap Stop. */
export function FieldSharingBadge() {
  const s = useSharing();
  if (s.mode !== 'foreground') return null;
  return (
    <div className="pill green no-print field-badge" role="status" style={{ gap: 6, paddingInlineEnd: 4 }}>
      <i /><Link to="/my/location" style={{ color: 'inherit' }} aria-label={t('field.sharing_now', 'Sharing location')}><span className="fb-label">{t('field.sharing_now', 'Sharing location')}</span></Link>
      <button className="btn sm ghost" onClick={() => stopSharing()} aria-label={t('field.stop', 'Stop sharing')}><span className="fb-label">{t('field.stop', 'Stop sharing')}</span><span className="fb-short" aria-hidden="true">{t('field.stop_short', 'Stop')}</span></button>
    </div>
  );
}

function Reading({ status }) {
  if (!status?.location) {
    return <div className="muted">{status?.last_error ? `No location saved. Last attempt: ${ERROR_TEXT[status.last_error] || status.last_error}` : 'No location saved.'}</div>;
  }
  const l = status.location;
  return (
    <KV items={[
      ['Taken at', `${whenText(l.captured_at)} (${ageText(status.age_minutes)})`],
      ['Received by server', whenText(l.received_at)],
      ['Accuracy', accuracyText(l.accuracy_m)],
      ['Freshness', <StatusBadge key="f" status={status.freshness} label={FRESH_LABEL[status.freshness]} tone={FRESH_TONE[status.freshness]} />],
      ['How', l.source === 'foreground' ? 'While the app was open' : 'One-time share'],
      ['Position', `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`],
    ]} />
  );
}

// ================================================================== My location (employee)
export function MyLocation() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/field/me');
  const live = useSharing();
  const [busy, setBusy] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [read, setRead] = useState(false);

  // the server still thinks a foreground session is open, but this app (after a reload) is not sending: end it honestly
  useEffect(() => { if (data?.status?.sharing === 'foreground' && live.mode !== 'foreground') stopSharing().then(reload); }, [data?.status?.sharing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live.lastSent) reload(); }, [live.lastSent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <><PageHead title={t('field.my_location', 'My location')} /><ErrorBox error={error} /></>;
  if (!data) return <Loading />;
  const { settings: s, consent: c, status } = data;
  const act = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok, 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };

  return (
    <div>
      <PageHead title={t('field.my_location', 'My location')} sub={`Times are shown in ${tzName()}.`} />
      {!s.enabled && <Card><Empty icon="map" title="Location sharing is off">Your workspace has not turned on location sharing. Nothing about your location is collected.</Empty></Card>}

      {s.enabled && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <Card title="What is shared and who sees it">
            <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }} dir="auto">{s.notice}</p>
            <ul className="muted" style={{ paddingInlineStart: 18 }}>
              <li>Your last location is kept for {s.retention_days} day{s.retention_days === 1 ? '' : 's'}, then deleted. No route history is stored.</li>
              <li>Allowing location on your phone or browser is only a technical permission. Sharing starts only when you press a Share button below.</li>
              <li>A location reading shows where the device was, within the accuracy shown. It is not proof that you were at a place.</li>
            </ul>
            {!c.accepted && (
              <div className="stack" style={{ gap: 10 }}>
                {c.needs_reaccept && <div className="alert warn">The notice changed since you last agreed. Please read it again.</div>}
                <label className="check"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} /> {t('field.accept', 'I have read this and agree to share my location when I choose to')}</label>
                <div><button className="btn primary" disabled={!read || busy} onClick={() => act(() => api.post('/api/field/me/consent', { notice_version: s.notice_version }), 'Thanks. You can share now.')}>Continue</button></div>
              </div>
            )}
            {c.accepted && <div className="muted" style={{ fontSize: 12 }}>You agreed on {whenText(c.accepted_at)}.</div>}
          </Card>

          {c.accepted && (
            <Card title="Share">
              <div className="stack" style={{ gap: 12 }}>
                {live.mode === 'foreground' ? (
                  <div className="alert ok" role="status">
                    <b>{t('field.sharing_now', 'Sharing location')}</b> every {Math.round(live.interval / 60) || 1} min while this app is open on your screen.
                    <div style={{ marginTop: 8 }}><button className="btn danger" onClick={() => act(() => stopSharing(), 'Sharing stopped')}>{t('field.stop', 'Stop sharing')}</button></div>
                  </div>
                ) : (
                  <div className="row wrap">
                    <button className="btn primary" disabled={busy || live.busy} onClick={() => act(() => shareOnce(user.id), 'Location shared')}>{t('field.share_once', 'Share my location once')}</button>
                    {s.foreground_allowed && <button className="btn" disabled={busy || live.busy} onClick={() => act(() => startForeground(user.id), 'Sharing while the app is open')}>{t('field.share_foreground', 'Share while the app is open')}</button>}
                  </div>
                )}
                {live.lastError && <div className="alert err">{live.lastError}</div>}
                <Field label="My availability" hint="Your own status. It is shown next to your location but does not depend on it.">
                  <Select value={status.availability === 'unknown' ? '' : status.availability} placeholder="Not set" options={AVAIL_OPTS}
                    onChange={(v) => v && act(() => api.put('/api/field/me/availability', { availability: v }), 'Availability updated')} />
                </Field>
                {status.service_area && <div className="muted">Assigned service area: <b>{status.service_area}</b></div>}
              </div>
            </Card>
          )}

          {c.accepted && (
            <Card title="Last saved location">
              <Reading status={status} />
              <div style={{ marginTop: 12 }}><button className="btn ghost danger sm" onClick={() => setWithdraw(true)}>{t('field.withdraw', 'Withdraw and delete my location')}</button></div>
            </Card>
          )}
        </div>
      )}
      {withdraw && <ConfirmDialog title="Withdraw location sharing?" danger confirmLabel="Withdraw and delete"
        message="Sharing stops now and your saved location is deleted. Your manager will see that no location is available. You can agree again later."
        onCancel={() => setWithdraw(false)} onConfirm={async () => { setWithdraw(false); await stopSharing(); await act(() => api.del('/api/field/me/consent'), 'Location deleted'); }} />}
    </div>
  );
}

// ================================================================== Field coverage (managers / HR)
const osmEmbed = (lat, lng) => `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.006}%2C${lng + 0.01}%2C${lat + 0.006}&layer=mapnik&marker=${lat}%2C${lng}`;
const osmLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

export function FieldCoverage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch('/api/field/team');
  const [sel, setSel] = useState(null);
  const [fresh, setFresh] = useState('');
  const [avail, setAvail] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const id = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60_000); return () => clearInterval(id); }, [reload]);

  const rows = useMemo(() => (data?.agents || []).filter((a) => (!fresh || a.freshness === fresh) && (!avail || a.availability === avail)
    && (!q || `${a.name} ${a.service_area || ''} ${a.designation || ''} ${a.branch || ''}`.toLowerCase().includes(q.toLowerCase()))), [data, fresh, avail, q]);
  if (error) return <><PageHead title={t('field.coverage', 'Field coverage')} /><ErrorBox error={error} /></>;
  if (!data) return <Loading />;
  const s = data.settings;
  const picked = rows.find((a) => a.user_id === sel && a.location) || rows.find((a) => a.location);
  const editArea = async (a) => {
    const v = window.prompt(`Service area for ${a.name}`, a.service_area || '');
    if (v == null) return;
    try { await api.put(`/api/field/team/${a.user_id}/area`, { service_area: v }); toast('Service area saved', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const counts = (data.agents || []).reduce((m, a) => ({ ...m, [a.freshness]: (m[a.freshness] || 0) + 1 }), {});

  return (
    <div>
      <PageHead title={t('field.coverage', 'Field coverage')} sub={`${data.scope === 'all' ? 'Everyone in the workspace' : 'Your team'} · last shared locations only · times in ${tzName()}`}>
        <button className="btn sm" onClick={reload}>Refresh</button>
      </PageHead>
      {!s.enabled && <div className="alert warn">Location sharing is turned off for this workspace, so no new locations arrive.{can('settings', 'edit') ? ' Turn it on below.' : ''}</div>}
      {data.scope === 'none' && <Card><Empty icon="users" title="No team to show">Field coverage lists the people who report to you. Nobody reports to you in HR yet.</Empty></Card>}

      {data.scope !== 'none' && (
        <>
          <div className="row wrap" style={{ marginBottom: 12, gap: 8 }}>
            <input className="input" style={{ maxWidth: 240 }} placeholder="Search name or area" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" />
            <Select value={fresh} onChange={setFresh} placeholder="Any freshness" style={{ width: 'auto' }} options={Object.keys(FRESH_LABEL).map((k) => ({ value: k, label: `${FRESH_LABEL[k]} (${counts[k] || 0})` }))} aria-label="Freshness" />
            <Select value={avail} onChange={setAvail} placeholder="Any availability" style={{ width: 'auto' }} options={Object.keys(AVAIL_LABEL).map((k) => ({ value: k, label: AVAIL_LABEL[k] }))} aria-label="Availability" />
            <span className="muted" style={{ fontSize: 12 }}>Fresh ≤ {s.fresh_minutes} min · Stale after {s.stale_minutes} min</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
            <Card title="Agents" flush>
              {!rows.length ? <Empty>No one matches these filters.</Empty> : (
                <div className="table-wrap"><table className="t">
                  <thead><tr><th>Agent</th><th>Availability</th><th>Last location</th><th>Accuracy</th><th>Service area</th></tr></thead>
                  <tbody>{rows.map((a) => (
                    <tr key={a.user_id} className={picked?.user_id === a.user_id ? 'selected' : ''} onClick={() => a.location && setSel(a.user_id)} style={{ cursor: a.location ? 'pointer' : 'default' }}>
                      <td><div className="bold">{a.name}</div><div className="muted" style={{ fontSize: 11.5 }}>{a.designation || a.role}{a.sharing === 'foreground' ? ' · sharing now' : ''}{a.consent !== 'accepted' ? ' · has not agreed to share' : ''}</div></td>
                      <td><StatusBadge status={a.availability} label={AVAIL_LABEL[a.availability] || a.availability} tone={AVAIL_TONE[a.availability]} /></td>
                      <td>
                        <StatusBadge status={a.freshness} label={FRESH_LABEL[a.freshness]} tone={FRESH_TONE[a.freshness]} />
                        <div className="muted nowrap" style={{ fontSize: 11.5 }}>{a.location ? whenText(a.location.captured_at) : a.last_error ? `Last attempt: ${a.last_error === 'denied' ? 'permission denied' : a.last_error}` : '—'}</div>
                      </td>
                      <td className="nowrap">{a.location ? accuracyText(a.location.accuracy_m) : '—'}</td>
                      <td>{a.service_area || <span className="muted">—</span>}{can('hrm', 'edit') && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); editArea(a); }} aria-label={`Edit service area for ${a.name}`}>Edit</button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
            <Card title={picked ? `Map: ${picked.name}` : 'Map'}>
              {!picked && <Empty icon="map">No shared locations yet.</Empty>}
              {picked && s.map_provider === 'osm_embed' && <iframe title={`Last location of ${picked.name}`} src={osmEmbed(picked.location.lat, picked.location.lng)} loading="lazy" style={{ width: '100%', height: 320, border: 0, borderRadius: 8 }} />}
              {picked && (
                <div style={{ marginTop: 8 }}>
                  <div className="muted" style={{ fontSize: 12 }}>{whenText(picked.location.captured_at)} ({ageText(picked.age_minutes)}) · {accuracyText(picked.location.accuracy_m)}. A device reading, not proof of presence.</div>
                  <a href={osmLink(picked.location.lat, picked.location.lng)} target="_blank" rel="noreferrer">Open in OpenStreetMap ↗</a>
                </div>
              )}
              {s.map_provider === 'none' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>The embedded map is turned off in the settings; use the list and the map link.</div>}
            </Card>
          </div>
        </>
      )}
      {can('settings', 'edit') && <FieldSettings onSaved={reload} />}
    </div>
  );
}

function FieldSettings({ onSaved }) {
  const toast = useToast();
  const { data, reload } = useFetch('/api/field/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return null;
  const up = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      await api.put('/api/field/settings', { enabled: f.enabled, foreground_allowed: f.foreground_allowed, interval_seconds: Number(f.interval_seconds), fresh_minutes: Number(f.fresh_minutes),
        stale_minutes: Number(f.stale_minutes), retention_days: Number(f.retention_days), map_provider: f.map_provider, notice: f.notice });
      toast('Location settings saved', 'ok'); reload(); onSaved?.();
    } catch (e) { toast(e.message, 'err'); }
  };
  const num = (k, label, hint) => <Field label={label} hint={hint}><input className="input" type="number" value={f[k]} onChange={(e) => up(k)(e.target.value)} /></Field>;
  return (
    <Card title="Location sharing settings" actions={<button className="btn primary sm" onClick={save}>Save settings</button>}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <Toggle value={f.enabled} onChange={up('enabled')} label="Allow employees to share their location" />
        <Toggle value={f.foreground_allowed} onChange={up('foreground_allowed')} label="Allow sharing while the app is open (otherwise one-time only)" />
        {num('interval_seconds', 'Send every (seconds)', '30 to 1800, while the app is open')}
        {num('fresh_minutes', 'Fresh for (minutes)', 'Older readings are refused when sent')}
        {num('stale_minutes', 'Stale after (minutes)')}
        {num('retention_days', 'Delete last location after (days)', '1 to 365')}
        <Field label="Map"><Select allowEmpty={false} value={f.map_provider} onChange={up('map_provider')} options={[{ value: 'osm_embed', label: 'OpenStreetMap embed (free, no key)' }, { value: 'none', label: 'No embedded map (list and links only)' }]} /></Field>
      </div>
      <Field label="Notice shown to employees" hint={`Version ${f.notice_version}. Changing the text asks every employee to agree again. These settings and this notice do not by themselves make the workspace legally compliant; check local employment and privacy rules.`}>
        <textarea className="input" rows={5} dir="auto" value={f.notice} onChange={(e) => up('notice')(e.target.value)} />
      </Field>
    </Card>
  );
}
