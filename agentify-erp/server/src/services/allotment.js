// Allotment letters for housing projects: one letter per sold plot, printed on the workspace's own letterhead with a QR code
// that opens a public verification page on the workspace's own address. The letter keeps a copy of what it states
// (a printed letter must not change when the customer record is edited later); the verification page shows only that copy,
// never CNIC, phone, e-mail or payment figures. Links carry a random token, never the sequential letter id.
// Shown only in housing-society / developer workspaces (setting `allotment_letters`: auto | on | off).
import crypto from 'node:crypto';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { all, get, getSetting, nextNo, run, tx } from '../db.js';
import { bad, forbidden, moneyText, notFound, now, today } from '../util.js';
import { brand } from './pdf.js';
import { workspaceUrl } from './siteHost.js';
import { isMultiTenant, LEGACY_SLUG } from '../platform.js';
import { ARABIC_FONT, hasArabic, registerArabic } from './rtlPdf.js';
import { readRefBytes } from './storage.js';

export { ALLOTMENT_SCHEMA } from '../allotmentSchema.js';

export const ALLOTMENT_CHOICES = ['auto', 'on', 'off'];
/**
 * Whether this workspace issues allotment letters. 'auto' (default): yes once it runs a housing scheme, i.e. has a
 * development project with numbered plots. Agency-only workspaces (no plotted development project) do not see it.
 */
export function allotmentEnabled() {
  const choice = getSetting('allotment_letters', 'auto');
  if (choice === 'on') return true;
  if (choice === 'off') return false;
  return !!get(`SELECT 1 x FROM properties p JOIN projects pr ON pr.id=p.project_id WHERE pr.kind='development' AND COALESCE(p.plot_no,'')<>'' LIMIT 1`);
}
export function assertAllotmentEnabled() {
  if (!allotmentEnabled()) throw forbidden('Allotment letters are for housing-society and developer workspaces. Switch them on in Settings > System settings.');
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : ''; };
const clean = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uniq = (xs) => xs.map((x) => clean(x)).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
const areaText = (l) => (l.area_size ? `${String(Number(l.area_size))} ${l.area_unit || ''}`.trim() : '');
const sizeText = (l) => [l.dimensions ? `(${l.dimensions})` : '', areaText(l)].filter(Boolean).join(' ');
const flag = (v, def) => (v === undefined || v === null || v === '' ? def : v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function saleFor(saleId) {
  const s = get(`SELECT s.id, s.kind, s.status, s.contact_id, s.property_id, s.agent_id, s.sale_date, s.sale_no FROM sales s WHERE s.id=?`, saleId);
  if (!s) throw notFound('Sale not found');
  return s;
}

/** What a new letter for this sale would say, filled from the customer, plot and project records. */
export function letterDraft(saleId) {
  const s = saleFor(saleId);
  const c = get('SELECT full_name, father_name, gender, address, area, city, province FROM contacts WHERE id=?', s.contact_id) || {};
  const p = s.property_id ? get(`SELECT p.*, pr.name project_name, pr.location project_location FROM properties p LEFT JOIN projects pr ON pr.id=p.project_id WHERE p.id=?`, s.property_id) : null;
  return {
    sale_id: s.id, sale_no: s.sale_no, kind: s.kind, sale_status: s.status, has_property: !!p,
    issue_date: today(), customer_name: c.full_name || '', relation: c.father_name ? `${c.gender === 'Female' ? 'D/O' : 'S/O'} ${c.father_name}` : '',
    customer_address: uniq([c.address, c.area, c.city]).join(', '),
    plot_no: p?.plot_no || '', block: p?.block || '', project_name: p?.project_name || '', property_type: p?.property_type || '',
    plot_location: uniq([p?.project_name, p?.address || p?.location || p?.project_location, p?.area_name, p?.city]).join(', '),
    area_size: p?.area_size ?? null, area_unit: p?.unit || '', dimensions: p?.dimensions || '', note: '',
    include_urdu: 1, include_map: 1, include_plan: 1,
  };
}

const LETTER_SELECT = `SELECT l.*, u.name issued_by_name, (SELECT COUNT(*) FROM allotment_scans x WHERE x.letter_id=l.id) scans,
  (SELECT MAX(scanned_at) FROM allotment_scans x WHERE x.letter_id=l.id) last_scanned_at FROM allotment_letters l LEFT JOIN users u ON u.id=l.issued_by`;
export const lettersForSale = (saleId) => all(`${LETTER_SELECT} WHERE l.sale_id=? ORDER BY l.id DESC`, saleId);
export const letterById = (id) => get(`${LETTER_SELECT} WHERE l.id=?`, id);

/** Every letter, newest first, for the Allotment Letters screen. Filters: project_id, block, status, q. Own-records roles see their own sales only. */
export function listLetters({ project_id, block, status, q } = {}, ownerId = null) {
  const where = ['1=1'], params = [];
  if (project_id) { where.push('p.project_id=?'); params.push(Number(project_id)); }
  if (block) { where.push('l.block=?'); params.push(String(block)); }
  if (status) { where.push('l.status=?'); params.push(String(status)); }
  if (q) { where.push('(l.letter_no LIKE ? OR l.customer_name LIKE ? OR l.plot_no LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (ownerId) { where.push('s.agent_id=?'); params.push(ownerId); }
  return all(`${LETTER_SELECT.replace('FROM allotment_letters l', 'FROM allotment_letters l JOIN sales s ON s.id=l.sale_id LEFT JOIN properties p ON p.id=l.property_id')}
    WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT 1000`, ...params);
}

/**
 * Issue a letter for a confirmed plot sale. Staff may correct the wording (address, location, dimensions) on the form;
 * the plot's dimensions are saved back to the plot when it had none. A sale has one letter in force: issuing again
 * cancels the earlier one (its QR then shows "cancelled"), so a lost letter can be replaced without two valid copies.
 */
export function issueLetter(saleId, body, user) {
  const s = saleFor(saleId);
  if (s.kind !== 'property') throw bad('Allotment letters are issued for plot sales, not construction contracts');
  if (s.status !== 'confirmed') throw bad('Only a confirmed sale can get an allotment letter');
  if (!s.property_id) throw bad('This sale has no plot attached');
  const d = letterDraft(saleId);
  const b = body || {};
  const v = (k, max) => clean(b[k] !== undefined ? b[k] : d[k], max);
  const l = {
    issue_date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.issue_date || '')) ? b.issue_date : d.issue_date,
    customer_name: v('customer_name', 120), relation: v('relation', 120), customer_address: v('customer_address', 300),
    plot_no: v('plot_no', 40), block: v('block', 40), project_name: v('project_name', 120), plot_location: v('plot_location', 300), property_type: v('property_type', 60),
    area_size: b.area_size !== undefined && b.area_size !== '' && b.area_size !== null ? Number(b.area_size) : d.area_size, area_unit: v('area_unit', 20), dimensions: v('dimensions', 40), note: clean(b.note, 600),
    include_urdu: flag(b.include_urdu, 1), include_map: flag(b.include_map, 1), include_plan: flag(b.include_plan, 1),
  };
  if (!l.customer_name) throw bad('Customer name is required');
  if (!l.customer_address) throw bad('Enter the customer\'s residential address (it can also be saved on the customer record)');
  if (!l.plot_no) throw bad('Plot number is required');
  if (!l.plot_location) throw bad('Plot location is required');
  if (l.area_size !== null && !(Number.isFinite(l.area_size) && l.area_size > 0)) throw bad('Area must be a positive number');
  if (l.dimensions && !/^[\d.]+\s*[x×*]\s*[\d.]+(\s*\S{0,6})?$/i.test(l.dimensions)) throw bad('Dimensions look like 25x45');
  return tx(() => {
    const old = all("SELECT id FROM allotment_letters WHERE sale_id=? AND status='issued'", saleId);
    for (const o of old) run("UPDATE allotment_letters SET status='cancelled', cancel_reason=?, cancelled_at=?, cancelled_by=? WHERE id=?", 'Replaced by a new letter', now(), user?.id ?? null, o.id);
    const token = crypto.randomBytes(18).toString('base64url');
    const letterNo = nextNo('allotment_letter', 'AL');
    const id = Number(run(`INSERT INTO allotment_letters(letter_no,token,sale_id,contact_id,property_id,issue_date,customer_name,relation,customer_address,plot_no,block,project_name,plot_location,property_type,area_size,area_unit,dimensions,note,include_urdu,include_map,include_plan,issued_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, letterNo, token, saleId, s.contact_id, s.property_id, l.issue_date, l.customer_name, l.relation || null, l.customer_address,
    l.plot_no, l.block || null, l.project_name || null, l.plot_location, l.property_type || null, l.area_size, l.area_unit || null, l.dimensions || null, l.note || null,
    l.include_urdu, l.include_map, l.include_plan, user?.id ?? null, now()).lastInsertRowid);
    // fill gaps on the records so the next document has them too; never overwrite what is already there
    if (l.dimensions) run("UPDATE properties SET dimensions=? WHERE id=? AND (dimensions IS NULL OR dimensions='')", l.dimensions, s.property_id);
    if (b.save_address) run("UPDATE contacts SET address=? WHERE id=? AND (address IS NULL OR address='')", l.customer_address, s.contact_id);
    return { id, letter_no: letterNo, replaced: old.length };
  });
}

/** Sold plots of a project (optionally one block) and whether each already has a letter in force: the bulk-issue preview. */
export function bulkCandidates(projectId, block, ownerId = null) {
  if (!projectId) throw bad('Choose a project');
  const params = [Number(projectId)];
  let extra = '';
  if (block) { extra += ' AND p.block=?'; params.push(String(block)); }
  if (ownerId) { extra += ' AND s.agent_id=?'; params.push(ownerId); }
  return all(`SELECT s.id sale_id, s.sale_no, p.plot_no, p.block, c.full_name customer_name, c.address,
      (SELECT letter_no FROM allotment_letters l WHERE l.sale_id=s.id AND l.status='issued') letter_no
    FROM sales s JOIN properties p ON p.id=s.property_id JOIN contacts c ON c.id=s.contact_id
    WHERE s.kind='property' AND s.status='confirmed' AND p.project_id=?${extra}
    ORDER BY p.block, CAST(p.plot_no AS INTEGER), p.plot_no`, ...params).map((r) => ({ ...r, has_address: !!clean(r.address), address: undefined }));
}

/** Issue letters for every sold plot of a project / block that has none in force. Plots that cannot be issued are listed with the reason. */
export function bulkIssue({ project_id, block, issue_date, include_urdu, include_map, include_plan } = {}, user, ownerId = null) {
  const rows = bulkCandidates(project_id, block, ownerId).filter((r) => !r.letter_no);
  if (rows.length > 500) throw bad('Issue at most 500 letters at a time; choose one block');
  const issued = [], skipped = [];
  for (const r of rows) {
    try { issued.push({ sale_id: r.sale_id, ...issueLetter(r.sale_id, { issue_date, include_urdu, include_map, include_plan }, user) }); }
    catch (e) { skipped.push({ sale_id: r.sale_id, sale_no: r.sale_no, plot_no: r.plot_no, customer_name: r.customer_name, reason: e.message }); }
  }
  return { issued, skipped };
}

export function cancelLetter(id, reason, user) {
  const l = letterById(id);
  if (!l) throw notFound('Letter not found');
  if (l.status === 'cancelled') throw bad('This letter is already cancelled');
  const why = clean(reason, 300);
  if (!why) throw bad('Give a reason for cancelling');
  run("UPDATE allotment_letters SET status='cancelled', cancel_reason=?, cancelled_at=?, cancelled_by=? WHERE id=?", why, now(), user?.id ?? null, id);
  return letterById(id);
}

/** The workspace's own address (its portal), where the QR code points. */
export function verifyBase(req) {
  // a workspace on the platform has its own address (slug.base-domain); the original single install keeps the address it is served on
  if (isMultiTenant() && req.tenant?.slug && req.tenant.slug !== LEGACY_SLUG) return workspaceUrl(req.tenant, req);
  return `${req.protocol}://${req.get('host')}`;
}
export const verifyUrl = (req, token) => `${verifyBase(req)}/verify/allotment/${token}`;

/** A letter is valid while it is not cancelled and its sale still stands (a cancelled sale voids the letter). */
function validity(l) {
  if (l.status === 'cancelled') return { valid: false, state: 'cancelled', reason: l.cancel_reason === 'Replaced by a new letter' ? 'This letter was replaced by a newer letter.' : 'This letter has been cancelled by the issuer.' };
  const s = get('SELECT status FROM sales WHERE id=?', l.sale_id);
  if (!s || s.status !== 'confirmed') return { valid: false, state: 'cancelled', reason: 'The allotment this letter records is no longer in force.' };
  return { valid: true, state: 'valid', reason: null };
}

const device = (ua) => (/ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Phone' : ua ? 'Computer' : 'Unknown');

/** What the public verification page shows: the letter's own copy only, no CNIC, phone, e-mail, price or payments. Each look is logged. */
export function publicLetter(token, { log = null } = {}) {
  if (!/^[\w-]{20,40}$/.test(String(token || ''))) return null;
  const l = get('SELECT * FROM allotment_letters WHERE token=?', token);
  if (!l) return null;
  const b = brand();
  const v = validity(l);
  if (log) run('INSERT INTO allotment_scans(letter_id,scanned_at,device,result) VALUES(?,?,?,?)', l.id, now(), device(String(log.userAgent || '')), v.valid ? 'valid' : 'not valid');
  return {
    ...v, company: { name: b.name, address: b.address || null, phone: b.phone || null, website: b.website || null, has_logo: !!b.logo },
    letter_no: l.letter_no, issue_date: l.issue_date, customer_name: l.customer_name,
    plot_no: l.plot_no, block: l.block, project_name: l.project_name, plot_location: l.plot_location, property_type: l.property_type,
    area: sizeText(l) || null, checked_at: now(),
  };
}
export const scansFor = (letterId) => all('SELECT scanned_at, device, result FROM allotment_scans WHERE letter_id=? ORDER BY id DESC LIMIT 200', letterId);

/** The workspace logo for the verification page (read from the letterhead settings). */
export const brandLogoPath = () => { const lp = brand().logo; return lp && fs.existsSync(lp) ? lp : null; };

export async function letterQrPng(url) {
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, scale: 8, type: 'png', color: { dark: '#111111', light: '#ffffff' } });
}

// ------------------------------------------------------------------ PDF
const INK = '#111111', SOFT = '#555555', RULE = '#999999';
const M = 50;


// ---- Urdu text. pdfkit shapes and orders an Urdu word correctly, but the bundled Naskh font has no space glyph and a
// line mixes Urdu with English names and numbers, so lines are laid out here word by word, right to left: each Urdu word
// on its own, each stretch of consecutive English words as one left-to-right chunk.
const tokensOf = (text) => String(text ?? '').split(/\s+/).filter(Boolean).map((t) => ({ text: t, rtl: hasArabic(t) }));
function tokenWidth(doc, t, size, bold) { doc.font(t.rtl ? ARABIC_FONT : bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(t.rtl ? size : size * 0.92); return doc.widthOfString(t.text); }
function chunks(doc, tokens, size, bold) {
  const out = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && !t.rtl && !last.rtl) last.text += ` ${t.text}`; else out.push({ ...t });
  }
  return out.map((c) => ({ ...c, w: tokenWidth(doc, c, size, bold) }));
}
const gapOf = (size) => size * 0.32;
/** One line of Urdu (with any English inside) whose right edge is at xRight. Returns its width. */
function urLine(doc, text, xRight, y, { size = 11, color = INK, bold = false } = {}) {
  registerArabic(doc);
  const cs = chunks(doc, tokensOf(text), size, bold);
  let x = xRight;
  for (const c of cs) {
    x -= c.w;
    doc.fillColor(color).font(c.rtl ? ARABIC_FONT : bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.rtl ? size : size * 0.92).text(c.text, x, c.rtl ? y : y + size * 0.35, { lineBreak: false });
    x -= gapOf(size);
  }
  return xRight - x - gapOf(size);
}
const urWidth = (doc, text, size = 11) => { registerArabic(doc); const cs = chunks(doc, tokensOf(text), size, false); return cs.reduce((a, c) => a + c.w, 0) + Math.max(0, cs.length - 1) * gapOf(size); };
/** A right-to-left paragraph wrapped to `width`; returns the y below it. */
function urPara(doc, text, xRight, y, width, size = 12) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (line && urWidth(doc, t, size) > width) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const lh = size * 2;
  lines.forEach((ln, i) => urLine(doc, ln, xRight, y + i * lh, { size }));
  return y + lines.length * lh;
}

/** Everything a letter's annexure needs, read before drawing: payment plan (from the sale) and plot position (site plan image or block layout). */
async function annexData(l) {
  const out = { plan: null, sitePlan: null, block: null };
  if (l.include_plan) out.plan = get('SELECT sale_date, sale_price, discount, net_price, booking_amount, advance_amount, num_installments, installment_amount, balloon_count, balloon_amount, balloon_interval, first_due, final_due FROM sales WHERE id=?', l.sale_id);
  if (l.include_map && l.property_id) {
    const p = get('SELECT project_id, block, plot_no FROM properties WHERE id=?', l.property_id);
    if (p?.project_id) {
      const doc = get(`SELECT path FROM documents WHERE entity_type='project' AND entity_id=? AND category='Site Plan' AND mime IN ('image/png','image/jpeg','image/jpg') ORDER BY id DESC LIMIT 1`, p.project_id);
      if (doc) { try { out.sitePlan = await readRefBytes(doc.path); } catch { out.sitePlan = null; } }
      if (!out.sitePlan) {
        const plots = all(`SELECT id, plot_no, status FROM properties WHERE project_id=? AND COALESCE(block,'')=? AND COALESCE(plot_no,'')<>'' AND status<>'cancelled'
          ORDER BY CAST(plot_no AS INTEGER), plot_no`, p.project_id, p.block || '');
        if (plots.length > 1) {
          // a long block shows the 120 plots around this one
          const at = Math.max(0, plots.findIndex((x) => x.id === l.property_id));
          const start = plots.length > 120 ? Math.max(0, Math.min(at - 60, plots.length - 120)) : 0;
          out.block = { name: p.block || '', plots: plots.slice(start, start + 120), total: plots.length, current: l.property_id };
        }
      }
    }
  }
  return out;
}

/** Double border and a faint logo (or company name) in the middle of the page, so a photocopy or a retyped letter stands out. */
function security(doc, b) {
  const w = doc.page.width, h = doc.page.height;
  doc.save();
  doc.rect(22, 22, w - 44, h - 44).lineWidth(1.4).strokeColor('#444444').stroke();
  doc.rect(27, 27, w - 54, h - 54).lineWidth(0.4).strokeColor('#777777').stroke();
  doc.restore();
  doc.save();
  if (b.logo) {
    try { doc.opacity(0.06); doc.image(b.logo, w / 2 - 150, h / 2 - 150, { fit: [300, 300], align: 'center', valign: 'center' }); } catch { /* unsupported image */ }
  } else {
    doc.rotate(-32, { origin: [w / 2, h / 2] });
    doc.fillOpacity(0.05).fillColor(INK).font('Helvetica-Bold').fontSize(54).text(b.name, 0, h / 2 - 30, { width: w, align: 'center', lineBreak: false });
  }
  doc.restore();
}

function cancelledMark(doc) {
  doc.save(); doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.fillOpacity(0.1).fillColor('#dc2626').font('Helvetica-Bold').fontSize(110).text('CANCELLED', 0, doc.page.height / 2 - 55, { width: doc.page.width, align: 'center', lineBreak: false });
  doc.restore();
}

function footer(doc, l, b, page) {
  doc.page.margins.bottom = 0;
  const W = doc.page.width - M * 2, fy = doc.page.height - M - 10;
  doc.moveTo(M, fy - 4).lineTo(M + W, fy - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  doc.font('Helvetica').fontSize(7).fillColor(SOFT).text(`${b.footer ? `${b.footer}  ·  ` : ''}${l.letter_no} · ${page}`, M, fy, { width: W, align: 'center', lineBreak: false });
}

/** Letterhead: logo left, company name and contact lines beside it, date and reference on the right. Returns the y below it. */
function letterhead(doc, l, b, { urdu = false } = {}) {
  const W = doc.page.width - M * 2;
  let y = 44;
  if (b.logo) { try { doc.image(b.logo, M, y, { fit: [96, 72] }); } catch { /* unsupported image */ } }
  const tx0 = b.logo ? M + 108 : M;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(b.name, tx0, y + 4, { width: W - (tx0 - M) - 150 });
  const contact = [b.address, [b.phone, b.email, b.website].filter(Boolean).join('  |  ')].filter(Boolean).join('\n');
  if (contact) doc.font('Helvetica').fontSize(8.5).fillColor(SOFT).text(contact, tx0, doc.y + 2, { width: W - (tx0 - M) - 150 });
  const leftBottom = Math.max(doc.y, y + (b.logo ? 72 : 36));
  if (urdu) {
    urLine(doc, `تاریخ ${dmy(l.issue_date)}`, M + W, y + 4, { size: 10, color: INK });
    urLine(doc, `حوالہ نمبر ${l.letter_no}`, M + W, y + 24, { size: 10, color: INK });
  } else {
    doc.font('Helvetica').fontSize(9.5).fillColor(INK);
    doc.text(`Date: ${dmy(l.issue_date)}`, M + W - 145, y + 6, { width: 145, align: 'right' });
    doc.text(`Ref No.: ${l.letter_no}`, M + W - 145, doc.y + 4, { width: 145, align: 'right' });
  }
  y = leftBottom + 10;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.2).strokeColor(INK).stroke();
  doc.moveTo(M, y + 3).lineTo(M + W, y + 3).lineWidth(0.4).strokeColor(RULE).stroke();
  return y + 22;
}

/** QR on the left, stamp circle and signature line on the right, at the foot of the page. */
function signBand(doc, qr, url, { urdu = false, minTop }) {
  doc.page.margins.bottom = 0;
  const W = doc.page.width - M * 2, fy = doc.page.height - M - 10;
  const bandTop = Math.max(minTop, fy - 150);
  const qs = 104;
  if (qr) {
    doc.image(qr, M, bandTop, { width: qs, height: qs });
    if (urdu) urLine(doc, 'تصدیق کے لیے اسکین کریں', M + qs, bandTop + qs + 4, { size: 9, color: INK });
    else doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('Scan to verify this letter', M, bandTop + qs + 4, { width: 160 });
    doc.font('Helvetica').fontSize(7).fillColor(SOFT).text(url.replace(/^https?:\/\//, '').replace(/\/verify\/.*/, ''), M, bandTop + qs + (urdu ? 22 : 17), { width: 160 });
  } else {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#b42318').text('CANCELLED', M, bandTop + 30, { width: 180 });
  }
  const sx = M + W - 300;
  doc.circle(sx + 60, bandTop + 48, 44).lineWidth(0.6).dash(3, { space: 3 }).strokeColor(RULE).stroke().undash();
  doc.moveTo(sx + 140, bandTop + 82).lineTo(sx + 300, bandTop + 82).lineWidth(0.7).strokeColor(INK).stroke();
  if (urdu) {
    urLine(doc, 'کمپنی کی مہر', sx + 88, bandTop + 40, { size: 9, color: SOFT });
    urLine(doc, 'مجاز دستخط کنندہ', sx + 260, bandTop + 86, { size: 9, color: SOFT });
  } else {
    doc.font('Helvetica').fontSize(8).fillColor(SOFT).text('Company stamp', sx + 16, bandTop + 44, { width: 88, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor(SOFT).text('Authorised signatory', sx + 140, bandTop + 86, { width: 160, align: 'center' });
  }
}

/** Two-column key/value grid; `wideKeys` take the full width. `urdu` puts labels on the right. */
function grid(doc, rows, y, { urdu = false } = {}) {
  const W = doc.page.width - M * 2, cw = W / 2, lw = 92;
  let ty = y;
  for (let i = 0; i < rows.length;) {
    const wide = rows[i][2] === 'wide';
    const cells = wide ? [rows[i]] : rows.slice(i, i + 2).filter((r) => r[2] !== 'wide');
    doc.font('Helvetica-Bold').fontSize(9.5);
    const vw = (wide ? W : cw) - lw - 12;
    const vh = cells.map(([, v]) => doc.heightOfString(String(v), { width: vw }) + 8);
    doc.font('Helvetica').fontSize(9);
    const kh = urdu ? [] : cells.map(([k]) => doc.heightOfString(k, { width: lw - 6 }) + 8);
    const h = Math.max(urdu ? 24 : 19, ...vh, ...kh);
    cells.forEach(([k, v], ci) => {
      const w = wide ? W : cw;
      const x = urdu ? M + W - (ci + 1) * cw - (wide ? cw : 0) : M + ci * cw;
      doc.rect(x, ty, w, h).fillAndStroke(ci % 2 ? '#ffffff' : '#f5f5f5', '#bbbbbb');
      if (urdu) {
        urLine(doc, k, x + w - 6, ty + 3, { size: 9.5, color: SOFT });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(String(v), x + 6, ty + 6, { width: vw, align: 'right' });
      } else {
        doc.fillColor(SOFT).font('Helvetica').fontSize(9).text(k, x + 6, ty + 5, { width: lw - 6 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(String(v), x + lw, ty + 5, { width: vw });
      }
    });
    ty += h; i += cells.length;
  }
  return ty;
}

function englishPage(doc, l, b, qr, url) {
  const W = doc.page.width - M * 2;
  security(doc, b);
  let y = letterhead(doc, l, b);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text('ALLOTMENT LETTER', M, y, { width: W, align: 'center', underline: true });
  y = doc.y + 18;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('To,', M, y);
  doc.font('Helvetica-Bold').text(l.customer_name, M, doc.y + 2);
  if (l.relation) doc.font('Helvetica').text(l.relation);
  doc.font('Helvetica').text(l.customer_address, { width: W * 0.65 });
  y = doc.y + 14;
  const plot = [`Plot No. ${l.plot_no}`, l.block && `Block ${l.block}`].filter(Boolean).join(', ');
  doc.font('Helvetica-Bold').fontSize(10.5).text(`Subject: Allotment of ${plot}${l.project_name ? `, ${l.project_name}` : ''}`, M, y, { width: W, underline: true });
  y = doc.y + 12;
  const size = sizeText(l);
  const parts = [
    ['This is to certify that ', false], [l.customer_name, true], [l.relation ? `, ${l.relation}` : '', false], [', resident of ', false], [l.customer_address, true],
    [', has been allotted ', false], [plot, true], [l.property_type && !/^plot$/i.test(l.property_type) ? ` (${l.property_type})` : '', false], [', situated at ', false], [l.plot_location, true],
    [size ? ', with a property area of ' : '', false], [size, true], ['.', false],
  ].filter(([t]) => t);
  doc.fontSize(10.5).fillColor(INK);
  parts.forEach(([t, bold], i) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    if (i === 0) doc.text(t, M, y, { width: W, lineGap: 3, continued: parts.length > 1 });
    else doc.text(t, { continued: i < parts.length - 1 });
  });
  doc.moveDown(0.8);
  doc.font('Helvetica').text(`This allotment is subject to the payment of all dues under the agreed payment plan and to the terms and conditions of ${b.name}.`, M, doc.y, { width: W, lineGap: 3, align: 'justify' });
  if (l.note) { doc.moveDown(0.6); doc.text(l.note, M, doc.y, { width: W, lineGap: 3, align: 'justify' }); }
  doc.moveDown(1);
  const rows = [['Plot No.', l.plot_no], ['Block', l.block], ['Project / society', l.project_name], ['Type', l.property_type], ['Dimensions', l.dimensions], ['Area', areaText(l)]].filter(([, v]) => v);
  rows.push(['Location', l.plot_location, 'wide']);
  y = grid(doc, rows, doc.y) + 16;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('Yours truly,', M, y);
  doc.moveDown(0.3).text('For,').font('Helvetica-Bold').text(b.name);
  signBand(doc, qr, url, { minTop: doc.y + 16 });
}

function urduPage(doc, l, b, qr, url) {
  const W = doc.page.width - M * 2, R = M + W;
  security(doc, b);
  let y = letterhead(doc, l, b, { urdu: true });
  const title = 'الاٹمنٹ لیٹر';
  urLine(doc, title, M + W / 2 + urWidth(doc, title, 20) / 2, y - 6, { size: 20, color: INK });
  y += 34;
  urLine(doc, `بنام ${l.customer_name}${l.relation ? ` ${l.relation}` : ''}`, R, y, { size: 12, color: INK });
  y = urPara(doc, `سکونت ${l.customer_address}`, R, y + 24, W * 0.75, 11) + 6;
  const plotUr = `پلاٹ نمبر ${l.plot_no}${l.block ? ` ، بلاک ${l.block}` : ''}`;
  y = urPara(doc, `موضوع ${plotUr}${l.project_name ? ` ، ${l.project_name}` : ''} کی الاٹمنٹ`, R, y + 4, W, 12) + 8;
  const size = sizeText(l);
  y = urPara(doc, `تصدیق کی جاتی ہے کہ ${plotUr} ، واقع ${l.plot_location}${size ? ` ، رقبہ ${size}` : ''} ، ${l.customer_name}${l.relation ? ` ${l.relation}` : ''} ساکن ${l.customer_address} کو الاٹ کیا گیا ہے۔`, R, y, W, 12) + 6;
  y = urPara(doc, `یہ الاٹمنٹ طے شدہ ادائیگی پلان کے مطابق تمام واجبات کی ادائیگی اور ${b.name} کے قواعد و ضوابط سے مشروط ہے۔`, R, y, W, 12) + 12;
  const rows = [['پلاٹ نمبر', l.plot_no], ['بلاک', l.block], ['پروجیکٹ / سوسائٹی', l.project_name], ['قسم', l.property_type], ['پیمائش', l.dimensions], ['رقبہ', areaText(l)]].filter(([, v]) => v);
  rows.push(['مقام', l.plot_location, 'wide']);
  y = grid(doc, rows, y, { urdu: true }) + 16;
  urLine(doc, 'منجانب', R, y, { size: 12, color: INK });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(b.name, M, y + 26, { width: W, align: 'right' });
  const after = urPara(doc, 'یہ انگریزی الاٹمنٹ لیٹر کا اردو ترجمہ ہے۔ کسی اختلاف کی صورت میں انگریزی متن معتبر ہوگا۔', R, y + 50, W, 9);
  signBand(doc, qr, url, { urdu: true, minTop: after + 6 });
}

function annexPage(doc, l, b, data) {
  const W = doc.page.width - M * 2;
  security(doc, b);
  let y = letterhead(doc, l, b);
  const parts = [data.sitePlan || data.block ? 'PLOT POSITION' : null, data.plan ? 'PAYMENT PLAN' : null].filter(Boolean);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(`ANNEXURE: ${parts.join(' AND ')}`, M, y - 6, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(SOFT).text(`${l.customer_name} · Plot No. ${l.plot_no}${l.block ? `, Block ${l.block}` : ''}${l.project_name ? ` · ${l.project_name}` : ''}`, M, doc.y + 3, { width: W, align: 'center' });
  y = doc.y + 16;
  if (data.sitePlan) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Site plan', M, y); y = doc.y + 6;
    const boxH = data.plan ? 300 : 520;
    try { doc.image(data.sitePlan, M, y, { fit: [W, boxH], align: 'center', valign: 'top' }); } catch { /* unreadable image */ }
    doc.rect(M, y, W, boxH).lineWidth(0.4).strokeColor('#cccccc').stroke();
    y += boxH + 6;
    doc.font('Helvetica').fontSize(8).fillColor(SOFT).text(`Your plot: Plot No. ${l.plot_no}${l.block ? `, Block ${l.block}` : ''}. Site plan as uploaded by ${b.name}.`, M, y, { width: W });
    y = doc.y + 16;
  } else if (data.block) {
    const blk = data.block;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${blk.name ? `Block ${blk.name}` : 'Plots'} layout`, M, y); y = doc.y + 6;
    const cols = 12, cw = W / cols, ch = 24;
    blk.plots.forEach((p, i) => {
      const x = M + (i % cols) * cw, yy = y + Math.floor(i / cols) * ch;
      const mine = p.id === blk.current;
      doc.rect(x + 1, yy + 1, cw - 2, ch - 2).fillAndStroke(mine ? INK : p.status === 'sold' ? '#e5e5e5' : '#ffffff', mine ? INK : '#9a9a9a');
      doc.font(mine ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(mine ? '#ffffff' : INK).text(String(p.plot_no), x + 2, yy + 8, { width: cw - 4, align: 'center', lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(blk.plots.length / cols) * ch + 6;
    doc.font('Helvetica').fontSize(8).fillColor(SOFT).text(`Dark box: your plot (${l.plot_no}). Grey: other allotted plots. Plots in number order, schematic and not to scale${blk.total > blk.plots.length ? `; ${blk.plots.length} of ${blk.total} plots in this block shown` : ''}.`, M, y, { width: W });
    y = doc.y + 16;
  }
  if (data.plan) {
    const s = data.plan;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Payment plan (as agreed at booking)', M, y); y = doc.y + 6;
    const rows = [['Total price', moneyText(s.sale_price)], ['Discount', s.discount ? moneyText(s.discount) : ''], ['Net price', moneyText(s.net_price)],
      ['Booking / down payment', moneyText(s.booking_amount + (s.advance_amount || 0))],
      ['Installments', s.num_installments ? `${s.num_installments} × ${moneyText(s.installment_amount)}` : ''],
      ['Balloon payments', s.balloon_count ? `${s.balloon_count} × ${moneyText(s.balloon_amount)}, every ${s.balloon_interval} months` : ''],
      ['First due', dmy(s.first_due)], ['Last due', dmy(s.final_due)], ['Booking date', dmy(s.sale_date)]].filter(([, v]) => v);
    y = grid(doc, rows, y) + 8;
    doc.font('Helvetica').fontSize(8).fillColor(SOFT).text('These are the agreed terms, not a statement of payments made. Ask for your account statement or see the customer portal for amounts paid and due.', M, y, { width: W });
  }
}

/** One or more letters as a single A4 PDF: English letter, Urdu page and annexure (as each letter was issued). */
export async function sendLettersPdf(res, letters, urlOf, filename) {
  const b = brand();
  const doc = new PDFDocument({ size: 'A4', margin: M, autoFirstPage: false, info: { Title: letters.length === 1 ? `Allotment letter ${letters[0].letter_no}` : `Allotment letters (${letters.length})`, Author: b.name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  doc.pipe(res);
  for (const l of letters) {
    const url = urlOf(l);
    const qr = l.status === 'issued' ? await letterQrPng(url) : null;
    const data = await annexData(l);
    const pages = [['Allotment letter', () => englishPage(doc, l, b, qr, url)]];
    if (l.include_urdu) pages.push(['Urdu', () => urduPage(doc, l, b, qr, url)]);
    if (data.plan || data.sitePlan || data.block) pages.push(['Annexure', () => annexPage(doc, l, b, data)]);
    pages.forEach(([name, draw], i) => {
      doc.addPage();
      draw();
      footer(doc, l, b, `${name} · page ${i + 1} of ${pages.length}`);
      if (l.status === 'cancelled') cancelledMark(doc);
    });
  }
  if (!letters.length) { doc.addPage(); doc.font('Helvetica').fontSize(11).text('No letters.', M, M); }
  doc.end();
}
export const sendLetterPdf = (res, l, url) => sendLettersPdf(res, [l], () => url, `allotment-letter-${l.letter_no}`);
