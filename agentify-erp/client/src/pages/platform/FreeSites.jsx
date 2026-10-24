// Console page: the separate domain free websites are served from, the signup switch, and a DNS check.
import { useCallback, useEffect, useState } from 'react';
import { Card, ErrorBox, Field, Loading, TextInput, Toggle } from '../../components/ui.jsx';
import { api } from '../../api.js';
import { useToast } from '../../context.jsx';
import { A, PageTitle, useCan } from './AdminShell.jsx';

export default function FreeSitesPage() {
  const toast = useToast();
  const can = useCan();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ domain: '', open: false });
  const [dns, setDns] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`${A}/free-sites`).then((x) => { setD(x); setF({ domain: x.domain, open: x.open }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const manage = can('system.manage');
  const save = async () => {
    setBusy(true);
    try { const x = await api.put(`${A}/free-sites`, f); setD(x); setF({ domain: x.domain, open: x.open }); setDns(null); toast('Saved', 'ok'); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const check = async () => { setBusy(true); try { setDns(await api.post(`${A}/free-sites/check-dns`, {})); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const dirty = d && (f.domain.trim().toLowerCase() !== d.domain || f.open !== d.open);
  return (
    <>
      <PageTitle title="Free websites" sub="Website-only accounts are served from a separate domain, never from the app's own domain, so a spam or flagged free site cannot affect the app or share its sign-in cookies." />
      <ErrorBox error={err} />
      {!d ? (!err && <Loading />) : (
        <>
          <Card title="Domain and signup">
            <div className="stack">
              <Field label="Free websites domain" hint="For example agentifysites.co. Must be a different domain from the app. Leave empty to keep free websites off.">
                <TextInput value={f.domain} onChange={(v) => setF((x) => ({ ...x, domain: v }))} placeholder="agentifysites.co" disabled={!manage} />
              </Field>
              {manage && f.domain.trim() ? <Toggle value={f.open} onChange={(v) => setF((x) => ({ ...x, open: v }))} label="Open free website signup on the marketing site" /> : <p className="muted">Set a domain to be able to open signup.</p>}
              <p className="muted">Status: {d.effective_open ? 'open. People can create a free website.' : 'closed. Nobody can create a free website, and nothing is served on this domain.'}{d.sites ? ` ${d.sites} free website${d.sites === 1 ? '' : 's'} exist${d.sites === 1 ? 's' : ''}.` : ''}</p>
              {manage && <div className="row"><button className="btn primary" disabled={busy || !dirty} onClick={save}>Save</button></div>}
            </div>
          </Card>
          {d.domain && (
            <Card title="DNS and certificates (you do this at your domain provider)">
              <p>Add these records so every free website reaches this server. Certificates are then issued automatically the first time each site is opened, only for free websites that exist.</p>
              <table className="t"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th /></tr></thead><tbody>
                {d.dns.records.map((r) => <tr key={r.name}><td>{r.type}</td><td><code>{r.name}</code></td><td>{d.dns.server_ip ? <code>{d.dns.server_ip}</code> : 'this server\'s public IPv4 address'}</td><td className="muted">{r.note}</td></tr>)}
              </tbody></table>
              {!d.dns.server_ip && <p className="muted">Tip: set ERP_SERVER_IP on the server so the check below can compare the records with this server.</p>}
              <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={busy} onClick={check}>Check DNS now</button></div>
              {dns && (
                <div style={{ marginTop: 10 }}>
                  <p>Wildcard (<code>*.{dns.domain}</code>): {dns.wildcard.length ? dns.wildcard.join(', ') : 'no answer'} {dns.server_ip ? (dns.wildcard_ok ? '✓ points here' : '✗ does not point here') : ''}</p>
                  <p>Bare domain (<code>{dns.domain}</code>): {dns.apex.length ? dns.apex.join(', ') : 'no answer'} {dns.server_ip ? (dns.apex_ok ? '✓ points here' : '✗ does not point here') : ''}</p>
                  {dns.note && <p className="muted">{dns.note}</p>}
                  <p className="muted">This checks DNS only. It does not prove that HTTPS works; open a free website address to confirm that.</p>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
