"""AI upscaling with Real-ESRGAN (ncnn/Vulkan). Reported as unavailable when the GPU runtime is missing."""
from __future__ import annotations

import os
from typing import Any

from ..rpc import WorkerError


def probe() -> dict[str, Any]:
    try:
        from realesrgan_ncnn_py import Realesrgan  # noqa: F401
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"realesrgan-ncnn-py missing: {e}", "requires_gpu": True}
    try:
        from realesrgan_ncnn_py import Realesrgan

        Realesrgan(gpuid=0, model=0)
        return {"available": True, "reason": None, "requires_gpu": True}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"Vulkan GPU not usable: {e}", "requires_gpu": True}


def image(params: dict, ctx) -> dict[str, Any]:
    from PIL import Image
    from realesrgan_ncnn_py import Realesrgan

    src, out = params["path"], params["out_path"]
    if not os.path.exists(src):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {src}")
    model = int(params.get("model", 0))
    up = Realesrgan(gpuid=int(params.get("gpu", 0)), model=model)
    with Image.open(src) as im:
        result = up.process_pil(im.convert("RGB"))
    result.save(out)
    return {"out_path": out, "width": result.width, "height": result.height}


METHODS = {"upscale.image": image}
