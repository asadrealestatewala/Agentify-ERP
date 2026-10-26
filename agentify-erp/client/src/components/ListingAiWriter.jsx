// AI writer inside the property editor: title ideas, short and full descriptions, and rewriting selected text. The server builds the
// prompt from the listing's own facts and the workspace's AI key. Results are editable previews: nothing changes in the form until
// the person presses a button, and nothing is saved or published from here (the form's own Save does that).
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Drawer, Field, Select, Spinner } from './ui.jsx';
import { api } from '../api.js';
import { getLanguage, t } from '../i18n.js';
import { useToast } from '../context.jsx';

const labels = () => ({ title: t('ai_writer.field_title', 'title'), short_desc: t('ai_writer.field_short', 'short description'), description: t('ai_writer.field_full', 'full description') });
const LANG_FALLBACK = { en: 'English', ur: 'Urdu', ar: 'Arabic', fr: 'French' };
const isRtl = (lang) => ['ar', 'ur'].includes(lang);

function Warnings({ items }) {
  if (!items?.length) return null;
  return <div className="alert warn" style={{ marginTop: 6 }}>{items.map((w) => <div key={w.kind + w.message}>{w.message}</div>)}</div>;
}

/** Text the person can edit before applying. `dir` follows the chosen language so Arabic and Urdu read right to left. */
function Preview({ value, onChange, lang, rows = 3, single }) {
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  return single
    ? <input className="input" dir={dir} lang={lang} value={value} onChange={(e) => onChange(e.target.value)} />
    : <textarea className="textarea" dir={dir} lang={lang} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * mode: 'titles' | 'description' | 'rewrite'. form: the editor's unsaved values. selection: { field, start, end, text } for rewrite.
 * onApply(field, value, how) where how is 'replace' | 'append' | 'selection'.
 */
export default function ListingAiWriter({ mode: initialMode, form, propertyId, selection, current, onApply, onClose }) {
  const toast = useToast();
  const [mode, setMode] = useState(initialMode);
  const [opts, setOpts] = useState(null);
  const [language, setLanguage] = useState(['en', 'fr', 'ar', 'ur'].includes(getLanguage()) ? getLanguage() : 'en');
  const [tone, setTone] = useState('professional');
  const [goal, setGoal] = useState('improve');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => { api.get('/api/properties/ai-writer').then(setOpts).catch((e) => setError(e.message)); }, []);
  useEffect(() => { setResult(null); setError(null); }, [mode]);

  const generate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const body = { mode, language, tone, property_id: propertyId || undefined, form };
      if (mode === 'rewrite') Object.assign(body, { field: selection.field, text: selection.text, goal });
      const r = await api.post('/api/properties/ai-writer', body);
      // keep editable copies next to the server's warnings
      if (r.titles) r.titles = r.titles.map((x) => ({ ...x, edit: x.text }));
      if (r.short) { r.short.edit = r.short.text; r.full.edit = r.full.text; }
      if (r.text) r.text.edit = r.text.text;
      setResult(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const apply = (field, value, how = 'replace') => {
    const v = String(value || '').trim();
    if (!v) return toast(t('ai_writer.empty', 'There is no text to use'), 'err');
    if (onApply(field, v, how) !== false) toast(t('ai_writer.applied', 'Added to the form. Review it, then save. Publishing is not changed.'), 'ok');
  };
  const edit = (path, v) => setResult((r) => {
    const n = { ...r };
    if (path[0] === 'titles') n.titles = r.titles.map((x, i) => (i === path[1] ? { ...x, edit: v } : x));
    else n[path[0]] = { ...r[path[0]], edit: v };
    return n;
  });

  const LABEL = labels();
  const languages = opts?.languages || LANG_FALLBACK;
  const canRewrite = !!selection?.text;
  const rtl = isRtl(result?.language || language);
  const replaceLabel = (field) => (current?.[field] ? t('ai_writer.replace', 'Replace {field}', { field: LABEL[field] }) : t('ai_writer.use', 'Use as {field}', { field: LABEL[field] }));

  return (
    <Drawer title={t('ai_writer.heading', 'Write with AI')} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>{t('common.close', 'Close')}</button>
        <button className="btn primary" disabled={busy || !opts?.connected || (mode === 'rewrite' && !canRewrite)} onClick={generate}>{busy ? <Spinner /> : <Icon name="bolt" size={16} />} {result ? t('ai_writer.again', 'Write again') : t('ai_writer.generate', 'Write suggestions')}</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row wrap" role="tablist" style={{ gap: 6 }}>
          {[['titles', t('ai_writer.mode_titles', 'Title ideas')], ['description', t('ai_writer.mode_desc', 'Descriptions')], ['rewrite', t('ai_writer.mode_rewrite', 'Rewrite selection')]].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={`btn sm ${mode === k ? 'primary' : ''}`} onClick={() => setMode(k)}>{l}</button>))}
        </div>
        <div className="muted">{t('ai_writer.explain', 'Uses only the details in this form (type, location, size, price, features, amenities). Review every suggestion: you decide what goes on the listing.')}</div>
        {opts && !opts.connected && <div className="alert warn">{t('ai_writer.not_connected', 'No AI provider is connected for this workspace. An administrator can connect one in Settings > Integrations (AI). The key stays on the server.')}</div>}
        <div className="form-grid">
          <Field label={t('ai_writer.language', 'Language')}><Select allowEmpty={false} value={language} onChange={setLanguage} options={Object.entries(languages).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label={t('ai_writer.tone', 'Tone')}><Select allowEmpty={false} value={tone} onChange={setTone} options={Object.entries(opts?.tones || { professional: 'professional' }).map(([value, label]) => ({ value, label: label.split(',')[0] }))} /></Field>
          {mode === 'rewrite' && <Field label={t('ai_writer.goal', 'What to do')}><Select allowEmpty={false} value={goal} onChange={setGoal} options={Object.entries(opts?.goals || { improve: 'Improve the wording and flow' }).map(([value, label]) => ({ value, label }))} /></Field>}
        </div>
        {mode === 'rewrite' && (canRewrite
          ? <Field label={t('ai_writer.selected', 'Selected text from the {field}', { field: LABEL[selection.field] })}><div className="card" dir="auto" style={{ padding: 10, whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>{selection.text}</div></Field>
          : <div className="alert info">{t('ai_writer.select_first', 'Select some text in the title or a description field first, then open Rewrite selection.')}</div>)}
        {error && <div className="alert err" role="alert">{error}</div>}
        {busy && <div className="muted" aria-live="polite">{t('ai_writer.working', 'Writing…')}</div>}

        {result?.titles && result.titles.map((x, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <Preview single value={x.edit} onChange={(v) => edit(['titles', i], v)} lang={result.language} />
            <Warnings items={x.warnings} />
            <div className="row" style={{ marginTop: 8, justifyContent: rtl ? 'flex-start' : 'flex-end' }}><button className="btn sm" onClick={() => apply('title', x.edit)}>{replaceLabel('title')}</button></div>
          </div>))}
        {result?.short && [['short', 'short_desc', 2, t('ai_writer.short', 'Short description')], ['full', 'description', 9, t('ai_writer.full', 'Full description')]].map(([k, field, rows, label]) => (
          <div key={k} className="card" style={{ padding: 12 }}>
            <b>{label}</b>
            <Preview value={result[k].edit} onChange={(v) => edit([k], v)} lang={result.language} rows={rows} />
            <Warnings items={result[k].warnings} />
            <div className="row wrap" style={{ marginTop: 8, gap: 6, justifyContent: rtl ? 'flex-start' : 'flex-end' }}>
              {field === 'description' && current?.description && <button className="btn sm" onClick={() => apply(field, result[k].edit, 'append')}>{t('ai_writer.append', 'Add below current text')}</button>}
              <button className="btn sm" onClick={() => apply(field, result[k].edit)}>{replaceLabel(field)}</button>
            </div>
          </div>))}
        {result?.text && (
          <div className="card" style={{ padding: 12 }}>
            <b>{t('ai_writer.rewritten', 'Rewritten text')}</b>
            <Preview value={result.text.edit} onChange={(v) => edit(['text'], v)} lang={result.language} rows={result.field === 'description' ? 6 : 2} single={result.field === 'title'} />
            <Warnings items={result.text.warnings} />
            <div className="row" style={{ marginTop: 8, justifyContent: rtl ? 'flex-start' : 'flex-end' }}><button className="btn sm" onClick={() => apply(result.field, result.text.edit, 'selection')}>{t('ai_writer.replace_sel', 'Replace selected text')}</button></div>
          </div>)}
      </div>
    </Drawer>
  );
}
