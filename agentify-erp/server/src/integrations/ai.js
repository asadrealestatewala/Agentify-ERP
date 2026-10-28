// OpenAI and Anthropic (Claude) for a workspace. The workspace owner pays for and owns the API key; it is stored encrypted
// and never shown again. Uses: answering data questions with tools (read-only, scoped to what the signed-in user may see),
// writing promotional video scripts, and turning call and meeting recordings into transcripts (OpenAI speech to text).
// A provider is "connected" only after a real request to it succeeded. Language models do not make video: they write the
// script and captions, and the app renders the video from the listing's own photos.
import { bad } from '../util.js';
import { assertPublicHttps } from '../services/integrations.js';
import { saveIntegration, integrationConfig, integrationRow, markTested, mask } from './store.js';

export const AI_PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', key_url: 'https://console.anthropic.com/settings/keys', default_model: 'claude-sonnet-5-5', key_hint: 'Starts with sk-ant-' },
  openai: { label: 'ChatGPT (OpenAI)', key_url: 'https://platform.openai.com/api-keys', default_model: 'gpt-4o', key_hint: 'Starts with sk-' },
  gemini: { label: 'Gemini (Google)', key_url: 'https://aistudio.google.com/apikey', default_model: 'gemini-2.5-flash', key_hint: 'Starts with AIza or AQ.' },
  custom: { label: 'Other model (OpenAI-compatible)', custom: true, key_url: 'https://openrouter.ai/keys', default_model: '', key_hint: 'Works with Groq, Mistral, DeepSeek, OpenRouter, Together, Azure OpenAI and any service that offers an OpenAI-compatible API' },
};
const KEY_RE = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,}$/, openai: /^sk-[A-Za-z0-9_-]{20,}$/, gemini: /^(AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9._-]{20,})$/, custom: /^\S{8,400}$/ };
const oaBase = (provider, cfg) => (provider === 'custom' ? cfg.base_url : 'https://api.openai.com/v1');
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const gHeaders = (key) => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json' });
/** Gemini accepts a subset of JSON Schema: drop the keywords it rejects. */
const gSchema = (s) => (Array.isArray(s) ? s.map(gSchema) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([k]) => !['additionalProperties', '$schema'].includes(k)).map(([k, v]) => [k, gSchema(v)])) : s);
const slot = (p) => `ai_${p}`;
/** Usage metering hook (services/aiUsage.js registers it); called with every model response so token counts can be recorded. */
let usageSink = null;
export const setUsageSink = (fn) => { usageSink = fn; };
const metered = (provider, model, d, purpose) => { try { usageSink?.({ provider, model, d, purpose }); } catch { /* metering never breaks a call */ } return d; };

async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 60_000) });
  let d = null; try { d = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new Error(d?.error?.message || d?.message || `The provider answered ${res.status}`);
  return d;
}

export async function testAi(provider, key) {
  if (provider === 'openai') { const d = await http('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, timeout: 15_000 }); return { models: (d.data || []).length }; }
  if (provider === 'gemini') { const d = await http(`${GEMINI}/models?pageSize=5`, { headers: { 'x-goog-api-key': key }, timeout: 15_000 }); return { models: (d.models || []).length }; }
  const d = await http('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 15_000 });
  return { models: (d.data || []).length };
}
export async function connectAi(provider, body, userId) {
  if (!AI_PROVIDERS[provider]) throw bad('Unknown provider');
  const prev = integrationConfig(slot(provider));
  const key = !body.api_key || /^•/.test(body.api_key) ? prev?.api_key : String(body.api_key).trim();
  if (!key || !KEY_RE[provider].test(key)) throw bad(`Paste the API key from your ${AI_PROVIDERS[provider].label} account. ${AI_PROVIDERS[provider].key_hint}.`);
  if (provider === 'custom') {
    // any OpenAI-compatible service: address and model are needed, and the test is a real tiny chat request
    const base = String(await assertPublicHttps(body.base_url || prev?.base_url || '')).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const model = String(body.model || prev?.model || '').trim().slice(0, 100);
    if (!model) throw bad('Enter the model name to use, for example llama-3.3-70b-versatile.');
    try { await http(`${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }), timeout: 30_000 }); } catch (e) { throw bad(`That service did not accept the key or model: ${e.message}`); }
    saveIntegration(slot(provider), { api_key: key, model, base_url: base }, { publicInfo: { key: mask(key), model, host: new URL(base).host }, status: 'connected', userId });
    markTested(slot(provider), true);
    return;
  }
  try { await testAi(provider, key); } catch (e) { throw bad(`${AI_PROVIDERS[provider].label} did not accept this key: ${e.message}`); }
  const model = String(body.model || prev?.model || AI_PROVIDERS[provider].default_model).trim().slice(0, 80);
  saveIntegration(slot(provider), { api_key: key, model }, { publicInfo: { key: mask(key), model }, status: 'connected', userId });
  markTested(slot(provider), true);
}
export const aiStatus = (provider) => { const r = integrationRow(slot(provider)); return r ? { status: r.status, ...(JSON.parse(r.public_info || '{}')) } : null; };
export const aiConfig = (provider) => integrationConfig(slot(provider));
/** The provider to use: the one the owner picked as default, else whichever is connected (Claude first). */
export function activeProvider(preferred) {
  const order = preferred && aiConfig(preferred) ? [preferred, 'anthropic', 'openai', 'gemini', 'custom'] : ['anthropic', 'openai', 'gemini', 'custom'];
  return order.find((p) => aiConfig(p)) || null;
}
/** Speech to text works with an OpenAI or a Gemini key (Claude has no audio input). */
export const canTranscribe = () => !!(aiConfig('openai') || aiConfig('gemini'));

// ---- chat with tools (one loop for both providers)
/** tools: [{ name, description, parameters (JSON schema), run: async (args) => object }] */
export async function runWithTools(provider, { system, question, history = [], tools = [], maxRounds = 5 }) {
  const cfg = aiConfig(provider);
  if (!cfg) throw bad('Connect an AI provider first.');
  const called = [];
  if (provider === 'anthropic') {
    const messages = [...history, { role: 'user', content: question }];
    for (let round = 0; round < maxRounds; round += 1) {
      const d = metered('anthropic', cfg.model, await http('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': cfg.api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1500, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }) }), 'workspace_assistant');
      const uses = (d.content || []).filter((b) => b.type === 'tool_use');
      if (d.stop_reason !== 'tool_use' || !uses.length) return { answer: (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), tools_used: called };
      messages.push({ role: 'assistant', content: d.content });
      const results = [];
      for (const u of uses) {
        const tool = tools.find((t) => t.name === u.name);
        called.push(u.name);
        let out; try { out = tool ? await tool.run(u.input || {}) : { error: 'Unknown tool' }; } catch (e) { out = { error: e.message }; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 12_000) });
      }
      messages.push({ role: 'user', content: results });
    }
    return { answer: 'I could not finish that analysis in a few steps. Try a narrower question.', tools_used: called };
  }
  if (provider === 'gemini') {
    const contents = [...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), { role: 'user', parts: [{ text: question }] }];
    for (let round = 0; round < maxRounds; round += 1) {
      const d = metered('gemini', cfg.model, await http(`${GEMINI}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: gHeaders(cfg.api_key),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, tools: tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: gSchema(t.parameters) })) }] : undefined }) }), 'workspace_assistant');
      const content = d.candidates?.[0]?.content;
      const calls = (content?.parts || []).filter((p) => p.functionCall);
      if (!calls.length) return { answer: (content?.parts || []).map((p) => p.text || '').join('').trim(), tools_used: called };
      contents.push(content);
      const responses = [];
      for (const { functionCall: fc } of calls) {
        const tool = tools.find((t) => t.name === fc.name);
        called.push(fc.name);
        let out; try { out = tool ? await tool.run(fc.args || {}) : { error: 'Unknown tool' }; } catch (e) { out = { error: e.message }; }
        const s = JSON.stringify(out);
        responses.push({ functionResponse: { name: fc.name, response: { result: s.length > 12_000 ? { truncated: s.slice(0, 12_000) } : out } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { answer: 'I could not finish that analysis in a few steps. Try a narrower question.', tools_used: called };
  }
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
  for (let round = 0; round < maxRounds; round += 1) {
    const d = metered(provider, cfg.model, await http(`${oaBase(provider, cfg)}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages, tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }) }), 'workspace_assistant');
    const m = d.choices?.[0]?.message;
    if (!m?.tool_calls?.length) return { answer: String(m?.content || '').trim(), tools_used: called };
    messages.push(m);
    for (const tc of m.tool_calls) {
      const tool = tools.find((t) => t.name === tc.function.name);
      called.push(tc.function.name);
      let out; try { out = tool ? await tool.run(JSON.parse(tc.function.arguments || '{}')) : { error: 'Unknown tool' }; } catch (e) { out = { error: e.message }; }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 12_000) });
    }
  }
  return { answer: 'I could not finish that analysis in a few steps. Try a narrower question.', tools_used: called };
}

/** One plain completion that must return JSON (used for video scripts). */
export async function completeJson(provider, { system, prompt, maxTokens = 1800, purpose = 'workspace_ai' }) {
  const cfg = aiConfig(provider);
  if (!cfg) throw bad('Connect an AI provider first.');
  let text;
  if (provider === 'anthropic') {
    const d = metered('anthropic', cfg.model, await http('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': cfg.api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }) }), purpose);
    text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } else if (provider === 'gemini') {
    const d = metered('gemini', cfg.model, await http(`${GEMINI}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: gHeaders(cfg.api_key), body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens } }) }), purpose);
    text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  } else {
    const d = metered(provider, cfg.model, await http(`${oaBase(provider, cfg)}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.model, ...(provider === 'custom' ? {} : { response_format: { type: 'json_object' } }),messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) }), purpose);
    text = d.choices?.[0]?.message?.content || '';
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The AI did not return a usable answer. Try again.');
  return JSON.parse(m[0]);
}

/** Speech to text (OpenAI). Claude has no audio input, so transcripts need an OpenAI key. */
export async function transcribe(buffer, filename = 'audio.mp3', language) {
  const cfg = aiConfig('openai');
  if (!cfg && aiConfig('gemini')) return transcribeGemini(buffer, filename, language);
  if (!cfg) throw new Error('Transcripts need a connected OpenAI (ChatGPT) or Gemini key.');
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  if (language) form.append('language', language);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${cfg.api_key}` }, body: form, signal: AbortSignal.timeout(180_000) });
  const text = await res.text();
  if (!res.ok) { let m = text; try { m = JSON.parse(text).error.message; } catch { /* plain */ } throw new Error(m || `OpenAI answered ${res.status}`); }
  return text.trim();
}

const AUDIO_MIME = { mp3: 'audio/mp3', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4' };
/** Speech to text with Gemini: the audio goes inline, so it is limited to about 18 MB. */
async function transcribeGemini(buffer, filename, language) {
  const cfg = aiConfig('gemini');
  if (buffer.length > 18 * 1024 * 1024) throw new Error('This recording is too large to transcribe with Gemini (18 MB limit).');
  const mime = AUDIO_MIME[String(filename).split('.').pop().toLowerCase()] || 'audio/mp3';
  const d = await http(`${GEMINI}/models/${encodeURIComponent(cfg.model)}:generateContent`, { method: 'POST', headers: gHeaders(cfg.api_key), timeout: 180_000,
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `Transcribe this recording word for word${language ? ` in language code ${language}` : ''}. Label speakers as Speaker 1, Speaker 2 when you can tell them apart. Return only the transcript.` }, { inline_data: { mime_type: mime, data: buffer.toString('base64') } }] }] }) });
  const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no transcript.');
  return text;
}
