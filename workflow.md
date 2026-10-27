# 工作流（逐步）

> 硬规则在 `SKILL.md`，审美标准在 `reference/standards.md`，开工前都要读。
> 流程：§0–§2 公共 → §3–§4 **A 模板路线** 或 §B **自定义图层路线** → §5–§7 公共（QA、成片、交付）。

变量（Git Bash 写法；PowerShell 把 `VAR=…` 换成 `$VAR='…'`）：
```bash
APP="F:/钟海明/2026/2026年10月10日MM-编辑器重构/app"
SK="F:/BaiduSyncdisk/PI Agnet/.agents/skills/mm-workbench-v5"
OLD="F:/BaiduSyncdisk/PI Agnet/.agents/skills/mm-video-packager"
mmw() { node "$APP/bin/mmw.mjs" "$@"; }
SRC="<用户素材文件夹>"; VIDEO="$SRC/<视频>.mp4"; COPY="$SRC/全量文案.md"
export PYTHONIOENCODING=utf-8      # Windows 控制台是 GBK，不设会在打印韩文/日文时崩
```
Windows 坑：
- 从 JSON 输出取字段用 **stdin**：`… | node -pe "JSON.parse(require('fs').readFileSync(0)).folder"`（`/tmp/x.json` 路径 node 读不到）。
- Git Bash 会把 `/audio/x.wav` 改写成 `C:/Program Files/Git/audio/…`，而且 CLI 会 `path.resolve` 文件参数 → 音频库文件请用绝对路径 `$APP/public/audio/<file>`。

## 0. 服务
`mmw health` 必须 `ok:true`。不通 → 按 SKILL.md 用 `Start-Process` 启动，等 3–5 s 再查。`projectsRoot` 就是工程会建在的根目录（测试环境是 `…/测试项目根`），不要擅自改设置。

## 1. 建工程（目录规则）
**用户给了素材目录 → 就用这个目录当工程目录**（工程.mmproj、素材/、导出/ 都建在里面）：
```bash
F="<用户目录名>"; mmw projects create --folder-name "$F"     # 目录已存在也可以，只会新建工程文件和子目录
```
编辑器要求：目录在 `projectsRoot`（`F:/钟海明/2026`）下面，名字 = `YYYY年M月D日MM-<KR|JP|EN|TC>-<标题>`（月日不补零；标题不含 `\ / : * ? " < > |`）。
- 不符合（报 400 “目录名不合规”，或目录不在根目录下）→ **提醒用户**，提出改名/移动方案（例如 `xxx` → `2026年10月19日MM-JP-xxx`），同意后由你执行，然后再建工程。**不要在别处另建目录绕过去。**
- 用户没给目录时才自己新建：
```bash
F=$(mmw projects create --title "扣傲慢义姐零花钱" --region KR | node -pe "JSON.parse(require('fs').readFileSync(0)).folder")
P=$(mmw projects show "$F" | node -pe "JSON.parse(require('fs').readFileSync(0)).path")   # 工程目录绝对路径
```
409 = 该目录已有工程：问用户“继续改旧工程”还是换目录；不要覆盖。

## 2. 导入素材
```bash
VID=$(mmw media import "$F" "$VIDEO" | node -pe "JSON.parse(require('fs').readFileSync(0)).media.id")
mmw media import "$F" "$APP/public/audio/bgm-liquid-crush.wav"     # BGM（build_v5 也会自动导入 spec.bgm.file）
```
`media import` 会复制进 `素材/` 并写入 `project.media`（返回 duration/width/height/hasAudio）。全量文案不导入，只作为唯一文字来源读取。

## 3. ASR 逐词对齐（复用旧 Skill 的 ①，不改它）
```bash
python "$OLD/scripts/prepare.py" "$P" --video "$P/素材/<视频>.mp4" --copy "$COPY"
```
- 产物在 `$P/工作区/mmvp/`：`copy.json`（文案结构）、`scan.json`（逐帧亮度/黑场、语音能量区间 -35 dB）、`align.json`（每句逐词时间，文字=文案，句末=能量结束 `speechEnd`）、`plan.json`（选项时间/定格亮帧/进度条节点/片尾图集），以及 `$P/确认单.md`、`$P/制作记录.md`。
- faster-whisper large-v3，CUDA 失败自动转 CPU；30 s 视频 GPU 约 1 分钟。ASR 结果有缓存（视频哈希不变就复用），重跑很快。
- **打开 `确认单.md`**：“必须回答”非空 → 先问用户。原声多出文案没有的台词时，三选一：补进文案 / 从视频剪掉 / 忽略不出字幕（用户选“忽略”才加 `--ignore-unscripted`）。
- 已有旧的逐词时间（例如以前项目的 `align.json`）也可直接手写 spec（见 `reference/spec.md`），但文字仍必须逐字取自全量文案。

## 4. 生成时间轴
### 4a. 推荐：spec → build（一次读改写，带文案审计）
```bash
cd "$P/工作区"
python "$SK/scripts/mmvp_to_spec.py" --mmvp mmvp --folder "$F" --media "$VID" --copy "$COPY" \
  [--portraits s1.png s2.png s3.png s4.png] [--ignore-unscripted] [--picks 0,0,-1] --out v5-spec.json
node "$SK/scripts/build_v5.mjs" v5-spec.json --dry-run      # 先看时间轴摘要
node "$SK/scripts/build_v5.mjs" v5-spec.json [--replace]    # 写入；工程已有片段时必须 --replace（清空时间轴，素材保留）
```
build_v5 做的事（与 UI/CLI 同一个 `model.js`）：
1. V1 视频 + A1 原声（同 `linkGroup`；视频 `fit: blur-pad`）；`video.end` = 最后一个选项时间（片尾黑场不保留）。
2. `video.holds`：源视频淡出/黑场压着台词或紧挨选项 → 该段 V1 改为“遮黑定格”（取淡出前最后一帧亮画面），A1 原声继续 → 不切台词、不露黑。
3. 标题 `title/liquid` 0–3.1 s（品牌短语后换行，如 `MiraiMind에서\n…`）。
4. 气泡 `bubble/liquid`：每句一条，开始 = 首词 − 0.25 s（思考气泡），结束 = 下一句前 / 选项点 / 未写台词开始前；`words` 为片段内相对秒。
5. 选项：按源时间**倒序** `insertChoice`（切开所有音视频、整体后推、插定格）；`freezeAt` 指定定格源帧（plan 里的亮帧 / hold 帧）。
6. 进度条 `meter/face`：标题结束起到片尾前；关键帧 0（3.2 s）→ 50（选项1 之后）→ 100（选项2 之后）；`lockedStage:3`；阶段头像用 `--portraits`（没有就留空，显示默认节点）。
7. 片尾 `end/liquid`（模板默认 4.2 s，按 standards §6 尽量缩短，点完就结束）：title=结尾卡第 1 行、cta=第 2 行（下载/플레이 行）、characterName=卡片标题、图集=最后一幕 3 个亮帧。
8. A2 BGM（默认 0.2，结尾淡出 0.6 s；**必须听得到**，按 standards §7 调整原声/BGM 比例）；`sfx` 可选放 A3（模板自带的出现/点击音效不用另放）。
9. 文案审计：标题/气泡/问题/选项/片尾/说话人/阶段名逐条必须是全量文案的子串（忽略空白、`**`、`<br>`）或 `approvedUiStrings`，否则退出 1 且不保存。

### 4b. 只用 CLI（小改、或没有 spec 时）
```bash
mmw clip add "$F" --type video --media $VID --track V1 --start 0 --duration 29.7
mmw clip add "$F" --type audio --media $VID --track A1 --start 0 --duration 29.7        # 原声必须单独放 A1
mmw clip add "$F" --type module --template title/liquid --start 0 --duration 3.1 --data '{"text":"MiraiMind에서\n<文案标题>"}'
mmw clip add "$F" --type module --template bubble/liquid --start 2.29 --duration 4.9 \
  --data '{"text":"밥 먹고 싶으면 …","words":[{"word":"밥 ","start":0.25,"end":0.93}, …]}'
mmw choice insert "$F" --at 9.8 --duration 3.2 --template choice/liquid --data '{"question":"<文案>","options":["① …","② …"],"pick":0}'
mmw clip list "$F"
```
- **先放气泡（源时间），再从后往前插选项**；选项插入后，后面的片段都后移了 duration，再加的进度条/片尾/BGM 要用输出时间。
- CLI 不能设 linkGroup / volume / 定格源帧：需要时用 build_v5，或 GET→改→PUT（带 revision）：
```bash
node -e "const F=process.argv[1];(async()=>{const u='http://127.0.0.1:4400/api/projects/'+encodeURIComponent(F);const {project:p,revision}=await (await fetch(u)).json();p.clips.find(c=>c.trackId==='A2').volume=0.2;const r=await fetch(u,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({project:p,revision})});console.log(r.status,await r.text())})()" "$F"
```
409 = 期间有人（UI）改过 → 重新 GET 再改。

### 选项时间判定（能量检查）
- t = 本幕最后一句 `speechEnd`（能量结束，含拖长尾音）+ 0.12 s，吸附到帧（×30 取整 /30）；离下一句起点 < 0.25 s 时放在下一句前 0.25 s（但不得早于 speechEnd）。
- 最后一幕：台词说到素材末尾时 t = 视频末尾（`video.end` 同值）。
- 自查：`qa_v5.mjs` 读 A1 在切点前后 0.06 s 的 RMS（> -35 dB 两侧都有 = 切断台词 → fail）；只在切点后有声音 = 下一句/环境音起点 → warn，看一眼即可。
- 选中项：非最后一幕 `pick:0`（文案第 1 个）；最后一幕 `pick:-1`（犹豫，3.6 s）。用户指定则 `--picks`。

## B. 自定义图层路线（无选项剧情 / 用户要新设计）
1. **拆片**：抽帧（每 0.5–1 s）+ ASR + 能量，标出：有台词段、无台词段、脸的位置、亮帧（做头像/片尾）。无台词段不编台词（SKILL 规则 7）。
2. **定方案**：按 `reference/standards.md` 选元素（标题、进度条、内心独白、钩子、片尾、BGM/音效），列出时间表；屏幕文字全部来自全量文案——文案没有的字先向用户申请（规则 5）。
3. **生成图层**：`<工程目录>/包装素材vN/脚本/gen.py`（PIL，1080×1920 透明整画布）；声音 `synth.py` 或音效库。格式与坑见 `reference/custom-layers.md`，参考 `cases/`。
4. **写工程**：幂等脚本 `patch.mjs`（GET→改→PUT），自定义轨道 `X-*`，音效 A3–A6。
5. 抽关键帧目视 → 进入 §5。
6. 验收后存案例：`cases/<日期>-<地区>-<标题>-<风格>/`（脚本 + README，格式照现有案例：类型、路线、包装、声音、用户的修改过程、文件、只作参考）；可复用的套路在 standards §9 加一行指向案例；用户新提的**通用**要求写进 standards 对应节（注明日期）。
用户逐条提修改时：只改对应的生成函数/时间，重新生成（**新文件名**）→ 重跑 patch → 抽帧 → `open_editor.mjs`。

## 5. QA → 自动保存 → 校对预览
```bash
node "$SK/scripts/qa_v5.mjs" "$F" --copy "$COPY" --approved "100만,채팅"     # 先过工程级 QA（exit 0）
mmw autosave "$F"
mmw export start "$F" --kind draft --wait --quiet       # 0.5 倍尺寸；44 s 成片约 4–5 分钟
node "$SK/scripts/qa_v5.mjs" "$F" --copy "$COPY" --approved "100만,채팅" --latest-draft
```
qa_v5 检查：占位未填写、同轨重叠、V1 空洞、A1 是否有原声、文案审计、words 拼接 = text、选项定格亮度、切台词、片尾图集亮度；有校对预览时再做 ffmpeg `blackdetect`（定格/空洞的黑 = fail，源视频自身转场黑 = warn）并抽帧拼 `导出/qa_HHMMSS/sheet.jpg`（标题、每个气泡末词、每个选项、进度条末、片尾）。
**必须用 read 打开 sheet.jpg 目视**：标题完整、气泡文字=文案且没被裁、选项问题/选项齐全、进度条节点、片尾卡文字与图集不黑、没有黑屏帧。

## 6. 成片
```bash
mmw export start "$F" --kind final --wait --quiet      # → 导出/<目录名>_成片_HHMMSS.mp4（h264 crf18 + aac，1080×1920）
```
检查返回 `status:"done"`、`verify.fullDecode:true`、`verify.frames == frames`。单帧：`mmw export start "$F" --kind frame --frame 90 --wait`。

## 7. 交付
**每次修改后（给用户看）**：
```bash
node "$SK/scripts/open_editor.mjs" "$F" --video "<最新校对预览.mp4>"     # 退出码 2 = 工程被旧页面改回 → 重新写入并再检查一次
```
然后告诉用户：改了什么、预览路径、QA 结论（warn 逐条说明）、`确认单.md` 里的自动决定、声音“需要你听一下”。

**用户验收合格后（必须做，用户忘了也要做）**：
```bash
mmw export start "$F" --kind final --wait --quiet
mkdir -p "<工程目录>/成品" && cp "<返回的成片路径>" "<工程目录>/成品/<目录名去掉日期前缀或用户指定名>.mp4"
```
用 ffprobe 确认 1080×1920、时长、有音轨，再打开 `成品` 文件夹给用户。

**用户自己配 BGM 时**：导出「无 BGM 版」——A2 只保留选项段的悬疑 BGM（其余删掉），原声和音效不动，存 `成品/<名>_无BGM版.mp4`，告诉用户选项段的时间范围（他的 BGM 要避让）。

用户在 UI 里手改过的工程，不要再 `build_v5 --replace`（会清空手改），改用 `mmw clip …` 或 GET→PUT 精确修改。

## 8. 迭代版本（同台词、换角色）
用户把同一份提示词换角色生成的新视频放在 `<工程目录>/迭代素材/版本N/`，要求套同一套包装。先告诉用户计划再做。
- **每个版本都重做**（跟画面/声音走的）：抽帧、人脸跟踪（出核对图）、ASR + 能量对齐每个字幕块/倒数/语气词时间、渐黑切点（逐帧亮度找变暗/亮起）、选项定格源帧、**错误人声检测（位置每版不同）**、开头/选项/手机/片尾用的背景帧。
- **直接沿用**：设计、文案、音效、数值、选项节奏。
- **做法**（参考 `cases/2026-10-21-*/`）：`analyze_ver.py N` 出抽帧/track.json/asr.json/黑场/能量 → 把时间写进 `ver_cfg.py` → `VER=N python gen.py`（图层输出到 `包装素材_版本N/`，时间轴按新段长重算）→ `VER=N node patch.mjs`。
- **工程**：改工程前先 GET 备份工程 JSON 到 `工程素材/`，在原工程里换视频生成、导出，全部版本做完后 PUT 还原；用户要在编辑器里单独改某版时，再 `VER=N node patch.mjs` 写回。
- **声音**：用户已配好音乐（如 `成品/音乐.MP3`）就铺满全片，选项段与已交付成品一致（叠悬疑 BGM）。可用「成品 − 无BGM版」与音乐做互相关，核对用户的音量/偏移。
- **交付**：每版 校对预览 → qa → 抽帧目视 → final → 限幅 → `成品/<名>_版本N.mp4`。

## 排错
| 现象 | 处理 |
|---|---|
| `工程已有 N 个片段` | 确认可以重建 → `--replace`；否则用 `mmw clip` 局部改 |
| `文案审计未通过` | 列出的字不在全量文案里：改成文案原句；文案没有就问用户，不能自造 |
| `选项 @t 没有生成定格` | t 处没有视频片段（超出 video.end？）→ 让最后一个选项 `at` = `video.end` |
| `气泡跨过了选项` | 气泡 end 改到 ≤ 选项 at |
| 校对预览黑屏 warn 紧挨选项/台词 | 在 spec `video.holds` 加 `{from,to,frame}`（源秒，frame 取淡出前亮帧）重建 |
| 导出 503 / error / `fetch failed` | 服务可能刚重启：等 5 s `mmw health` 再试；`mmw export status ID` 看 `error`。确认是编辑器 bug → 按 SKILL 规则 4 向用户申请修改，不擅自改 |
| 自定义字体导出后不生效 / 日文变细体 | 见 custom-layers §4、standards §3 |
| 改过的图层没变化 | 图层用了同一个文件名（导入按路径去重）→ 换新文件名 |
| 409 revision 冲突 | UI 同时在改：重新读取后再写（CLI 已自动重试一次） |
| prepare.py 对日语视频对齐失败（用了韩语模型，匹配率 0%） | 不用 mmvp_to_spec，手写 spec：按能量分段（-35 dB，`scan.json` audioDb）定每句起止，段内按假名数平均分配逐字时间；巴掌等瞬态用能量峰 + 剪辑点定位（见女仆案例 `mkspec5.py`） |
| 需要独占开场的标题（标题期间不放正片） | build_v5 不支持：build 后用 patch 把所有片段整体后移标题时长（见女仆案例 `patch5.mjs`）；qa 会报「V1 0–Ns 黑场」，属预期 |
| faster-whisper / whisper 段错误（segfault） | 改用 ElevenLabs：`elevenlabs speech-to-text convert --model-id scribe_v2 --file audio.wav --language-code jpn --diarize true`（带说话人区分）（2026-10-26） |
| ElevenLabs 音乐分段报错 | composition plan 每段 `duration_ms` ≥ 3000（2026-10-26） |
| 动漫角色抠图 rembg CPU 太慢（约 20 s/帧） | transformers `ZhengPeng7/BiRefNet_lite`，torch CUDA fp16（见猫娘报恩案例 `matte.py`）（2026-10-27） |
| 动漫人脸检测不稳/误检 | 手动设脸位置锚点，只用离锚点近的可靠检测微调（见猫娘报恩案例 `gen.py`）（2026-10-27） |
| build 报「A3 @t 与已有片段重叠」 | 同轨音效重叠：先用 ffmpeg/numpy 合成一个文件再放，或换空闲轨 |
