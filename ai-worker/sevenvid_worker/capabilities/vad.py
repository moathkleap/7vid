"""Voice activity detection with the Silero VAD ONNX model (no torch dependency)."""
from __future__ import annotations

import os
from typing import Any

import numpy as np

from ..rpc import WorkerError
from ._media import decode_audio

_session_cache: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        import onnxruntime  # noqa: F401

        return {"available": True, "reason": None, "requires": ["silero/vad-v5"]}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"onnxruntime missing: {e}"}


def _session(model_path: str):
    import onnxruntime as ort

    if model_path not in _session_cache:
        if not os.path.exists(model_path):
            raise WorkerError("MODEL_NOT_INSTALLED", f"Silero VAD model not found at {model_path}", {"model": "silero/vad-v5"})
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        _session_cache[model_path] = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
    return _session_cache[model_path]


def speech_probabilities(audio: np.ndarray, session, sample_rate: int = 16000, ctx=None) -> np.ndarray:
    """Runs Silero VAD v5 frame by frame. The v5 model expects each window to be prefixed with the last
    64 (16 kHz) / 32 (8 kHz) samples of the previous window; without that context the output collapses to ~0."""
    window = 512 if sample_rate == 16000 else 256
    context_size = 64 if sample_rate == 16000 else 32
    state = np.zeros((2, 1, 128), dtype=np.float32)
    sr = np.array(sample_rate, dtype=np.int64)
    n = int(np.ceil(len(audio) / window))
    probs = np.zeros(n, dtype=np.float32)
    padded = np.concatenate([audio.astype(np.float32), np.zeros(n * window - len(audio), dtype=np.float32)])
    names = {i.name for i in session.get_inputs()}
    context = np.zeros(context_size, dtype=np.float32)
    for i in range(n):
        chunk = padded[i * window:(i + 1) * window]
        feed = {"input": np.concatenate([context, chunk])[None, :], "sr": sr}
        if "state" in names:
            feed["state"] = state
        outputs = session.run(None, feed)
        probs[i] = float(outputs[0].reshape(-1)[0])
        if len(outputs) > 1:
            state = outputs[1]
        context = chunk[-context_size:]
        if ctx is not None and i % 200 == 0:
            ctx.check()
            ctx.progress(0.1 + 0.8 * i / max(1, n), "vad")
    return probs


def segments_from_probs(probs: np.ndarray, window_ms: float, threshold: float, min_speech_ms: float, min_silence_ms: float, pad_ms: float, total_ms: float) -> list[dict[str, Any]]:
    on, off = threshold, max(0.05, threshold - 0.15)
    speech: list[list[float]] = []
    active = False
    start = 0.0
    for i, p in enumerate(probs):
        t = i * window_ms
        if not active and p >= on:
            active = True
            start = t
        elif active and p < off:
            active = False
            speech.append([start, t])
    if active:
        speech.append([start, len(probs) * window_ms])
    merged: list[list[float]] = []
    for s in speech:
        if merged and s[0] - merged[-1][1] < min_silence_ms:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    merged = [s for s in merged if s[1] - s[0] >= min_speech_ms]
    out: list[dict[str, Any]] = []
    for s in merged:
        out.append({"start_ms": max(0.0, s[0] - pad_ms), "end_ms": min(total_ms, s[1] + pad_ms), "kind": "speech"})
    return out


def detect(params: dict, ctx) -> dict[str, Any]:
    path = params["path"]
    model_path = params["model_path"]
    threshold = float(params.get("threshold", 0.5))
    min_speech_ms = float(params.get("min_speech_ms", 250))
    min_silence_ms = float(params.get("min_silence_ms", 500))
    pad_ms = float(params.get("pad_ms", 100))
    ctx.progress(0.02, "decode")
    audio = decode_audio(params, path, 16000, 1, params.get("start_ms"), params.get("end_ms"))
    total_ms = len(audio) / 16.0
    if len(audio) == 0:
        return {"speech": [], "silence": [{"start_ms": 0, "end_ms": 0, "kind": "silence"}], "duration_ms": 0, "speech_ratio": 0.0}
    session = _session(model_path)
    probs = speech_probabilities(audio, session, 16000, ctx)
    speech = segments_from_probs(probs, 32.0, threshold, min_speech_ms, min_silence_ms, pad_ms, total_ms)
    silence: list[dict[str, Any]] = []
    cursor = 0.0
    for s in speech:
        if s["start_ms"] - cursor >= min_silence_ms:
            silence.append({"start_ms": cursor, "end_ms": s["start_ms"], "kind": "silence"})
        cursor = s["end_ms"]
    if total_ms - cursor >= min_silence_ms:
        silence.append({"start_ms": cursor, "end_ms": total_ms, "kind": "silence"})
    speech_ms = sum(s["end_ms"] - s["start_ms"] for s in speech)
    ctx.progress(1.0, None)
    offset = float(params.get("start_ms") or 0)
    for seg in speech + silence:
        seg["start_ms"] += offset
        seg["end_ms"] += offset
    return {"speech": speech, "silence": silence, "duration_ms": total_ms, "speech_ratio": speech_ms / total_ms if total_ms else 0.0}


METHODS = {"vad.detect": detect}
