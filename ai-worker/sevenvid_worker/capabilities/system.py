from __future__ import annotations

import platform
import sys
from typing import Any

from .. import __version__


def devices() -> dict[str, Any]:
    info: dict[str, Any] = {"onnxruntime": None, "torch": None, "opencv": None, "mediapipe": None}
    try:
        import onnxruntime as ort

        info["onnxruntime"] = {"version": ort.__version__, "providers": ort.get_available_providers()}
    except Exception:  # noqa: BLE001
        pass
    try:
        import torch

        cuda = torch.cuda.is_available()
        info["torch"] = {"version": torch.__version__, "cuda": cuda, "device": torch.cuda.get_device_name(0) if cuda else None, "mps": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())}
    except Exception:  # noqa: BLE001
        pass
    try:
        import cv2

        info["opencv"] = {"version": cv2.__version__}
    except Exception:  # noqa: BLE001
        pass
    try:
        import mediapipe as mp

        info["mediapipe"] = {"version": getattr(mp, "__version__", "unknown")}
    except Exception:  # noqa: BLE001
        pass
    return info


def best_device() -> str:
    d = devices()
    if d.get("torch") and d["torch"].get("cuda"):
        return "cuda"
    if d.get("torch") and d["torch"].get("mps"):
        return "mps"
    if d.get("onnxruntime") and any(p in d["onnxruntime"]["providers"] for p in ("CUDAExecutionProvider", "DmlExecutionProvider", "CoreMLExecutionProvider")):
        return "gpu-onnx"
    return "cpu"


def probe() -> dict[str, Any]:
    return {"available": True, "reason": None}


def hello(params: dict, ctx) -> dict[str, Any]:
    from . import probe_all

    return {
        "version": __version__,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "platform": platform.platform(),
        "device": best_device(),
        "devices": devices(),
        "capabilities": probe_all(),
    }


METHODS = {"hello": hello, "system.probe": hello}
