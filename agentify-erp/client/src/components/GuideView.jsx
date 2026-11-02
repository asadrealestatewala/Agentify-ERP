// A release guide: steps, things to know, FAQs. Used under What's new and in the console's Support knowledge base.
export default function GuideView({ guide, internal = false, videoUrl }) {
  return (
    <div className="stack" style={{ marginTop: 6, fontSize: 13.5 }}>
      <div className="muted" style={{ fontSize: 12 }}>Who it affects: {guide.who}</div>
      <ol style={{ margin: 0, paddingLeft: 20 }}>{guide.steps.map((s) => <li key={s} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
      {guide.limits?.length > 0 && <div><b>Good to know</b><ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{guide.limits.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {guide.faq?.length > 0 && <div><b>Common questions</b>{guide.faq.map((f) => <div key={f.q} style={{ marginTop: 4 }}><i>{f.q}</i><div>{f.a}</div></div>)}</div>}
      {internal && guide.internal?.length > 0 && <div className="alert info"><b>Support notes (not shown to workspaces)</b><ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>{guide.internal.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      {guide.video && (videoUrl ? <a className="btn sm" href={videoUrl} target="_blank" rel="noopener noreferrer">Watch the video</a> : internal ? <span className="muted" style={{ fontSize: 12 }}>Video key: {guide.video}</span> : null)}
    </div>
  );
}
