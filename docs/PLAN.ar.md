# خطة بناء 7vid — تطبيق سطح مكتب «محلي أولاً» لتحرير الفيديو وتوليده بالذكاء الاصطناعي

## 0. السياق (لماذا هذه الخطة)

- المستودع `moathkleap/7vid` **فارغ تماماً**: لا commits، لا فروع على GitHub، لا كود، لا إطار عمل، لا قاعدة بيانات، لا واجهة. البناء يبدأ من الصفر على الفرع `claude/ai-video-editor-desktop-app-coa0wr`.
- المطلوب: منتج سطح مكتب احترافي بوحدتين (AI Video Editor + AI Video Creator) يعمل محلياً، بلا أي وظيفة وهمية، مع تحقق داخلي من كل نتيجة، دعم عربي/إنجليزي مع RTL/LTR، ومعمارية مزوّدين قابلة للتوسعة.
- المخرَج الأول من هذه الخطة: معمارية + خريطة وحدات + مخطط قاعدة بيانات + معمارية المزوّدين + معمارية معالجة الفيديو + خارطة طريق تنفيذ على 8 مراحل، ثم التنفيذ مرحلة بمرحلة مع اختبار وربط وتحقق قبل الانتقال.

### 0.1 نتائج فحص بيئة التنفيذ الحالية (Sandbox) — تحدد ما يمكن التحقق منه هنا

| المورد | الحالة هنا | الأثر |
|---|---|---|
| Node 22.22 / pnpm 10 / npm registry | ✅ | كل حزم JavaScript متاحة |
| Python 3.11 / PyPI | ✅ | mediapipe, opencv-contrib, onnxruntime, faster-whisper, sherpa-onnx, silero-vad, rapidocr, noisereduce, pyloudnorm, piper-tts, espeakng-loader … |
| apt (archive/security.ubuntu.com) | ✅ | تثبيت `ffmpeg 6.1` كامل (x264/x265/aom/vpx/vidstab/libass)، `espeak-ng`، `fonts-noto` |
| `node:sqlite` المدمج في Node 22 | ✅ مُختبَر (FTS5 + JSON + WAL) | قاعدة بيانات بلا وحدات native تحتاج إعادة بناء مع Electron |
| storage.googleapis.com | ✅ | نماذج MediaPipe (كشف الأجسام EfficientDet، تقسيم الأشخاص، معالم الوجه) |
| raw/media.githubusercontent.com | ✅ | بيانات Tesseract (ara/eng)، نماذج OpenCV Zoo (YuNet لكشف الوجوه، SFace لبصمة الوجه، VitTrack للتتبع) |
| xvfb + Playwright Chromium | ✅ | اختبارات واجهة حقيقية بلا شاشة |
| GitHub releases / api.github.com | ❌ محجوب | ثنائي **Electron** لا يمكن تنزيله هنا؛ نماذج sherpa-onnx، أوزان Real-ESRGAN/YOLO محجوبة |
| Hugging Face (وكل مراياه) | ❌ محجوب | نماذج Whisper (STT)، GGUF (LLM)، Piper (TTS)، Stable Diffusion/Wan/LTX محجوبة |
| static.crates.io | ❌ محجوب | Tauri/Rust مستبعد عملياً |
| GPU | ❌ لا يوجد | كل اختبارات GPU تُوسم `skipped: no GPU` لا `passed` |

**الاستنتاجات الملزمة للخطة:**
1. **الإطار: Electron** (القرار الصحيح للمنتج بغض النظر عن البيئة — انظر §1). لكن ثنائي Electron لا يمكن تشغيله في هذه البيئة، لذلك سنبني **«وضع المتصفح التطويري» (Dev Bridge)**: نفس خدمات العملية الرئيسية الحقيقية تعمل كعملية Node وتُعرض لواجهة React نفسها عبر WebSocket بنفس عقد IPC. هذا يتيح اختبارات E2E حقيقية (استيراد → تحليل → تحرير → أمر AI → معالجة → معاينة → تصدير → تحقق) هنا داخل Chromium. اختبارات Playwright-Electron تُكتب أيضاً وتعمل على جهاز المطوّر/CI حيث يتوفر Electron.
2. النماذج الكبيرة (Whisper، LLM، Piper، SD) لا يمكن تنزيلها هنا → كل اختبار يعتمد على نموذج غير مثبت يُوسم صراحةً `skipped — model not installed` ويُشغَّل على جهاز المستخدم عبر `pnpm verify:models`. لا يُعلن أي شيء ناجحاً لم يُنفَّذ فعلياً.
3. ما **يمكن** التحقق منه فعلياً هنا (وسيُتحقق منه): كامل مسار FFmpeg (قص/دمج/سرعة/عكس/تجميد/اقتصاص/تدوير/نِسَب/فلاتر لون/تثبيت/تصدير + تحقق)، كشف الوجوه (YuNet) والأجسام (MediaPipe) والتتبع (OpenCV) والأقنعة/الطمس مع تحقق بصري قياسي، VAD وكشف/إزالة السكوت وتقليل الضجيج والتطبيع، OCR عربي/إنجليزي (tesseract.js)، TTS أساسي (espeak-ng)، قاعدة البيانات، نظام المهام، الاستعادة بعد الانهيار، المخطِّط الحتمي للأوامر العربية/الإنجليزية، الترجمة (SRT/VTT/حرق)، مسار Creator بوضع Animatic الصادق.

---

## 1. القرارات التقنية (Stack)

| الطبقة | الاختيار | المبرر |
|---|---|---|
| غلاف سطح المكتب | **Electron 38** (Chromium + Node 22.19) عبر `electron-vite`، تغليف `electron-builder` (Windows/macOS/Linux) | نظام Node البيئي المطلوب (node-llama-cpp, onnxruntime-node, sharp)، ترميزات H.264/AAC مدمجة للمعاينة، نضج التغليف. Tauri مستبعد (crates محجوبة هنا + لا webkit2gtk-dev) |
| الواجهة | React 19 + TypeScript + Tailwind v4 + Radix UI + Zustand + framer-motion (حركات خفيفة) + i18next (ar/en) + lucide-react | واجهة Premium داكنة أولاً، RTL/LTR عبر `dir` + الخصائص المنطقية (`ms-`, `pe-`) |
| العملية الرئيسية | Node 22 + TypeScript، `node:sqlite` (مدمج، FTS5) خلف واجهة `Database` مجردة، FFmpeg/FFprobe كـ sidecar، Python AI Worker عبر JSON-RPC على stdio | لا وحدات native هشة؛ FFmpeg هو محرك المعالجة الحقيقي؛ Python هو محرك الذكاء الاصطناعي المحلي القياسي |
| النواة المشتركة | حزمة TS نقية (نموذج الخط الزمني، الأوامر، Undo/Redo عبر `immer` patches، المدقق، المخطِّط الحتمي) | تُستخدم في الواجهة (تحرير تفاؤلي) وفي العملية الرئيسية (مصدر الحقيقة) |
| Python AI Worker | `mediapipe`, `opencv-contrib-python-headless`, `onnxruntime`, `silero-vad`, `faster-whisper`/`sherpa-onnx`, `piper-tts`/`espeakng-loader`, `noisereduce`, `pyloudnorm`, `soundfile`, `realesrgan-ncnn-py`, (اختياري) `diffusers`/جسر ComfyUI | تثبيت بحسب القدرة (extras) داخل venv يديره التطبيق، بموافقة المستخدم وعرض الحجم |
| نماذج اللغة للمساعد | مخطِّط حتمي ثنائي اللغة (دائم التوفر) + `node-llama-cpp` (GGUF محلي) + Ollama (محلي عبر HTTP) + Anthropic / OpenAI-compatible (سحابي، opt-in) | المخطِّط الحتمي يضمن عمل الأوامر المذكورة في المتطلبات بلا أي نموذج؛ النموذج يوسّع الفهم ويُخرج JSON مُتحقَّقاً منه بـ zod |
| الاختبارات | vitest (وحدة/تكامل)، Playwright (E2E واجهة في وضع المتصفح + مواصفة Electron)، pytest (worker)، وسائط اصطناعية مولّدة بـ FFmpeg | |
| الاسم | اسم العرض **7vid**، معرّف الحزم `sevenvid` | أسماء الحزم لا يُفضَّل أن تبدأ برقم |

---

## 2. خريطة الوحدات (Monorepo بـ pnpm workspaces)

```
7vid/
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, .eslintrc, .prettierrc
├─ apps/desktop/                 # تطبيق Electron (electron-vite)
│  ├─ src/main/                  # bootstrap، النوافذ، IPC router، القوائم، الحوارات، safeStorage، حارس الانهيار
│  ├─ src/preload/               # contextBridge: window.sevenvid.{invoke, subscribe} فقط
│  ├─ src/renderer/              # React: app shell، الشاشات، المكوّنات، المتاجر، i18n، الثيمات
│  └─ electron-builder.yml       # extraResources: ffmpeg, fonts, model registry, ai-worker
├─ packages/core/                # TS نقي: أنواع المشروع/الخط الزمني، الأوامر + Undo/Redo، المدقق، IntentParser، وحدات الزمن/الأرقام العربية، القوالب
├─ packages/ipc/                 # عقد IPC المكتوب بـ zod (channels, payloads, events) — مصدر واحد للحقيقة
├─ packages/engine/              # Node فقط: كل خدمات العملية الرئيسية
│  ├─ db/ (schema, migrations, repositories, fts)      ├─ media/ (probe, thumbnails, waveform, proxy, import)
│  ├─ ffmpeg/ (runner, progress, filtergraph builder)  ├─ render/ (graph compiler, staged renderer, preview renderer)
│  ├─ export/ (presets, encoder probe, validator)      ├─ audio/ (silence, loudness, enhance chains)
│  ├─ subtitles/ (srt/vtt/ass writers, styles, align)  ├─ vision/ (faces, objects, tracking, masks, ocr, verify)
│  ├─ ai/ (planner, operations, runner, verifier, conversation)  ├─ creator/ (brief, script, character bible, scenes, animatic, assembly)
│  ├─ providers/ (registry, interfaces, local/*, cloud/*)          ├─ models/ (registry, downloader, installer, tester, recommender)
│  ├─ worker/ (python runtime manager, venv, JSON-RPC client)    ├─ tasks/ (queue, scheduler, persistence, pause/resume/cancel)
│  ├─ project/ (session, autosave, versions, journal, recovery)  ├─ hardware/ (cpu/gpu/vram/ram/disk monitor, encoders)
│  ├─ capabilities/ (capability registry → UI gating)           ├─ privacy/ (network gateway, consent, network log)
│  ├─ errors/ (AppError, codes, catalog)  ├─ logging/ (pino JSON files, rotation, diagnostics bundle)  ├─ search/ (FTS5 global search)
│  └─ devbridge/ (WebSocket host يعرض نفس IPC للمتصفح/Playwright)
├─ ai-worker/                    # حزمة Python: sevenvid_worker (JSON-RPC stdio) + capabilities/* + pyproject extras
├─ resources/                    # fonts (Inter, IBM Plex Sans Arabic/Noto Arabic), icons, models/registry.json, templates/*.json, presets/*.json
├─ tests/                        # e2e/ (playwright), fixtures/ (مولّد وسائط اصطناعية), integration/
├─ scripts/                      # fetch-ffmpeg, verify-models, audit-ui, gen-fixtures, dev-browser
└─ docs/                         # README, ARCHITECTURE, INSTALL, DEVELOPMENT, AI_MODELS, HARDWARE, TROUBLESHOOTING, PROVIDERS, TESTING
```

**قواعد الفصل:** الواجهة لا تستورد من `engine` أبداً (فقط `core` و`ipc`). `engine` لا يعرف React. كل الاتصال عبر عقد `ipc` المكتوب (invoke/subscribe). كل مسار ثقيل يمر بنظام المهام. كل اتصال خارجي يمر بـ `privacy/NetworkGateway`.

**مصدر الحقيقة للمشروع:** `ProjectSession` في العملية الرئيسية يملك وثيقة الخط الزمني؛ الواجهة ترسل أوامر (`core` commands) وتحتفظ بنسخة مرآة، وتستخدم `core` للمعاينة التفاؤلية أثناء السحب ثم تُثبِّت الأمر. عمليات الذكاء الاصطناعي تعدّل نفس الوثيقة عبر نفس الأوامر → تزامن مضمون بين الخط الزمني والمعاينة والترجمات والأقنعة.

---

## 3. مخطط قاعدة البيانات (SQLite، WAL، FTS5) — الملفات الكبيرة خارج القاعدة كمراجع

| الجدول | الأعمدة الأساسية |
|---|---|
| `projects` | id, name, kind(editor/creator), settings_json (width,height,fps,sampleRate,aspectPreset), data_dir, current_version_id, thumbnail_path, created_at, updated_at, last_opened_at, deleted_at |
| `project_versions` | id, project_id, seq, label, reason(autosave/manual/ai/restore/creator), document_json (وثيقة الخط الزمني كاملة), hash, size_bytes, created_at |
| `assets` | id, project_id(null=مكتبة عامة), kind(video/image/audio/music/voice/character/generated/template/font), name, source_path, fingerprint, mime, container, duration_ms, width, height, fps_num, fps_den, video_codec, audio_codec, channels, sample_rate, bitrate, streams_json, thumbnail_path, sprite_path, waveform_path, proxy_path, proxy_status, analysis_status, tags_json, favorite, missing, created_at, updated_at |
| `assets_fts` (FTS5) | name, tags, transcript_text |
| `transcripts` | id, asset_id, project_id, language, provider_id, model_id, segments_json, text, created_at |
| `ai_conversations` / `ai_messages` | conversation(project_id) / message(role, content, interpretation_json, plan_id, created_at) |
| `ai_plans` | id, conversation_id, message_id, operations_json, status(draft/confirmed/executing/done/failed/cancelled), requires_confirmation, summary_ar, summary_en, created_at |
| `ai_operations` | id, plan_id, project_id, seq, type, params_json, input_json, output_json, status(queued/validating-input/running/validating-output/validating-state/done/failed/cancelled/skipped), validation_json, error_json, provider_id, model_id, version_before, version_after, started_at, finished_at, duration_ms |
| `characters` | id, project_id, name, bible_json (age, gender, appearance, face, hair, clothing, voice, personality), reference_images_json, embedding_blob, generation_params_json, created_at, updated_at |
| `scripts` | id, project_id, version, brief_json, script_json, created_at |
| `scenes` | id, project_id, order_index, scene_json (duration, location, characters, dialogue, narration, camera, lighting, environment, action, transition, audio, music, prompt, negative_prompt, references), status, storyboard_path, generated_asset_id, consistency_json, created_at, updated_at |
| `models` | id, registry_id, name, capability, provider_id, version, size_bytes, vram_mb, ram_mb, files_json, install_path, status(available/downloading/installed/broken/removed), checksum_ok, license, installed_at, last_tested_at, last_test_json |
| `providers_config` | provider_id, enabled, config_json (الأسرار عبر Electron `safeStorage`), updated_at |
| `settings` | key, value_json, updated_at |
| `tasks` | id, kind, title, project_id, parent_task_id, status(queued/running/paused/done/failed/cancelled/interrupted), priority, progress, progress_message, eta_ms, params_json, result_json, error_json, attempts, cancellable, pausable, created_at, started_at, finished_at |
| `exports` | id, project_id, task_id, preset_id, settings_json, output_path, status, validation_json, size_bytes, duration_ms, created_at, finished_at |
| `templates` | id, name, category, builtin, template_json, thumbnail_path, created_at |
| `network_log` | id, ts, provider_id, host, purpose, bytes_out, bytes_in, status |
| `app_state` | key, value (مثال: `session_open`, `last_project_id`) — علامة الانهيار للاستعادة |
| `global_fts` (FTS5) | entity_type, entity_id, title, body — للبحث الشامل (مشاريع، وسائط، شخصيات، مشاهد، عمليات AI، نماذج، قوالب) |

**خارج القاعدة (في `data_dir` للمشروع):** `project.7vid.json` (مرآة قابلة للنقل)، `journal.ndjson` (patches تراكمية بين اللقطات للاستعادة)، `tracks/<id>.json` (إطارات الأقنعة/التتبع)، `cache/` (proxies, thumbnails, waveforms, preview renders)، `generated/` (أصول Creator)، `exports/`.

---

## 4. معمارية مزوّدي الذكاء الاصطناعي (Provider Architecture)

```ts
ProviderDescriptor { id, name, version, kind: 'local'|'local-service'|'cloud', capabilities[], requirements: { gpu?, minVramMb?, minRamMb?, models?: registryIds[], pythonExtras?: string[] }, inputFormats[], outputFormats[], configSchema: zod }
Provider { descriptor; probe(ctx) → { available, reason?, device? } }
واجهات: TextModelProvider, SpeechToTextProvider, SpeechSynthesisProvider, TranslationProvider, FaceDetectionProvider, ObjectDetectionProvider, TrackingProvider, SegmentationProvider, FaceEmbeddingProvider, OcrProvider, ImageModelProvider, VideoModelProvider, MusicProvider, UpscalingProvider, EnhancementProvider, InterpolationProvider
ProviderRegistry: register / list(capability) / select(capability, policy{preferLocal, userPreference}) / availability cache + events
```

| القدرة | المزوّد الافتراضي (محلي) | بدائل | التحقق هنا |
|---|---|---|---|
| Text (المساعد/الكاتب) | `DeterministicPlanner` (core) → دائم | `node-llama-cpp` GGUF (Qwen2.5-3B/7B-Instruct)، Ollama، Anthropic (`claude-sonnet-5`)، OpenAI-compatible | الحتمي ✅ كامل؛ الآخرون اختبار عقد بخادم وهمي + `skipped` بلا نموذج/مفتاح |
| STT (ar/en/مختلط) | `faster-whisper` (CT2؛ small/medium/large-v3-turbo) | `sherpa-onnx` whisper، whisper.cpp | ❌ نماذج محجوبة → `verify:models` على جهاز المستخدم |
| VAD/السكوت | `silero-vad` (النموذج داخل الحزمة) + FFmpeg `silencedetect` | — | ✅ |
| TTS | `piper-tts` (ar_JO-kareem, en_US-lessac) | `espeak-ng` (أساسي، دائم التوفر)، سحابي opt-in | espeak ✅؛ piper `skipped` |
| كشف الوجوه | OpenCV **YuNet** (ONNX 345KB) | MediaPipe Face Landmarker (أقنعة دقيقة) | ✅ |
| كشف الأجسام | MediaPipe EfficientDet-Lite0/2 (COCO) | YOLO ONNX عبر onnxruntime (تنزيل لاحق) | ✅ |
| التتبع | OpenCV CSRT/VitTrack + إعادة الربط بالكشف (IoU + Kalman + استيفاء) + كشف الفشل | — | ✅ |
| تقسيم الأشخاص | MediaPipe selfie/multiclass segmenter | — | ✅ |
| بصمة الوجه (اتساق الشخصيات) | OpenCV **SFace** ONNX | insightface (لاحقاً) | ✅ |
| OCR | `tesseract.js` (wasm، ara+eng من tessdata_fast) | RapidOCR/PaddleOCR عبر Python (لاحقاً) | ✅ |
| تحسين الصوت | FFmpeg (`afftdn`, `loudnorm`, `speechnorm`, `acompressor`, `equalizer`, `sidechaincompress`) + `noisereduce` | Demucs (فصل الصوت، اختياري) | ✅ |
| تحسين الفيديو/اللون | FFmpeg (`eq`, `colortemperature`, `colorbalance`, `unsharp`, `hqdn3d`/`nlmeans`, `vidstab`/`deshake`, `minterpolate`) | RIFE (استيفاء إطارات AI، اختياري) | ✅ |
| Upscaling | FFmpeg Lanczos (غير AI، مُسمّى صراحة) | **Real-ESRGAN** (ncnn-vulkan؛ يتطلب GPU) | Lanczos ✅؛ ESRGAN `skipped` |
| توليد الصور | `diffusers` محلي (SD/Flux، يتطلب VRAM) | جسر ComfyUI محلي، سحابي opt-in | واجهة + اختبار عقد؛ `needs-model` |
| توليد الفيديو | `diffusers` محلي (Wan2.1-T2V-1.3B / LTX؛ ≥8–12GB VRAM) | جسر ComfyUI، سحابي opt-in | واجهة + اختبار عقد؛ `needs-hardware/model` |
| موسيقى | مكتبة المستخدم/أصول مرخصة | MusicGen-small محلي، سحابي | مكتبة ✅ |
| ترجمة نصية | عبر TextModelProvider | سحابي | حتمي ❌ (يتطلب نموذج) → `needs-provider` |

**مدير النماذج:** سجل `resources/models/registry.json` (id, capability, provider, size, vram/ram, files[{url, sha256, path}], license, languages) ← تنزيل قابل للاستئناف عبر نظام المهام + تحقق sha256 + تثبيت في `userData/models` + زر **Test** يشغّل اختباراً حقيقياً (تفريغ عينة صوتية اصطناعية، كشف وجوه في صورة اختبار) ويعرض النتيجة والزمن + توصية بحسب العتاد (جدول عتبات VRAM/RAM).

**Python Runtime Manager:** كشف Python ≥3.10 → إنشاء venv مُدار → تثبيت extras حسب القدرة بموافقة المستخدم (يعرض الحجم) → handshake `hello` يُرجع القدرات المتاحة/غير المتاحة مع السبب. على Windows بلا Python: إرشاد تثبيت موجّه. لاحقاً (المرحلة 8): تغليف PyInstaller.

**بوابة الشبكة والخصوصية:** كل طلب خارجي (مزوّد سحابي، تنزيل نموذج) يمر بـ `NetworkGateway` الذي يرفض ما لم يفعّله المستخدم، يطلب موافقة أول تنزيل، ويسجّل كل طلب في `network_log` (مضيف + غرض + حجم). شارة «معالجة خارجية مفعّلة» في الشريط العلوي عند تفعيل أي مزوّد سحابي.

---

## 5. معمارية معالجة الفيديو والصوت

**5.1 الاستيراد والتحليل (لا يُعدَّل الملف الأصلي أبداً):** `ffprobe -show_streams -show_format` → metadata (دقة، fps، كودك، مدة، مسارات فيديو/صوت) → thumbnails (sprite sheet عبر `fps=1/N`) → waveform peaks (PCM 8kHz mono → JSON) → قرار proxy: يُولَّد (H.264/AAC أو VP9/Opus بحسب ما يدعمه Chromium الفعلي للغلاف، تُكتشف القدرة من الواجهة عند الإقلاع) إذا كانت الدقة > 1080p أو الكودك/الحاوية غير قابلة للفك في المعاينة (HEVC/ProRes/AVI/MKV...). كل ذلك كمهام خلفية بتقدم حقيقي.

**5.2 محرك المعاينة (هجين):** معاينة حيّة مركّبة (`<video>` لكل مقطع مرئي + canvas للأقنعة/الترجمات/التحويلات/تعديلات اللون التقريبية + Web Audio للمستويات والـ fades) بساعة رئيسية واحدة. للمؤثرات التي تتطلب معالجة (تحسين الصوت، تقليل الضجيج، upscale، الاستيفاء، التثبيت) → **Rendered Preview**: رندر خلفي بجودة proxy للمقطع المتأثر (كاش بمفتاح hash لوثيقة المقطع) ثم تبديل تلقائي؛ الواجهة تُظهر الحالة (live/rendered/rendering). معاينة قبل/بعد بعرض منقسم.

**5.3 مترجم الخط الزمني إلى FFmpeg (`RenderGraphCompiler`):** وثيقة الخط الزمني + مدى + هدف (proxy/preview/export) → filtergraph:
- المقاطع: `trim/atrim` + `setpts`، السرعة (`setpts`/سلسلة `atempo`)، العكس (`reverse` عبر ملف وسيط للمقاطع الطويلة)، التجميد (`tpad`/`loop`)، اقتصاص/تدوير/قلب/تحجيم/pad إلى إعدادات التسلسل، نسب العرض (16:9، 9:16، 1:1، 4:5، مخصص) مع استراتيجيات (crop/fit/blur-fill).
- اللون/التحسين: `eq`, `colortemperature`, `colorbalance`, `curves`, `unsharp`, `hqdn3d`, `vidstabdetect/transform` (مرحلتان) أو `deshake`, `minterpolate`.
- الأقنعة المتتبَّعة: لكل مسار قناع ملف `sendcmd` يحدّث `crop/overlay/drawbox` لكل إطار (blur = `boxblur`, pixelate = `scale↓ + scale↑ neighbor`, box = `drawbox`, custom = PNG sequence + `alphamerge`).
- الترجمات: توليد ASS (أنماط، RTL عبر libass + خط عربي مضمّن) → `subtitles=` للحرق؛ تصدير SRT/VTT/ASS.
- الصوت: مسارات متعددة `amix`، ducking `sidechaincompress`، `afade`، `loudnorm` (مرحلتان)، `afftdn`، `speechnorm`، `acompressor`، `equalizer`، استبدال الصوت.
- **الرندر المرحلي:** `RenderPlanner` يقرر تمريرة واحدة أو رندر وسيط لكل مقطع ثم `concat` عند تعقيد الرسم (يحمي من حدود FFmpeg ويسمح بالإلغاء/الاستئناف بحسب المقاطع المكتملة).

**5.4 مركز التصدير:** حاويات MP4/MOV/WebM؛ كودكات H.264/H.265/AV1 (libx264/libx265/libsvtav1/libaom) + مسرّعات عتادية تُكتشف فعلياً (`-encoders` + **ترميز اختباري لثانية واحدة** لتأكيد عمل nvenc/qsv/amf/videotoolbox/vaapi) مع تراجع تلقائي؛ خيارات الدقة/fps/bitrate/CRF/الصوت؛ إعدادات مسبقة (YouTube, TikTok, Instagram, High Quality, 4K, Custom)؛ تقدم حقيقي من `-progress pipe:1` (fps، الزمن المتبقي، الحجم). **التحقق بعد التصدير:** ffprobe (المدة ± تسامح، الدقة، الكودك، عدد الإطارات)، فك كامل `-v error … -f null` (صفر أخطاء)، حجم > 0، وفحوص خاصة بالعملية (انظر §6.4).

---

## 6. المساعد الذكي ومخطِّط الأوامر (الميزة الأهم)

**6.1 المسار:** رسالة المستخدم (ar/en/مختلط) → **فهم** (`IntentParser` الحتمي: تطبيع الأرقام العربية/الهندية، صيغ الزمن `2:10`، «أول 20 ثانية»، «الدقيقة 2:10 إلى 2:45»، «خلي الفيديو دقيقة»، الإشارات المكانية «على اليمين/اليسار/الوسط»، «كل الوجوه»؛ إن لم يكن واثقاً وكان TextModelProvider مفعّلاً → LLM بمخطط JSON صارم (zod) وإلا سؤال توضيحي) → **تحليل المشروع** (المدة، المقاطع، وجود صوت/كلام، وجوه مكتشفة، نسبة العرض) → **خطة** = DAG من عمليات مكتوبة → **تدقيق** (قابلية التنفيذ، القدرات المتاحة، العتاد، المدد) → **عرض الخطة للمستخدم** بالعربية/الإنجليزية (ما سيحدث خطوة بخطوة) مع أزرار **Apply / Preview / Cancel** (التأكيد إلزامي للعمليات المدمّرة أو الطويلة) → **تنفيذ** عبر نظام المهام مع تقدم لكل عملية → **تحقق** لكل عملية → **تحديث الخط الزمني** بأوامر `core` (قابلة للتراجع كوحدة واحدة) → **تقرير** دقيق بما تغيّر فعلاً (ولماذا فشل ما فشل + إعادة المحاولة/بدائل).

**6.2 مخطط العملية:**
```ts
Operation { id, type, params, inputs: Ref[], outputs: Ref[], status, error?, validation: { input, output, state }, requiresConfirmation, destructive, estimate?: { durationMs, vramMb } }
أنواع: TrimStart, TrimEnd, CutRange, SetDuration, SplitAt, RemoveSilence, DetectFaces, TrackTargets, ApplyMask(blur|pixelate|box), DetectObjects, EnhanceAudio(preset), Normalize, Denoise, Transcribe, Translate, GenerateSubtitles, BurnSubtitles, SetAspect(preset), ChangeSpeed, Reverse, FreezeFrame, ColorAdjust, EnhanceVideo(preset), Upscale(target), Stabilize, DetectText(OCR), BlurText, ValidateTimeline, RenderPreview
```
**6.3 خريطة الأمثلة المطلوبة →** «احذف أول 20 ثانية وآخر 15» → TrimStart(20)+TrimEnd(15)؛ «احذف من 2:10 إلى 2:45» → CutRange؛ «خلي الفيديو دقيقة» → SetDuration(60, strategy=ask|trim-end|remove-silence-first)؛ «شيل فترات السكوت» → RemoveSilence(vad)؛ «طمس وجه الشخص على اليمين» → DetectFaces+TrackTargets(selector=rightmost)+ApplyMask(blur)+RenderPreview؛ «خلي الفيديو مناسب للتيك توك» → SetAspect(9:16)+(اختياري) Subtitles style؛ «حسن الصوت/نظف الصوت/احذف الضجيج» → EnhanceAudio؛ «ارفع جودة الفيديو» → EnhanceVideo/Upscale بحسب العتاد؛ «أضف ترجمة عربية» → Transcribe(auto)+Translate(ar إذا لزم)+GenerateSubtitles؛ «اجعل الفيديو أكثر احترافية» → خطة مركّبة تُعرض للمستخدم قبل التنفيذ.

**6.4 التحقق الحقيقي لكل عملية (Verifier):** Trim/Cut → مدة الوثيقة والناتج؛ RemoveSilence → `silencedetect` على الناتج لا يُظهر سكوتاً ≥ العتبة؛ ApplyMask → **قياس** تباين Laplacian داخل منطقة القناع في إطارات عيّنة من الرندر (قبل/بعد) يجب أن ينخفض تحت عتبة + وجود مسار القناع في الوثيقة + وجود العملية في السجل؛ EnhanceAudio → قياس `ebur128`/`volumedetect` قبل/بعد؛ Subtitles → عدد cues > 0، مرتبة، ضمن المدة، متزامنة مع مقاطع الكلام (VAD)؛ Upscale → دقة الناتج = الهدف + فك كامل؛ Tracking → نسبة الإطارات المفقودة والثقة، وعند الفشل: إبلاغ + محاولة استرداد محكومة (إعادة كشف + إعادة ربط) + عدم إنتاج نتيجة خاطئة بصمت.

---

## 7. مولّد الفيديو (AI Video Creator)

المسار: **Idea → Brief** (نموذج منظّم يُملأ من النص عبر LLM أو يدوياً؛ يسأل فقط عن الناقص الضروري ويستنتج الافتراضيات: المدة، اللغة، النبرة، الأسلوب، النسبة، المنصة، الشخصيات، الموقع، الحوار، الصوت، الموسيقى، الكاميرا، الإضاءة) → **Script** (LLM؛ وبدونه: محرر سكربت يدوي بقالب مشاهد — مسار حقيقي) → **Character Bible** (ID، الاسم، العمر، الجنس، المظهر، الوجه، الشعر، الملابس، الصوت، الشخصية، صور مرجعية من نص/صورة/عدة صور عبر ImageModelProvider، بصمة SFace، معاملات التوليد؛ الواقعية الفوتوغرافية افتراضياً في القوالب والـ negative prompts) → **Scenes/Shot list** (كل مشهد بالحقول المطلوبة + storyboard مرئي) → **Voice** (TTS بالمزوّد المتاح) → **Music** (مكتبة/مزوّد) → **Video generation** عبر VideoModelProvider عند توفر عتاد/نموذج؛ وإلا **وضع Animatic** الصادق: مشاهد من صور الشخصيات/المشاهد (ImageModelProvider) أو بطاقات storyboard بحركة Ken Burns، مُعلَّمة بوضوح «Animatic — لا يوجد نموذج توليد فيديو مثبت» → **Editing**: تجميع تلقائي في **نفس نموذج الخط الزمني** للمحرر (كل أدوات المحرر تعمل عليه) → **Subtitles** من السكربت وتوقيتات TTS → **Final review**: فحوص QA (المدد، الأصول الناقصة، **اتساق الشخصية** بمقارنة بصمة الوجه المرجعية مع وجوه الإطارات المولّدة وتعليم غير المتّسق مع خيار إعادة التوليد؛ لا وعود بحفظ الهوية إن كان النموذج لا يدعمها) → **Export** عبر مركز التصدير نفسه. مستويات جودة التوليد: Draft/Balanced/High/Maximum تُترجم إلى معاملات المزوّد.

---

## 8. الأنظمة العرضية (Cross-cutting)

- **نظام المهام:** طابور بأولويات + عمّال (عمليات FFmpeg/Python)؛ pause/resume (SIGSTOP/SIGCONT على POSIX؛ على Windows: إيقاف بنقطة تفتيش للمهام القابلة للتجزئة، وإلا يُبلَّغ «الإيقاف المؤقت غير مدعوم لهذا النوع» بصدق)، cancel، retry، تقدير الزمن المتبقي، حفظ في `tasks`، وعند الإقلاع: المهام التي كانت `running` تُوسم `interrupted` مع عرض إعادة المحاولة.
- **الأخطاء:** `AppError { errorId(ULID), module, operation, code, cause, technical, userMessageKey(ar/en), retryable, recovery[], logRef }` + كتالوج أكواد + `ErrorBus` → واجهة (toast/dialog مع Retry/بدائل). فشل مهمة AI لا يُسقط التطبيق أبداً.
- **السجلات والتشخيص:** pino JSON (timestamp, module, operation, taskId, model, durationMs, status, error) بملفات دوّارة في `userData/logs`؛ لوحة Diagnostics (سجلات حيّة، تاريخ المهام، معلومات النظام، سجل الشبكة، تصدير حزمة تشخيص zip).
- **إطار التحقق:** كل عملية مهمة تنفّذ `validateInput → execute → validateOutput → validateState → userConfirmation`، تُسجَّل حالات كل خطوة في `ai_operations`/`tasks`.
- **سجل القدرات (Capability Registry) — منع الأزرار الميتة:** حالة كل قدرة (`available | needs-model | needs-provider | needs-hardware | needs-runtime | unavailable-in-build`) مشتقة من المزوّدين/العتاد/وقت التشغيل؛ مكوّن `<CapabilityGate>` يعطّل الزر ويشرح السبب ويقدّم إجراءً (فتح مدير النماذج/الإعدادات). قاعدة lint تمنع `onClick` فارغة، وسكربت `audit-ui` يزور كل الشاشات ويضغط كل `[data-action]` ويتحقق من وجود أثر مسجَّل أو شرح Gate.
- **المشروع:** autosave (debounce 2s + كل N أوامر) كلقطة في `project_versions` + `journal.ndjson`؛ تاريخ الإصدارات مع استعادة/تكرار؛ علامة `session_open` للانهيار → عند الإقلاع التالي استعادة آخر حالة صالحة (لقطة + journal) مع تحقق من سلامة JSON.
- **الإعدادات:** General, Appearance (dark/light/system), Language (ar/en + RTL), AI, Models, GPU, Storage (مواقع الكاش/الحدود/تنظيف), Export, Keyboard Shortcuts (قابلة للتخصيص)، Privacy، External Providers، Notifications، Performance.
- **البحث الشامل:** FTS5 عبر `global_fts` مع فهرسة عند التغيير.
- **العتاد:** `systeminformation` + `nvidia-smi` (VRAM/الاستخدام) + مسبار Python (CUDA/DirectML/CoreML) + مسبار مرمّزات FFmpeg؛ فحص قبل العمليات الثقيلة مع رسالة واضحة عند العجز (VRAM المطلوب، العتاد الموصى به، الزمن المقدّر، البديل السحابي الاختياري).
- **الأمان:** contextIsolation، sandbox، بلا nodeIntegration، CSP صارمة، قائمة سماح لـ `openExternal`، أسرار عبر `safeStorage`، لا telemetry.

---

## 9. الواجهة (UI/UX)

- **التخطيط:** شريط جانبي أيسر (Home, Editor, Creator, Projects, Media, Models, Templates, Export, Settings, System) — يصبح يميناً في RTL تلقائياً؛ شريط علوي (اسم المشروع، حالة الحفظ، Undo/Redo، زر المساعد، Export، شارة المعالجة الخارجية)؛ شريط حالة سفلي (GPU، RAM، التخزين، حالة المعالجة/المهام).
- **الشاشات:** Home (New/Open/Import، Editor/Creator، المشاريع والتصديرات الأخيرة، حالة النماذج/GPU/التخزين — كلها من بيانات حقيقية)؛ Editor (مكتبة المشروع | معاينة | لوحة الخصائص/المؤثرات؛ خط زمني canvas متعدد المسارات بسحب/قص/تقسيم/trim/ripple/insert/replace/duplicate/zoom/snap/markers)؛ Creator (معالج مراحل مع storyboard)؛ Projects؛ Media Library (فئات، بحث، فلاتر، معاينة، وسوم، مفضلة)؛ Models؛ Templates؛ Export Center؛ Settings؛ System/Hardware؛ لوحة المساعد العامة (الأمر → التفسير → الخطة → التقدم → النتيجة)؛ Diagnostics.
- **نظام التصميم:** tokens داكنة أولاً + light، Inter + IBM Plex Sans Arabic، Radix للوصولية، حركات framer-motion خفيفة فقط للتحميل/الانتقال/الاكتمال/الخطأ، اختصارات لوحة مفاتيح على نمط NLE (Space, J/K/L, I/O, S, Delete, Ctrl+Z/Y, +/-, M).

---

## 10. خارطة الطريق (8 مراحل) — لا تُعلَن مرحلة مكتملة قبل: تنفيذ → اختبار → ربط → تحقق → إصلاح

| المرحلة | المخرجات | الاختبارات/معيار الاكتمال |
|---|---|---|
| **1. الأساس** | monorepo، electron-vite، React shell + التنقل الكامل + i18n/RTL + الثيمات، `ipc` contract، `node:sqlite` + migrations + repositories، نظام المشاريع (إنشاء/فتح/حفظ/إصدارات/استعادة)، إدارة الملفات (userData، data_dir)، نظام المهام، الأخطاء، السجلات، كشف العتاد، Dev Bridge، Capability Registry | vitest للـ db/tasks/project/recovery؛ Playwright: كل عناصر التنقل تفتح شاشتها؛ محاكاة انهيار → استعادة |
| **2. الوسائط والتحرير** | تثبيت/اكتشاف FFmpeg، الاستيراد والتحليل (كل الصيغ)، thumbnails/waveform/proxy، المكتبة، نموذج الخط الزمني + الأوامر + Undo/Redo، خط زمني canvas، المعاينة الحيّة، التحرير الأساسي (قص/تقسيم/دمج/اقتصاص/تدوير/قلب/تحجيم/سرعة/بطيء/تجميد/عكس/استخراج إطار/نِسَب وإعدادات المنصات)، RenderGraphCompiler، تصدير أولي + تحقق | اختبارات مسار الفيديو بوسائط اصطناعية (كل عملية تُرندر وتُفحص بـ ffprobe/فك كامل)؛ E2E: استيراد → تحرير → تصدير → تحقق |
| **3. الصوت والترجمة والرؤية** | سلاسل الصوت، VAD/السكوت، Python worker + runtime manager، كشف/تتبع الوجوه والأجسام، الأقنعة (blur/pixelate/box/custom) + sendcmd، OCR (كشف/تتبع/طمس/استخراج/بحث)، STT providers + محرر ترجمة + أنماط + SRT/VTT/حرق، الترجمة عبر LLM (gated)، اللون والتحسين + قبل/بعد، upscale (Lanczos + ESRGAN gated) | vision/audio/ocr pytest+vitest بصور/أصوات حقيقية (صورة وجه من skimage، نص عربي مُصيَّر)؛ تحقق الطمس القياسي؛ STT `skipped` بلا نموذج مع مسار `verify:models` |
| **4. المساعد** | IntentParser ثنائي اللغة + اختبارات شاملة للأمثلة، Operation schema، Planner/Runner/Verifier، واجهة المحادثة (تفسير/خطة/تقدم/نتيجة)، التأكيد/المعاينة/الإلغاء/التراجع، مزوّدو LLM (llama.cpp/Ollama/Anthropic) خلف Gate | E2E: «احذف أول 10 ثواني، طمس الوجه، حسن الصوت، وأضف ترجمة» يغيّر الوثيقة فعلياً ويُرندر ويُتحقق؛ سيناريوهات فشل (لا وجوه، لا كلام، لا نموذج) تُبلَّغ بصدق |
| **5. Creator** | Brief/Script/Character Bible/Scenes/Storyboard/Voice/Music/Generation providers/Animatic/Assembly/Subtitles/Review/Export | E2E: فكرة → سكربت (يدوي أو LLM) → شخصية → مشاهد → TTS → animatic → خط زمني → تصدير → تحقق؛ فحص اتساق الشخصية بـ SFace |
| **6. النماذج والمزوّدون** | شاشة AI Models (مثبت/متاح/حجم/VRAM/RAM/حالة/تنزيل/إزالة/تحديث/اختبار)، registry.json، التوصية بالعتاد، NetworkGateway + موافقات، إعدادات المزوّدين الخارجيين | اختبار التنزيل/الاستئناف/sha256 بخادم محلي؛ اختبار "Test" الحقيقي لنماذج يمكن جلبها هنا (YuNet, MediaPipe, tessdata) |
| **7. التصدير والجودة والتشخيص** | مركز التصدير الكامل (presets، كودكات، مسرّعات مكتشفة فعلياً، تقدم، تحقق)، سجل التصديرات، لوحة Diagnostics، حزمة التشخيص، Recovery النهائي | مصفوفة تصدير (حاوية × كودك × دقة) + تحقق؛ محاكاة امتلاء القرص (فحص المساحة قبل البدء + معالجة ENOSPC) |
| **8. QA والتغليف** | تدقيق شامل (كل زر/شاشة/نموذج/حوار/مسار خطأ/لغة/RTL/ثيم/اختصار/undo/autosave/recovery)، الأداء (lazy loading، virtualization، caching)، مراجعة أمن/خصوصية، تهيئة electron-builder، الوثائق التسع | `audit-ui`، `pnpm test` كامل، `pnpm typecheck`، `pnpm lint`؛ تقرير نهائي صادق بما تم التحقق منه هنا وما يتطلب جهاز المستخدم |

**تنفيذ الجلسة:** بعد كل مرحلة: commit وصفي + push إلى الفرع المحدد؛ فتح PR مسودة بعد المرحلة 1 وتحديثه تباعاً. تثبيتات البيئة المطلوبة هنا: `apt-get install ffmpeg espeak-ng fonts-noto-core`، `pnpm install`، venv للـ worker مع extras القابلة للتثبيت هنا.

---

## 11. استراتيجية الاختبار والتحقق النهائي

- **الأوامر:** `pnpm test` (vitest عبر الحزم)، `pnpm test:py` (pytest)، `pnpm test:e2e` (Playwright في وضع المتصفح عبر Dev Bridge + xvfb)، `pnpm test:e2e:electron` (على جهاز به Electron)، `pnpm typecheck`، `pnpm lint`، `pnpm audit:ui`، `pnpm verify:models` (على جهاز المستخدم: يختبر كل نموذج مثبت باختبار حقيقي ويطبع تقريراً).
- **المثبّتات (fixtures):** مولّد وسائط اصطناعية بـ FFmpeg (`testsrc2`, `sine`, `anoisesrc`, صمت، نص عربي/إنجليزي مُصيَّر بـ PIL+arabic-reshaper للـ OCR، مقاطع بصيغ MP4/MOV/MKV/AVI/WebM/M4V + صور + صوت)، صورة وجه حقيقية (`skimage.data.astronaut`) لاختبارات الكشف/التتبع/الطمس/البصمة.
- **مصفوفة حالات الفشل (كلها باختبارات):** إدخال غير صالح، ملف مفقود، صيغة غير مدعومة، GPU غير متاح، VRAM غير كافٍ (محاكاة عتاد)، نموذج غير متاح، فشل AI (worker ينهار → إعادة تشغيل + خطأ صادق)، فشل الرندر (FFmpeg يخرج بخطأ → لا نجاح كاذب)، امتلاء القرص، إعادة تشغيل التطبيق واستعادة المشروع.
- **بوابة الجودة النهائية:** قائمة تدقيق §52 من المتطلبات تُنفَّذ بنداً بنداً وتُوثَّق نتائجها في `docs/QA_REPORT.md` مع تمييز صريح: ✅ تم التحقق هنا / ⏭️ يتطلب جهاز المستخدم (نموذج/GPU/Electron) / ❌ غير مطبّق (ظاهر في الواجهة كغير متاح).

## 12. الوثائق (docs/)
README (عربي + إنجليزي)، ARCHITECTURE، INSTALL، DEVELOPMENT، AI_MODELS (إعداد النماذج المحلية)، HARDWARE (المتطلبات والتوصيات)، TROUBLESHOOTING، PROVIDERS (دليل دمج مزوّد جديد)، TESTING، QA_REPORT.

## 13. الافتراضات والقرارات المتخذة
- الإطار Electron وليس Tauri (مبرر تقني في §1). الاسم `7vid`/`sevenvid`.
- `node:sqlite` بدل better-sqlite3 (خلف واجهة مجردة يمكن تبديلها بملف واحد).
- Python worker مطلوب للقدرات المتقدمة؛ التطبيق يعمل بدونه لكل ما يعتمد على FFmpeg/Node (تحرير، تصدير، OCR، المخطِّط الحتمي) ويعرض بقية القدرات كـ `needs-runtime`.
- توليد الفيديو الواقعي محلياً يتطلب GPU قوياً؛ عند غيابه يعمل Creator بوضع Animatic الصادق أو بمزوّد سحابي يفعّله المستخدم صراحة.
- اللغة الافتراضية للواجهة تُكتشف من النظام (ar/en) وقابلة للتغيير.
