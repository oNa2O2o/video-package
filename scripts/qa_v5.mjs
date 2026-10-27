#!/usr/bin/env node
// qa_v5.mjs — pre-export / post-export QA for a MM 包装编辑器 v5 project (read-only; never edits the project).
//
//   node qa_v5.mjs FOLDER --copy 全量文案.md [--approved "100만,채팅,..."] [--draft FILE | --latest-draft] [--api URL]
//
// Checks: placeholders (未填写), same-track overlap, V1 gaps (black), copy audit (every screen string ⊂ full copy),
// choice cuts speech (source audio energy right after the split point), freeze / end-card frames not black,
// and with a draft: ffmpeg blackdetect + a stills contact sheet (导出/qa_HHMMSS/sheet.jpg) to LOOK at.
// Exit 0 = pass, 1 = failures (listed in "fail").
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = k => argv.includes(`--${k}`);
const VALUE_OPTS = new Set(['--copy', '--approved', '--draft', '--api']);
const folder = argv.find((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(argv[i - 1]));
if (!folder) { console.error('用法：node qa_v5.mjs FOLDER --copy 全量文案.md [--approved "a,b"] [--draft FILE | --latest-draft]'); process.exit(1); }
const API = opt('api', process.env.MM_API || 'http://127.0.0.1:4400').replace(/\/$/, '');
const FPS = 30, DARK = 22, SPEECH_DB = -35;
const enc = encodeURIComponent;
const get = async u => { const r = await fetch(API + '/api' + u); const d = await r.json(); if (!r.ok) throw new Error(`${u} → ${d.error}`); return d; };
const end = c => c.start + c.duration;
const r2 = x => Math.round(x * 100) / 100;
const fail = [], warn = [], info = [];

function ff(args, opts = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {maxBuffer: 1 << 30, ...opts});
  if (r.status !== 0 && !opts.allowFail) throw new Error('ffmpeg ' + args.join(' ') + '\n' + r.stderr);
  return r;
}
function luma(file, t) {
  const buf = ff(['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', 'scale=16:28,format=gray', '-f', 'rawvideo', '-']).stdout;
  return buf.length ? buf.reduce((a, b) => a + b, 0) / buf.length : 0;
}
const dbCache = new Map();
function audioDb(file) {           // 10 ms RMS dB track of the source audio
  if (dbCache.has(file)) return dbCache.get(file);
  const pcm = ff(['-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-']).stdout;
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1), hop = 160, out = [];
  for (let i = 0; i + hop <= s.length; i += hop) { let e = 0; for (let k = 0; k < hop; k++) e += (s[i + k] / 32768) ** 2; out.push(20 * Math.log10(Math.sqrt(e / hop) + 1e-9)); }
  dbCache.set(file, out); return out;
}
const maxDb = (db, a, b) => { let m = -120; for (let i = Math.max(0, Math.floor(a * 100)); i < Math.min(db.length, Math.ceil(b * 100)); i++) m = Math.max(m, db[i]); return m; };

const norm = s => String(s ?? '').normalize('NFC').replace(/\*\*|<br\s*\/?>/gi, '').replace(/[\s\u3000]+/g, '');

async function main() {
  const {project: p, path: dir} = await get(`/projects/${enc(folder)}`);
  const templates = await get('/templates');
  const mediaFile = id => { const m = p.media.find(x => x.id === id); return m && (path.isAbsolute(m.path) ? m.path : path.join(dir, m.path)); };
  const mods = p.clips.filter(c => c.type === 'module');
  const label = c => `${c.module?.templateId ?? c.type} @${r2(c.start)}s`;

  // 1. placeholders (same rule as the editor's export QA)
  const blank = v => v == null || (typeof v === 'string' ? !v.trim() : Array.isArray(v) ? !v.length || v.every(blank) : false);
  for (const c of mods) {
    const t = templates.find(x => x.id === c.module.templateId);
    if (!t) { fail.push(`${label(c)}：模板不存在`); continue; }
    const keys = (t.editable ?? []).filter(f => ['text', 'textarea', 'string', 'list', 'options', 'words', undefined].includes(f.type) && !f.optional).map(f => f.key);
    const miss = keys.filter(k => blank(c.module.data?.[k]));
    if (miss.length) fail.push(`${label(c)}：占位未填写（${miss.join('、')}）`);
    if (c.module.type === 'choice' && (c.module.data.options ?? []).some(blank)) fail.push(`${label(c)}：有空选项`);
  }
  // 2. overlaps
  for (const tr of p.tracks) {
    const cs = p.clips.filter(c => c.trackId === tr.id).sort((a, b) => a.start - b.start);
    for (let i = 1; i < cs.length; i++) if (cs[i].start < end(cs[i - 1]) - 1e-4) fail.push(`${tr.id} @${r2(cs[i].start)}s：同轨重叠`);
  }
  // 3. V1 coverage until the end card (gap = black)
  const v1 = p.clips.filter(c => c.trackId === 'V1').sort((a, b) => a.start - b.start);
  const endCard = mods.find(c => c.module.type === 'end');
  const bodyEnd = endCard ? endCard.start : Math.max(...p.clips.map(end));
  let cur = 0;
  for (const c of v1) { if (c.start > cur + 1 / FPS) fail.push(`V1 ${r2(cur)}–${r2(c.start)}s 没有画面（黑场）`); cur = Math.max(cur, end(c)); }
  if (cur < bodyEnd - 1 / FPS) fail.push(`V1 ${r2(cur)}–${r2(bodyEnd)}s 没有画面（黑场）`);
  if (!p.clips.some(c => c.trackId === 'A1' && c.type === 'audio')) warn.push('A1 没有原声片段（视频片段本身是静音渲染的，原声必须放 A1）');
  // 4. copy audit
  const copyFile = opt('copy');
  if (!copyFile) warn.push('未给 --copy，跳过文案审计');
  else {
    const COPY = norm(fs.readFileSync(copyFile, 'utf8'));
    const ok = new Set((opt('approved', '') || '').split(',').map(norm).filter(Boolean));
    const chk = (c, k, s) => { if (s && String(s).trim() && !COPY.includes(norm(s)) && !ok.has(norm(s))) fail.push(`${label(c)} ${k}：「${String(s).replace(/\n/g, '⏎')}」不在全量文案里`); };
    for (const c of mods) {
      const d = c.module.data ?? {};
      for (const k of ['text', 'speaker', 'question', 'title', 'characterName', 'cta', 'chatCount', 'chatLabel']) chk(c, k, d[k]);
      (d.options ?? []).forEach((o, i) => chk(c, `options[${i}]`, o));
      (d.stages ?? []).forEach((s, i) => chk(c, `stages[${i}].label`, s?.label));
      if (Array.isArray(d.words) && d.words.length && d.text && norm(d.words.map(w => w.word).join('')) !== norm(d.text)) fail.push(`${label(c)}：words 拼起来 ≠ text`);
    }
  }
  // 5. choices: freeze not black, split point not inside speech
  for (const ch of mods.filter(c => c.module.type === 'choice')) {
    const fr = p.clips.filter(c => c.freezeOf === ch.id);
    if (!fr.length) fail.push(`${label(ch)}：没有定格（不是用 choice insert 插入的？）`);
    for (const f of fr) {
      const L = luma(mediaFile(f.mediaId), f.in);
      (L < DARK ? fail : info).push(`${label(ch)} 定格源 ${r2(f.in)}s 亮度 ${L.toFixed(0)}${L < DARK ? '（黑场！给该选项设 freezeAt 换亮帧）' : ''}`);
    }
    const before = p.clips.find(c => c.trackId === 'A1' && c.type === 'audio' && Math.abs(end(c) - ch.start) < 1e-3);
    if (before) {
      const src = mediaFile(before.mediaId), s = (before.in ?? 0) + before.duration;
      const db = audioDb(src);
      const tail = maxDb(db, s, s + 0.15), head = maxDb(db, s - 0.15, s);
      const nearTail = maxDb(db, s, s + 0.06), nearHead = maxDb(db, s - 0.06, s);
      const atMediaEnd = s >= (p.media.find(m => m.id === before.mediaId)?.duration ?? 1e9) - 0.05;
      const msg = `${label(ch)} 切点源 ${r2(s)}s：切点前 0.15s 峰值 ${head.toFixed(1)} dB，切点后 ${atMediaEnd ? '（素材结尾）' : tail.toFixed(1) + ' dB'}`;
      if (atMediaEnd) (head > SPEECH_DB ? warn : info).push(msg + (head > SPEECH_DB ? '：台词一直说到素材最后一帧，确认最后一个字没被素材本身截断' : ''));
      else if (nearHead > SPEECH_DB && nearTail > SPEECH_DB) fail.push(msg + '：切点前后都有语音 = 切断台词 → 选项后移到能量结束后');
      else if (tail > SPEECH_DB) warn.push(msg + '：切点后 0.15s 内有新的声音起点（下一句/环境音），不算切断，但请看一眼');
      else info.push(msg);
    }
  }
  // 6. end card backdrop/gallery not black
  if (endCard) for (const g of [endCard.module.data.backdrop, ...(endCard.module.data.gallery ?? [])].filter(x => x?.mediaId)) {
    const L = luma(mediaFile(g.mediaId), g.time); if (L < DARK) fail.push(`片尾图集/背景帧 ${r2(g.time)}s 是黑场（亮度 ${L.toFixed(0)}）`);
  }
  // 7. draft: blackdetect + stills sheet
  let draft = opt('draft');
  if (flag('latest-draft')) {
    const ex = (await get('/exports')).filter(e => e.folder === folder && e.kind === 'draft' && e.status === 'done' && e.exists !== false);
    draft = ex[0]?.file;
  }
  let sheet = null;
  if (draft) {
    const txt = spawnSync('ffmpeg', ['-hide_banner', '-i', draft, '-vf', 'blackdetect=d=0.03:pic_th=0.85:pix_th=0.10', '-an', '-f', 'null', '-'], {encoding: 'utf8'}).stderr;
    const blacks = [...txt.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    for (const [a, b] of blacks) {
      const mid = (a + b) / 2, c = v1.find(x => mid >= x.start && mid < end(x));
      if (c?.type === 'video' && luma(mediaFile(c.mediaId), (c.in ?? 0) + (mid - c.start) * (c.speed ?? 1)) < DARK) warn.push(`校对预览 ${r2(a)}–${r2(b)}s 黑屏：源视频自身的黑场/转场（不是定格）。若紧挨选项，看是否需要把选项提前到黑场开始处（不得切断台词）`);
      else if (p.clips.some(x => x.trackId === 'X-black' && mid >= x.start && mid < end(x))) info.push(`校对预览 ${r2(a)}–${r2(b)}s 黑屏：X-black 黑幕过渡（故意）`);
      else fail.push(`校对预览 ${r2(a)}–${r2(b)}s 黑屏（${c ? c.type : '无 V1 画面'}）`);
    }
    const pts = [];
    const ttl = mods.find(c => c.module.type === 'title'); if (ttl) pts.push(['标题', ttl.start + Math.min(1.5, ttl.duration / 2)]);
    for (const b of mods.filter(c => c.module.type === 'bubble')) { const w = b.module.data.words ?? []; pts.push(['气泡', b.start + (w.length ? Math.min(b.duration - 0.4, w.at(-1).end) : b.duration * 0.6)]); }
    for (const c of mods.filter(c => c.module.type === 'choice')) pts.push(['选项', c.start + c.duration * 0.6]);
    const met = mods.find(c => c.module.type === 'meter'); if (met) pts.push(['进度条末', end(met) - 0.3]);
    if (endCard) pts.push(['片尾', endCard.start + endCard.duration * 0.7]);
    if (!pts.length) {   // B 路线（全是自定义图层、没有模块）：定格中点 + 每 4 s 采样 + 结尾
      for (const c of v1.filter(c => c.type === 'freeze')) pts.push(['定格', c.start + c.duration * 0.6]);
      const T = Math.max(...p.clips.map(end));
      for (let t = 1.5; t < T - 0.5; t += 4) pts.push([`${r2(t)}s`, t]);
      pts.push(['结尾', T - 0.3]);
    }
    pts.sort((a, b) => a[1] - b[1]);
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const qdir = path.join(dir, '导出', `qa_${stamp}`); fs.mkdirSync(qdir, {recursive: true});
    pts.forEach(([, t], i) => ff(['-ss', String(t), '-i', draft, '-frames:v', '1', '-vf', 'scale=270:-2', '-y', path.join(qdir, `s_${String(i).padStart(2, '0')}.jpg`)]));
    const cols = Math.min(6, pts.length), rows = Math.ceil(pts.length / cols);
    sheet = path.join(qdir, 'sheet.jpg');
    ff(['-framerate', '1', '-i', path.join(qdir, 's_%02d.jpg'), '-vf', `tile=${cols}x${rows}:padding=4`, '-frames:v', '1', '-y', sheet]);
    info.push(`stills（左→右、上→下）：${pts.map(([n, t]) => `${n}@${r2(t)}s`).join('，')}`);
    fs.writeFileSync(path.join(qdir, 'stills.json'), JSON.stringify(pts.map(([n, t], i) => ({i, name: n, t})), null, 1));
  }
  const res = {folder, ok: !fail.length, fail, warn, info, draft: draft ?? null, sheet};
  console.log(JSON.stringify(res, null, 2));
  process.exit(fail.length ? 1 : 0);
}
main().catch(e => { console.error(JSON.stringify({error: e.message})); process.exit(1); });
