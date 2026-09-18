"""Audio measurement (loudness/peaks) and spectral-gating noise reduction."""
from __future__ import annotations

from typing import Any

import numpy as np

from ._media import decode_audio


def probe() -> dict[str, Any]:
    missing = []
    for mod in ("pyloudnorm", "noisereduce", "soundfile"):
        try:
            __import__(mod)
        except Exception:  # noqa: BLE001
            missing.append(mod)
    return {"available": not missing, "reason": f"missing: {', '.join(missing)}" if missing else None}


def measure(params: dict, ctx) -> dict[str, Any]:
    import pyloudnorm as pyln

    audio = decode_audio(params, params["path"], 48000, 2, params.get("start_ms"), params.get("end_ms"))
    if len(audio) == 0:
        return {"lufs": None, "peak_dbfs": None, "rms_dbfs": None, "duration_ms": 0}
    mono = audio.mean(axis=1) if audio.ndim == 2 else audio
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2))) if len(mono) else 0.0
    lufs = None
    if len(mono) >= 48000 * 0.4:
        meter = pyln.Meter(48000)
        try:
            lufs = float(meter.integrated_loudness(audio))
            if not np.isfinite(lufs):
                lufs = None
        except Exception:  # noqa: BLE001
            lufs = None
    return {"lufs": lufs, "peak_dbfs": 20 * np.log10(peak) if peak > 0 else -100.0, "rms_dbfs": 20 * np.log10(rms) if rms > 0 else -100.0, "duration_ms": len(mono) / 48.0}


def denoise(params: dict, ctx) -> dict[str, Any]:
    import noisereduce as nr
    import soundfile as sf

    strength = float(params.get("strength", 0.8))
    audio = decode_audio(params, params["path"], 48000, 2)
    ctx.progress(0.2, "denoise")
    if audio.ndim == 1:
        audio = audio[:, None]
    out = np.zeros_like(audio)
    for ch in range(audio.shape[1]):
        out[:, ch] = nr.reduce_noise(y=audio[:, ch], sr=48000, stationary=bool(params.get("stationary", False)), prop_decrease=strength)
        ctx.progress(0.2 + 0.7 * (ch + 1) / audio.shape[1], "denoise")
        ctx.check()
    sf.write(params["out_path"], out, 48000, subtype="PCM_16")
    return {"out_path": params["out_path"], "duration_ms": len(out) / 48.0}


METHODS = {"audio.measure": measure, "audio.denoise": denoise}
