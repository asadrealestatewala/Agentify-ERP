// The hosted enquiry form: a page a customer's website shows in an iframe (or through one <script> tag). No key is on their
// page. The form posts to the publishable-key endpoint of /api/v1, and may only be framed by the sites on its allow-list.
import { Router } from 'express';
import { getSetting } from '../db.js';
import { formByKey } from '../services/formKeys.js';
import { liveConfig } from '../services/siteRelease.js';

const r = Router();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? v : d);
const notFound = (res) => res.status(404).type('text/plain').send('This form does not exist or was switched off.');

r.use((req, res, next) => (req.tenant || !process.env.ERP_BASE_DOMAIN ? next() : notFound(res)));

// the script a website includes: it adds the iframe right after itself and keeps it as tall as the form
const LOADER = `(function(){var s=document.currentScript;if(!s)return;var key=s.getAttribute('data-form');if(!key)return;
var origin=new URL(s.src,location.href).origin;var f=document.createElement('iframe');
f.src=origin+'/embed/form/'+encodeURIComponent(key)+'?p='+encodeURIComponent(location.href)+'&r='+encodeURIComponent(document.referrer);
f.title=s.getAttribute('data-title')||'Enquiry form';f.loading='lazy';f.style.cssText='width:100%;border:0;min-height:460px;display:block';
s.parentNode.insertBefore(f,s.nextSibling);
window.addEventListener('message',function(e){if(e.origin!==origin||e.source!==f.contentWindow||!e.data||e.data.type!=='agentify-form-height')return;
f.style.height=Math.min(2400,Math.max(200,Number(e.data.height)||460))+'px';});})();`;
r.get('/agentify-form.js', (_req, res) => res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' }).send(LOADER));

// the form's own behaviour (an external file because the page allows no inline scripts)
const FORM_JS = `(function(){var f=document.getElementById('f');if(!f)return;var msg=document.getElementById('msg');var btn=f.querySelector('button');
function tell(){try{parent.postMessage({type:'agentify-form-height',height:document.documentElement.scrollHeight},'*');}catch(e){}}
tell();addEventListener('load',tell);addEventListener('resize',tell);
f.addEventListener('submit',function(e){e.preventDefault();msg.className='';msg.textContent='';btn.disabled=true;
var d={name:f.name.value,email:f.email.value,phone:f.phone.value,message:f.message?f.message.value:'',website:f.website.value,enquiry_type:'inquiry',
source:{page_url:f.page_url.value,referrer:f.referrer.value}};
if(f.consent){d.consent={privacy:f.consent.checked,marketing:false,text:f.consent_text.value,at:new Date().toISOString()};}
fetch('/api/v1/forms/'+encodeURIComponent(f.dataset.key)+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
.then(function(x){if(x.ok){f.reset();f.hidden=true;msg.className='ok';msg.textContent=f.dataset.thanks;}else{msg.className='err';msg.textContent=(x.j&&x.j.error&&x.j.error.message)||'Something went wrong. Please try again.';}btn.disabled=false;tell();})
.catch(function(){msg.className='err';msg.textContent='Could not send. Check your connection and try again.';btn.disabled=false;tell();});});})();`;
r.get('/form.js', (_req, res) => res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).send(FORM_JS));

r.get('/form/:key', (req, res) => {
  const form = formByKey(req.params.key);
  if (!form) return notFound(res);
  const theme = liveConfig().theme || {};
  const brand = hex(theme.primary, '#0e7c6b');
  const company = getSetting('company_name', '');
  const url = (v) => (/^https?:\/\/[^\s"<>]{1,500}$/i.test(String(v || '')) ? String(v) : '');
  const ancestors = ["'self'", ...form.origins].join(' ');
  res.set({
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  });
  res.removeHeader('X-Frame-Options'); // frame-ancestors above is the rule
  const label = (id, text, extra = '') => `<label for="${id}">${text}${extra}</label>`;
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(form.title || form.name)}</title>
<style>*{box-sizing:border-box}body{margin:0;padding:16px;font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;background:transparent}
h1{font-size:20px;margin:0 0 12px}form{display:grid;gap:12px}label{display:block;font-size:14px;font-weight:600;margin-bottom:4px}
input,textarea{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:#fff;color:inherit}input:focus,textarea:focus{outline:2px solid ${brand};outline-offset:1px;border-color:${brand}}
textarea{min-height:96px;resize:vertical}.check{display:flex;gap:8px;align-items:flex-start;font-size:14px}.check input{width:auto;margin-top:3px}.check label{font-weight:400;margin:0}
button{padding:12px 18px;border:0;border-radius:8px;background:${brand};color:#fff;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
#msg{margin-top:12px;font-size:15px}#msg.ok{color:#166534}#msg.err{color:#b91c1c}.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.by{margin-top:12px;font-size:12px;color:#64748b}</style></head><body>
<h1>${esc(form.title || (company ? `Contact ${company}` : 'Contact us'))}</h1>
<form id="f" data-key="${esc(form.form_key)}" data-thanks="Thank you. We have your details and will be in touch soon." novalidate>
<div>${label('name', 'Your name', ' *')}<input id="name" name="name" autocomplete="name" required maxlength="120"></div>
<div>${label('email', 'Email')}<input id="email" name="email" type="email" autocomplete="email" maxlength="120"></div>
<div>${label('phone', 'Phone')}<input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="30"></div>
<div>${label('message', 'Message')}<textarea id="message" name="message" maxlength="2000"></textarea></div>
<div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
<input type="hidden" name="page_url" value="${esc(url(req.query.p))}"><input type="hidden" name="referrer" value="${esc(url(req.query.r))}">
${form.consent_text ? `<div class="check"><input id="consent" name="consent" type="checkbox" required><label for="consent">${esc(form.consent_text)}</label><input type="hidden" name="consent_text" value="${esc(form.consent_text)}"></div>` : ''}
<button type="submit">${esc(form.button || 'Send enquiry')}</button></form><div id="msg" role="status" aria-live="polite"></div>
<script src="/embed/form.js"></script></body></html>`);
});

export default r;
