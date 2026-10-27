#!/usr/bin/env node
// 交付用：让已打开的编辑器页面自动刷新 → 编辑器切到该工程 → 打开浏览器（+ 可选打开视频）→ 等待后确认工程没被旧页面改回去。
// 用法：node open_editor.mjs <工程目录名> [--video <mp4 绝对路径>] [--wait 30] [--no-browser]
// 退出码：0 = 工程未被改动；2 = 等待期间工程被别处改写（要重新检查/重写）。
import fs from 'node:fs';
import {spawn} from 'node:child_process';

const APP = 'F:/钟海明/2026/2026年10月10日MM-编辑器重构/app';
const API = 'http://127.0.0.1:4400/api';
const args = process.argv.slice(2);
const F = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--video' && args[args.indexOf(a) - 1] !== '--wait');
if (!F) { console.error('用法: node open_editor.mjs <工程目录名> [--video file.mp4] [--wait 30] [--no-browser]'); process.exit(1); }
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const video = opt('--video'); const wait = Number(opt('--wait') ?? 30);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getRev = async () => { const r = await fetch(`${API}/projects/${encodeURIComponent(F)}`); if (!r.ok) throw new Error('读取工程失败 ' + r.status); const j = await r.json(); return {revision: j.revision, clips: j.project?.clips?.length}; };
const open = target => spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${String(target).replace(/'/g, "''")}'`], {detached: true, stdio: 'ignore'}).unref();

const before = await getRev();
// 1) 已打开的编辑器页面全部重新加载（vite 监听 index.html 变化 → full reload；只改时间戳，不改内容）
const idx = `${APP}/index.html`; const now = new Date(); fs.utimesSync(idx, now, now);
await sleep(4000);
// 2) 编辑器标签切到该工程
const s = await (await fetch(`${API}/settings`)).json();
const tabs = (s['ui.tabs']?.tabs ?? []).filter(t => t.folder !== F); tabs.push({folder: F, name: F});
await fetch(`${API}/settings`, {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({'ui.tabs': {tabs, active: F}, lastProject: F})});
// 3) 打开
if (!args.includes('--no-browser')) open('http://127.0.0.1:4400/');
if (video) open(video.replace(/\//g, '\\'));
// 4) 等待后确认
await sleep(wait * 1000);
const after = await getRev();
const same = after.revision === before.revision;
console.log(JSON.stringify({folder: F, before, after, unchanged: same, video: video ?? null}));
process.exit(same ? 0 : 2);
