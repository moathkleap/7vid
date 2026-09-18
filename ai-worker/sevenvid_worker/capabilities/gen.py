"""Image/video generation bridges (diffusers). Availability depends on torch, a GPU and installed models."""
from __future__ import annotations

import os
from typing import Any

from ..rpc import WorkerError


def probe() -> dict[str, Any]:
    try:
        import torch
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"torch not installed: {e}", "requires_gpu": True}
    try:
        import diffusers  # noqa: F401
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"diffusers not installed: {e}", "requires_gpu": True}
    gpu = torch.cuda.is_available() or bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    return {"available": True, "reason": None if gpu else "no GPU: generation will be extremely slow on CPU", "requires_gpu": True, "gpu": gpu}


def image(params: dict, ctx) -> dict[str, Any]:
    import torch
    from diffusers import AutoPipelineForText2Image

    model_path = params.get("model_path")
    if not model_path or not os.path.exists(model_path):
        raise WorkerError("MODEL_NOT_INSTALLED", "image generation model not installed", {"model": params.get("model_id")})
    device = "cuda" if torch.cuda.is_available() else "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(model_path, torch_dtype=dtype)
    pipe = pipe.to(device)
    steps = int(params.get("steps", 25))
    generator = torch.Generator(device=device).manual_seed(int(params.get("seed", 0))) if params.get("seed") is not None else None

    def cb(pipe_, step, timestep, kwargs):
        ctx.progress(step / max(1, steps), f"step {step}/{steps}")
        ctx.check()
        return kwargs

    result = pipe(prompt=params["prompt"], negative_prompt=params.get("negative_prompt"), width=int(params.get("width", 1024)), height=int(params.get("height", 1024)), num_inference_steps=steps, guidance_scale=float(params.get("guidance", 6.0)), generator=generator, callback_on_step_end=cb)
    out = params["out_path"]
    result.images[0].save(out)
    return {"out_path": out, "device": device}


METHODS = {"gen.image": image}
