// Public page opened by the QR code on an allotment letter (no sign-in). It shows the issuing company's own branding and the
// letter's key facts as the company issued them; nothing sensitive (no CNIC, phone, price or payments) is ever sent here.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : ''; };

const S = {
  page: { minHeight: '100vh', background: '#f4f5f7', color: '#111827', padding: '32px 16px', fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
  card: { maxWidth: 560, margin: '0 auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', borderBottom: '1px solid #e5e7eb' },
  body: { padding: 20 },
  row: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, padding: '9px 0', borderBottom: '1px solid #f0f1f3', fontSize: 14 },
  label: { color: '#6b7280' },
  foot: { maxWidth: 560, margin: '14px auto 0', textAlign: 'center', fontSize: 12, color: '#6b7280' },
};

function Status({ data }) {
  const ok = data.valid;
  const tone = ok ? { bg: '#ecfdf3', border: '#abefc6', fg: '#067647' } : { bg: '#fef3f2', border: '#fecdca', fg: '#b42318' };
  return (
    <div role="status" style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
        {ok ? <><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></> : <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>}
      </svg>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{ok ? 'Genuine allotment letter' : 'This letter is not valid'}</div>
        <div style={{ fontSize: 13.5, marginTop: 3 }}>{ok ? `Issued by ${data.company.name} and still in force.` : data.reason}</div>
      </div>
    </div>
  );
}

export default function VerifyAllotment() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    document.title = 'Verify allotment letter';
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex'; document.head.appendChild(m);
    api.get(`/api/verify/allotment/${encodeURIComponent(token)}`).then(setData).catch((e) => setErr(e.message || 'This letter could not be checked.'));
    return () => m.remove();
  }, [token]);
  const c = data?.company;
  const rows = data ? [['Reference no.', data.letter_no], ['Date issued', dmy(data.issue_date)], ['Allottee', data.customer_name], ['Plot no.', data.plot_no], ['Block', data.block],
    ['Project / society', data.project_name], ['Location', data.plot_location], ['Area', data.area], ['Type', data.property_type]].filter(([, v]) => v) : [];
  return (
    <div style={S.page}>
      <main style={S.card}>
        <div style={S.head}>
          {c?.has_logo && <img src={`/api/verify/allotment/${encodeURIComponent(token)}/logo`} alt="" style={{ maxHeight: 52, maxWidth: 96, objectFit: 'contain' }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{c?.name || 'Allotment letter verification'}</div>
            {c && <div style={{ fontSize: 12.5, color: '#6b7280' }}>{[c.address, c.phone].filter(Boolean).join(' · ')}</div>}
          </div>
        </div>
        <div style={S.body}>
          {!data && !err && <div style={{ color: '#6b7280' }}>Checking the letter…</div>}
          {err && (
            <div role="alert" style={{ background: '#fef3f2', border: '1px solid #fecdca', color: '#b42318', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontWeight: 700 }}>No matching letter</div>
              <div style={{ fontSize: 13.5, marginTop: 3 }}>{err} Contact the company that issued the letter before relying on it.</div>
            </div>
          )}
          {data && (
            <>
              <Status data={data} />
              <h1 style={{ fontSize: 15, margin: '20px 0 4px' }}>Allotment letter details</h1>
              <div>{rows.map(([k, v]) => <div key={k} style={S.row}><span style={S.label}>{k}</span><b style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{v}</b></div>)}</div>
              <p style={{ fontSize: 12.5, color: '#6b7280', margin: '14px 0 0' }}>Compare these details with the printed letter. If anything differs, the paper copy may have been altered.</p>
              <div style={{ marginTop: 16 }}><Link to="/portal/login" style={{ color: '#111827', fontSize: 14, fontWeight: 600 }}>Allottee? Sign in to your customer portal</Link></div>
            </>
          )}
        </div>
      </main>
      <div style={S.foot}>{data ? `Checked ${new Date().toLocaleString()} · ` : ''}Verification by <span style={{ color: '#0e7c6b', fontWeight: 600 }}>Agentify ERP</span></div>
    </div>
  );
}
