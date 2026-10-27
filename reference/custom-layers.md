# 自定义图层路线（B 路线）技术参考

适用：无选项剧情、或用户要求新设计时，不用模板，自己生成图层写进工程。完整例子：`cases/2026-10-19-JP-偶像逆攻略男性向/`（`gen.py` 生成图层、`synth.py` 合成音频、`patch2.mjs` 写工程）。

## 1. 文件放哪
全部放在**用户的工程目录**里，例如：
```
<工程目录>/包装素材vN/          生成的 PNG（1080×1920 透明整画布）
<工程目录>/包装素材vN/audio/    合成的 BGM / 音效 wav
<工程目录>/包装素材vN/脚本/     gen.py / synth.py / patch.mjs（可直接重跑）
```
不要用 `_tmp` 之类的临时目录。

## 2. 生成图层（PIL）
- 每个图层都是 **1080×1920 透明 PNG，元素画在最终位置**；clip 用 `fit:'fill'`，`transform` 全默认 → 位置天然对齐。
- 动画靠 clip 关键帧，缩放/旋转的中心用 `anchorX/anchorY`（0–1，= 元素中心像素 / 画布尺寸）。
- **重新生成的图必须换新文件名**（如 `mt2_`、`_b`、`_c` 后缀）：`media import` 按路径去重，同名文件不会更新。
- 描边 + 发光：先画放大描边层，再 GaussianBlur 做 glow，最后叠文字（见 gen.py `text_layer` / `glow`）。

## 3. 写进工程（GET → 改 → PUT）
```js
let {project: p, revision} = await GET(`/projects/${F}`);
const {media: m} = await POST(`/projects/${F}/media`, {sourcePath: abs});   // 复制进 素材/，返回 media
p.media.push(m);                                                             // 已存在同 path 就复用旧 id
p.tracks.splice(idx, 0, {id: 'X-title', kind: 'module', moduleType: 'title', name: '标题', locked: false, hidden: false, muted: false});
p.clips.push({id, trackId: 'X-title', type: 'image', name: '标题', start, duration, mediaId, fit: 'fill',
  transform: {x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, anchorX: .5, anchorY: .5},
  keyframes: {opacity: [{t: 0, v: 0}, {t: .3, v: 1, ease: 'ease'}], scale: [...], scaleX: [...], x: [...], y: [...], rotation: [...]}});
await PUT(`/projects/${F}`, {project: p, revision});
```
- 关键帧 `t` 是 **clip 内相对秒**；`x/y` 是像素位移；`scaleX` 可做进度条填充（anchorX 设在条的左端）。
- 脚本要**幂等**：开头先删掉自己加的轨道/片段（`X-*`、A2–A6 等）再重加，方便反复重跑。
- 轨道顺序 = 数组顺序，后面的在上层。
- 图片片段也可以放在 V1（例如片尾背景），保证 V1 不空。

## 4. 字体
- 上传：`POST /api/fonts`（multipart `file`），之后 `GET /api/fonts` 能看到 `{family, url}`；模板参数 `module.params.font = family`。
- 自定义字体在导出时也要生效：导出渲染从另一个 origin 加载 `/font-files/*`，需要服务端开 CORS（2026-10-19 已经在编辑器里修好）。导出后要抽帧确认字体对了。

## 5. 音频
- 轨道：A1 原声、A2 BGM、A3–A6 音效（同轨不重叠，按时间分配到空闲轨）。
- 字段：`{type:'audio', mediaId, start, duration, in, speed:1, volume, fadeIn, fadeOut}`。
- 删掉原声中的某段：把 A1 拆成两段，中间留空（拆开后的段去掉 `linkGroup`）。
- 模板气泡音效：`module.params.sounds = {thinking: null}` 关闭思考音；弹出音保留。

## 6. 检查
- 单帧：`mmw export start F --kind frame --frame N --wait`。**以返回的 `file` 为准**（同名会生成 `-2`、`-3` 后缀）。
- 校对预览是 540×960，抽帧拼图前先放大到 1080×1920 再裁。
- 图层多时用 `qa_v5.mjs`（重叠、V1 空洞、文案审计）+ 关键时刻抽帧目视。

## 7. 编辑器已知坑
- 已打开的旧编辑器页面会拿旧数据保存。2026-10-19 已修改：发生 409 冲突时载入服务端版本，不再覆盖。仍要求每次改完运行 `scripts/open_editor.mjs`（刷新所有页面 + 30 s 检查）。
- `listProjects` 只列出 `projectsRoot` 的直接子目录里、名字符合规范的工程。
- **片段时长 ≥ 1/30 s**，否则 PUT 报 `duration: Number must be greater than or equal to …`。start/end 先吸附到帧（`Math.round(t*30)/30`），再保留 **4 位小数**；只保留 3 位时相邻片段会被 qa 判成“同轨重叠”。
- 关键帧 `ease: 'hold'` = 保持到下一个关键帧（硬闪烁、数值跳变、循环复位用它；缺省是平滑过渡）。
- 反复重新生成后旧 PNG 还留在 `p.media` 里：patch 末尾清掉没被任何片段引用的 media。
- 黑幕过渡统一放 `X-black` 轨：qa_v5 对该轨覆盖的黑屏只记 info，不算 fail。
- **段长先吸附到 1/30 s 再累加偏移**：否则后面按偏移算出的片尾背景等 V1 片段会和上一段差半帧，qa 报「V1 @t：同轨重叠」。（2026-10-21）
- **编辑器混音没有限幅**：人声 + 音效 + BGM 叠加会到 +2–3 dBFS。交付成品前过一遍 `ffmpeg -i 成片 -c:v copy -af "alimiter=limit=0.89:level=false" -c:a aac -b:a 192k 成品.mp4`。（2026-10-21）
- **导出单独调用**：不要把 draft + final 串在一条后台命令里（工具 600 s 超时会留下 `.partial.mp4` 和中断的任务）；一次 `export start --wait` 一条命令，残留 `.partial.mp4` 删掉。（2026-10-21）
- **ASR 会认错同音字**（如 集金→就勤、後日→公実/口実）：只用它对时间，屏幕文字一律用全量文案。（2026-10-21）
- **先用静帧合成看版面**：`preview4.py`（bg_at(T) + 该时刻图层按关键帧插值）几秒出图，不用每次等 3–5 分钟导出；定稿后再导出校对预览。代码见 `cases/2026-10-21-*/`。（2026-10-21）
- **逐帧图层可行**：弹幕/手机屏每帧一个片段（单工程 1265 个片段），编辑器和导出都正常。（2026-10-26）
- **定格画面上的蒙版/跟脸位置要做同样的变换**：定格片段有 scale 关键帧和锚点时，蒙版和跟脸坐标按同一缩放、锚点换算，否则对不上。（2026-10-26）
- `mmw export start` 输出里有非法转义，不要管道给 `json.load`；用 `grep '"file"'` 取路径。

## 8. 环境（Agent 自己配好，不找用户）
缺依赖时自己安装、自己验证，交付说明里写一句装了什么。本机已配好（2026-10-21）：
- **faster-whisper GPU**：RTX 5070 + `nvidia-cublas-cu12`、`nvidia-cudnn-cu12==9.*`（pip），site-packages 下 `zz_nvidia_dll_path.pth` 启动时把 `nvidia/*/bin` 加进 DLL 路径 → `device='cuda', compute_type='float16'` 可用。若再报 `cublas64_12.dll is not found`，检查这两个包和 .pth。
- **OpenCV 人脸检测**：系统 `cv2` 是 5.0（没有 `CascadeClassifier`）→ 用 4.x：`pip install opencv-python-headless==4.10.0.84 --target C:/Users/zhonghaiming5328/cv4`，脚本里 `sys.path.insert(0, 'C:/Users/zhonghaiming5328/cv4')`。OpenCV 不能读中文路径：视频/模型先复制到 ASCII 路径，或 `cv2.imdecode(np.fromfile(p, np.uint8), …)`。动漫脸模型 `lbpcascade_animeface.xml` 在伪人案例目录。
- **看图**：read 读导出帧常报 ENOENT → 先 `cp` 到 `C:/mmview/` 再读（偶尔要重试一次）；多帧用 ffmpeg `hstack` 拼一张。（2026-10-22）
- **Git Bash**：循环里跑 ffmpeg 要加 `-nostdin` 和 `</dev/null`；Windows 的 python 不认 `/tmp`，临时文件放 `工作区/`；python 输出中文先 `export PYTHONIOENCODING=utf-8`。（2026-10-22）
- **MusicGen**：`facebook/musicgen-stereo-large`（transformers，RTX 5070 12GB 可跑），已下载到 HF 缓存。（2026-10-22）
- **torch CUDA 会崩**：`torch.cuda.is_available()` 直接 access violation（rembg 走 GPU 同样崩）。抠人物用 rembg `new_session('u2net_human_seg')` 跑 CPU，529 帧约 13 分钟，后台跑。（2026-10-26）
- **ASR**：整条视频一次识别可能把前 20 s 糊成一个词 → 按幕切开识别，并给 `initial_prompt` = 该幕文案。
