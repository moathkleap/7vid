"""Object detection with MediaPipe EfficientDet-Lite (COCO classes) on sampled frames."""
from __future__ import annotations

import os
from typing import Any

from ..rpc import WorkerError
from ._media import iter_frames

_detectors: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        from mediapipe.tasks.python import vision  # noqa: F401

        return {"available": True, "reason": None, "requires": ["mediapipe/efficientdet-lite0"]}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"mediapipe missing: {e}"}


def detector(model_path: str, score_threshold: float, max_results: int):
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    key = f"{model_path}:{score_threshold}:{max_results}"
    det = _detectors.get(key)
    if det is None:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"object detection model not found at {model_path}", {"model": "mediapipe/efficientdet-lite0"})
        options = vision.ObjectDetectorOptions(base_options=mp_python.BaseOptions(model_asset_path=model_path), running_mode=vision.RunningMode.IMAGE, score_threshold=score_threshold, max_results=max_results)
        det = vision.ObjectDetector.create_from_options(options)
        _detectors[key] = det
    return det


def detect_video(params: dict, ctx) -> dict[str, Any]:
    import cv2
    import mediapipe as mp

    path = params["path"]
    det = detector(params["model_path"], float(params.get("score_threshold", 0.4)), int(params.get("max_results", 20)))
    sample_fps = float(params.get("sample_fps", 2))
    start_ms = float(params.get("start_ms", 0))
    end_ms = params.get("end_ms")
    wanted = set(params.get("categories") or [])
    frames: list[dict[str, Any]] = []
    meta = None
    for t_ms, frame, m in iter_frames(path, sample_fps, start_ms, end_ms):
        meta = m
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        objs: list[dict[str, Any]] = []
        for d in result.detections:
            cat = d.categories[0] if d.categories else None
            name = cat.category_name if cat else "object"
            if wanted and name not in wanted:
                continue
            bb = d.bounding_box
            objs.append({"x": bb.origin_x / m.width, "y": bb.origin_y / m.height, "w": bb.width / m.width, "h": bb.height / m.height, "score": float(cat.score) if cat else 0.0, "label": name})
        frames.append({"t_ms": round(t_ms, 3), "objects": objs})
        total = (end_ms if end_ms is not None else m.duration_ms) - start_ms
        if total:
            ctx.progress(min(0.99, (t_ms - start_ms) / total), f"objects {len(frames)}")
        ctx.check()
    if meta is None:
        raise WorkerError("MEDIA_UNSUPPORTED", "no frames decoded", {"path": path})
    return {"frames": frames, "width": meta.width, "height": meta.height, "fps": meta.fps, "duration_ms": meta.duration_ms, "sample_fps": sample_fps}


METHODS = {"objects.detect": detect_video}
