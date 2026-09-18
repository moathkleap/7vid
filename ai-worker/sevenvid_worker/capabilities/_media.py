"""Shared media helpers: audio decoding through FFmpeg and frame iteration through OpenCV."""
from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Iterator

import numpy as np

from ..rpc import WorkerError


def ffmpeg_path(params: dict) -> str:
    p = params.get("ffmpeg") or os.environ.get("SEVENVID_FFMPEG_PATH") or shutil.which("ffmpeg")
    if not p:
        raise WorkerError("FFMPEG_NOT_FOUND", "ffmpeg binary not found")
    return p


def decode_audio(params: dict, path: str, sample_rate: int = 16000, channels: int = 1, start_ms: float | None = None, end_ms: float | None = None) -> np.ndarray:
    """Decodes any media file to float32 PCM with FFmpeg. Shape: (samples,) for mono or (samples, channels)."""
    if not os.path.exists(path):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {path}", {"path": path})
    args = [ffmpeg_path(params), "-hide_banner", "-loglevel", "error", "-nostdin"]
    if start_ms:
        args += ["-ss", f"{start_ms / 1000:.3f}"]
    args += ["-i", path]
    if end_ms is not None and start_ms is not None:
        args += ["-t", f"{(end_ms - start_ms) / 1000:.3f}"]
    args += ["-vn", "-ac", str(channels), "-ar", str(sample_rate), "-f", "f32le", "-"]
    proc = subprocess.run(args, capture_output=True, check=False)
    if proc.returncode != 0:
        raise WorkerError("FFMPEG_FAILED", proc.stderr.decode("utf8", "ignore")[-500:] or "ffmpeg failed")
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if channels > 1:
        data = data.reshape(-1, channels)
    return data


@dataclass
class VideoMeta:
    width: int
    height: int
    fps: float
    frame_count: int
    duration_ms: float


def open_video(path: str):
    import cv2

    if not os.path.exists(path):
        raise WorkerError("FILE_NOT_FOUND", f"file not found: {path}", {"path": path})
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise WorkerError("MEDIA_UNSUPPORTED", f"OpenCV could not open {path}", {"path": path})
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    meta = VideoMeta(int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)), float(fps), count, (count / fps) * 1000 if fps else 0)
    return cap, meta


def iter_frames(path: str, sample_fps: float | None, start_ms: float = 0, end_ms: float | None = None) -> Iterator[tuple[float, "np.ndarray", VideoMeta]]:
    """Yields (t_ms, frame_bgr, meta) sampled at `sample_fps` (None = every frame)."""
    import cv2

    cap, meta = open_video(path)
    try:
        step = 1 if not sample_fps or sample_fps >= meta.fps else int(round(meta.fps / sample_fps))
        start_frame = int(round(start_ms / 1000 * meta.fps))
        if start_frame > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        idx = start_frame
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t_ms = idx / meta.fps * 1000
            if end_ms is not None and t_ms > end_ms:
                break
            if (idx - start_frame) % step == 0:
                yield t_ms, frame, meta
            idx += 1
    finally:
        cap.release()


def read_frame_at(path: str, t_ms: float):
    import cv2

    cap, meta = open_video(path)
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t_ms))
        ok, frame = cap.read()
        if not ok:
            raise WorkerError("MEDIA_UNSUPPORTED", f"could not read frame at {t_ms} ms")
        return frame, meta
    finally:
        cap.release()


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0
