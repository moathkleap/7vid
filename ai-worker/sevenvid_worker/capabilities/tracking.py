"""Object/face tracking with OpenCV trackers plus periodic re-detection and honest loss reporting."""
from __future__ import annotations

from typing import Any

from ..rpc import WorkerError
from . import faces as faces_mod
from ._media import iou, open_video


def probe() -> dict[str, Any]:
    try:
        import cv2

        ok = hasattr(cv2, "TrackerCSRT_create") or (hasattr(cv2, "legacy") and hasattr(cv2.legacy, "TrackerCSRT_create"))
        return {"available": ok, "reason": None if ok else "OpenCV build lacks CSRT tracker", "details": {"vittrack": hasattr(cv2, "TrackerVit_create")}}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"opencv missing: {e}"}


def _make_tracker(kind: str, vit_model: str | None):
    import cv2

    if kind == "vit" and vit_model and hasattr(cv2, "TrackerVit_create"):
        p = cv2.TrackerVit_Params()
        p.net = vit_model
        return cv2.TrackerVit_create(p)
    if hasattr(cv2, "TrackerCSRT_create"):
        return cv2.TrackerCSRT_create()
    return cv2.legacy.TrackerCSRT_create()


def run(params: dict, ctx) -> dict[str, Any]:
    """Tracks one target box from `start_ms` to `end_ms`. Returns per-frame keyframes (normalized) and status."""
    import cv2

    path = params["path"]
    start_ms = float(params["start_ms"])
    end_ms = float(params["end_ms"])
    box = params["box"]  # normalized {x,y,w,h}
    kind = params.get("tracker", "csrt")
    detector_kind = params.get("detector")  # 'face' | None
    face_model = params.get("face_model_path")
    redetect_every = int(params.get("redetect_every", 15))
    max_lost = int(params.get("max_lost_frames", 30))
    keyframe_every = int(params.get("keyframe_every", 1))
    cap, meta = open_video(path)
    W, H = meta.width, meta.height
    try:
        start_frame = int(round(start_ms / 1000 * meta.fps))
        end_frame = int(round(end_ms / 1000 * meta.fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        ok, frame = cap.read()
        if not ok:
            raise WorkerError("MEDIA_UNSUPPORTED", "could not read the start frame")
        px = (box["x"] * W, box["y"] * H, box["w"] * W, box["h"] * H)
        tracker = _make_tracker(kind, params.get("vit_model_path"))
        tracker.init(frame, tuple(int(round(v)) for v in px))
        det = faces_mod.detector(face_model, W, H, float(params.get("score_threshold", 0.6))) if detector_kind == "face" and face_model else None
        keyframes: list[dict[str, Any]] = [{"t_ms": start_frame / meta.fps * 1000, "x": box["x"], "y": box["y"], "w": box["w"], "h": box["h"], "confidence": 1.0}]
        lost_ranges: list[dict[str, float]] = []
        lost_run = 0
        lost_start: float | None = None
        current = px
        idx = start_frame + 1
        total = max(1, end_frame - start_frame)
        while idx <= end_frame:
            ok, frame = cap.read()
            if not ok:
                break
            t_ms = idx / meta.fps * 1000
            tracked, tb = tracker.update(frame)
            conf = 0.8 if tracked else 0.0
            if tracked:
                x, y, w, h = [float(v) for v in tb]
                inside = x + w > 0 and y + h > 0 and x < W and y < H and w > 4 and h > 4
                if inside:
                    current = (x, y, w, h)
                else:
                    tracked = False
            if det is not None and (idx - start_frame) % redetect_every == 0:
                dets = faces_mod.detect_in_frame(det, frame)
                best, best_iou = None, 0.0
                for d in dets:
                    cand = (d["x"] * W, d["y"] * H, d["w"] * W, d["h"] * H)
                    score = iou(cand, current)
                    if score > best_iou:
                        best, best_iou = cand, score
                if best is not None and best_iou >= 0.3:
                    current = best
                    conf = 1.0
                    tracked = True
                    tracker = _make_tracker(kind, params.get("vit_model_path"))
                    tracker.init(frame, tuple(int(round(v)) for v in best))
                elif not tracked and best is not None:
                    cx, cy = current[0] + current[2] / 2, current[1] + current[3] / 2
                    bx, by = best[0] + best[2] / 2, best[1] + best[3] / 2
                    if ((cx - bx) ** 2 + (cy - by) ** 2) ** 0.5 < 0.2 * max(W, H):
                        current = best
                        conf = 0.9
                        tracked = True
                        tracker = _make_tracker(kind, params.get("vit_model_path"))
                        tracker.init(frame, tuple(int(round(v)) for v in best))
            if tracked:
                if lost_start is not None:
                    lost_ranges.append({"start_ms": lost_start, "end_ms": t_ms})
                    lost_start = None
                lost_run = 0
            else:
                lost_run += 1
                if lost_start is None:
                    lost_start = t_ms
                if lost_run > max_lost:
                    break
            if (idx - start_frame) % keyframe_every == 0:
                x, y, w, h = current
                keyframes.append({"t_ms": round(t_ms, 3), "x": max(0.0, x / W), "y": max(0.0, y / H), "w": min(1.0, w / W), "h": min(1.0, h / H), "confidence": conf})
            if (idx - start_frame) % 10 == 0:
                ctx.progress(min(0.99, (idx - start_frame) / total), "tracking")
                ctx.check()
            idx += 1
        if lost_start is not None:
            lost_ranges.append({"start_ms": lost_start, "end_ms": idx / meta.fps * 1000})
        covered_end = keyframes[-1]["t_ms"] if keyframes else start_ms
        lost_ms = sum(r["end_ms"] - r["start_ms"] for r in lost_ranges)
        if lost_run > max_lost:
            status = "lost"
        elif lost_ms > 0.15 * (end_ms - start_ms):
            status = "partial"
        else:
            status = "ok"
        return {"keyframes": keyframes, "status": status, "lost_ranges": lost_ranges, "covered_end_ms": covered_end, "width": W, "height": H, "fps": meta.fps}
    finally:
        cap.release()


METHODS = {"track.run": run}
