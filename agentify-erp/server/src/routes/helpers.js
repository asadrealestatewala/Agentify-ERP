import ExcelJS from 'exceljs';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, run, insert, update, uploadDir } from '../db.js';
import { keepContext } from '../context.js';
import { can } from '../rbac.js';
import { audit } from '../audit.js';
import { sendPdf } from '../services/pdf.js';
import { region } from '../util.js';
import { asyncH, bad, notFound, jparse, now } from '../util.js';

/** Generic list/get/create/update/delete for simple masters. */
export function crud(router, o) {
  const { table, module, cols, search = [], filters = [], json = [], orderBy = `${table}.id DESC`, label = table, select, required: req = [] } = o;
  const base = select || `SELECT ${table}.* FROM ${table}`;
  const parse = (row) => {
    if (!row) return row;
    for (const k of json) if (typeof row[k] === 'string') row[k] = jparse(row[k], k === 'tags' ? [] : {});
    return row;
  };
  router.get('/', can(module, 'view'), asyncH((r, res) => {
    const where = [o.baseWhere || '1=1'], params = [];
    if (r.query.q && search.length) { where.push(`(${search.map((s) => `${s} LIKE ?`).join(' OR ')})`); params.push(...search.map(() => `%${r.query.q}%`)); }
    for (const f of filters) if (r.query[f] !== undefined && r.query[f] !== '') { where.push(`${table}.${f} = ?`); params.push(r.query[f]); }
    if (o.scope) { const s = o.scope(r); if (s) { where.push(s.sql); params.push(...s.params); } }
    const limit = Math.min(Number(r.query.limit) || 50, 1000), page = Math.max(Number(r.query.page) || 1, 1);
    const total = get(`SELECT COUNT(*) n FROM (${base} WHERE ${where.join(' AND ')})`, ...params).n;
    const rows = all(`${base} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit).map(parse);
    res.json({ rows, total, page, limit });
  }));
  router.get('/:id(\\d+)', can(module, 'view'), asyncH((r, res) => {
    const row = get(`${base} WHERE ${table}.id=?`, r.params.id);
    if (!row) throw notFound();
    res.json(parse(row));
  }));
  router.post('/', can(module, 'create'), asyncH((r, res) => {
    const data = { ...r.body };
    for (const k of req) if (data[k] === undefined || data[k] === null || data[k] === '') throw bad(`${k.replace(/_/g, ' ')} is required`);
    for (const k of json) if (data[k] !== undefined && typeof data[k] !== 'string') data[k] = JSON.stringify(data[k]);
    if (o.before) o.before(data, r, null);
    if (cols.includes('created_at')) data.created_at = now();
    const id = insert(table, data, cols);
    if (o.after) o.after(id, r, null);
    audit(r, `Created ${label}`, table, id, data.name || data.title || data.value);
    res.status(201).json(parse(get(`${base} WHERE ${table}.id=?`, id)));
  }));
  router.put('/:id(\\d+)', can(module, 'edit'), asyncH((r, res) => {
    const existing = get(`SELECT * FROM ${table} WHERE id=?`, r.params.id);
    if (!existing) throw notFound();
    const data = { ...r.body };
    for (const k of json) if (data[k] !== undefined && typeof data[k] !== 'string') data[k] = JSON.stringify(data[k]);
    if (o.before) o.before(data, r, existing);
    update(table, existing.id, data, cols.filter((c) => c !== 'created_at'));
    if (o.after) o.after(existing.id, r, existing);
    audit(r, `Edited ${label}`, table, existing.id, data.name || data.title || data.value);
    res.json(parse(get(`${base} WHERE ${table}.id=?`, existing.id)));
  }));
  router.delete('/:id(\\d+)', can(module, 'delete'), asyncH((r, res) => {
    const existing = get(`SELECT * FROM ${table} WHERE id=?`, r.params.id);
    if (!existing) throw notFound();
    if (o.canDelete) o.canDelete(existing);
    try { run(`DELETE FROM ${table} WHERE id=?`, existing.id); } catch (e) {
      if (/FOREIGN KEY/i.test(e.message)) throw bad('This record is in use by other records and cannot be deleted');
      throw e;
    }
    audit(r, `Deleted ${label}`, table, existing.id, existing.name || existing.title || existing.value);
    res.json({ ok: true });
  }));
}

const MONEY_KEY = /(price|amount|paid|outstanding|overdue|balance|debit|credit|value|budget|salary|net)$/i;
/** Spreadsheet and CSV amounts are written in major units (1234.56) for regions that store cents; Pakistan (whole rupees) is unchanged. */
function majorUnits(columns, rows) {
  const m = region().money;
  if (m.scale === 0) return { rows, moneyKeys: new Set() };
  const keys = new Set(columns.filter((c) => c.type === 'money' || MONEY_KEY.test(c.key)).map((c) => c.key));
  return { rows: rows.map((r) => ({ ...r, ...Object.fromEntries([...keys].filter((k) => typeof r[k] === 'number').map((k) => [k, m.toMajor(r[k])])) })), moneyKeys: keys };
}

/** Send rows as xlsx / csv / json. columns: [{key,label}] */
export async function sendTable(res, format, name, columns, rows, opts = {}) {
  if (format === 'pdf') {
    const title = opts.title || name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return sendPdf(res, name, { title, subtitle: opts.subtitle, summary: opts.summary, columns, rows, totals: opts.totals });
  }
  if (format === 'xlsx' || format === 'csv') { const x = majorUnits(columns, rows); rows = x.rows; opts = { ...opts, moneyKeys: x.moneyKeys }; }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(name.slice(0, 30));
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
    ws.getRow(1).font = { bold: true };
    if (opts.moneyKeys?.size) { const fmt = `#,##0.${'0'.repeat(region().money.scale)}`; for (const k of opts.moneyKeys) ws.getColumn(k).numFmt = fmt; }
    rows.forEach((r) => ws.addRow(Object.fromEntries(columns.map((c) => [c.key, r[c.key]]))));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  if (format === 'csv') {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const out = '﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(out);
  }
  return res.json({ columns, rows });
}

const ALLOWED = {
  documents: new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx']),
  media: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.pdf']),
  image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']),
};
const MIME_OK = /^(application\/pdf|image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel|octet-stream))$/;

// The first bytes of each image format we accept: the extension and the browser's type claim alone can be faked.
const IMAGE_MAGIC = { '.jpg': [[0xff, 0xd8, 0xff]], '.jpeg': [[0xff, 0xd8, 0xff]], '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], '.gif': [[0x47, 0x49, 0x46, 0x38]], '.webp': [[0x52, 0x49, 0x46, 0x46]] };
function looksLikeImage(file) {
  const ext = path.extname(file.filename || file.originalname || '').toLowerCase();
  const sigs = IMAGE_MAGIC[ext]; if (!sigs) return false;
  let head;
  try { const fd = fs.openSync(file.path, 'r'); head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd); } catch { return false; }
  if (ext === '.webp' && head.toString('latin1', 8, 12) !== 'WEBP') return false;
  return sigs.some((sig) => sig.every((b, i) => head[i] === b));
}
/** After an image upload: every file must really be an image of its extension, or all of them are removed and refused. */
function checkImages(req) {
  const files = [...(req.file ? [req.file] : []), ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())];
  const badOne = files.find((f) => !looksLikeImage(f));
  if (!badOne) return undefined;
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
  return bad(`This file is not a valid image: ${badOne.originalname}`);
}

/** Validated multipart upload into uploads/<dir>. Random filenames — originals never touch the disk path. */
export function uploader(dir, kind = 'documents', maxMb = 25) {
  const m = multer({
    storage: multer.diskStorage({
      // resolved per request: every tenant uploads into its own folder
      destination: (_r, _f, cb) => { const target = path.join(uploadDir(), dir); fs.mkdir(target, { recursive: true }, (e) => cb(e, target)); },
      filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase()),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 20 },
    fileFilter: (_r, f, cb) => {
      const ext = path.extname(f.originalname).toLowerCase();
      if (!ALLOWED[kind].has(ext) || !MIME_OK.test(f.mimetype)) return cb(bad(`File type not allowed: ${f.originalname}`));
      cb(null, true);
    },
  });
  // multer finishes from stream events, outside the request's tenant context; restore it for the route handler
  const wrap = (mw) => (req, res, next) => mw(req, res, keepContext((err) => (err || kind !== 'image' ? next(err) : next(checkImages(req)))));
  return { single: (f) => wrap(m.single(f)), array: (f, n) => wrap(m.array(f, n)), fields: (f) => wrap(m.fields(f)), any: () => wrap(m.any()), none: () => wrap(m.none()) };
}
