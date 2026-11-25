// Allotment letters for housing projects: one letter per sold plot, printed on the workspace's own letterhead with a QR code
// that opens a public verification page on the workspace's own address. The letter keeps a copy of what it states
// (a printed letter must not change when the customer record is edited later); the verification page shows only that copy,
// never CNIC, phone, e-mail or payment figures. Links carry a random token, never the sequential letter id.
import crypto from 'node:crypto';
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { all, get, nextNo, run, tx } from '../db.js';
import { bad, notFound, now, today } from '../util.js';
import { brand } from './pdf.js';
import { workspaceUrl } from './siteHost.js';
import { isMultiTenant, LEGACY_SLUG } from '../platform.js';

export { ALLOTMENT_SCHEMA } from '../allotmentSchema.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dmy = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}-${MON[Number(m[2]) - 1]}-${m[1]}` : ''; };
const clean = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const uniq = (xs) => xs.map((x) => clean(x)).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
const sizeText = (l) => {
  const area = l.area_size ? `${String(Number(l.area_size))} ${l.area_unit || ''}`.trim() : '';
  return [l.dimensions ? `(${l.dimensions})` : '', area].filter(Boolean).join(' ');
};

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
  };
}

export const lettersForSale = (saleId) => all(`SELECT l.*, u.name issued_by_name FROM allotment_letters l LEFT JOIN users u ON u.id=l.issued_by WHERE l.sale_id=? ORDER BY l.id DESC`, saleId);
export const letterById = (id) => get(`SELECT l.*, u.name issued_by_name FROM allotment_letters l LEFT JOIN users u ON u.id=l.issued_by WHERE l.id=?`, id);

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
    const id = Number(run(`INSERT INTO allotment_letters(letter_no,token,sale_id,contact_id,property_id,issue_date,customer_name,relation,customer_address,plot_no,block,project_name,plot_location,property_type,area_size,area_unit,dimensions,note,issued_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, letterNo, token, saleId, s.contact_id, s.property_id, l.issue_date, l.customer_name, l.relation || null, l.customer_address,
    l.plot_no, l.block || null, l.project_name || null, l.plot_location, l.property_type || null, l.area_size, l.area_unit || null, l.dimensions || null, l.note || null, user?.id ?? null, now()).lastInsertRowid);
    // fill gaps on the records so the next document has them too; never overwrite what is already there
    if (l.dimensions) run("UPDATE properties SET dimensions=? WHERE id=? AND (dimensions IS NULL OR dimensions='')", l.dimensions, s.property_id);
    if (b.save_address) run("UPDATE contacts SET address=? WHERE id=? AND (address IS NULL OR address='')", l.customer_address, s.contact_id);
    return { id, replaced: old.length };
  });
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

/** What the public verification page shows: the letter's own copy only, no CNIC, phone, e-mail, price or payments. */
export function publicLetter(token) {
  if (!/^[\w-]{20,40}$/.test(String(token || ''))) return null;
  const l = get('SELECT * FROM allotment_letters WHERE token=?', token);
  if (!l) return null;
  const b = brand();
  const v = validity(l);
  return {
    ...v, company: { name: b.name, address: b.address || null, phone: b.phone || null, website: b.website || null, has_logo: !!b.logo },
    letter_no: l.letter_no, issue_date: l.issue_date, customer_name: l.customer_name,
    plot_no: l.plot_no, block: l.block, project_name: l.project_name, plot_location: l.plot_location, property_type: l.property_type,
    area: sizeText(l) || null, checked_at: now(),
  };
}
/** The workspace logo for the verification page (read from the letterhead settings). */
export const brandLogoPath = () => { const lp = brand().logo; return lp && fs.existsSync(lp) ? lp : null; };

export async function letterQrPng(url) {
  return QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, scale: 8, type: 'png', color: { dark: '#111111', light: '#ffffff' } });
}

/**
 * The letter as an A4 PDF in the style of a company letter: letterhead with the workspace logo, title, date and reference,
 * a certificate paragraph, a plot schedule, the QR code to verify it, and space for signature and stamp.
 */
export async function sendLetterPdf(res, l, url) {
  const b = brand();
  const qr = l.status === 'issued' ? await letterQrPng(url) : null;
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Allotment letter ${l.letter_no}`, Author: b.name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="allotment-letter-${l.letter_no}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  doc.pipe(res);
  const INK = '#111111', SOFT = '#555555', RULE = '#999999';
  const M = 50, W = doc.page.width - M * 2;

  // letterhead: logo left, company name and contact lines beside it, date and reference on the right
  let y = 44;
  if (b.logo) { try { doc.image(b.logo, M, y, { fit: [96, 72] }); } catch { /* unsupported image */ } }
  const tx0 = b.logo ? M + 108 : M;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(b.name, tx0, y + 4, { width: W - (tx0 - M) - 150 });
  const contact = [b.address, [b.phone, b.email, b.website].filter(Boolean).join('  |  ')].filter(Boolean).join('\n');
  if (contact) doc.font('Helvetica').fontSize(8.5).fillColor(SOFT).text(contact, tx0, doc.y + 2, { width: W - (tx0 - M) - 150 });
  const leftBottom = Math.max(doc.y, y + (b.logo ? 72 : 36));
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  doc.text(`Date: ${dmy(l.issue_date)}`, M + W - 145, y + 6, { width: 145, align: 'right' });
  doc.text(`Ref No.: ${l.letter_no}`, M + W - 145, doc.y + 4, { width: 145, align: 'right' });
  y = leftBottom + 10;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1.2).strokeColor(INK).stroke();
  doc.moveTo(M, y + 3).lineTo(M + W, y + 3).lineWidth(0.4).strokeColor(RULE).stroke();

  // title
  y += 22;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text('ALLOTMENT LETTER', M, y, { width: W, align: 'center', underline: true });
  y = doc.y + 18;

  // addressee
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('To,', M, y);
  doc.font('Helvetica-Bold').text(l.customer_name, M, doc.y + 2);
  if (l.relation) doc.font('Helvetica').text(l.relation);
  doc.font('Helvetica').text(l.customer_address, { width: W * 0.65 });
  y = doc.y + 14;

  const plot = [`Plot No. ${l.plot_no}`, l.block && `Block ${l.block}`].filter(Boolean).join(', ');
  doc.font('Helvetica-Bold').fontSize(10.5).text(`Subject: Allotment of ${plot}${l.project_name ? `, ${l.project_name}` : ''}`, M, y, { width: W, underline: true });
  y = doc.y + 12;

  // certificate paragraph with the key facts in bold
  const size = sizeText(l);
  const runs = [
    ['This is to certify that ', false], [l.customer_name, true], [l.relation ? `, ${l.relation}` : '', false], [', resident of ', false], [l.customer_address, true],
    [', has been allotted ', false], [plot, true], [l.property_type && !/^plot$/i.test(l.property_type) ? ` (${l.property_type})` : '', false], [', situated at ', false], [l.plot_location, true],
    [size ? ', with a property area of ' : '', false], [size, true], ['.', false],
  ].filter(([t]) => t);
  doc.fontSize(10.5).fillColor(INK);
  runs.forEach(([t, bold], i) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
    if (i === 0) doc.text(t, M, y, { width: W, lineGap: 3, continued: runs.length > 1 });
    else doc.text(t, { continued: i < runs.length - 1 });
  });
  doc.moveDown(0.8);
  doc.font('Helvetica').text(`This allotment is subject to the payment of all dues under the agreed payment plan and to the terms and conditions of ${b.name}.`, M, doc.y, { width: W, lineGap: 3, align: 'justify' });
  if (l.note) { doc.moveDown(0.6); doc.text(l.note, M, doc.y, { width: W, lineGap: 3, align: 'justify' }); }
  doc.moveDown(1);

  // plot schedule
  const rows = [['Plot No.', l.plot_no], ['Block', l.block], ['Project / society', l.project_name], ['Type', l.property_type],
    ['Dimensions', l.dimensions], ['Area', l.area_size ? `${String(Number(l.area_size))} ${l.area_unit || ''}`.trim() : '']].filter(([, v]) => v);
  rows.push(['Location', l.plot_location]);
  let ty = doc.y;
  const cw = W / 2, lw = 92;
  for (let i = 0; i < rows.length;) {
    const wide = rows[i][0] === 'Location'; // the location gets the full width
    const cells = wide ? [rows[i]] : rows.slice(i, i + 2).filter(([k]) => k !== 'Location');
    doc.font('Helvetica-Bold').fontSize(9.5);
    const vw = (wide ? W : cw) - lw - 12;
    const h = Math.max(19, ...cells.map(([, v]) => doc.heightOfString(String(v), { width: vw }) + 8));
    cells.forEach(([k, v], ci) => {
      const x = M + ci * cw, w = wide ? W : cw;
      doc.rect(x, ty, w, h).fillAndStroke(ci % 2 ? '#ffffff' : '#f5f5f5', '#bbbbbb');
      doc.fillColor(SOFT).font('Helvetica').fontSize(9).text(k, x + 6, ty + 5, { width: lw - 6 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(String(v), x + lw, ty + 5, { width: vw });
    });
    ty += h; i += cells.length;
  }
  doc.y = ty + 16;
  doc.font('Helvetica').fontSize(10.5).fillColor(INK).text('Yours truly,', M, doc.y);
  doc.moveDown(0.3).text('For,').font('Helvetica-Bold').text(b.name);

  // bottom band: QR on the left, signature and stamp on the right
  doc.page.margins.bottom = 0; // the band and footer sit in the bottom margin; never spill onto a second page
  const fy = doc.page.height - 50 - 10;
  const bandTop = Math.max(doc.y + 16, fy - 150);
  const qs = 104;
  if (qr) {
    doc.image(qr, M, bandTop, { width: qs, height: qs });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('Scan to verify this letter', M, bandTop + qs + 4, { width: 160 });
    doc.font('Helvetica').fontSize(7).fillColor(SOFT).text(url.replace(/^https?:\/\//, '').replace(/\/verify\/.*/, ''), M, doc.y + 1, { width: 160 });
  } else {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#b42318').text('CANCELLED', M, bandTop + 30, { width: 180 });
  }
  const sx = M + W - 300;
  doc.circle(sx + 60, bandTop + 48, 44).lineWidth(0.6).dash(3, { space: 3 }).strokeColor(RULE).stroke().undash();
  doc.font('Helvetica').fontSize(8).fillColor(SOFT).text('Company stamp', sx + 16, bandTop + 44, { width: 88, align: 'center' });
  doc.moveTo(sx + 140, bandTop + 82).lineTo(sx + 300, bandTop + 82).lineWidth(0.7).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(SOFT).text('Authorised signatory', sx + 140, bandTop + 86, { width: 160, align: 'center' });

  doc.moveTo(M, fy - 4).lineTo(M + W, fy - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  doc.font('Helvetica').fontSize(7).fillColor(SOFT).text(b.footer || `${l.letter_no} · Issued ${dmy(l.issue_date)} · Verify online by scanning the QR code`, M, fy, { width: W, align: 'center', lineBreak: false });
  if (l.status === 'cancelled') {
    doc.save(); doc.rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.fillOpacity(0.1).fillColor('#dc2626').font('Helvetica-Bold').fontSize(110).text('CANCELLED', 0, doc.page.height / 2 - 55, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.restore();
  }
  doc.end();
}
