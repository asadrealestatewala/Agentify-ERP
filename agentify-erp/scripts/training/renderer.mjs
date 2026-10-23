/**
 * The animation renderer for the training videos. This function is serialised and run INSIDE Chrome (page.evaluate), so it must not use anything
 * from outside itself. It draws a 1920x1080 animation on a canvas and records it together with the voice-over.
 *
 * spec = {
 *   title, kicker, tagline, logo (data URL, transparent logo), seconds (set here),
 *   segments: [ { kind: 'intro' | 'scene' | 'outro', wav (base64), phase, title, bullets[], sentences[], img (data URL), focus {x,y,w,h} (fractions) | null, call, url } ],
 *   phases: [ names ... ],  recap: [ ... ]
 * }
 * Returns { mime, seconds, chunks: [base64...] } (the video split into pieces so it can cross the browser boundary).
 */
export async function renderInPage(spec) {
  const W = 1920, H = 1080;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; document.body.appendChild(cv);
  const g = cv.getContext('2d', { alpha: false });
  const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const back = (t) => { t = clamp(t); const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const load = (src) => new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const font = (px, w = 600) => { g.font = `${w} ${px}px ${FONT}`; };
  const wrap = (text, x, y, maxW, lh, maxLines = 9, draw = true) => {
    const words = String(text).split(/\s+/); let line = '', n = 0;
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { if (draw) g.fillText(line, x, y + n * lh); n++; line = w; if (n >= maxLines) return n; } else line = t; }
    if (line) { if (draw) g.fillText(line, x, y + n * lh); n++; }
    return n;
  };

  // ---------------------------------------------------------------- audio: every segment's voice, placed one after another
  const ac = new AudioContext(); await ac.resume();
  const bufs = await Promise.all(spec.segments.map(async (s) => ac.decodeAudioData(Uint8Array.from(atob(s.wav), (c) => c.charCodeAt(0)).buffer)));
  const PAD = { intro: 0.55, scene: 0.65, outro: 0.9 };
  let at = 0; const segs = spec.segments.map((s, i) => { const dur = bufs[i].duration + PAD[s.kind]; const o = { ...s, start: at, dur, voice: bufs[i] }; at += dur; return o; });
  const TOTAL = at;
  const imgs = await Promise.all(segs.map((s) => load(s.img)));
  const logo = await load(spec.logo);
  const scenes = segs.filter((s) => s.kind === 'scene');
  const phaseNames = scenes.map((s) => s.phase);

  // ---------------------------------------------------------------- pre-drawn layers (cheap per frame)
  const mkLayer = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); fn(x, w, h); return c; };
  const glow = mkLayer(900, 900, (x) => { const gr = x.createRadialGradient(450, 450, 0, 450, 450, 450); gr.addColorStop(0, 'rgba(94,234,212,.30)'); gr.addColorStop(1, 'rgba(94,234,212,0)'); x.fillStyle = gr; x.fillRect(0, 0, 900, 900); });
  const bgBase = mkLayer(W, H, (x) => { const gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#071f1e'); gr.addColorStop(0.55, '#0b3b38'); gr.addColorStop(1, '#0f766e'); x.fillStyle = gr; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 1; for (let i = 0; i < W; i += 60) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); } for (let j = 0; j < H; j += 60) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); } });
  const shadow = (w, h) => mkLayer(w + 160, h + 160, (x) => { x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 50; x.shadowOffsetY = 22; x.fillStyle = '#000'; x.beginPath(); x.roundRect(80, 70, w, h, 18); x.fill(); });
  const WIN = { x: 70, y: 222, w: 1190, h: 740 }; const winShadow = shadow(WIN.w, WIN.h);

  const bg = (t) => {
    g.drawImage(bgBase, 0, 0);
    for (let i = 0; i < 4; i++) { const x = (i * 560 + 200 + Math.sin(t * 0.3 + i) * 90), y = 240 + (i % 2) * 520 + Math.cos(t * 0.25 + i * 2) * 70; g.globalAlpha = 0.9; g.drawImage(glow, x - 450, y - 450); }
    g.globalAlpha = 1;
  };
  const header = (t, e) => {
    g.globalAlpha = e;
    if (logo) { const k = 62 / logo.height; g.drawImage(logo, 64, 26, logo.width * k, 62); }
    g.fillStyle = 'rgba(255,255,255,.92)'; font(28, 650); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(spec.title, W - 64, 46);
    g.fillStyle = '#7fe3d2'; font(19, 600); g.fillText(spec.kicker.toUpperCase(), W - 64, 78);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.globalAlpha = 1;
  };
  /** One chip per phase of this video, so the viewer always knows which part they are in. */
  const tracker = (t, idx, lt, dur) => {
    const n = phaseNames.length, gap = 12, total = W - 128, cw = Math.min(300, (total - gap * (n - 1)) / n); const x0 = 64 + (total - (cw * n + gap * (n - 1))) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cw + gap), y = 118, h = 54, active = i === idx, done = i < idx;
      g.fillStyle = active ? '#14b8a6' : done ? 'rgba(20,184,166,.28)' : 'rgba(255,255,255,.08)'; rr(x, y, cw, h, 27); g.fill();
      if (active) { g.save(); rr(x, y, cw, h, 27); g.clip(); g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x, y, cw * clamp(lt / dur), h); g.restore(); }
      g.fillStyle = active ? '#052e2b' : '#fff'; g.beginPath(); g.arc(x + 27, y + 27, 17, 0, 7); g.fillStyle = active ? '#fff' : done ? '#14b8a6' : 'rgba(255,255,255,.18)'; g.fill();
      g.fillStyle = active ? '#052e2b' : done ? '#052e2b' : '#d7ece8'; font(20, 700); g.textAlign = 'center'; g.fillText(done ? '✓' : String(i + 1), x + 27, y + 34);
      g.textAlign = 'left'; g.fillStyle = active ? '#fff' : done ? '#bff3ea' : 'rgba(255,255,255,.65)'; font(21, active ? 700 : 600);
      let label = phaseNames[i]; while (g.measureText(label).width > cw - 74 && label.length > 4) label = label.slice(0, -2); if (label !== phaseNames[i]) label += '…';
      g.fillText(label, x + 56, y + 34);
    }
  };
  const caption = (s, lt) => {
    const sent = s.sentences, totalChars = sent.reduce((a, x) => a + x.length, 0) || 1, voiceDur = s.dur - PAD[s.kind]; let acc = 0, cur = sent[sent.length - 1];
    for (const x of sent) { acc += (x.length / totalChars) * voiceDur; if (lt < acc + 0.05) { cur = x; break; } }
    g.fillStyle = 'rgba(2,20,19,.78)'; rr(160, 986, W - 320, 74, 20); g.fill();
    g.fillStyle = '#fff'; font(31, 560); g.textAlign = 'center'; g.textBaseline = 'middle';
    let txt = cur; while (g.measureText(txt).width > W - 400 && txt.length > 10) { txt = txt.slice(0, -4) + '…'; } g.fillText(txt, W / 2, 1023); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  };

  // ---------------------------------------------------------------- the three kinds of segment
  const drawIntro = (s, lt) => {
    bg(lt);
    const a = easeOut(lt / 0.9), pop = back(lt / 0.9);
    if (logo) { const k = 190 / logo.height, w = logo.width * k, h = 190; g.save(); g.translate(W / 2, 330); g.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop); g.globalAlpha = a; g.shadowColor = 'rgba(94,234,212,.55)'; g.shadowBlur = 40; g.drawImage(logo, -w / 2, -h / 2, w, h); g.restore(); }
    g.globalAlpha = easeOut((lt - 0.5) / 0.8); g.textAlign = 'center'; g.fillStyle = '#7fe3d2'; font(28, 700); g.fillText(spec.kicker.toUpperCase(), W / 2, 520);
    g.fillStyle = '#fff'; font(96, 800); const words = spec.title.split(' '); let lines = [spec.title]; if (g.measureText(spec.title).width > 1500) { const half = Math.ceil(words.length / 2); lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')]; }
    lines.forEach((l, i) => g.fillText(l, W / 2, 625 + i * 104));
    g.globalAlpha = easeOut((lt - 1.1) / 0.8); g.fillStyle = 'rgba(255,255,255,.85)'; font(34, 500); g.fillText(spec.tagline, W / 2, 625 + lines.length * 104 + 20);
    // the phases that follow, as little chips
    const chips = phaseNames, y = 800; font(26, 650); const ws = chips.map((c) => g.measureText(c).width + 56), tot = ws.reduce((a, b) => a + b, 0) + 14 * (chips.length - 1); let x = W / 2 - tot / 2;
    chips.forEach((c, i) => { const p = easeOut((lt - 1.4 - i * 0.12) / 0.5); g.globalAlpha = p; g.fillStyle = 'rgba(255,255,255,.1)'; rr(x, y + (1 - p) * 20, ws[i], 56, 28); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(c, x + 28, y + 37 + (1 - p) * 20); x += ws[i] + 14; });
    g.globalAlpha = 1; g.textAlign = 'left'; caption(s, lt);
  };
  const drawOutro = (s, lt) => {
    bg(lt); const a = easeOut(lt / 0.8);
    g.globalAlpha = a; g.textAlign = 'center';
    if (logo) { const k = 120 / logo.height; g.drawImage(logo, W / 2 - (logo.width * k) / 2, 190, logo.width * k, 120); }
    g.fillStyle = '#fff'; font(86, 800); g.fillText("You're ready to go", W / 2, 440);
    g.fillStyle = '#7fe3d2'; font(36, 600); g.fillText('What you have just seen', W / 2, 520);
    font(32, 600); const items = spec.recap; items.forEach((c, i) => { const p = easeOut((lt - 0.5 - i * 0.18) / 0.4); const y = 590 + Math.floor(i / 3) * 84, col = i % 3, nInRow = Math.min(3, items.length - Math.floor(i / 3) * 3), w = 520, x = W / 2 - (nInRow * w + (nInRow - 1) * 24) / 2 + col * (w + 24); g.globalAlpha = p * a; g.fillStyle = 'rgba(255,255,255,.1)'; rr(x, y + (1 - p) * 16, w, 66, 18); g.fill(); g.fillStyle = '#14b8a6'; g.beginPath(); g.arc(x + 36, y + 33 + (1 - p) * 16, 15, 0, 7); g.fill(); g.fillStyle = '#052e2b'; font(22, 800); g.fillText('✓', x + 36, y + 41 + (1 - p) * 16); g.textAlign = 'left'; g.fillStyle = '#fff'; font(30, 620); g.fillText(c, x + 66, y + 44 + (1 - p) * 16); g.textAlign = 'center'; });
    g.globalAlpha = a; g.fillStyle = 'rgba(255,255,255,.85)'; font(32, 500); g.fillText('Need help? Ask the assistant or your administrator.', W / 2, 920);
    g.globalAlpha = 1; g.textAlign = 'left'; caption(s, lt);
  };
  const drawScene = (s, img, k, lt) => {
    bg(lt); const e = easeOut(lt / 0.55); header(lt, 1); tracker(lt, k, lt, s.dur);
    // window with the real screen
    const wx = WIN.x - (1 - e) * 90, wy = WIN.y, fade = e;
    g.globalAlpha = fade; g.drawImage(winShadow, wx - 80, wy - 70);
    g.save(); rr(wx, wy, WIN.w, WIN.h, 18); g.clip(); g.fillStyle = '#e9eef3'; g.fillRect(wx, wy, WIN.w, 46);
    [['#ff5f57', 24], ['#febc2e', 48], ['#28c840', 72]].forEach(([c, dx]) => { g.fillStyle = c; g.beginPath(); g.arc(wx + dx, wy + 23, 7, 0, 7); g.fill(); });
    g.fillStyle = '#fff'; rr(wx + 110, wy + 9, 560, 28, 14); g.fill(); g.fillStyle = '#5b6674'; font(16, 500); g.fillText(`${spec.host || 'agentifyerp.co'}${s.url || ''}`, wx + 128, wy + 29);
    const ix = wx, iy = wy + 46, iw = WIN.w, ih = WIN.h - 46; g.fillStyle = '#fff'; g.fillRect(ix, iy, iw, ih);
    if (img) {
      const f = s.focus, zt = f ? clamp(0.5 / Math.max(f.w, f.h * 1.55), 1, 1.45) : 1.0, zp = f ? easeInOut((lt - 1.1) / 1.6) : 0, z = 1 + (zt - 1) * zp;
      // the screenshot fills the window width; zoom is centred on the focus point and kept inside the picture
      const base = iw / img.width, sw = iw * z, sh = img.height * base * z; let ox = 0, oy = 0;
      if (f) { const fx = (f.x + f.w / 2) * iw * z, fy = (f.y + f.h / 2) * img.height * base * z; ox = clamp(iw / 2 - fx, iw - sw, 0); oy = clamp(ih / 2 - fy, ih - sh, 0); }
      g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip(); g.drawImage(img, ix + ox, iy + oy, sw, sh);
      if (f && f.w * f.h < 0.55) { // highlight ring + callout
        const rx = ix + ox + f.x * iw * z - 10, ry = iy + oy + f.y * img.height * base * z - 8, rw = f.w * iw * z + 20, rh = f.h * img.height * base * z + 16, p = easeOut((lt - 1.25) / 0.45), pulse = 0.5 + 0.5 * Math.sin(lt * 5);
        g.globalAlpha = fade * p; g.strokeStyle = '#14b8a6'; g.lineWidth = 5 + pulse * 2; g.shadowColor = 'rgba(20,184,166,.9)'; g.shadowBlur = 18 + pulse * 10; rr(rx, ry, rw, rh, 12); g.stroke(); g.shadowBlur = 0;
        if (s.call) { font(24, 700); const tw = g.measureText(s.call).width + 36, tx = clamp(rx, ix + 14, ix + iw - tw - 14), ty = ry - 52 < iy + 10 ? ry + rh + 12 : ry - 52; g.fillStyle = '#0f766e'; rr(tx, ty, tw, 42, 21); g.fill(); g.fillStyle = '#fff'; g.fillText(s.call, tx + 18, ty + 29); }
        // pointer travelling to the highlighted spot, then a click ripple
        const cx = rx + rw / 2, cy = ry + rh / 2, m = easeInOut((lt - 0.35) / 1.0), px = ix + iw - 220 + (cx - (ix + iw - 220)) * m, py = iy + ih - 160 + (cy - (iy + ih - 160)) * m;
        g.globalAlpha = fade; const rp = (lt - 1.5) / 0.8; if (rp > 0 && rp < 1) { g.strokeStyle = `rgba(20,184,166,${1 - rp})`; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, 14 + rp * 46, 0, 7); g.stroke(); }
        g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 8; g.fillStyle = '#111'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py + 30); g.lineTo(px + 8, py + 23); g.lineTo(px + 15, py + 37); g.lineTo(px + 21, py + 34); g.lineTo(px + 14, py + 21); g.lineTo(px + 24, py + 21); g.closePath(); g.fill(); g.stroke(); g.shadowBlur = 0;
      }
      g.restore();
    }
    g.restore(); g.globalAlpha = 1;
    // phase panel on the right
    const px0 = 1320, pe = easeOut((lt - 0.15) / 0.6);
    g.globalAlpha = pe; g.fillStyle = 'rgba(255,255,255,.07)'; rr(px0 - 24 + (1 - pe) * 60, 222, 590, 740, 26); g.fill();
    g.fillStyle = 'rgba(255,255,255,.1)'; font(210, 800); g.fillText(String(k + 1).padStart(2, '0'), px0 + 250 + (1 - pe) * 60, 410);
    g.fillStyle = '#7fe3d2'; font(24, 700); g.fillText(`PHASE ${k + 1} OF ${phaseNames.length}`, px0 + (1 - pe) * 60, 290);
    g.fillStyle = '#fff'; font(52, 800); const nl = wrap(s.title, px0 + (1 - pe) * 60, 455, 520, 62, 3);
    let y = 455 + nl * 62 + 18;
    (s.bullets || []).forEach((b, i) => { const p = easeOut((lt - 0.9 - i * 0.55) / 0.5); if (p <= 0) return; g.globalAlpha = p; g.fillStyle = '#14b8a6'; g.beginPath(); g.arc(px0 + 14, y - 9, 12, 0, 7); g.fill(); g.fillStyle = '#052e2b'; font(17, 800); g.textAlign = 'center'; g.fillText('✓', px0 + 14, y - 3); g.textAlign = 'left'; g.fillStyle = '#eafffb'; font(30, 560); const n = wrap(b, px0 + 44 + (1 - p) * 30, y, 490, 38, 3); y += n * 38 + 24; });
    g.globalAlpha = 1; caption(s, lt);
  };

  // ---------------------------------------------------------------- record
  const frame = (t) => {
    const i = Math.max(0, segs.findIndex((s, j) => t < s.start + s.dur || j === segs.length - 1)), s = segs[i], lt = Math.min(t - s.start, s.dur);
    if (s.kind === 'intro') drawIntro(s, lt); else if (s.kind === 'outro') drawOutro(s, lt); else drawScene(s, imgs[i], scenes.indexOf(s), lt);
    if (i > 0 && lt < 0.25) { g.fillStyle = `rgba(7,31,30,${1 - lt / 0.25})`; g.fillRect(0, 0, W, H); } // soft cut between segments
  };
  // ---------------------------------------------------------------- encode frame by frame (WebCodecs H.264 + AAC into an MP4): exact, nothing dropped, and faster than real time
  const FPS = 24, total = TOTAL + 0.4, N = Math.ceil(total * FPS), SR = ac.sampleRate;
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: 1280, height: 720 }, audio: { codec: 'aac', sampleRate: SR, numberOfChannels: 2 }, fastStart: 'in-memory' });
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { throw e; } });
  venc.configure({ codec: 'avc1.64001f', width: 1280, height: 720, bitrate: 420_000, framerate: FPS, latencyMode: 'quality' });
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { throw e; } });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 96_000 });
  const len = Math.ceil(total * SR), L = new Float32Array(len), R = new Float32Array(len);
  for (const sg of segs) { const vd = sg.voice.getChannelData(0), off = Math.floor((sg.start + 0.1) * SR); for (let i = 0; i < vd.length && off + i < len; i++) { L[off + i] += vd[i]; R[off + i] += vd[i]; } }
  for (let i = 0; i < len; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); R[i] = Math.max(-1, Math.min(1, R[i])); }
  const CH = 2048; for (let off = 0; off < len; off += CH) { const n = Math.min(CH, len - off), data = new Float32Array(n * 2); data.set(L.subarray(off, off + n), 0); data.set(R.subarray(off, off + n), n); const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data }); aenc.encode(ad); ad.close(); if (aenc.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 1)); }
  for (let i = 0; i < N; i++) {
    frame(Math.min(i / FPS, TOTAL));
    const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % 240 === 0 }); vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
  }
  await venc.flush(); await aenc.flush(); muxer.finalize(); cv.remove();
  const u8 = new Uint8Array(muxer.target.buffer);
  for (let i = 0; i < u8.length; i += 2 * 1024 * 1024) { let str = ''; const sub = u8.subarray(i, i + 2 * 1024 * 1024); for (let j = 0; j < sub.length; j += 32768) str += String.fromCharCode(...sub.subarray(j, j + 32768)); await window.__saveChunk(btoa(str)); }
  return { mime: 'video/mp4', seconds: total };
}
