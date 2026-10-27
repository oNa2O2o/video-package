---
name: mm-workbench-v5
version: 1.1.0
description: 通过 Agent API / mmw CLI 操作「MM 包装编辑器 v5」，把一个视频 + 一份全量文案包装成 MM 成片（标题、逐词气泡、选项定格、进度条、内心独白、片尾卡、BGM/音效），导出校对预览/成片，并在验收后交付到素材目录的「成品」。支持两条路线：KR 互动剧（模板 + 选项）与自定义包装（无选项剧情、或用户要求新设计时自己做图层）。用户说“用工作台包装”“用 v5 编辑器包装”“v5编辑器”“AI包装”“mmw”“用新编辑器做 MM-KR/JP/EN/TC 包装”“在编辑器里建工程/加气泡/插选项/导出”“重新设计包装”“迭代版本”“换角色同台词”“无BGM版”时使用。旧工作台（4363 端口）用 mm-video-packager。
---

# MM 包装编辑器 v5 · Agent 操作

编辑器 = 本地 HTTP 服务，UI 和 Agent 共用同一套接口。编辑器只是**可视化呈现工程**的地方：你通过 **REST `/api/*` 或 CLI `bin/mmw.mjs`** 读写工程，包装内容可以用模板，也可以用自己生成的图层。

- App 根 `$APP` = `F:/钟海明/2026/2026年10月10日MM-编辑器重构/app`；CLI `mmw` = `node $APP/bin/mmw.mjs`
- 本 Skill `$SK` = `F:/BaiduSyncdisk/PI Agnet/.agents/skills/mm-workbench-v5`
- ASR/对齐复用旧 Skill（只调用、不修改）`$OLD` = `F:/BaiduSyncdisk/PI Agnet/.agents/skills/mm-video-packager`

## 前提（每次先查）
`mmw health` → `{ok:true, port:4400, projectsRoot}`。不通就独立启动（不要用随 shell 结束的子进程），等 10 s 再查：
```powershell
Start-Process node -ArgumentList 'server/index.mjs','--dev' -WorkingDirectory 'F:/钟海明/2026/2026年10月10日MM-编辑器重构/app' -WindowStyle Hidden
```
另需 `ffmpeg/ffprobe`、`python` + `faster-whisper`（GPU 失败用 `device='cpu'`）。

## 硬规则（用户定的，任何模型都必须遵守）
**目录与交付**
1. **用户给什么目录就用什么目录**：用户给的素材目录就是工程目录（`mmw projects create --folder-name <该目录名>`），所有产物（工程、素材、导出、脚本、生成图层）都放在里面，**不准自己在别处新建目录**、不留临时目录。只有用户没给目录时才新建。目录名不符合命名规范（见 workflow §1）或不在 `projectsRoot` 下 → **提醒用户**，并提出帮他改名/移动，得到同意再动。
2. **验收合格 = 必须交付成品**：用户说合格/要成片时，导出完整分辨率成片（`--kind final`，1080×1920）并复制到 `<素材目录>/成品/`（统一叫「成品」）。用户忘了提也要做。
3. **改完就给用户看**：每次修改后运行 `node $SK/scripts/open_editor.mjs <工程> --video <最新预览>`（自动刷新已开的编辑器页 → 切到该工程 → 打开浏览器和视频 → 等 30 s 确认工程没被改回）。不让用户手动刷新/打开。**只展示图和视频**（预览、成片、关键帧）；脚本、图层、文案、json 等其他产物不开目录。要开目录用 `powershell -NoProfile -ExecutionPolicy Bypass -File $SK/scripts/open_dir.ps1 <目录>`：该目录已打开就只激活，不重复开。

**默认禁止（需要时先向用户提申请，批准后才做，并在交付说明里写清楚改了什么）**
4. **不改编辑器源码**（`$APP` 下任何文件）。遇到编辑器 bug：记录现象和原因，向用户申请修改；没批准就绕开或报告。
5. **全量文案只读**。屏幕文字只能来自全量文案（或用户批准的 `approvedUiStrings`）。觉得要改字/加字（例如进度条标签、去句号）→ 向用户提出，批准后再改文案文件。
6. **不手写 `工程.mmproj` 文件**：一律通过 API（GET → 改 → PUT 带 revision）或 CLI。

**内容**
7. **不编台词、不自造文字**：原片没有人声的段落不加台词；ASR 在纯音乐/无人声处会幻听出词（如「おやすみなさい」「ごちそうさまでした」），必须用能量/人工核对。说话人名、阶段名、按钮字没有来源就留空。
8. **原声与文案不一致先问**（补文案 / 剪掉 / 忽略不出字幕），不擅自决定。
9. **V1 不空**：V1 在任何时刻都要有画面（片尾背景图放 V1）；定格帧不能是纯黑帧。片尾背景亮度按题材定，不要求必须亮（2026-10-20 用户删除“片尾必须亮”）。
10. **原声在 A1**：视频片段渲染时静音，V1 视频必须配同源 A1 音频（linkGroup）。
11. **同轨不重叠**；模块文本字段导出前 0 个“未填写”。
12. **自己检查后再交付**：跑 `qa_v5.mjs`（fail 必须为空）→ 导出关键帧/预览**用 read 打开看**。声音你听不到 → 只能用频谱/音量检查，交付时明确写“需要你听一下”。

## 路线选择
| 情况 | 路线 |
|---|---|
| KR 互动剧：有【UI提问】选项、标准液态包装 | **A 模板路线**：ASR 对齐 → spec → `build_v5` → QA（workflow §A） |
| 无选项剧情（POV 蒙太奇、内心独白…），或用户要求“重新设计/不要模板样式” | **B 自定义图层路线**：PIL 生成透明整画布 PNG + 自合成音效，脚本 GET→PUT 写入 X-* 轨（workflow §B，参考 `cases/`） |
两条路线可以混用（例如角色气泡用模板，其余用自定义图层）。

## 文件
| 文件 | 何时读 |
|---|---|
| `workflow.md` | 每次包装：公共步骤、A/B 两条路线、QA、交付（含无 BGM 版）、§8 迭代版本、排错 |
| `reference/standards.md` | **审美标准**（用户验收过的画面/片尾/声音要求）+ 可选打法。每次包装前读 |
| `reference/custom-layers.md` | B 路线：图层/关键帧/音频的数据格式、编辑器渲染规则与坑 |
| `reference/cli.md` | 全部 CLI 命令与 REST 接口 |
| `reference/templates.md` | 模板 id、data/params、内置音效 |
| `reference/spec.md` | `v5-spec.json` 格式（A 路线 build_v5 输入） |
| `cases/` | 已验收案例（只作参考，具体数值/文案不要照搬） |
| `scripts/open_editor.mjs` | 交付：刷新编辑器 + 打开工程/视频 + 30 s 覆盖检查 |
| `scripts/open_dir.ps1` | 打开成品/导出目录（已打开则不重复开） |
| `scripts/mmvp_to_spec.py` / `build_v5.mjs` / `qa_v5.mjs` | A 路线生成、通用 QA |
