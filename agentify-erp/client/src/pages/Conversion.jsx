// CRM > Lead conversion: how leads move from enquiry to a response, a viewing and a sale. Every percentage shows what it was
// divided by. Leads from before response tracking, and leads without a source, are counted separately rather than guessed.
// An agent with own-scope access sees only their own leads.
import { useState } from 'react';
import { Card, Empty, Loading, PageHead, Stat } from '../components/ui.jsx';
import { useFetch } from '../context.jsx';

const mins = (m) => (m == null ? '–' : m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} days`);
const pct = (r) => (r.rate == null ? '–' : `${r.rate}%`);
const Rate = ({ label, r, help }) => <Stat label={label} value={pct(r)} sub={`${r.n} of ${r.d}${help ? ` · ${help}` : ''}`} />;
/** Value on top, what it was divided by underneath. Nothing to divide by reads "No data" rather than a bare dash or 0%. */
const RateCell = ({ r }) => (r.d ? <><div className="cell-main">{pct(r)}</div><div className="cell-sub">{r.n} of {r.d}</div></> : <span className="muted">No data</span>);
const RateTable = ({ rows, first }) => (
  <div className="table-wrap"><table className="t"><thead><tr><th>{first}</th><th className="num">Leads</th><th className="num">Responded</th><th className="num">Appointment</th><th className="num">Won</th></tr></thead><tbody>
    {rows.map((s) => <tr key={s.key}><td className="cell-main">{s.label}</td><td className="num">{s.leads}</td><td className="num"><RateCell r={s.response_rate} /></td><td className="num"><RateCell r={s.appointment_rate} /></td><td className="num"><RateCell r={s.won_rate} /></td></tr>)}
  </tbody></table></div>
);
const isoDay = (d) => d.toISOString().slice(0, 10);

export default function Conversion() {
  const [range, setRange] = useState({ from: isoDay(new Date(Date.now() - 30 * 864e5)), to: isoDay(new Date()) });
  const { data, loading, error } = useFetch('/api/leadflow/conversion', range, [range.from, range.to]);
  if (error) return <div className="alert err">{error}</div>;
  return (
    <div>
      <PageHead title="Lead conversion" sub={data ? `${data.period.from} to ${data.period.to} · ${data.period.timezone}${data.scope === 'own' ? ' · your leads' : ''}` : ''}>
        <div className="row wrap">
          <input className="input" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
          <input className="input" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
        </div>
      </PageHead>
      {!data || loading ? <Loading /> : data.totals.leads === 0 ? <Empty title="No leads in this period" hint="Choose a wider date range." /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <Stat label="Leads" value={data.totals.leads} sub={`${data.totals.tracked} tracked · ${data.totals.not_tracked} from before tracking · ${data.totals.unassigned} waiting for an owner`} />
            <Rate label="Accepted by owner" r={data.rates.accepted} />
            <Rate label="Responded to by a person" r={data.rates.responded} />
            <Rate label="Booked an appointment" r={data.rates.appointments} />
            <Rate label="Completed a viewing" r={data.rates.viewings} help="of those with an appointment" />
            <Rate label="Won" r={data.rates.won} />
            <Rate label="Lost" r={data.rates.lost} />
          </div>
          <Card title="Time to first response by a person">
            {data.response_time.count ? <div className="row wrap" style={{ gap: 24 }}>
              <div><div className="muted">Median</div><strong style={{ fontSize: 20 }}>{mins(data.response_time.median_minutes)}</strong></div>
              <div><div className="muted">Average</div><strong style={{ fontSize: 20 }}>{mins(data.response_time.average_minutes)}</strong></div>
              <div><div className="muted">Median, working time only</div><strong style={{ fontSize: 20 }}>{mins(data.response_time.median_working_minutes)}</strong></div>
              <div><div className="muted">Leads measured</div><strong style={{ fontSize: 20 }}>{data.response_time.count}</strong></div>
            </div> : <p className="muted" style={{ margin: 0 }}>{data.response_time.note}</p>}
            <p className="muted" style={{ marginBottom: 0 }}>Response targets: {data.sla.met} met · {data.sla.missed} missed · {data.sla.open} still open{data.sla.rate.rate != null ? ` · ${data.sla.rate.rate}% of due leads on time` : ''}.</p>
          </Card>
          <Card title="By source">
            <RateTable rows={data.by_source} first="Source" />
          </Card>
          {data.by_agent.length > 0 && <Card title="By owner (first assignment)">
            <RateTable rows={data.by_agent} first="Agent" />
          </Card>}
          <Card title="People and automation">
            <p className="muted" style={{ marginTop: 0 }}>{data.automation.note}</p>
            <div className="row wrap" style={{ gap: 24 }}>
              <div><div className="muted">Responses by people</div><strong>{data.automation.human_responses}</strong></div>
              <div><div className="muted">Contact attempts</div><strong>{data.automation.contact_attempts}</strong></div>
              <div><div className="muted">Automated messages</div><strong>{data.automation.automated_events}</strong></div>
              <div><div className="muted">Customer replies</div><strong>{data.automation.customer_replies}</strong></div>
              <div><div className="muted">In sequences</div><strong>{data.automation.sequences_enrolled}</strong></div>
              <div><div className="muted">Stopped by a reply</div><strong>{data.automation.sequences_stopped_by_reply}</strong></div>
              <div><div className="muted">Stopped by a booking</div><strong>{data.automation.sequences_stopped_by_booking}</strong></div>
            </div>
          </Card>
          <Card title="How these figures are worked out">
            <ul style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 4 }}>{Object.entries(data.definitions).map(([k, v]) => <li key={k} className="muted">{v}</li>)}</ul>
          </Card>
        </div>)}
    </div>
  );
}
