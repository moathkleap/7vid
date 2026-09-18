"""Text to speech: Piper (neural, downloadable voices) and eSpeak NG (always available, basic quality)."""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import wave
from typing import Any

from ..rpc import WorkerError


def _espeak_binary() -> str | None:
    return shutil.which("espeak-ng") or shutil.which("espeak")


def _espeak_library():
    try:
        import espeakng_loader

        return espeakng_loader.get_library_path(), espeakng_loader.get_data_path()
    except Exception:  # noqa: BLE001
        return None


def probe() -> dict[str, Any]:
    engines: dict[str, Any] = {}
    engines["espeak"] = {"available": bool(_espeak_binary() or _espeak_library()), "quality": "basic"}
    try:
        import piper  # noqa: F401

        engines["piper"] = {"available": True, "quality": "high", "requires": ["piper voice model"]}
    except Exception as e:  # noqa: BLE001
        engines["piper"] = {"available": False, "reason": f"piper missing: {e}"}
    available = any(e.get("available") for e in engines.values())
    return {"available": available, "reason": None if available else "no TTS engine available", "engines": engines}


def _wav_duration_ms(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate() * 1000


def _espeak_via_binary(binary: str, text: str, out_path: str, voice: str, rate: int, pitch: int) -> None:
    proc = subprocess.run([binary, "-v", voice, "-s", str(rate), "-p", str(pitch), "-w", out_path, text], capture_output=True, check=False)
    if proc.returncode != 0:
        raise WorkerError("PROVIDER_FAILED", proc.stderr.decode("utf8", "ignore")[-400:] or "espeak failed")


def _espeak_via_library(text: str, out_path: str, voice: str, rate: int, pitch: int) -> None:
    found = _espeak_library()
    if not found:
        raise WorkerError("PROVIDER_UNAVAILABLE", "espeak-ng not available")
    lib_path, data_path = found
    lib = ctypes.cdll.LoadLibrary(str(lib_path))
    AUDIO_OUTPUT_SYNCHRONOUS = 2
    samples: list[bytes] = []
    CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)

    def cb(wav, numsamples, events):
        if numsamples > 0:
            samples.append(ctypes.string_at(wav, numsamples * 2))
        return 0

    cb_ref = CALLBACK(cb)
    lib.espeak_Initialize.restype = ctypes.c_int
    sr = lib.espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, str(data_path).encode("utf8"), 0)
    if sr <= 0:
        raise WorkerError("PROVIDER_FAILED", "espeak_Initialize failed")
    lib.espeak_SetSynthCallback(cb_ref)
    lib.espeak_SetVoiceByName(voice.encode("utf8"))
    lib.espeak_SetParameter(1, rate, 0)
    lib.espeak_SetParameter(3, pitch, 0)
    data = text.encode("utf8")
    lib.espeak_Synth(data, len(data) + 1, 0, 0, 0, 1, None, None)
    lib.espeak_Synchronize()
    lib.espeak_Terminate()
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(samples))


def synthesize(params: dict, ctx) -> dict[str, Any]:
    text = str(params.get("text", "")).strip()
    out_path = params["out_path"]
    engine = params.get("engine", "espeak")
    if not text:
        raise WorkerError("INVALID_INPUT", "text is empty")
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if engine == "piper":
        model_path = params.get("model_path")
        if not model_path or not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", "Piper voice model not found", {"model": params.get("model_id")})
        from piper import PiperVoice

        voice = PiperVoice.load(model_path)
        with wave.open(out_path, "wb") as wav_file:
            if hasattr(voice, "synthesize_wav"):
                voice.synthesize_wav(text, wav_file, length_scale=float(params.get("length_scale", 1.0)))
            else:
                voice.synthesize(text, wav_file, length_scale=float(params.get("length_scale", 1.0)))
    else:
        voice = params.get("voice") or ("ar" if any("؀" <= c <= "ۿ" for c in text) else "en")
        rate = int(params.get("rate", 165))
        pitch = int(params.get("pitch", 50))
        binary = _espeak_binary()
        if binary:
            _espeak_via_binary(binary, text, out_path, voice, rate, pitch)
        else:
            _espeak_via_library(text, out_path, voice, rate, pitch)
    if not os.path.exists(out_path) or os.path.getsize(out_path) < 100:
        raise WorkerError("PROVIDER_FAILED", "TTS produced no audio")
    return {"out_path": out_path, "duration_ms": _wav_duration_ms(out_path), "engine": engine}


METHODS = {"tts.synthesize": synthesize}
