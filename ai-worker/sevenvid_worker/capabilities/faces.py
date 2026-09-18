"""Face detection with OpenCV YuNet (ONNX) on sampled video frames or single images."""
from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..rpc import WorkerError
from ._media import iter_frames, read_frame_at

_detectors: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        import cv2

        if not hasattr(cv2, "FaceDetectorYN"):
            return {"available": False, "reason": "OpenCV build lacks FaceDetectorYN"}
        return {"available": True, "reason": None, "requires": ["opencv/yunet-2023mar"], "details": {"opencv": cv2.__version__}}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"opencv missing: {e}"}


def detector(model_path: str, width: int, height: int, score_threshold: float):
    import cv2

    key = f"{model_path}:{score_threshold}"
    det = _detectors.get(key)
    if det is None:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"YuNet model not found at {model_path}", {"model": "opencv/yunet-2023mar"})
        det = cv2.FaceDetectorYN.create(model_path, "", (width, height), score_threshold, 0.3, 200)
        _detectors[key] = det
    det.setInputSize((width, height))
    return det


def detect_in_frame(det, frame: np.ndarray) -> list[dict[str, Any]]:
    h, w = frame.shape[:2]
    _, faces = det.detect(frame)
    out: list[dict[str, Any]] = []
    if faces is None:
        return out
    for row in faces:
        x, y, bw, bh = [float(v) for v in row[:4]]
        score = float(row[14]) if len(row) > 14 else 1.0
        landmarks = [[float(row[4 + i * 2]) / w, float(row[5 + i * 2]) / h] for i in range(5)] if len(row) >= 14 else []
        out.append({"x": max(0.0, x / w), "y": max(0.0, y / h), "w": min(1.0, bw / w), "h": min(1.0, bh / h), "score": score, "landmarks": landmarks})
    return out


def detect_video(params: dict, ctx) -> dict[str, Any]:
    path = params["path"]
    model_path = params["model_path"]
    sample_fps = float(params.get("sample_fps", 4))
    score_threshold = float(params.get("score_threshold", 0.7))
    start_ms = float(params.get("start_ms", 0))
    end_ms = params.get("end_ms")
    frames: list[dict[str, Any]] = []
    meta = None
    total = None
    det = None
    for t_ms, frame, m in iter_frames(path, sample_fps, start_ms, end_ms):
        meta = m
        if total is None:
            total = (end_ms if end_ms is not None else m.duration_ms) - start_ms
        if det is None:
            det = detector(model_path, m.width, m.height, score_threshold)
        boxes = detect_in_frame(det, frame)
        frames.append({"t_ms": round(t_ms, 3), "faces": boxes})
        if total:
            ctx.progress(min(0.99, (t_ms - start_ms) / total), f"faces {len(frames)}")
        ctx.check()
    if meta is None:
        raise WorkerError("MEDIA_UNSUPPORTED", "no frames decoded", {"path": path})
    return {"frames": frames, "width": meta.width, "height": meta.height, "fps": meta.fps, "duration_ms": meta.duration_ms, "sample_fps": sample_fps, "total_faces": sum(len(f["faces"]) for f in frames)}


def detect_image(params: dict, ctx) -> dict[str, Any]:
    import cv2

    path = params["path"]
    if not os.path.exists(path):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {path}")
    img = cv2.imread(path)
    if img is None:
        raise WorkerError("MEDIA_UNSUPPORTED", f"could not read image {path}")
    det = detector(params["model_path"], img.shape[1], img.shape[0], float(params.get("score_threshold", 0.7)))
    return {"faces": detect_in_frame(det, img), "width": img.shape[1], "height": img.shape[0]}


def detect_at(params: dict, ctx) -> dict[str, Any]:
    frame, meta = read_frame_at(params["path"], float(params.get("t_ms", 0)))
    det = detector(params["model_path"], meta.width, meta.height, float(params.get("score_threshold", 0.7)))
    return {"faces": detect_in_frame(det, frame), "width": meta.width, "height": meta.height}


METHODS = {"faces.detect": detect_video, "faces.detectImage": detect_image, "faces.detectAt": detect_at}
