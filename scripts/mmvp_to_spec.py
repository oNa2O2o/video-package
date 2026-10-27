# -*- coding: utf-8 -*-
"""Convert mm-video-packager ① output (工作区/mmvp/plan.json + align.json + scan.json) into a v5-spec.json
for build_v5.mjs.  All screen text is taken verbatim from plan/copy (which come from the full copy file).

  python mmvp_to_spec.py --mmvp <dir>/工作区/mmvp --folder "<v5 folder>" --media <videoMediaId> \
      --copy <全量文案.md> [--profile <kr-liquid.json>] [--app <app root>] [--portraits a.png b.png c.png d.png] \
      [--ignore-unscripted] [--picks 0,0,-1] [--out v5-spec.json]

Times stay in SOURCE seconds; build_v5.mjs maps them onto the output timeline (choices insert freezes).
"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path

FPS = 30
SKILL_OLD = Path(__file__).resolve().parents[2] / "mm-video-packager"
DEFAULT_APP = "F:/钟海明/2026/2026年10月10日MM-编辑器重构/app"

def snap(t): return round(round(t * FPS) / FPS, 4)
def read(p): return json.loads(Path(p).read_text(encoding="utf-8"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mmvp", required=True); ap.add_argument("--folder", required=True); ap.add_argument("--media", required=True)
    ap.add_argument("--copy", required=True); ap.add_argument("--profile", default=str(SKILL_OLD / "profiles" / "kr-liquid.json"))
    ap.add_argument("--app", default=DEFAULT_APP); ap.add_argument("--portraits", nargs="*", default=[])
    ap.add_argument("--ignore-unscripted", action="store_true", help="user answered 忽略未写台词")
    ap.add_argument("--picks", default="", help="override selected option per choice, e.g. 0,1,-1")
    ap.add_argument("--lead", type=float, default=0.25, help="bubble starts this long before its first word (thinking pill)")
    ap.add_argument("--no-holds", action="store_true", help="do not cover source black/fades with held frames")
    ap.add_argument("--out", default="v5-spec.json")
    a = ap.parse_args()
    mm = Path(a.mmvp); plan = read(mm / "plan.json"); align = read(mm / "align.json"); prof = read(a.profile)
    design, choice_cfg, audio = prof["design"], prof["choice"], prof["audio"]

    if plan["hard"] and not (a.ignore_unscripted and all("原声说了文案里没有的内容" in q for q in plan["hard"])):
        print(json.dumps({"error": "确认单里还有“必须回答”的问题，先问用户", "hard": plan["hard"]}, ensure_ascii=False, indent=1)); sys.exit(2)

    picks = [int(x) for x in a.picks.split(",")] if a.picks else []
    choices = []
    for i, c in enumerate(plan["choices"]):
        pick = picks[i] if i < len(picks) else c["selected"]
        choices.append({"template": "choice/liquid", "at": snap(c["t"]), "duration": choice_cfg["hesitateDuration"] if pick < 0 else choice_cfg["selectDuration"],
                        "question": c["question"], "options": c["options"], "pick": pick,
                        **({"freezeAt": round(c["host"], 3)} if c.get("host") is not None else {})})
    at_list = [c["at"] for c in choices]

    # bubbles: one per aligned copy line; words keep the copy text (ASR only gave timing)
    unscripted = align.get("unscripted", [])
    speech = read(mm / "scan.json")["speech"] if (mm / "scan.json").exists() else []
    cues = [cue for cl in plan["clips"] if cl["kind"] == "main" for cue in cl["cues"]]
    cues.sort(key=lambda c: c["start"])
    bubbles, prev_end = [], 0.0
    for k, cue in enumerate(cues):
        words = [{"word": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in cue["words"]]
        start = max(prev_end, words[0]["start"] - a.lead, 0.0)
        end = cue["endAbs"]
        # never let a bubble linger over speech that is not in the copy
        # (ASR pins the first unscripted word into the preceding silence, so use the energy onset from scan.json)
        for u in unscripted:
            if u["end"] > cue["speechEnd"] + 0.3 and u["start"] < end:
                onset = next((s for s, e in speech if s > cue["speechEnd"] + 0.05), u["start"])
                end = min(end, max(cue["speechEnd"] + 0.2, onset - 0.1))
        # never cross a choice point (choice freezes are inserted there)
        for t in at_list:
            if start < t < end: end = t
        end = round(end, 3)
        bubbles.append({"template": "bubble/liquid", "start": round(start, 3), "end": end, "text": cue["text"], "words": words})
        prev_end = end

    video_end = snap(plan["choices"][-1]["t"]) if plan["choices"] and plan["choices"][-1]["final"] else snap(plan["duration"])
    # holds: source fade/black that overlaps speech or touches a choice → hold the last bright frame on V1
    # (A1 audio keeps playing, so no speech is cut and no black frame is shown)
    holds = []
    scan = read(mm / "scan.json") if (mm / "scan.json").exists() else None
    if scan and not a.no_holds:
        L = scan["luma"]; lum = lambda t: L[min(len(L) - 1, max(0, int(round(t * FPS))))]
        for d0, d1 in scan["darkRanges"]:
            if d0 >= video_end - 1e-3: continue
            talk = any(s0 < d1 and s1 > d0 - 0.2 for s0, s1 in scan["speech"])
            near = any(d0 - 0.35 <= t <= d1 + 0.35 for t in at_list)
            if not (talk or near): continue
            ref = max([lum(d0 - k / FPS) for k in range(1, 46)] or [0])
            f = int(round(d0 * FPS))
            while f > 0 and L[f] < 0.85 * ref: f -= 1          # walk back through the fade-out
            frame = f / FPS
            if L[f] < scan["thresholds"]["darkLuma"] + 8: continue  # nothing bright to hold
            frm, to = (f + 1) / FPS, min(d1, video_end)
            for c in choices:                                 # a choice inside / next to the hold freezes the same frame
                if frm - 0.35 <= c["at"] <= to + 0.35:
                    c["freezeAt"] = round(frame, 4)
                    if c["at"] < frm: frm = c["at"]           # no 2-frame flicker of live video between choice and hold
            holds.append({"from": round(frm, 4), "to": round(to, 4), "frame": round(frame, 4)})
    meter = None
    if design.get("meter", {}).get("enabled"):
        aff = [x for cl in plan["clips"] for x in cl["affection"]]
        stage_imgs = (a.portraits + [""] * 4)[:4]
        meter = {"template": "meter/face", "start": design["titleDuration"],
                 "keyframes": [{"at": round(x["t"], 3), "value": x["value"]} for x in sorted(aff, key=lambda x: x["t"])],
                 "stages": [{"image": p} if p else {} for p in stage_imgs], "lockedStage": 3}
    gal = plan.get("gallery", {})
    spec = {
        "folder": a.folder, "app": a.app, "copyFile": str(Path(a.copy).resolve()).replace("\\", "/"),
        "approvedUiStrings": prof.get("approvedUiStrings", []),
        "video": {"mediaId": a.media, "in": 0, "end": video_end, "fit": design.get("fitMode", "blur-pad"), "holds": holds},
        "title": {"template": "title/liquid", "text": plan["title"], "duration": design["titleDuration"]},
        "bubbles": bubbles, "choices": choices, "meter": meter,
        "end": {"template": "end/liquid", "duration": design["endDuration"], "title": plan["endTitle"], "cta": plan["cta"],
                "characterName": plan.get("cardTitle", ""), "chatCount": design.get("chatCount", ""), "chatLabel": design.get("chatLabel", ""),
                "gallery": [round(t, 3) for t in gal.get("times", [])], **({"backdrop": round(gal["backdrop"], 3)} if gal.get("backdrop") is not None else {})},
        "bgm": {"file": str(Path(a.app) / "public" / "audio" / f"bgm-{audio['bgmTrack']}.wav").replace("\\", "/"), "volume": audio.get("bgmVolume", 0.2)} if audio.get("bgmTrack") else None,
        "notes": {"unscripted": unscripted, "asrDiffs": align.get("diffs", []), "reasons": plan.get("reasons", [])},
    }
    if not meter: spec.pop("meter")
    Path(a.out).write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {a.out}: {len(bubbles)} bubbles, {len(choices)} choices, video 0–{video_end}s")

if __name__ == "__main__":
    main()
