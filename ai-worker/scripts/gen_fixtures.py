"""Writes test images that need Python-side sources (a real photo with a face from scikit-image, Arabic text for OCR)."""
from __future__ import annotations

import os
import sys

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "generated")
os.makedirs(out, exist_ok=True)

try:
    import numpy as np
    from PIL import Image
    from skimage import data

    astronaut = data.astronaut()
    Image.fromarray(astronaut).save(os.path.join(out, "astronaut.png"))
    # A short video of the astronaut photo panning slowly (for face tracking tests)
    import subprocess

    ffmpeg = os.environ.get("SEVENVID_FFMPEG_PATH", "ffmpeg")
    target = os.path.join(out, "face-pan-4s.mp4")
    if not os.path.exists(target):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", os.path.join(out, "astronaut.png"), "-vf", "scale=768:768,crop=512:512:x='120*t/4':y=0,format=yuv420p", "-t", "4", "-r", "25", "-c:v", "libx264", "-preset", "veryfast", target], check=True)
    print("astronaut fixtures ready")
except Exception as e:  # noqa: BLE001
    print(f"skipping astronaut fixture: {e}")

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1280, 720), (18, 20, 26))
    draw = ImageDraw.Draw(img)
    font_candidates = ["/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    ar_font = next((f for f in font_candidates if os.path.exists(f)), None)
    latin_font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if os.path.exists("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") else ar_font
    if ar_font:
        from PIL import features

        arabic = "مرحبا بكم في المتجر"
        if features.check("raqm"):
            # Pillow with libraqm shapes and reorders Arabic itself; pre-shaped text would be shaped twice
            draw.text((1140, 120), arabic, font=ImageFont.truetype(ar_font, 72), fill=(255, 255, 255), direction="rtl", anchor="ra")
        else:
            draw.text((140, 120), get_display(arabic_reshaper.reshape(arabic)), font=ImageFont.truetype(ar_font, 72), fill=(255, 255, 255))
    if latin_font:
        draw.text((140, 380), "OPEN 24 HOURS", font=ImageFont.truetype(latin_font, 80), fill=(255, 230, 120))
    img.save(os.path.join(out, "text-frame.png"))
    import subprocess

    ffmpeg = os.environ.get("SEVENVID_FFMPEG_PATH", "ffmpeg")
    target = os.path.join(out, "text-3s.mp4")
    if not os.path.exists(target):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", os.path.join(out, "text-frame.png"), "-t", "3", "-r", "25", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", target], check=True)
    print("text fixtures ready")
except Exception as e:  # noqa: BLE001
    print(f"skipping text fixture: {e}")
