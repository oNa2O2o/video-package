#!/usr/bin/env node
// build_v5.mjs — apply a packaging spec (v5-spec.json) to a MM 包装编辑器 v5 project through the Agent API.
// Same operations as `mmw clip add / choice insert` (it imports the app's src/shared/model.js), done in one
// read-modify-PUT so linkGroup / volume / freeze frame / words can be set too.
//
//   node build_v5.mjs SPEC.json [--replace] [--dry-run] [--api http://127.0.0.1:4400] [--app <app root>]
//
// Spec times are SOURCE-video seconds (before any choice freeze is inserted). The script converts them to
// output time: out(s) = s + Σ duration of choices whose `at` <= s.  See reference/spec.md.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const argv = process.argv.slice(2);
const flag = k => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const specPath = argv.find(a => !a.startsWith('--') && a.endsWith('.json'));
if (!specPath) { console.error('用法：node build_v5.mjs SPEC.json [--replace] [--dry-run] [--api URL] [--app APP_ROOT]'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const APP = opt('app', process.env.MM_APP || spec.app || 'F:/钟海明/2026/2026年10月10日MM-编辑器重构/app');
const API = (opt('api', process.env.MM_API || spec.api || 'http://127.0.0.1:4400')).replace(/\/$/, '');
const M = await import(pathToFileURL(path.join(APP, 'src/shared/model.js')).href);
const {newId, insertChoice, DEFAULT_TRANSFORM, MODULE_TYPE_NAMES, FPS, clipEnd, overlaps} = M;
const enc = encodeURIComponent;
const r3 = x => Math.round(x * 1000) / 1000;
const snap = x => Math.round(x * FPS) / FPS;          // frame-exact

async function call(method, url, body) {
  const r = await fetch(API + '/api' + url, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) { const e = new Error(`${method} ${url} → ${r.status} ${d?.error ?? t}`); e.status = r.status; throw e; }
  return d;
}

// ------------------------------------------------------------------ copy audit (hard rule: text only from copy)
const norm = s => String(s ?? '').normalize('NFC').replace(/\*\*|<br\s*\/?>/gi, '').replace(/[\s\u3000]+/g, '');
const copyFile = spec.copyFile;
if (!copyFile || !fs.existsSync(copyFile)) { console.error(`copyFile 不存在：${copyFile}（必须指向用户的全量文案）`); process.exit(1); }
const COPY = norm(fs.readFileSync(copyFile, 'utf8'));
const APPROVED = new Set((spec.approvedUiStrings ?? []).map(norm));
const audit = [];
function check(where, s) {
  if (s == null || !String(s).trim()) return;
  const n = norm(s);
  if (!COPY.includes(n) && !APPROVED.has(n)) audit.push(`${where}：「${String(s).replace(/\n/g, '⏎')}」不在全量文案里`);
}

// ------------------------------------------------------------------ spec → clip list
const choices = (spec.choices ?? []).map(c => ({...c, at: snap(c.at), duration: c.duration ?? (c.pick === -1 ? 3.6 : 3.2)})).sort((a, b) => a.at - b.at);
const out = s => r3(s + choices.filter(c => c.at <= s + 1e-6).reduce((a, c) => a + c.duration, 0));

async function main() {
  const {project: p0, revision} = await call('GET', `/projects/${enc(spec.folder)}`);
  let p = structuredClone(p0);
  const templates = await call('GET', '/templates');
  const tpl = id => { const t = templates.find(x => x.id === id); if (!t) throw new Error(`模板不存在：${id}（mmw templates 查看）`); return t; };
  if (p.clips.length && !flag('replace')) throw new Error(`工程已有 ${p.clips.length} 个片段；确认要重建时加 --replace（会清空时间轴，素材保留）`);
  if (flag('replace')) p.clips = [];

  const media = id => { const m = p.media.find(x => x.id === id); if (!m) throw new Error(`素材不存在：${id}（先 mmw media import）`); return m; };
  async function importFile(file) {
    const abs = path.resolve(file);
    const hit = p.media.find(m => path.basename(m.path) === path.basename(abs));
    if (hit) return hit.id;
    const {media: m} = await call('POST', `/projects/${enc(spec.folder)}/media`, {sourcePath: abs});
    if (!p.media.some(x => x.path === m.path)) p.media.push(m);
    return p.media.find(x => x.path === m.path).id;
  }
  const moduleClip = (templateId, start, duration, data, params = {}, trackId) => {
    const t = tpl(templateId);
    const tr = trackId ?? p.tracks.find(x => x.kind === 'module' && x.moduleType === t.type)?.id;
    return {id: newId('c'), trackId: tr, type: 'module', start: r3(start), duration: r3(duration), name: MODULE_TYPE_NAMES[t.type],
      transform: {...DEFAULT_TRANSFORM, ...(t.defaults?.transform ?? {})},
      module: {type: t.type, templateId, templateVersion: t.version ?? 1, data: {...structuredClone(t.defaults?.data ?? {}), ...data}, params: {...(t.defaults?.params ?? {}), ...params}}};
  };
  const push = c => {
    if (overlaps(p, c.trackId, c.start, c.duration)) throw new Error(`${c.trackId} @${c.start}s 与已有片段重叠（同轨不重叠）`);
    p.clips.push(c); return c;
  };

  // 1. V1 video + A1 original audio, linked
  const v = spec.video; const vm = media(v.mediaId);
  const vin = v.in ?? 0, vend = Math.min(v.end ?? vm.duration, vm.duration);
  const vdur = r3(Math.floor((vend - vin) * FPS + 1e-6) / FPS);   // frame-exact so a choice at the very end gets its freeze
  for (const c of choices) if (c.at > vdur - 1e-3) c.at = vdur;     // last choice after the final word → at the video end
  const link = newId('L');
  push({id: newId('c'), trackId: 'V1', type: 'video', start: 0, duration: vdur, mediaId: vm.id, in: vin, speed: 1, name: vm.name, transform: {...DEFAULT_TRANSFORM}, fit: v.fit ?? 'blur-pad', linkGroup: link});
  if (vm.hasAudio !== false) push({id: newId('c'), trackId: 'A1', type: 'audio', start: 0, duration: vdur, mediaId: vm.id, in: vin, speed: 1, volume: v.volume ?? 1, name: vm.name, linkGroup: link});
  // 1b. holds: cover source fades/black while audio keeps playing (A1 untouched): V1 piece → freeze of a bright frame
  for (const h of [...(v.holds ?? [])].sort((a, b) => b.from - a.from)) {
    const from = snap(Math.max(0, h.from - vin)), to = Math.min(vdur, snap(h.to - vin));
    if (to - from < 1 / FPS) continue;
    const base = p.clips.find(c => c.trackId === 'V1' && c.type === 'video' && from >= c.start - 1e-6 && from < clipEnd(c) - 1e-6);
    if (!base) continue;
    if (from > base.start + 1e-6) p = M.splitClip(p, base.id, from);
    const mid = p.clips.find(c => c.trackId === 'V1' && c.type === 'video' && Math.abs(c.start - from) < 1e-6);
    if (to < clipEnd(mid) - 1e-6) p = M.splitClip(p, mid.id, to);
    const piece = p.clips.find(c => c.id === mid.id);
    Object.assign(piece, {type: 'freeze', in: r3(h.frame), name: '遮黑定格'}); delete piece.linkGroup; delete piece.speed;
  }

  // 2. title
  if (spec.title) { check('标题', spec.title.text); push(moduleClip(spec.title.template ?? 'title/liquid', spec.title.start ?? 0, spec.title.duration ?? 3.1, {text: spec.title.text}, spec.title.params)); }

  // 3. bubbles (source time; words become clip-local)
  for (const [i, b] of (spec.bubbles ?? []).entries()) {
    const words = (b.words ?? []).map(w => ({word: w.word, start: r3(w.start - b.start), end: r3(w.end - b.start)}));
    const text = b.text ?? words.map(w => w.word).join('');
    check(`气泡${i + 1}`, text);
    for (const c of choices) if (b.start < c.at - 1e-6 && b.end > c.at + 1e-6) throw new Error(`气泡${i + 1}（${b.start}–${b.end}）跨过了选项 @${c.at}：气泡必须在选项前结束`);
    const data = {text, words, role: b.role ?? 'character'};
    if (b.speaker) { check(`气泡${i + 1}说话人`, b.speaker); data.speaker = b.speaker; }
    if (b.avatar) data.avatarMediaId = await importFile(b.avatar);
    push(moduleClip(b.template ?? 'bubble/liquid', b.start, b.end - b.start, data, b.params));
  }

  // 4. choices — descending source time so earlier insert points stay valid
  for (const c of [...choices].reverse()) {
    check('选项问题', c.question); c.options.forEach((o, k) => check(`选项${k + 1}`, o));
    const before = p.clips.length;
    p = insertChoice(p, {t: c.at, duration: c.duration, trackId: p.tracks.find(t => t.kind === 'module' && t.moduleType === 'choice').id,
      module: {type: 'choice', templateId: c.template ?? 'choice/liquid', templateVersion: tpl(c.template ?? 'choice/liquid').version ?? 1,
        data: {question: c.question, options: c.options, pick: c.pick ?? 0}, params: {...(tpl(c.template ?? 'choice/liquid').defaults?.params ?? {}), ...(c.params ?? {})}},
      transform: {...DEFAULT_TRANSFORM}});
    const added = p.clips.slice(before);
    const ch = added.find(x => x.type === 'module');
    const fr = added.filter(x => x.type === 'freeze' && x.freezeOf === ch.id);   // (split halves of hold freezes are also new clips)
    if (!fr.length) {   // the piece before t is a hold freeze (or ends exactly at t) → hold the same frame
      const prev = p.clips.filter(x => x.trackId === 'V1' && x.id !== ch.id && Math.abs(clipEnd(x) - c.at) < 1e-6 && (x.type === 'freeze' || x.type === 'video')).pop();
      if (prev) { const f = {id: newId('c'), trackId: 'V1', type: 'freeze', start: c.at, duration: c.duration, mediaId: prev.mediaId,
        in: prev.type === 'freeze' ? prev.in : r3((prev.in ?? 0) + prev.duration - 1 / FPS), freezeOf: ch.id, transform: prev.transform, fit: prev.fit, name: '定格'}; p.clips.push(f); fr.push(f); }
    }
    if (!fr.length) throw new Error(`选项 @${c.at}s 没有生成定格（该时间点没有视频片段结束/切开？最后一个选项请把 video.end 设成同一时间）`);
    if (c.freezeAt != null) for (const f of fr) f.in = r3(c.freezeAt);   // black frame before t → hold a bright frame instead
    c._out = ch.start; c._freezeIn = fr[0].in;
  }
  // after the reverse loop, earlier choices shifted later ones: recompute output times from the project
  const chClips = p.clips.filter(x => x.module?.type === 'choice').sort((a, b) => a.start - b.start);
  const bodyEnd = Math.max(...p.clips.filter(x => x.trackId === 'V1').map(clipEnd));

  // 5. meter (output time; keyframe `at` in source time → mapped, "at == choice.at" lands right after that choice)
  if (spec.meter) {
    const m = spec.meter;
    const start = out(m.start ?? (spec.title?.duration ?? 3.1));
    const end = m.end != null ? out(m.end) : bodyEnd;
    const stages = [];
    for (let i = 0; i < 4; i++) { const s = m.stages?.[i] ?? {}; if (s.label) check(`进度条阶段${i + 1}`, s.label); stages.push({mediaId: s.image ? await importFile(s.image) : (s.mediaId ?? ''), label: s.label ?? ''}); }
    const keyframes = (m.keyframes ?? []).map(k => ({t: r3(snap(out(k.at) - start)), value: k.value})).map(k => ({...k, t: Math.max(0, k.t)}));
    push(moduleClip(m.template ?? 'meter/face', start, end - start, {stages, keyframes, lockedStage: m.lockedStage ?? 3}, m.params));
  }

  // 6. end card right after the body
  if (spec.end) {
    const e = spec.end;
    for (const k of ['title', 'characterName', 'cta', 'chatCount', 'chatLabel']) check(`片尾 ${k}`, e[k]);
    const data = {title: e.title, characterName: e.characterName ?? '', cta: e.cta, chatCount: e.chatCount ?? '', chatLabel: e.chatLabel ?? '', clicks: e.clicks ?? 5,
      gallery: (e.gallery ?? []).map(t => ({mediaId: vm.id, time: r3(t)}))};
    if (e.backdrop != null) data.backdrop = {mediaId: vm.id, time: r3(e.backdrop)};
    push(moduleClip(e.template ?? 'end/liquid', bodyEnd, e.duration ?? 4.2, data, e.params));
  }
  const total = Math.max(...p.clips.map(clipEnd));

  // 7. BGM (A2) + extra sfx (A3)
  if (spec.bgm) {
    const id = spec.bgm.mediaId ?? await importFile(spec.bgm.file);
    const bm = media(id);
    push({id: newId('c'), trackId: 'A2', type: 'audio', start: 0, duration: r3(Math.min(total, bm.duration ?? total)), mediaId: id, in: 0, speed: 1, volume: spec.bgm.volume ?? 0.2, fadeOut: spec.bgm.fadeOut ?? 0.6, name: bm.name});
  }
  for (const s of spec.sfx ?? []) {
    const id = s.mediaId ?? await importFile(s.file); const sm = media(id);
    push({id: newId('c'), trackId: 'A3', type: 'audio', start: r3(s.outAt ?? out(s.at)), duration: r3(sm.duration ?? 0.5), mediaId: id, in: 0, speed: 1, volume: s.volume ?? 0.8, name: sm.name});
  }

  if (audit.length) { console.error(JSON.stringify({error: '文案审计未通过（屏幕文字必须出自全量文案 / approvedUiStrings）', audit}, null, 2)); process.exit(1); }
  M.validateProject(p);
  const summary = {folder: spec.folder, total: r3(total), clips: p.clips.length,
    choices: chClips.map(c => ({start: r3(c.start), end: r3(clipEnd(c)), question: c.module.data.question, freezeIn: p.clips.find(f => f.freezeOf === c.id)?.in})),
    timeline: [...p.clips].sort((a, b) => a.start - b.start).map(c => `${c.trackId.padEnd(8)} ${String(r3(c.start)).padStart(7)}–${String(r3(clipEnd(c))).padEnd(7)} ${c.type}${c.module ? ' ' + c.module.templateId + ' ' + JSON.stringify(c.module.data.text ?? c.module.data.question ?? c.module.data.title ?? '').slice(0, 40) : ''}`)};
  if (flag('dry-run')) { console.log(JSON.stringify(summary, null, 2)); return; }
  const r = await call('PUT', `/projects/${enc(spec.folder)}`, {project: p, revision});
  console.log(JSON.stringify({...summary, revision: r.revision}, null, 2));
}
main().catch(e => { console.error(JSON.stringify({error: e.message}, null, 2)); process.exit(1); });
