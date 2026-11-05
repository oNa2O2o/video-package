"""把导出目录里带时间戳的 校对预览/成片 改成版本号命名（用户 2026-11-05 要求：按 v几 命名，方便找）。
用法：python ver_draft.py <工程目录>
  - 导出/<名>_校对预览_HHMMSS.mp4 → 导出/<名>_校对预览_vN.mp4（按修改时间从旧到新接着已有的最大 vN 编号）
  - 成片同理：_成片_HHMMSS.mp4 → _成片_vN.mp4
  - 打印最新校对预览的路径（之后 qa 用 --draft <该路径>，open_editor 用 --video <该路径>）
"""
import os, re, sys
d = os.path.join(sys.argv[1], '导出')
latest = None
for kind in ('校对预览', '成片'):
    fs = [f for f in os.listdir(d) if f.endswith('.mp4') and f'_{kind}_' in f]
    vs = [int(m.group(1)) for f in fs if (m := re.search(rf'_{kind}_v(\d+)\.mp4$', f))]
    n = max(vs, default=0)
    ts = sorted([f for f in fs if re.search(rf'_{kind}_\d{{6}}\.mp4$', f)], key=lambda f: os.path.getmtime(os.path.join(d, f)))
    for f in ts:
        n += 1; new = re.sub(rf'_{kind}_\d{{6}}\.mp4$', f'_{kind}_v{n}.mp4', f)
        os.rename(os.path.join(d, f), os.path.join(d, new)); print(f'{f} -> {new}')
    if kind == '校对预览' and n: latest = os.path.join(d, next(f for f in os.listdir(d) if f.endswith(f'_{kind}_v{n}.mp4'))).replace('\\', '/')
print('LATEST', latest)
