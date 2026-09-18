import type { CapabilityId } from '@sevenvid/core';

export interface ModelFile {
  url: string;
  path: string;
  sha256: string | null;
  sizeBytes: number | null;
}

export interface ModelSpec {
  id: string;
  name: string;
  capability: CapabilityId;
  providerId: string;
  version: string;
  kind: 'local';
  files: ModelFile[];
  sizeBytes: number;
  vramMb: number | null;
  ramMb: number;
  requiresGpu: boolean;
  languages: string[];
  license: string;
  description: string;
  descriptionAr: string;
  host: string;
  recommended: 'always' | 'gpu' | 'optional';
}

const gh = (repo: string, ref: string, file: string) => `https://raw.githubusercontent.com/${repo}/${ref}/${file}`;
const lfs = (repo: string, ref: string, file: string) => `https://media.githubusercontent.com/media/${repo}/${ref}/${file}`;
const mp = (p: string) => `https://storage.googleapis.com/mediapipe-models/${p}`;
const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

/** Built-in model registry. Checksums are verified after download; entries without a checksum are verified by size and a load test. */
export const MODEL_REGISTRY: ModelSpec[] = [
  { id: 'opencv/yunet-2023mar', name: 'YuNet face detector', capability: 'vision.faces', providerId: 'worker-vision', version: '2023mar', kind: 'local', files: [{ url: lfs('opencv/opencv_zoo', 'main', 'models/face_detection_yunet/face_detection_yunet_2023mar.onnx'), path: 'face_detection_yunet_2023mar.onnx', sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', sizeBytes: 232589 }], sizeBytes: 232589, vramMb: null, ramMb: 200, requiresGpu: false, languages: [], license: 'MIT', description: 'Fast, accurate face detection on CPU (OpenCV Zoo).', descriptionAr: 'كشف وجوه سريع ودقيق على المعالج (OpenCV Zoo).', host: 'media.githubusercontent.com', recommended: 'always' },
  { id: 'opencv/sface-2021dec', name: 'SFace face recognition', capability: 'vision.faceEmbedding', providerId: 'worker-vision', version: '2021dec', kind: 'local', files: [{ url: lfs('opencv/opencv_zoo', 'main', 'models/face_recognition_sface/face_recognition_sface_2021dec.onnx'), path: 'face_recognition_sface_2021dec.onnx', sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', sizeBytes: 38696353 }], sizeBytes: 38696353, vramMb: null, ramMb: 300, requiresGpu: false, languages: [], license: 'Apache-2.0', description: 'Face identity embeddings for character consistency checks.', descriptionAr: 'بصمات هوية الوجه لفحص اتساق الشخصيات.', host: 'media.githubusercontent.com', recommended: 'optional' },
  { id: 'opencv/vittrack-2023sep', name: 'VitTrack object tracker', capability: 'vision.tracking', providerId: 'worker-vision', version: '2023sep', kind: 'local', files: [{ url: lfs('opencv/opencv_zoo', 'main', 'models/object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx'), path: 'object_tracking_vittrack_2023sep.onnx', sha256: '2990f0b7cd44d92afa48cd97db6de7be113fc1d9594fddb74e2725c10478e91d', sizeBytes: 714726 }], sizeBytes: 714726, vramMb: null, ramMb: 200, requiresGpu: false, languages: [], license: 'Apache-2.0', description: 'Transformer tracker used when CSRT loses the target.', descriptionAr: 'متتبع بالمحوّلات يُستخدم عند فقد CSRT للهدف.', host: 'media.githubusercontent.com', recommended: 'optional' },
  { id: 'mediapipe/efficientdet-lite0', name: 'EfficientDet-Lite0 object detector', capability: 'vision.objects', providerId: 'worker-vision', version: '1', kind: 'local', files: [{ url: mp('object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'), path: 'efficientdet_lite0.tflite', sha256: '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993', sizeBytes: 7254339 }], sizeBytes: 7254339, vramMb: null, ramMb: 300, requiresGpu: false, languages: [], license: 'Apache-2.0', description: '80 COCO object classes, fast on CPU.', descriptionAr: '80 فئة من أجسام COCO، سريع على المعالج.', host: 'storage.googleapis.com', recommended: 'always' },
  { id: 'mediapipe/efficientdet-lite2', name: 'EfficientDet-Lite2 object detector', capability: 'vision.objects', providerId: 'worker-vision', version: '1', kind: 'local', files: [{ url: mp('object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite'), path: 'efficientdet_lite2.tflite', sha256: '5d4ebec1029bc9907aeadb9e7b4ac9cb1da6a19d01ad375210a9ae18ba173302', sizeBytes: 12138859 }], sizeBytes: 12138859, vramMb: null, ramMb: 400, requiresGpu: false, languages: [], license: 'Apache-2.0', description: 'More accurate object detector (slower).', descriptionAr: 'كاشف أجسام أدق (أبطأ).', host: 'storage.googleapis.com', recommended: 'optional' },
  { id: 'mediapipe/selfie-segmenter', name: 'Selfie segmenter', capability: 'vision.segmentation', providerId: 'worker-vision', version: '1', kind: 'local', files: [{ url: mp('image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite'), path: 'selfie_segmenter.tflite', sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b', sizeBytes: 249537 }], sizeBytes: 249537, vramMb: null, ramMb: 200, requiresGpu: false, languages: [], license: 'Apache-2.0', description: 'Person/background segmentation for masks.', descriptionAr: 'فصل الشخص عن الخلفية للأقنعة.', host: 'storage.googleapis.com', recommended: 'optional' },
  { id: 'mediapipe/face-landmarker', name: 'Face landmarker', capability: 'vision.faces', providerId: 'worker-vision', version: '1', kind: 'local', files: [{ url: mp('face_landmarker/face_landmarker/float16/1/face_landmarker.task'), path: 'face_landmarker.task', sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', sizeBytes: 3758596 }], sizeBytes: 3758596, vramMb: null, ramMb: 300, requiresGpu: false, languages: [], license: 'Apache-2.0', description: '478 face landmarks for precise masks.', descriptionAr: '478 معلماً للوجه لأقنعة دقيقة.', host: 'storage.googleapis.com', recommended: 'optional' },
  { id: 'tesseract/ara-fast', name: 'Tesseract Arabic (fast)', capability: 'ocr', providerId: 'tesseract', version: '4.1', kind: 'local', files: [{ url: gh('tesseract-ocr/tessdata_fast', 'main', 'ara.traineddata'), path: 'ara.traineddata', sha256: 'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729', sizeBytes: 1432056 }], sizeBytes: 1432056, vramMb: null, ramMb: 200, requiresGpu: false, languages: ['ar'], license: 'Apache-2.0', description: 'Arabic OCR language data.', descriptionAr: 'بيانات التعرف الضوئي للعربية.', host: 'raw.githubusercontent.com', recommended: 'always' },
  { id: 'tesseract/eng-fast', name: 'Tesseract English (fast)', capability: 'ocr', providerId: 'tesseract', version: '4.1', kind: 'local', files: [{ url: gh('tesseract-ocr/tessdata_fast', 'main', 'eng.traineddata'), path: 'eng.traineddata', sha256: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2', sizeBytes: 4113088 }], sizeBytes: 4113088, vramMb: null, ramMb: 200, requiresGpu: false, languages: ['en'], license: 'Apache-2.0', description: 'English OCR language data.', descriptionAr: 'بيانات التعرف الضوئي للإنجليزية.', host: 'raw.githubusercontent.com', recommended: 'always' },
  { id: 'silero/vad-v5', name: 'Silero VAD v5', capability: 'audio.vad', providerId: 'worker-audio', version: '5', kind: 'local', files: [{ url: gh('snakers4/silero-vad', 'master', 'src/silero_vad/data/silero_vad.onnx'), path: 'silero_vad.onnx', sha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3', sizeBytes: 2327524 }], sizeBytes: 2327524, vramMb: null, ramMb: 100, requiresGpu: false, languages: [], license: 'MIT', description: 'Speech/silence detection for silence removal and subtitle alignment.', descriptionAr: 'كشف الكلام/السكوت لإزالة السكوت ومزامنة الترجمة.', host: 'raw.githubusercontent.com', recommended: 'always' },
  { id: 'whisper/small-ct2', name: 'Whisper small (faster-whisper)', capability: 'stt', providerId: 'faster-whisper', version: 'small', kind: 'local', files: [
    { url: hf('Systran/faster-whisper-small', 'model.bin'), path: 'model.bin', sha256: null, sizeBytes: 483546902 },
    { url: hf('Systran/faster-whisper-small', 'config.json'), path: 'config.json', sha256: null, sizeBytes: 2000 },
    { url: hf('Systran/faster-whisper-small', 'tokenizer.json'), path: 'tokenizer.json', sha256: null, sizeBytes: 2400000 },
    { url: hf('Systran/faster-whisper-small', 'vocabulary.txt'), path: 'vocabulary.txt', sha256: null, sizeBytes: 460000 },
  ], sizeBytes: 486_000_000, vramMb: 1500, ramMb: 1500, requiresGpu: false, languages: ['ar', 'en', 'multilingual'], license: 'MIT', description: 'Arabic/English transcription, good balance of speed and accuracy on CPU.', descriptionAr: 'تفريغ عربي/إنجليزي، توازن جيد بين السرعة والدقة على المعالج.', host: 'huggingface.co', recommended: 'always' },
  { id: 'whisper/medium-ct2', name: 'Whisper medium (faster-whisper)', capability: 'stt', providerId: 'faster-whisper', version: 'medium', kind: 'local', files: [
    { url: hf('Systran/faster-whisper-medium', 'model.bin'), path: 'model.bin', sha256: null, sizeBytes: 1527906378 },
    { url: hf('Systran/faster-whisper-medium', 'config.json'), path: 'config.json', sha256: null, sizeBytes: 2000 },
    { url: hf('Systran/faster-whisper-medium', 'tokenizer.json'), path: 'tokenizer.json', sha256: null, sizeBytes: 2400000 },
    { url: hf('Systran/faster-whisper-medium', 'vocabulary.txt'), path: 'vocabulary.txt', sha256: null, sizeBytes: 460000 },
  ], sizeBytes: 1_530_000_000, vramMb: 3000, ramMb: 3000, requiresGpu: false, languages: ['ar', 'en', 'multilingual'], license: 'MIT', description: 'Higher accuracy Arabic transcription; GPU recommended.', descriptionAr: 'دقة أعلى للعربية؛ يُنصح بمعالج رسومي.', host: 'huggingface.co', recommended: 'gpu' },
  { id: 'whisper/large-v3-turbo-ct2', name: 'Whisper large-v3-turbo (faster-whisper)', capability: 'stt', providerId: 'faster-whisper', version: 'large-v3-turbo', kind: 'local', files: [
    { url: hf('deepdml/faster-whisper-large-v3-turbo-ct2', 'model.bin'), path: 'model.bin', sha256: null, sizeBytes: 1620000000 },
    { url: hf('deepdml/faster-whisper-large-v3-turbo-ct2', 'config.json'), path: 'config.json', sha256: null, sizeBytes: 2000 },
    { url: hf('deepdml/faster-whisper-large-v3-turbo-ct2', 'tokenizer.json'), path: 'tokenizer.json', sha256: null, sizeBytes: 2500000 },
    { url: hf('deepdml/faster-whisper-large-v3-turbo-ct2', 'vocabulary.json'), path: 'vocabulary.json', sha256: null, sizeBytes: 1100000 },
    { url: hf('deepdml/faster-whisper-large-v3-turbo-ct2', 'preprocessor_config.json'), path: 'preprocessor_config.json', sha256: null, sizeBytes: 400 },
  ], sizeBytes: 1_625_000_000, vramMb: 4000, ramMb: 4000, requiresGpu: true, languages: ['ar', 'en', 'multilingual'], license: 'MIT', description: 'Best quality multilingual transcription; needs a GPU with 4 GB VRAM.', descriptionAr: 'أفضل جودة تفريغ متعدد اللغات؛ يحتاج معالجاً رسومياً بذاكرة 4 جيجابايت.', host: 'huggingface.co', recommended: 'gpu' },
  { id: 'piper/ar-kareem-medium', name: 'Piper voice: Arabic (Kareem)', capability: 'tts', providerId: 'piper', version: 'medium', kind: 'local', files: [
    { url: hf('rhasspy/piper-voices', 'ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx'), path: 'ar_JO-kareem-medium.onnx', sha256: null, sizeBytes: 63200000 },
    { url: hf('rhasspy/piper-voices', 'ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json'), path: 'ar_JO-kareem-medium.onnx.json', sha256: null, sizeBytes: 5000 },
  ], sizeBytes: 63_205_000, vramMb: null, ramMb: 500, requiresGpu: false, languages: ['ar'], license: 'MIT', description: 'Natural Arabic neural voice (offline).', descriptionAr: 'صوت عربي عصبي طبيعي (بدون إنترنت).', host: 'huggingface.co', recommended: 'always' },
  { id: 'piper/en-lessac-medium', name: 'Piper voice: English (Lessac)', capability: 'tts', providerId: 'piper', version: 'medium', kind: 'local', files: [
    { url: hf('rhasspy/piper-voices', 'en/en_US/lessac/medium/en_US-lessac-medium.onnx'), path: 'en_US-lessac-medium.onnx', sha256: null, sizeBytes: 63200000 },
    { url: hf('rhasspy/piper-voices', 'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'), path: 'en_US-lessac-medium.onnx.json', sha256: null, sizeBytes: 5000 },
  ], sizeBytes: 63_205_000, vramMb: null, ramMb: 500, requiresGpu: false, languages: ['en'], license: 'MIT', description: 'Natural English neural voice (offline).', descriptionAr: 'صوت إنجليزي عصبي طبيعي (بدون إنترنت).', host: 'huggingface.co', recommended: 'always' },
  { id: 'llm/qwen2.5-3b-instruct-q4', name: 'Qwen2.5 3B Instruct (GGUF Q4_K_M)', capability: 'llm.text', providerId: 'llama-cpp', version: 'Q4_K_M', kind: 'local', files: [{ url: hf('Qwen/Qwen2.5-3B-Instruct-GGUF', 'qwen2.5-3b-instruct-q4_k_m.gguf'), path: 'qwen2.5-3b-instruct-q4_k_m.gguf', sha256: null, sizeBytes: 2100000000 }], sizeBytes: 2_100_000_000, vramMb: 3000, ramMb: 4000, requiresGpu: false, languages: ['ar', 'en', 'multilingual'], license: 'Apache-2.0', description: 'Local language model for the assistant and script writing (Arabic-capable).', descriptionAr: 'نموذج لغوي محلي للمساعد وكتابة السكربتات (يدعم العربية).', host: 'huggingface.co', recommended: 'always' },
  { id: 'llm/qwen2.5-7b-instruct-q4', name: 'Qwen2.5 7B Instruct (GGUF Q4_K_M)', capability: 'llm.text', providerId: 'llama-cpp', version: 'Q4_K_M', kind: 'local', files: [{ url: hf('Qwen/Qwen2.5-7B-Instruct-GGUF', 'qwen2.5-7b-instruct-q4_k_m.gguf'), path: 'qwen2.5-7b-instruct-q4_k_m.gguf', sha256: null, sizeBytes: 4700000000 }], sizeBytes: 4_700_000_000, vramMb: 6000, ramMb: 8000, requiresGpu: false, languages: ['ar', 'en', 'multilingual'], license: 'Apache-2.0', description: 'Stronger local language model; 8 GB RAM or 6 GB VRAM recommended.', descriptionAr: 'نموذج لغوي محلي أقوى؛ يُنصح بـ 8 جيجابايت ذاكرة أو 6 جيجابايت ذاكرة رسومية.', host: 'huggingface.co', recommended: 'gpu' },
  { id: 'realesrgan/x4plus', name: 'Real-ESRGAN x4plus', capability: 'upscale.ai', providerId: 'realesrgan', version: 'v0.1.0', kind: 'local', files: [{ url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth', path: 'RealESRGAN_x4plus.pth', sha256: null, sizeBytes: 67040989 }], sizeBytes: 67040989, vramMb: 2000, ramMb: 2000, requiresGpu: true, languages: [], license: 'BSD-3-Clause', description: 'AI upscaling 2x/4x (Vulkan GPU required).', descriptionAr: 'تكبير بالذكاء الاصطناعي 2x/4x (يتطلب معالجاً رسومياً بدعم Vulkan).', host: 'github.com', recommended: 'gpu' },
  { id: 'sd/sdxl-turbo', name: 'SDXL Turbo (images)', capability: 'gen.image', providerId: 'diffusers', version: '1.0', kind: 'local', files: [{ url: 'https://huggingface.co/stabilityai/sdxl-turbo', path: 'sdxl-turbo', sha256: null, sizeBytes: 7000000000 }], sizeBytes: 7_000_000_000, vramMb: 8000, ramMb: 16000, requiresGpu: true, languages: [], license: 'SAI NC Community', description: 'Fast photorealistic image generation for storyboards and character references (8 GB VRAM).', descriptionAr: 'توليد صور واقعية سريع للقصص المصورة ومراجع الشخصيات (8 جيجابايت ذاكرة رسومية).', host: 'huggingface.co', recommended: 'gpu' },
  { id: 'wan/2.1-t2v-1.3b', name: 'Wan 2.1 T2V 1.3B (video)', capability: 'gen.video', providerId: 'diffusers', version: '2.1', kind: 'local', files: [{ url: 'https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers', path: 'wan2.1-t2v-1.3b', sha256: null, sizeBytes: 12000000000 }], sizeBytes: 12_000_000_000, vramMb: 12000, ramMb: 32000, requiresGpu: true, languages: [], license: 'Apache-2.0', description: 'Local text-to-video generation (12 GB VRAM, slow).', descriptionAr: 'توليد فيديو من النص محلياً (12 جيجابايت ذاكرة رسومية، بطيء).', host: 'huggingface.co', recommended: 'gpu' },
];

export function modelSpec(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}
