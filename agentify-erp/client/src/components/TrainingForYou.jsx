// Dashboard card: the training videos assigned to this employee's role (the server decides which; see routes/training.js).
// Hidden when there are none.
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Card } from './ui.jsx';
import { useFetch } from '../context.jsx';

const length = (s) => (s ? (s < 90 ? `${s} sec` : `${Math.round(s / 60)} min`) : '');

export default function TrainingForYou() {
  const d = useFetch('/api/training/library');
  const rows = d.data?.rows;
  if (!rows || !rows.length) return null;
  return (
    <Card title="Training for you" actions={<Link to="/training" className="btn sm">All videos ({rows.length})</Link>}>
      <ul className="train-mini">{rows.slice(0, 3).map((v) => (
        <li key={v.id}><Link to="/training"><Icon name="video" size={16} /><span><b>{v.title}</b><small>{[v.category, length(v.seconds)].filter(Boolean).join(' · ')}</small></span></Link></li>))}</ul>
    </Card>
  );
}
