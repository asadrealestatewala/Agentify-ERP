// Publish a listing to the property portals of the workspace's country, and see what each one still needs.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from './ui.jsx';
import { api } from '../api.js';
import { useToast } from '../context.jsx';

export default function PortalsCard({ propertyId, published }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState({});
  const load = useCallback(() => api.get(`/api/integrations/portals/readiness/${propertyId}`).then(setRows).catch(() => setRows([])), [propertyId]);
  useEffect(() => { load(); }, [load]);
  if (!rows?.length) return null;
  const go = async () => {
    const portals = Object.keys(pick).filter((k) => pick[k]);
    try {
      const r = await api.post('/api/integrations/portals/publish', { property_id: propertyId, portals });
      const bad = r.results.filter((x) => !x.ok);
      toast(bad.length ? `${r.results.length - bad.length} published. ${bad[0].portal}: ${bad[0].error}` : 'Published to the selected portals', bad.length ? 'err' : 'ok');
      setPick({}); load();
    } catch (e) { toast(e.message, 'err'); }
  };
  const off = async (id) => { await api.post('/api/integrations/portals/unpublish', { property_id: propertyId, portals: [id] }); load(); };
  return (
    <Card title="Property portals">
      {!published && <div className="alert warn">Publish this listing on your website first. Portals only receive published listings.</div>}
      <div className="stack">
        {rows.map((p) => {
          const on = p.publication?.status === 'published';
          return (
            <div key={p.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <label className="check" style={{ flex: 1 }}>
                {on ? <b style={{ color: 'var(--ok, #0f766e)' }}>✓</b> : <input type="checkbox" disabled={!published || p.missing.length > 0} checked={!!pick[p.id]} onChange={(e) => setPick({ ...pick, [p.id]: e.target.checked })} />} <b>{p.name}</b>
                {on && <span className="muted"> · on this portal's feed since {p.publication.published_at}</span>}
                {!on && p.missing.length > 0 && <div className="muted">Needs {p.missing.join(', ')}</div>}
                {p.publication?.status === 'failed' && <div className="muted">Last attempt failed: {p.publication.error}</div>}
              </label>
              {on && <button className="btn sm" onClick={() => off(p.id)}>Withdraw</button>}
            </div>);
        })}
      </div>
      <div className="row wrap" style={{ marginTop: 10 }}><button className="btn primary sm" disabled={!Object.values(pick).some(Boolean)} onClick={go}>Publish to selected</button><Link className="btn sm" to="/settings/integrations">Portal settings and feed addresses</Link></div>
    </Card>
  );
}
