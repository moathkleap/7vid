"""Speech to text with faster-whisper (CTranslate2). Models are installed by the app's model manager."""
from __future__ import annotations

import os
from typing import Any

from ..rpc import WorkerError

_models: dict[str, Any] = {}


def probe() -> dict[str, Any]:
    try:
        import faster_whisper  # noqa: F401

        return {"available": True, "reason": None, "requires": ["whisper model"], "engine": "faster-whisper"}
    except Exception as e:  # noqa: BLE001
        return {"available": False, "reason": f"faster-whisper missing: {e}"}


def _model(model_dir: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    key = f"{model_dir}:{device}:{compute_type}"
    m = _models.get(key)
    if m is None:
        if not os.path.isdir(model_dir):
            raise WorkerError("MODEL_NOT_INSTALLED", f"Whisper model directory not found: {model_dir}", {"model_dir": model_dir})
        m = WhisperModel(model_dir, device=device, compute_type=compute_type)
        _models[key] = m
    return m


def transcribe(params: dict, ctx) -> dict[str, Any]:
    path = params["path"]
    if not os.path.exists(path):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {path}")
    device = params.get("device", "auto")
    if device == "auto":
        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:  # noqa: BLE001
            device = "cpu"
    compute_type = params.get("compute_type") or ("float16" if device == "cuda" else "int8")
    model = _model(params["model_dir"], device, compute_type)
    language = params.get("language")
    ctx.progress(0.05, "transcribe")
    segments_iter, info = model.transcribe(path, language=None if language in (None, "auto") else language, task=params.get("task", "transcribe"), word_timestamps=bool(params.get("word_timestamps", True)), vad_filter=bool(params.get("vad_filter", True)), beam_size=int(params.get("beam_size", 5)))
    total = float(getattr(info, "duration", 0) or 0)
    segments: list[dict[str, Any]] = []
    for seg in segments_iter:
        words = [{"start_ms": round(w.start * 1000), "end_ms": round(w.end * 1000), "word": w.word, "probability": float(w.probability)} for w in (seg.words or [])]
        segments.append({"start_ms": round(seg.start * 1000), "end_ms": round(seg.end * 1000), "text": seg.text.strip(), "words": words, "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0))})
        if total:
            ctx.progress(min(0.99, seg.end / total), f"{len(segments)} segments")
        ctx.check()
    return {"language": info.language, "language_probability": float(info.language_probability), "duration_ms": round(total * 1000), "segments": segments, "device": device, "compute_type": compute_type}


METHODS = {"stt.transcribe": transcribe}
