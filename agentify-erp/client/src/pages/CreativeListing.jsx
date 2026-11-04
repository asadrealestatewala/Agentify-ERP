// Creative Studio: Listing to post. Builds a finished, branded post from a real property (its own photo, price, area and location).
// No AI image and no credits: the photo is the real one and the layout is drawn in the browser, so nothing is invented.
// The result can be downloaded or kept in My creations.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading } from '../components/ui.jsx';
import { api } from '../api.js';
import { money } from '../format.js';
import { useAuth, useToast } from '../context.jsx';

const SIZES = { square: [1080, 1080, 'Square (1:1)'], portrait: [1080, 1350, 'Portrait (4:5)'], story: [1080, 1920, 'Story (9:16)'] };
const STYLES = { classic: 'Classic band', bold: 'Bold price', minimal: 'Clean card' };
const LANGS = ['English', 'Roman Urdu', 'Urdu'];

const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('The photo could not be loaded')); i.src = src; });
function cover(ctx, img, w, h) { const r = Math.max(w / img.width, h / img.height); const dw = img.width * r, dh = img.height * r; ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); }
function wrap(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(t).width > maxW && line) { n++; if (n >= maxLines) { ctx.fillText(`${line}…`, x, y); return y + lineH; } ctx.fillText(line, x, y); y += lineH; line = words[i]; } else line = t;
  }
  ctx.fillText(line, x, y); return y + lineH;
}
const fit = (ctx, text, weight, px, maxW, f) => { let n = px; ctx.font = f(weight, n); while (ctx.measureText(text).width > maxW && n > 28) { n -= 2; ctx.font = f(weight, n); } return n; };
const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };

export async function drawPost(canvas, { listing, photo, brand, style, size, priceText, tag }) {
  const [W, H] = SIZES[size]; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); const teal = /^#[0-9a-f]{6}$/i.test(brand.primary_color || '') ? brand.primary_color : '#0e7c6b';
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);
  if (photo) cover(ctx, await loadImg(photo), W, H);
  const where = [listing.area_name, listing.city].filter(Boolean).join(', ') || listing.location || '';
  const facts = [listing.bedrooms && `${listing.bedrooms} Beds`, listing.bathrooms && `${listing.bathrooms} Baths`, listing.area_size && `${listing.area_size} ${listing.unit || ''}`.trim()].filter(Boolean);
  const pad = Math.round(W * 0.06);
  let logo = null; if (brand.logo) { try { logo = await loadImg(`/uploads/${brand.logo}`); } catch { logo = null; } }
  const drawBrand = (x, y, light) => {
    let cx = x;
    if (logo) { const lh = 64, lw = Math.min(200, logo.width * (lh / logo.height)); ctx.save(); rr(ctx, cx, y, lw + 20, lh + 16, 14); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore(); ctx.drawImage(logo, cx + 10, y + 8, lw, lh); cx += lw + 36; }
    ctx.fillStyle = light ? '#fff' : '#0f172a'; ctx.font = font(700, 34); ctx.textBaseline = 'middle'; ctx.fillText(brand.brand_name || '', cx, y + 40); ctx.textBaseline = 'alphabetic';
  };
  const chip = (text, x, y, bg, fg) => { ctx.font = font(600, 32); const w = ctx.measureText(text).width + 40; rr(ctx, x, y, w, 58, 29); ctx.fillStyle = bg; ctx.fill(); ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 20, y + 30); ctx.textBaseline = 'alphabetic'; return x + w + 14; };
  if (style === 'classic') {
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.78)'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.45, W, H * 0.55);
    const bandH = Math.round(H * 0.16); ctx.fillStyle = teal; ctx.fillRect(0, H - bandH, W, bandH);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 66); ctx.fillText(priceText, pad, H - bandH + bandH * 0.62);
    ctx.font = font(600, 30); ctx.textAlign = 'right'; ctx.fillText(brand.brand_name || '', W - pad, H - bandH + bandH * 0.6); ctx.textAlign = 'left';
    ctx.fillStyle = '#fff'; ctx.font = font(800, 62); let y = wrap(ctx, listing.title, pad, H - bandH - 190 - (facts.length ? 60 : 0), W - pad * 2, 70, 2);
    ctx.font = font(500, 36); ctx.fillStyle = 'rgba(255,255,255,0.92)'; if (where) ctx.fillText(`📍 ${where}`, pad, y + 2);
    let cx = pad; if (facts.length) for (const f of facts) cx = chip(f, cx, H - bandH - 86, 'rgba(255,255,255,0.92)', '#0f172a');
    if (tag) { rr(ctx, pad, pad, ctx.measureText(tag).width + 70, 64, 32); ctx.fillStyle = teal; ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = font(700, 32); ctx.textBaseline = 'middle'; ctx.fillText(tag, pad + 35, pad + 34); ctx.textBaseline = 'alphabetic'; }
  } else if (style === 'bold') {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.45, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.85)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawBrand(pad, pad, true);
    ctx.fillStyle = '#fff'; fit(ctx, priceText, 900, Math.round(W * 0.11), W - pad * 2, font); ctx.fillText(priceText, pad, H - pad - 175);
    ctx.font = font(700, 48); wrap(ctx, listing.title, pad, H - pad - 105, W - pad * 2, 56, 2);
    ctx.font = font(500, 36); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillText([where, facts.join('  ·  ')].filter(Boolean).join('   |   '), pad, H - pad + 6);
    ctx.fillStyle = teal; ctx.fillRect(pad, H - pad - 300, 120, 10);
    if (tag) chip(tag, W - pad - ctx.measureText(tag).width - 40, pad, teal, '#fff');
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 260); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 260);
    const cw = W - pad * 2, chH = 330, cy = H - pad - chH;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 40; rr(ctx, pad, cy, cw, chH, 32); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
    rr(ctx, pad, cy, 16, chH, 8); ctx.fillStyle = teal; ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.font = font(800, 48); let y = wrap(ctx, listing.title, pad + 50, cy + 80, cw - 90, 56, 2);
    ctx.font = font(500, 32); ctx.fillStyle = '#475569'; if (where) ctx.fillText(where, pad + 50, y - 4);
    ctx.fillStyle = teal; ctx.font = font(800, 58); ctx.fillText(priceText, pad + 50, cy + chH - 40);
    ctx.font = font(600, 30); ctx.fillStyle = '#334155'; ctx.textAlign = 'right'; ctx.fillText(facts.join('  ·  '), pad + cw - 30, cy + chH - 46); ctx.textAlign = 'left';
    drawBrand(pad, pad, true);
    if (tag) chip(tag, W - pad - ctx.measureText(tag).width - 40, pad, teal, '#fff');
  }
}

function caption(l, lang, priceText, brandName, purpose) {
  const where = [l.area_name, l.city].filter(Boolean).join(', ') || l.location || '';
  const facts = [l.bedrooms && `${l.bedrooms} bed`, l.bathrooms && `${l.bathrooms} bath`, l.area_size && `${l.area_size} ${l.unit || ''}`.trim()].filter(Boolean).join(', ');
  const rent = purpose === 'rent';
  if (lang === 'Roman Urdu') return `${rent ? 'Kiraye ke liye' : 'Bikau'}: ${l.title}${where ? `, ${where}` : ''}.\n${facts ? `${facts}.\n` : ''}Qeemat: ${priceText}.\nMazeed maloomat ke liye humein ${brandName ? `(${brandName}) ` : ''}message karein.`;
  if (lang === 'Urdu') return `${rent ? 'کرائے کے لیے' : 'برائے فروخت'}: ${l.title}${where ? `، ${where}` : ''}۔\n${facts ? `${facts}۔\n` : ''}قیمت: ${priceText}۔\nمزید معلومات کے لیے ہم سے رابطہ کریں${brandName ? ` (${brandName})` : ''}۔`;
  return `${rent ? 'For rent' : 'For sale'}: ${l.title}${where ? ` in ${where}` : ''}.\n${facts ? `${facts}.\n` : ''}${rent ? 'Rent' : 'Price'}: ${priceText}.\nMessage us${brandName ? ` at ${brandName}` : ''} to book a viewing.`;
}

export default function CreativeListing({ onSaved }) {
  const toast = useToast(); const { can } = useAuth(); const canvas = useRef(null);
  const [rows, setRows] = useState(null); const [q, setQ] = useState(''); const [err, setErr] = useState(''); const [brand, setBrand] = useState(null);
  const [sel, setSel] = useState(null); const [photoIdx, setPhotoIdx] = useState(0); const [style, setStyle] = useState('classic'); const [size, setSize] = useState('square');
  const [lang, setLang] = useState('English'); const [tag, setTag] = useState(''); const [busy, setBusy] = useState(false); const [drawErr, setDrawErr] = useState('');
  useEffect(() => { api.get('/api/creative/brand').then(setBrand).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { const t = setTimeout(() => api.get(`/api/creative/listings?q=${encodeURIComponent(q)}`).then(setRows).catch((e) => setErr(e.message)), q ? 250 : 0); return () => clearTimeout(t); }, [q]);
  const priceText = useMemo(() => (sel?.price ? `${money(sel.price)}${sel.purpose === 'rent' ? ' / month' : ''}` : 'Price on request'), [sel]);
  const photo = sel?.photos?.[photoIdx] ? `/uploads/${sel.photos[photoIdx]}` : null;
  useEffect(() => {
    if (!sel || !brand || !canvas.current) return;
    setDrawErr(''); drawPost(canvas.current, { listing: sel, photo, brand, style, size, priceText, tag: tag.trim().slice(0, 24) }).catch((e) => setDrawErr(e.message));
  }, [sel, photo, brand, style, size, priceText, tag]);
  if (err && !rows) return <ErrorBox error={err} />;
  if (!rows || !brand) return <Loading rows={3} />;
  const fileName = `${(sel?.title || 'listing').replace(/[^\w]+/g, '-').slice(0, 40)}-${size}.png`;
  const download = () => canvas.current.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png');
  const keep = async () => { setBusy(true); setErr(''); try { await api.post('/api/creative/items', { data: canvas.current.toDataURL('image/png').split(',')[1], title: sel.title, prompt: 'Listing to post', size }); toast('Saved in My creations'); onSaved?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const cap = sel ? caption(sel, lang, priceText, brand.brand_name, sel.purpose) : '';
  const copy = () => navigator.clipboard?.writeText(cap).then(() => toast('Caption copied'));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card title="Listing to post">
        <p className="muted" style={{ marginTop: 0 }}>Pick a property and get a ready post with its real photo, price, area and location in your brand colours. Free, and nothing is invented.</p>
        <ErrorBox error={err} />
        <Field label="Find a property"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, area or code" /></Field>
        {rows.length === 0 ? <Empty title="No properties found" hint="Add a property under Inventory, with a photo, then come back here." /> : (
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {rows.map((r) => (
              <button key={r.id} type="button" className="card" onClick={() => { setSel(r); setPhotoIdx(0); }} aria-pressed={sel?.id === r.id}
                style={{ textAlign: 'left', padding: 0, overflow: 'hidden', cursor: 'pointer', borderColor: sel?.id === r.id ? 'var(--brand, #0e7c6b)' : undefined, borderWidth: sel?.id === r.id ? 2 : 1 }}>
                <div style={{ height: 110, background: '#e2e8f0' }}>{r.photos[0] ? <img src={`/uploads/${r.photos[0]}`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="muted" style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 12 }}>No photo yet</span>}</div>
                <div style={{ padding: 10 }}><strong style={{ display: 'block', fontSize: 14, overflowWrap: 'anywhere' }}>{r.title}</strong><span className="muted" style={{ fontSize: 12 }}>{r.price ? money(r.price) : 'No price'}</span></div>
              </button>
            ))}
          </div>)}
      </Card>
      {sel && (
        <Card title={`Your post: ${sel.title}`}>
          {!sel.photos.length && <p className="muted" style={{ marginTop: 0 }}>This property has no photo yet, so the post uses a plain background. Add a photo under Inventory for a better result.</p>}
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', alignItems: 'start' }}>
            <div><canvas ref={canvas} style={{ width: '100%', maxWidth: 420, height: 'auto', borderRadius: 12, border: '1px solid var(--line, #e2e8f0)', display: 'block' }} aria-label="Post preview" />{drawErr && <p className="muted" role="alert">{drawErr}</p>}</div>
            <div>
              {sel.photos.length > 1 && <Field label="Photo"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{sel.photos.map((p, i) => <button key={p} type="button" aria-label={`Photo ${i + 1}`} aria-pressed={i === photoIdx} onClick={() => setPhotoIdx(i)} style={{ padding: 0, border: i === photoIdx ? '2px solid var(--brand, #0e7c6b)' : '1px solid #cbd5e1', borderRadius: 8, overflow: 'hidden', width: 56, height: 56, cursor: 'pointer', background: 'none' }}><img src={`/uploads/${p}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></button>)}</div></Field>}
              <Field label="Style"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{Object.entries(STYLES).map(([k, v]) => <button key={k} type="button" className={`btn${style === k ? ' primary' : ''}`} aria-pressed={style === k} onClick={() => setStyle(k)}>{v}</button>)}</div></Field>
              <Field label="Size"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{Object.entries(SIZES).map(([k, v]) => <button key={k} type="button" className={`btn${size === k ? ' primary' : ''}`} aria-pressed={size === k} onClick={() => setSize(k)}>{v[2]}</button>)}</div></Field>
              <Field label="Badge (optional)" hint="For example Just listed or Open house"><input className="input" value={tag} onChange={(e) => setTag(e.target.value)} maxLength={24} /></Field>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button className="btn primary" onClick={download}>Download image</button>
                {can('content', 'create') && <button className="btn" disabled={busy} onClick={keep}>{busy ? 'Saving…' : 'Save in My creations'}</button>}
              </div>
              <Field label="Caption"><div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>{LANGS.map((l) => <button key={l} type="button" className={`btn${lang === l ? ' primary' : ''}`} aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>)}</div>
                <textarea className="input" rows={6} readOnly value={cap} dir={lang === 'Urdu' ? 'rtl' : 'ltr'} /><button className="btn" style={{ marginTop: 6 }} onClick={copy}>Copy caption</button></Field>
            </div>
          </div>
        </Card>)}
    </div>
  );
}
