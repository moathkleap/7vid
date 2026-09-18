import json
import os
import subprocess
import sys

from sevenvid_worker.capabilities import audio, faces, tracking, tts, vad, verify

from .conftest import model_or_skip


WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def test_hello_over_stdio():
    # Same launch shape as the Node WorkerClient: cwd = worker source dir, package importable via PYTHONPATH.
    env = {**os.environ, "PYTHONPATH": WORKER_DIR, "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen([sys.executable, "-m", "sevenvid_worker", "--stdio"], cwd=WORKER_DIR, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ready = json.loads(proc.stdout.readline())
    assert ready["method"] == "ready"
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "hello", "params": {}}) + "\n")
    proc.stdin.flush()
    reply = json.loads(proc.stdout.readline())
    assert reply["id"] == 1
    caps = reply["result"]["capabilities"]
    assert caps["vad"]["available"] is True
    assert caps["faces"]["available"] is True
    assert "device" in reply["result"]
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "nope", "params": {}}) + "\n")
    proc.stdin.flush()
    err = json.loads(proc.stdout.readline())
    assert err["error"]["data"]["type"] == "METHOD_NOT_FOUND"
    proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "shutdown"}) + "\n")
    proc.stdin.flush()
    proc.wait(timeout=10)


def test_vad_finds_speech_and_silence(fixtures_dir, ctx):
    model = model_or_skip("silero/vad-v5/silero_vad.onnx")
    clip = os.path.join(fixtures_dir, "speech-with-silence-12s.mp4")
    if not os.path.exists(clip):
        import pytest

        pytest.skip("speech fixture missing (espeak-ng not installed when fixtures were generated)")
    result = vad.detect({"path": clip, "model_path": model, "min_silence_ms": 800}, ctx)
    assert result["duration_ms"] > 11_000
    # real synthesized speech at 0-3, 6-8, 11-12 s; silence 3-6 and 8-11 s
    silences = [(round(s["start_ms"] / 1000), round(s["end_ms"] / 1000)) for s in result["silence"]]
    assert any(abs(a - 3) <= 1 and abs(b - 6) <= 1 for a, b in silences), silences
    assert any(abs(a - 8) <= 1 and abs(b - 11) <= 1 for a, b in silences), silences
    speech = [(round(s["start_ms"] / 1000), round(s["end_ms"] / 1000)) for s in result["speech"]]
    assert speech and speech[0][0] <= 1, speech
    assert 0.3 < result["speech_ratio"] < 0.7
    # a pure tone is not speech: the whole tone clip must come back as silence
    tone = vad.detect({"path": os.path.join(fixtures_dir, "tone-with-silence-12s.mp4"), "model_path": model}, ctx)
    assert tone["speech_ratio"] < 0.1


def test_faces_detected_in_photo_and_video(fixtures_dir, ctx):
    model = model_or_skip("opencv/yunet-2023mar/face_detection_yunet_2023mar.onnx")
    img = faces.detect_image({"path": os.path.join(fixtures_dir, "astronaut.png"), "model_path": model}, ctx)
    assert len(img["faces"]) >= 1
    face = img["faces"][0]
    assert 0 < face["x"] < 1 and 0 < face["w"] < 0.6
    video = faces.detect_video({"path": os.path.join(fixtures_dir, "face-pan-4s.mp4"), "model_path": model, "sample_fps": 2}, ctx)
    assert video["total_faces"] >= 6
    none = faces.detect_video({"path": os.path.join(fixtures_dir, "moving-box-6s.mp4"), "model_path": model, "sample_fps": 1}, ctx)
    assert none["total_faces"] == 0


def test_tracking_follows_moving_box(fixtures_dir, ctx):
    path = os.path.join(fixtures_dir, "moving-box-6s.mp4")
    # box starts at x=40,y=120 (80x80) on 640x360
    result = tracking.run({"path": path, "start_ms": 0, "end_ms": 5000, "box": {"x": 40 / 640, "y": 120 / 360, "w": 80 / 640, "h": 80 / 360}}, ctx)
    assert result["status"] in ("ok", "partial")
    kf = result["keyframes"]
    assert len(kf) > 100
    assert kf[-1]["x"] > kf[0]["x"] + 0.3
    expected_x = (40 + 60 * 5) / 640
    assert abs(kf[-1]["x"] - expected_x) < 0.08


def test_face_tracking_with_redetection(fixtures_dir, ctx):
    model = model_or_skip("opencv/yunet-2023mar/face_detection_yunet_2023mar.onnx")
    path = os.path.join(fixtures_dir, "face-pan-4s.mp4")
    first = faces.detect_at({"path": path, "t_ms": 0, "model_path": model}, ctx)
    assert first["faces"]
    box = {k: first["faces"][0][k] for k in ("x", "y", "w", "h")}
    result = tracking.run({"path": path, "start_ms": 0, "end_ms": 3800, "box": box, "detector": "face", "face_model_path": model, "redetect_every": 10}, ctx)
    assert result["status"] in ("ok", "partial")
    assert result["keyframes"][-1]["t_ms"] > 3000
    assert all(k["confidence"] > 0 for k in result["keyframes"][-5:])


def test_verify_blur_metric_distinguishes_sharp_from_blurred(fixtures_dir, ctx, tmp_path):
    import subprocess

    src = os.path.join(fixtures_dir, "face-pan-4s.mp4")
    blurred = str(tmp_path / "blurred.mp4")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", "boxblur=20", "-c:v", "libx264", "-preset", "ultrafast", blurred], check=True)
    samples = [{"t_ms": 500, "box": {"x": 0.3, "y": 0.1, "w": 0.4, "h": 0.4}}, {"t_ms": 2000, "box": {"x": 0.3, "y": 0.1, "w": 0.4, "h": 0.4}}]
    a = verify.blur_metric({"path": src, "samples": samples}, ctx)
    b = verify.blur_metric({"path": blurred, "samples": samples}, ctx)
    for sa, sb in zip(a["samples"], b["samples"]):
        assert sb["sharpness"] < sa["sharpness"] * 0.2


def test_audio_measure_and_denoise(fixtures_dir, ctx, tmp_path):
    m = audio.measure({"path": os.path.join(fixtures_dir, "tone-3s.wav")}, ctx)
    assert m["peak_dbfs"] is not None and m["peak_dbfs"] < 0
    assert m["lufs"] is not None
    out = str(tmp_path / "denoised.wav")
    r = audio.denoise({"path": os.path.join(fixtures_dir, "tone-3s.wav"), "out_path": out, "strength": 0.5}, ctx)
    assert os.path.getsize(out) > 1000 and r["duration_ms"] > 2900


def test_tts_espeak_arabic_and_english(ctx, tmp_path):
    p = tts.probe()
    if not p["engines"]["espeak"]["available"]:
        import pytest

        pytest.skip("espeak not available")
    ar = tts.synthesize({"text": "مرحبا بكم في تطبيق سفن فيد", "out_path": str(tmp_path / "ar.wav"), "engine": "espeak"}, ctx)
    assert ar["duration_ms"] > 800
    en = tts.synthesize({"text": "Welcome to seven vid", "out_path": str(tmp_path / "en.wav"), "engine": "espeak", "voice": "en"}, ctx)
    assert en["duration_ms"] > 500
