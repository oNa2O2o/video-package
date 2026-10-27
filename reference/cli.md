# CLI `bin/mmw.mjs` + REST（来源：app/docs/API.md）

`mmw` = `node F:/钟海明/2026/2026年10月10日MM-编辑器重构/app/bin/mmw.mjs`。stdout 输出 JSON；失败 stderr `{error,status,detail}`、退出码 1（`export wait`：失败 2、超时 3）。
写操作都是“GET 工程 → model.js 纯函数 → PUT(revision)，409 自动重试一次”，可与 UI 同时编辑。时间 = 成片时间秒，帧 = round(t×30)。
服务器地址：`--api URL` > `MM_API` > `app/data/server.json` > `http://127.0.0.1:4400`。`FOLDER` = 项目根下目录名（也接受工程目录绝对路径）。

## 健康 / 设置
```bash
mmw health                                   # {ok, version, dev, port, pid, projectsRoot}
mmw settings                                 # {projectsRoot, theme, muted, lastProject, projectsRootLocked?}
mmw settings set theme=\"light\" muted=true    # 值按 JSON 解析；允许键 projectsRoot theme muted lastProject volume shortcutScheme region prefs
```

## 工程
```bash
mmw projects list                                            # 命名合规且含 工程.mmproj 的目录，新→旧
mmw projects create --title 扣傲慢义姐零花钱 --region KR [--product MM] [--date 2026-10-11] [--width 1080 --height 1920]
mmw projects create --folder-name "2026年10月11日-MM-KR-扣傲慢义姐零花钱"
mmw projects show "$F"                                       # {folder, path, project, revision}
mmw projects duplicate "$F"                                  # 标题+“副本”，不复制 自动保存/ 导出/
```
create → 201 `{folder, path, project, revision}`；标题空 400 “素材标题必填”；命名不合规 400；已存在 409（不覆盖）。

## 素材
```bash
mmw media import "$F" "F:/素材/原片.mp4"           # 复制进 素材/ + 加入 project.media → {media:{id,kind,name,path,duration,width,height,hasAudio,fps}}
mmw media import "$F" "$APP/public/audio/bgm-liquid-crush.wav"   # 音频库文件用绝对路径
mmw media import "$F" a.png --no-add               # 只复制不加入工程
```
同名同内容复用，同名不同内容 → `名称-2.ext`。

## 片段
```bash
mmw clip list "$F"                                   # [{id, trackId, type, start, duration, end, mediaId, template, data}]
mmw clip add "$F" --type video --media M --track V1 --start 0 [--duration D] [--in 0]
mmw clip add "$F" --type audio --media M --track A1 --start 0 [--duration D] [--in 0]     # 原声 A1 / BGM A2 / 音效 A3
mmw clip add "$F" --type image --media M --start 0 --duration 3
mmw clip add "$F" --type module --template bubble/liquid [--track M-bubble] --start 1.2 --duration 2.5 --data '{"text":"文案原句"}' [--params '{}']
mmw clip move "$F" CLIP --start 3 [--track M-bubble]
mmw clip split "$F" CLIP --at 5
mmw clip delete "$F" CLIP1 CLIP2 [--ripple]          # 删 choice 会连带删其定格并合拢空隙
```
- 模块轨按模板类型自动选：`M-title M-bubble M-choice M-meter M-end`；视频 `V1`；音频 `A1 原声 / A2 BGM / A3 音效`。
- module 的 data = 模板默认 data（文案全空）合并 `--data`；params 同理。
- 同轨重叠会报错（`--force` 跳过，不要用）。
- video 片段默认 duration = 素材时长 − in；**视频渲染静音**，原声要另加 A1 audio。CLI 不设 linkGroup/volume/fit。

## 选项（插入定格）
```bash
mmw choice insert "$F" --at 12.4 [--duration 3.2] [--template choice/liquid] [--track M-choice] \
  --data '{"question":"…","options":["① …","② …"],"pick":0}' [--params '{}']
```
在 t 处切开所有视频/音频片段 → 整体后推 duration → 每条视频轨插 freeze（断点前一帧、静音，`freezeOf`=choice id）→ 放 choice 模块。t 必须正好是某段视频的结尾或内部，否则没有定格。

## 链接 / 自动保存 / 历史 / 工程包
```bash
mmw link "$F" "F:/…/2026年10月9日-MM-KR-旧工程"        # 幂等
mmw autosave "$F" [--force]                            # 内容未变 → {skipped:true}
mmw history list "$F"                                  # [{file,time,size}] 旧→新
mmw history restore "$F" 20261011-153000.mmproj        # 先备份当前再恢复
mmw package "$F" --mode self|withLinks [--collect]     # --collect = AE 收集文件 → 整理工程_时间/
```

## 导出
```bash
mmw export start "$F" --kind draft --wait [--quiet]    # 校对预览 0.5×，导出/<目录名>_校对预览_HHMMSS.mp4
mmw export start "$F" --kind final --wait              # 成片，导出/<目录名>_成片_HHMMSS.mp4
mmw export start "$F" --kind frame --frame 90 --wait   # 单帧 PNG 导出/<目录名>_帧90.png
mmw export status [ID] | mmw export wait ID [--timeout 1800] | mmw export cancel ID
```
记录：`{id, status: queued|rendering|done|error|cancelled, progress, file, relPath, width, height, fps, duration, frames, size, error, exists, verify:{width,height,fps,frames,duration,fullDecode}}`。服务器不会因占位拦截导出——导出前自己跑 `qa_v5.mjs`。

## 库
```bash
mmw templates      # 模板 manifest（见 templates.md）
mmw fonts          # [{family, weight, url, source}]
mmw audio          # [{name, file, url, path, category: BGM|音效|点击|上传, duration}]
```

## REST（CLI 覆盖不到时直接调用；前缀 /api，别名 /v1）
| 方法 路径 | 说明 |
|---|---|
| GET `/health` · GET/PUT `/settings` | |
| GET/POST `/projects` | 列表 / 新建 `{product,region,title,date?}` 或 `{folderName}` |
| GET `/projects/:folder` | `{folder,path,project,revision}` |
| PUT `/projects/:folder` | `{project, revision}` → zod 校验；revision 不一致 409 `{revision}`；revision 省略 = 强制覆盖（别用） |
| POST `/projects/:folder/duplicate` | `{title?}` |
| POST `/projects/:folder/media` | multipart `file` 或 `{sourcePath}`（也接受 `/audio/x.wav`）→ `{media}`，**不改工程**，调用方自己 push 进 project.media 再 PUT |
| POST `/projects/:folder/clipboard-image` | `{dataUrl}` → 素材/截图/粘贴-时间.png |
| GET `/projects/:folder/file?path=` | 媒体流（Range） |
| POST `/projects/:folder/link` · `/autosave` · `/package` | 同 CLI |
| GET `/projects/:folder/history` · POST `/history/restore` `{file}` | |
| POST `/exports` `{folder, kind, frame?, project?}` | 202；`project` = 指定快照，缺省读磁盘 |
| GET `/exports` · GET `/exports/:id` · POST `/exports/:id/cancel` · `/reveal` · DELETE `/exports/:id` | |
| GET `/templates` · `/fonts` · `/audio-library` · POST `/fonts` · `/audio-library`（multipart） | |

工程数据模型：`app/src/shared/model.js`（`projectSchema`）。片段关键字段：`{id, trackId, start, duration, type: video|image|audio|freeze|module, mediaId, in, speed, volume, fadeIn, fadeOut, linkGroup, freezeOf, transform, fit: blur-pad|cover|contain|fill, keyframes, module:{type, templateId, templateVersion, data, params}}`。
