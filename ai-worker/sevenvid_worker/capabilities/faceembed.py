"""Face identity embeddings with OpenCV SFace, used for character consistency checks."""
from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..rpc import WorkerError
from . import faces as faces_mod

_recognizers: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        import cv2

        ok = hasattr(cv2, "FaceRecognizerSF")
        return {"available": ok, "reason": None if ok else "OpenCV build lacks FaceRecognizerSF", "requires": ["opencv/yunet-2023mar", "opencv/sface-2021dec"]}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"opencv missing: {e}"}


def _recognizer(model_path: str):
    import cv2

    r = _recognizers.get(model_path)
    if r is None:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"SFace model not found at {model_path}", {"model": "opencv/sface-2021dec"})
        r = cv2.FaceRecognizerSF.create(model_path, "")
        _recognizers[model_path] = r
    return r


def embed_image(params: dict, ctx) -> dict[str, Any]:
    import cv2

    path = params["path"]
    img = cv2.imread(path)
    if img is None:
        raise WorkerError("MEDIA_UNSUPPORTED", f"could not read image {path}")
    det = faces_mod.detector(params["det_model_path"], img.shape[1], img.shape[0], float(params.get("score_threshold", 0.7)))
    _, raw = det.detect(img)
    rec = _recognizer(params["rec_model_path"])
    out = []
    if raw is not None:
        for row in raw:
            aligned = rec.alignCrop(img, row)
            feat = rec.feature(aligned).reshape(-1)
            h, w = img.shape[:2]
            out.append({"box": {"x": float(row[0]) / w, "y": float(row[1]) / h, "w": float(row[2]) / w, "h": float(row[3]) / h}, "score": float(row[14]), "embedding": [float(v) for v in feat]})
    return {"faces": out}


def compare(params: dict, ctx) -> dict[str, Any]:
    a = np.asarray(params["a"], dtype=np.float32)
    b = np.asarray(params["b"], dtype=np.float32)
    cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    return {"cosine": cos, "same_identity": cos >= float(params.get("threshold", 0.363))}


METHODS = {"faces.embedImage": embed_image, "faces.compare": compare}
