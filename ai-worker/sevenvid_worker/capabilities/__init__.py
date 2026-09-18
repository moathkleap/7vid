from __future__ import annotations

from typing import Any, Callable

from . import audio, faceembed, faces, gen, objects, stt, system, tracking, tts, upscale, vad, verify

MODULES = {
    "system": system,
    "vad": vad,
    "faces": faces,
    "objects": objects,
    "tracking": tracking,
    "verify": verify,
    "audio": audio,
    "tts": tts,
    "stt": stt,
    "faceembed": faceembed,
    "upscale": upscale,
    "gen": gen,
}


def probe_all() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for name, mod in MODULES.items():
        try:
            out[name] = mod.probe()
        except Exception as e:  # noqa: BLE001
            out[name] = {"available": False, "reason": f"probe failed: {e}"}
    return out


def build_handlers() -> dict[str, Callable]:
    handlers: dict[str, Callable] = {}
    for mod in MODULES.values():
        handlers.update(mod.METHODS)
    return handlers
