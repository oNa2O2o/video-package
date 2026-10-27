# CHANGELOG

## v1.1.0 — 2026-10-27
- 硬规则 3：只在出图/视频时展示，其他产物不开目录；新增 `scripts/open_dir.ps1`，目录已打开就不重复开。
- standards：截图/头像挑角色最好看的一帧；可选打法新增人物身后弹幕、最后一题心跳、片尾口播手机屏。
- custom-layers：逐帧图层可行、定格变换要同步到蒙版/跟脸；torch CUDA 崩溃改 CPU rembg。
- workflow 排错：whisper 段错误改 ElevenLabs scribe_v2；ElevenLabs 音乐分段 ≥3000ms。
- 新增案例 `cases/2026-10-26-JP-1年ぶりの彼-深夜琥珀/`。

## v1.0.0
- 初版（未打版本号前的状态）。
