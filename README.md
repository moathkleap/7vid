# 7vid

**7vid** is a local-first desktop application for AI-assisted video editing and AI video creation.
Every operation runs on your machine by default; cloud providers are optional, opt-in and clearly labeled.

> **الوصف بالعربية:** 7vid تطبيق سطح مكتب يعمل محلياً أولاً لتحرير الفيديو وتوليده بالذكاء الاصطناعي.
> كل العمليات تعمل على جهازك افتراضياً؛ المزوّدون السحابيون اختياريون ويُفعَّلون صراحةً مع تنبيه واضح.
> خطة البناء الكاملة (المعمارية، خريطة الوحدات، قاعدة البيانات، المزوّدون، خارطة الطريق) في [`docs/PLAN.ar.md`](docs/PLAN.ar.md).

## Status

The application is being built in eight phases (see `docs/PLAN.ar.md`). Features that belong to a later
phase are shown in the interface as explicitly **not available** — nothing is simulated.

| Phase | Scope | Status |
|---|---|---|
| 1 | Application shell, navigation, i18n (ar/en, RTL), projects, versions, crash recovery, tasks, errors, logs, hardware detection, capability registry, dev bridge | ✅ |
| 2 | Media import/analysis, library, timeline, preview, basic editing, render compiler, export | ✅ |
| 3 | Audio, subtitles, OCR, face/object detection, masking, tracking (Python AI worker) | ✅ |
| 4 | AI assistant, command planner, execution and validation engine | 🔜 |
| 5 | AI Video Creator | 🔜 |
| 6 | AI model manager, providers, network gateway | 🔜 |
| 7 | Export center, quality validation, diagnostics | 🔜 |
| 8 | QA audit, performance, security review, packaging, documentation | 🔜 |

## Architecture (short)

```
apps/desktop        Electron shell (main, preload) + React renderer
packages/core       Pure TypeScript domain: project document, timeline commands, undo/redo, validation
packages/ipc        Typed IPC contract (zod) shared by main, preload, renderer and the dev bridge
packages/engine     Node engine: SQLite (node:sqlite), projects, tasks, hardware, FFmpeg, AI orchestration
ai-worker           Python AI worker (JSON-RPC over stdio) for vision, speech and generation models
resources           Fonts, templates, model registry
tests               Playwright end-to-end tests (browser mode + Electron)
```

## What works today (verified by tests)

- **Editing:** multi-track timeline, cut/split/trim/ripple, speed/reverse/freeze, transforms, aspect and platform presets, live preview, rendered preview, validated export.
- **Privacy masks:** face detection (YuNet), tracking (OpenCV CSRT with face re-detection), blur/pixelate/box masks with rectangular or elliptical shape, keyframed with `sendcmd` in the FFmpeg render graph, plus a **measured verification** (Laplacian variance or block-mean error inside the mask, before vs. after) so a mask is never reported as applied without proof.
- **Audio:** silence detection (Silero VAD when installed, FFmpeg `silencedetect` otherwise), silence removal with re-detection as verification, loudness measurement (`ebur128`), enhancement presets and a rendered before/after comparison with real numbers.
- **Subtitles:** SRT/WebVTT import, SRT/WebVTT/ASS export verified by re-parsing, burn-in with Arabic shaping (libass), cue and style editing. Speech recognition runs through faster-whisper once a Whisper model is installed.
- **On-screen text:** OCR (Tesseract, Arabic + English) per sampled frame, linked into text regions, text extraction and text masks.
- **Enhancement:** looks (color presets), Lanczos upscaling with output validation, AI upscaling gated on a Vulkan GPU runtime, before/after split comparison.
- **Models & runtime:** model registry with checksums, downloads through the privacy-aware network gateway (resumable, logged), real per-model tests on bundled samples, Python runtime detection and setup.

Capabilities that need a model, a runtime or hardware this machine lacks are shown as such in the interface, with the reason and the next step.

## Development

```bash
pnpm install
pnpm dev             # Electron app (requires the Electron binary; downloaded by npm on install)
pnpm dev:browser     # Engine + renderer in a normal browser (no Electron needed)
pnpm fixtures        # synthetic test media (FFmpeg; speech samples need espeak-ng)
pnpm test            # unit and integration tests (vitest)
pnpm test:py         # Python worker tests (needs ai-worker/.venv)
pnpm test:e2e        # end-to-end tests in Chromium against the real engine
pnpm typecheck && pnpm lint
```

### Python AI worker (development)

```bash
python3 -m venv ai-worker/.venv
ai-worker/.venv/bin/pip install -e "ai-worker[vision,audio,stt,tts,test]"
```

The application detects `ai-worker/.venv` automatically in development; packaged builds create their own
environment from **AI Models → Set up runtime**. Models are installed into `<userData>/models/<id>` (or
`SEVENVID_MODELS_DIR`); the registry with sizes, checksums and hardware requirements lives in
`packages/engine/src/models/registry.ts`.

FFmpeg/FFprobe are located from `SEVENVID_FFMPEG_PATH`, the bundled `resources/bin/<platform>-<arch>/`
directory, or the system `PATH`.

## Privacy

- No telemetry. The setting exists only to show that it cannot be enabled.
- No hidden network calls: every outbound request goes through the network gateway and is logged.
- Original media files are never modified.
