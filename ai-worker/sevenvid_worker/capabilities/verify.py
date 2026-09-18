"""Measurements used by the validation engine to verify that an operation really changed the output."""
from __future__ import annotations

from typing import Any

import numpy as np

from ._media import read_frame_at


def probe() -> dict[str, Any]:
    try:
        import cv2  # noqa: F401

        return {"available": True, "reason": None}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"opencv missing: {e}"}


def _crop(frame: np.ndarray, box: dict | None) -> np.ndarray:
    if not box:
        return frame
    h, w = frame.shape[:2]
    x0 = int(max(0, box["x"] * w))
    y0 = int(max(0, box["y"] * h))
    x1 = int(min(w, (box["x"] + box["w"]) * w))
    y1 = int(min(h, (box["y"] + box["h"]) * h))
    if x1 <= x0 or y1 <= y0:
        return frame[0:1, 0:1]
    return frame[y0:y1, x0:x1]


def sharpness(frame: np.ndarray) -> float:
    import cv2

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def blur_metric(params: dict, ctx) -> dict[str, Any]:
    """Laplacian variance inside boxes at the given times (lower = blurrier)."""
    path = params["path"]
    out = []
    for i, s in enumerate(params["samples"]):
        frame, _ = read_frame_at(path, float(s["t_ms"]))
        region = _crop(frame, s.get("box"))
        out.append({"t_ms": s["t_ms"], "sharpness": sharpness(region), "mean": float(region.mean())})
        ctx.progress((i + 1) / max(1, len(params["samples"])), None)
    return {"samples": out}


def compare(params: dict, ctx) -> dict[str, Any]:
    """Mean absolute pixel difference between two videos at sampled times (optionally inside a box)."""
    import cv2

    a, b = params["a"], params["b"]
    out = []
    for i, s in enumerate(params["samples"]):
        fa, _ = read_frame_at(a, float(s["t_ms"]))
        fb, _ = read_frame_at(b, float(s["t_ms"]))
        if fa.shape != fb.shape:
            fb = cv2.resize(fb, (fa.shape[1], fa.shape[0]))
        ra, rb = _crop(fa, s.get("box")), _crop(fb, s.get("box"))
        if ra.shape != rb.shape:
            rb = cv2.resize(rb, (ra.shape[1], ra.shape[0]))
        out.append({"t_ms": s["t_ms"], "mean_abs_diff": float(np.abs(ra.astype(np.float32) - rb.astype(np.float32)).mean()), "sharpness_a": sharpness(ra), "sharpness_b": sharpness(rb)})
        ctx.progress((i + 1) / max(1, len(params["samples"])), None)
    return {"samples": out}


METHODS = {"verify.blurMetric": blur_metric, "verify.compare": compare}
