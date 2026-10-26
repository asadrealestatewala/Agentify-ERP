// Setup checklist on the dashboard: steps tick themselves when the real data shows them done (never from visiting a page).
import { Link } from 'react-router-dom';
import { Card, ProgressBar } from './ui.jsx';
import { useFetch } from '../context.jsx';

export default function ActivationChecklist() {
  const { data } = useFetch('/api/email/activation');
  if (!data || (data.total && data.done >= data.total)) return null;
  const steps = data.steps.filter((s) => s.applicable);
  return (
    <Card title="Get set up" actions={<span className="muted">{data.done} of {data.total} done</span>}>
      <ProgressBar value={data.total ? Math.round((data.done * 100) / data.total) : 0} />
      <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 8 }}>
        {steps.map((s) => (
          <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 10, border: '2px solid #0e7c6b', background: s.done ? '#0e7c6b' : 'transparent', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flex: 'none' }}>{s.done ? '✓' : ''}</span>
            <span>{s.done ? <span className="muted" style={{ textDecoration: 'line-through' }}>{s.label}</span> : <><Link to={s.link}><strong>{s.label}</strong></Link><div className="muted" style={{ fontSize: 12.5 }}>{s.hint}</div></>}</span>
          </li>))}
      </ul>
    </Card>
  );
}
