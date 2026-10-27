# 模块模板（`mmw templates` = GET /api/templates）

来源：`app/src/render/templates/<type>/<id>/manifest.js` + `common.js`。同一类型的所有模板 **data 字段完全相同**（换包装只换 templateId/params，文案保留）。
- **data = 文案**（只能来自全量文案；默认全空 = 占位，编辑器显示半透明“默认样式”，导出时不显示，QA 报“未填写”）
- **params = 样式**（颜色、字号、开关；可改，不涉及文案）
- transform 默认 `{x:0,y:0,scale:1,rotation:0,opacity:1,anchorX:.5,anchorY:.5}`，x/y 是相对模板锚点的像素偏移（画布 1080×1920）

| id | 类型 / 轨 | 名称 | 默认时长 | 默认 params | 内置音效 |
|---|---|---|---|---|---|
| `title/liquid` | title / M-title | 液态标题：标签胶囊 + 渐变荧光笔主标题（**首行为胶囊**） | 3.5（KR 规范用 3.1） | `fontSize:72` | in: liquid-swoosh |
| `title/classic` | title | 经典电影感发光标题 | 3.5 | `fontSize:90, titleStyle:"cinematic"(cinematic/clean/chat/impact/label), accent` | in: transition-air |
| `bubble/liquid` | bubble / M-bubble | 液态气泡：思考气泡变形、逐词显现、头像与声纹 | 3 | `fontSize:44, thinking:0.25, waveform:true, highlight:"#C24BE6"` | thinking, pop |
| `bubble/classic` | bubble | 经典玻璃：语音条 + 逐词 | 3 | `fontSize:58, thinking:0.25, waveform:true, color, userColor` | pop |
| `choice/liquid` | choice / M-choice | 液态选择：序号徽章、悬停高亮、选中爆光、手指指针 | 3（KR 用 3.2 / 犹豫 3.6） | `dim:0.48, showBrand:true` | in, option, click, out |
| `choice/classic` | choice | 经典玻璃选项 + 手指 + 倒计时 | 3 | `dim:0.48, showBrand:true, accent` | in, click, out |
| `meter/face` | meter / M-meter | 表情进度条：4 阶段表情头像，锁链锁定最后阶段 | 6 | — | fill, unlock |
| `meter/bar` | meter | 玻璃好感度条，超过 100 彩虹解锁 | 6 | — | fill, unlock |
| `end/liquid` | end / M-end | 液态片尾卡：人物卡图集 + 聊天次数 + 渐变 CTA 连点 | 4（KR 用 4.2） | `clickInterval:0.18, showBrand:true` | in, shine, click |
| `end/classic` | end | 经典人物卡 + CTA 连点 | 4 | `clickInterval:0.18, showBrand:true, accent` | in, click |

| `title/lgxsplit` | title | 独占分屏反差标题：上下两个反差画面 + 液态玻璃标题条 + Logo（2026-10-22） | 2.8 | `mediaId, topTime, bottomTime, topShift, bottomShift, tilt, split`(标题断行字) | in |
| `bubble/lgx` | bubble | 悬浮液态玻璃聊天气泡（平时不显示手机）；所有 lgx 气泡+选项组成同一段聊天记录 | 3 | `tone`(hot=红), `shatterAt`(片段内秒), `slapAt`(成片秒，巴掌震屏/裂纹) | pop |
| `choice/lgx` | choice | 液态玻璃手机弹出 + 试玩广告聊天样式 + 选项 | 3 | `selectAt`(点击秒), `tone`, `phoneExit`, `timeout`(超时失败流程), `timeoutText/failText/retryText` | in, click |
| `meter/lglass` | meter | 液态玻璃数值条，溢出液体；`Overlay` 可做闪白/闪烁 | 6 | `label, overflowAt, centerAt, centerDur, grayAt, fx[]` | fill, drop |
| `end/lgx` | end | 手机收成角色卡 + Logo + 聊天数 + 渐变 CTA 连点；接在超时选项后从失败卡位置展开 | 5.8 | `rewind`(开头时光倒流), `rewindTo`(倒回的源秒) | in, shine, click |

lgx 系列样式在 `src/render/styles/lgx.css`、公共组件 `src/render/ui/lgx.jsx`（液态玻璃 `LGlass`、`PhoneScene`、`FloatChat`、`Shatter`、`ScreenCrack`），用法见 `cases/2026-10-16-JP-女仆-液态玻璃手机/`。

KR 液态默认组合：`title/liquid` + `bubble/liquid` + `choice/liquid` + `meter/face` + `end/liquid`。模板自带音效由合成统一调度，不需要手放到 A3。

## data 字段（★ = 必填，空则 QA“未填写”）

### bubble
| key | 类型 | 文案? | 说明 |
|---|---|---|---|
| ★`text` | string | 文案 | 台词原句（可插 `\n` 语义换行，换行不算改字） |
| `words` | `[{word,start,end}]` | 文案+时间 | **片段内相对秒**；`word` 依次拼接必须 == text（含空格/换行）；为空则按 text 均匀显现 |
| `speaker` | string | 文案 | 说话人名：**文案/用户没给就留空**（只显示头像） |
| `role` | `character` \| `user` | 样式 | user = POV/用户气泡（右侧） |
| `avatarMediaId` | media id | 素材 | 头像图（需先 media import） |

显现规则：思考气泡 0→`params.thinking` 秒，首词 `start` 起逐词出现。所以片段 start 放在首词前 0.25 s。

### title
| ★`text` | string | 文案 | 标题；`title/liquid` 首行显示为胶囊标签 → `MiraiMind에서\n<主标题>` |

### choice
| key | 类型 | 说明 |
|---|---|---|
| ★`question` | string | 【UI提问】行去掉标签前缀后的文字 |
| ★`options` | string[]（≤4） | 文案选项原样（`① …` 前缀可留，模板会去掉并显示序号徽章）；不能有空项 |
| `pick` | int | 选中第几个（0 起）；`-1` = 指针犹豫不选（最后一幕） |

点击时刻 = `selectionFrame(duration) = min(round(0.82×帧数), 帧数−5)`。只通过 `choice insert` 插入。

### meter
| key | 类型 | 说明 |
|---|---|---|
| `stages` | `[{mediaId,label}]×4` | 阶段头像（图片素材 id）与标签；label 空 → 默认 `0% / 50% / 100% / ???`（模板内置，不算自造） |
| `keyframes` | `[{t,value}]` | **片段内秒**；value 0/50/100/150 = 点亮阶段 1–4；每次变化 30 帧缓动并播 fill/unlock 音效 |
| `lockedStage` | int −1..3 | 锁链锁定的阶段（KR 用 3，显示 ???） |

### end
| key | 类型 | 文案? | 说明 |
|---|---|---|---|
| ★`title` | string | 文案 | 结尾卡文案第 1 行 |
| ★`cta` | string | 文案 | 含“下载/다운로드/플레이”的行 |
| `characterName` | string | 文案 | 卡片标题行；没有就空 |
| `chatCount` / `chatLabel` | string | approvedUiStrings | 如 `100만` / `채팅`（kr-liquid profile 批准）；未批准就留空 |
| `gallery` | `[{mediaId,time}]` | 素材 | 源视频秒，取最后一幕 2–3 个**亮**帧 |
| `backdrop` | `{mediaId,time}` | 素材 | 背景帧（不在编辑面板里，但模板支持）；缺省 = gallery[0] |
| `clicks` | int 1–10 | 样式 | CTA 连点次数（默认 5） |
