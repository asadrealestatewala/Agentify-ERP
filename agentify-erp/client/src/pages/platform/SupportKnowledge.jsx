// Console > System > Support knowledge: every release guide, searchable, with support-only notes.
import { useMemo, useState } from 'react';
import { Card, Empty, PageHead } from '../../components/ui.jsx';
import GuideView from '../../components/GuideView.jsx';
import { guideList, searchKnowledge } from '../../../../shared/guides.js';
import { CHANGELOG } from '../../../../shared/changelog.js';

export default function SupportKnowledge() {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(null);
  const all = useMemo(() => guideList(), []);
  const hits = useMemo(() => (q.trim() ? searchKnowledge(q, { platform: true }) : []), [q]);
  const shown = q.trim() ? hits.filter((h) => h.type === 'guide').map((h) => ({ key: h.key, ...h.guide })) : all;
  const items = q.trim() ? hits.filter((h) => h.type === 'release') : [];
  const without = CHANGELOG.slice(0, 15).flatMap((r) => r.items.filter((i) => !i.guide).map(() => r.version)).length;
  return (
    <>
      <PageHead title="Support knowledge" sub="What each release added, in plain steps, with who it affects, known limits and support-only notes. Ask in a workspace answers from the same guides." />
      <Card>
        <input type="search" aria-label="Search guides" placeholder="Search by feature, module or question…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{all.length} guides. {without} of the last 15 releases' items have no guide yet; add one in shared/guides.js and set guide: 'key' on the release item.</div>
      </Card>
      {!shown.length && !items.length && <Empty title="Nothing found" sub="Try other words, or add a guide for this feature." />}
      {shown.map((g) => (
        <Card key={g.key} title={<span><span className="tag">{g.since}</span> {g.title}</span>} actions={<button className="btn sm ghost" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>{open === g.key ? 'Hide' : 'Open'}</button>}>
          <div className="muted" style={{ fontSize: 12 }}>{g.module}</div>
          {(open === g.key || q.trim()) && <GuideView guide={g} internal />}
        </Card>
      ))}
      {items.map((h) => <Card key={h.version + h.item.text} title={<span><span className="tag">{h.version}</span> {h.title}</span>}>{h.item.text}{h.item.where && <div className="muted" style={{ fontSize: 12 }}>Where: {h.item.where}</div>}</Card>)}
    </>
  );
}
