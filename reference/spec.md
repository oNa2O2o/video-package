# v5-spec.json（`scripts/build_v5.mjs` 的输入）

由 `mmvp_to_spec.py` 生成，也可以手写/手改。**除特别说明，时间都是源视频秒**（插入选项之前的时间）；build_v5 自动换算成片时间：`out(s) = s + Σ(at ≤ s 的选项 duration)`，所以 `at` 恰好等于某选项时间的点落在该选项之后。

```jsonc
{
  "folder": "2026年10月11日-MM-KR-扣傲慢义姐零花钱",        // 工程目录名
  "app": "F:/钟海明/2026/2026年10月10日MM-编辑器重构/app",   // 用来 import src/shared/model.js
  "copyFile": "F:/…/全量文案.md",                            // 文案审计的唯一来源（必填）
  "approvedUiStrings": ["100만", "채팅"],                     // 文案外允许上屏的字（来自 profile，用户批准过）
  "video": {
    "mediaId": "m…", "in": 0, "end": 29.7, "fit": "blur-pad",   // end = 最后一个选项时间（片尾黑场不要）
    "holds": [{"from": 19.1, "to": 20.167, "frame": 19.067}]    // 该段 V1 改为定格 frame（遮源视频淡出黑场，A1 照播）
  },
  "title": {"template": "title/liquid", "text": "MiraiMind에서\n오만한 새누나 용돈 압류하기", "duration": 3.1},
  "bubbles": [
    {"template": "bubble/liquid", "start": 2.29, "end": 7.19,       // 片段区间（源秒）；不得跨过任何选项 at
     "text": "밥 먹고 싶으면 알아서 끓여 먹고,\n생활비나 내놔!",
     "words": [{"word": "밥 ", "start": 2.54, "end": 3.22}, …],    // 源秒（build 时转成片段内相对秒）；拼接 == text
     "role": "character", "speaker": "", "avatar": "F:/…/face.png"}  // speaker/avatar 可选；speaker 必须出自文案
  ],
  "choices": [
    {"template": "choice/liquid", "at": 9.8, "duration": 3.2, "question": "…", "options": ["① …", "② …", "③ …"], "pick": 0,
     "freezeAt": 9.833}                                               // 可选：定格用的源帧（默认 = at 前一帧）
  ],
  "meter": {"template": "meter/face", "start": 3.1,                  // 起点（源秒），终点默认 = 片尾前
    "keyframes": [{"at": 3.2, "value": 0}, {"at": 9.8, "value": 50}, {"at": 20.167, "value": 100}],
    "stages": [{"image": "F:/…/stage1.png"}, {}, {}, {}], "lockedStage": 3},
  "end": {"template": "end/liquid", "duration": 4.2, "title": "…", "cta": "…", "characterName": "…",
    "chatCount": "100만", "chatLabel": "채팅", "gallery": [21.5, 24.83, 28.17], "backdrop": 28.17},
  "bgm": {"file": "F:/…/app/public/audio/bgm-liquid-crush.wav", "volume": 0.2, "fadeOut": 0.6},
  "sfx": [{"file": "F:/…/app/public/audio/thought.wav", "at": 5.0, "volume": 0.8}]   // at=源秒，或 outAt=成片秒
}
```

规则：
- `options` 数量 2–4；最后一幕 `pick:-1` 时 duration 3.6。
- 最后一个选项 `at` ≥ `video.end` 时自动对齐到 `video.end`（帧对齐），才能生成定格。
- build 之后 `notes` 字段被忽略（mmvp_to_spec 用它记录未写台词、ASR 错听、自动决定原因）。
- 修改 spec 后重跑 `build_v5.mjs v5-spec.json --replace`（会清空时间轴；用户 UI 手改过的工程不要这样做）。
