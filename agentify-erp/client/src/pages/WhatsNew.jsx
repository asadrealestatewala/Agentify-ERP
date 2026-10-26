// Menu › What's new: every shipped update, newest first, from shared/changelog.js.
import { Card, PageHead } from '../components/ui.jsx';
import { APP_VERSION, CHANGELOG, tenantChangelog } from '../../../shared/changelog.js';

const fmt = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };

// Workspaces see only tenant items; the Super Admin console passes `platform` to see everything.
export default function WhatsNew({ platform = false }) {
  const log = platform ? CHANGELOG : tenantChangelog();
  return (
    <>
      <PageHead title="What's new" sub={`You are on version ${APP_VERSION}.`} />
      {log.map((r) => (
        <Card key={r.version} title={<span><span className="tag">{r.version}</span> {r.title}</span>} actions={<span className="muted" style={{ fontSize: 12 }}>{fmt(r.date)}</span>}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.items.map((it) => (
              <li key={it.text} style={{ marginBottom: 6 }}>{platform && it.audience === 'platform' && <span className="tag" style={{ marginRight: 6 }}>Console</span>}{it.text}{it.where && <div className="muted" style={{ fontSize: 12 }}>Where: {it.where}</div>}</li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
