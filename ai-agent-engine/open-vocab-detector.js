/**
 * ai-agent-engine/open-vocab-detector.js
 * 中間層：オープンボキャブラリ検出（OWL-ViT / Transformers.js）。
 * COCO-SSD の固定80クラスでは拾えない対象（吊り下げ植物、洗濯物など）を、
 * テキストで指定した自由ラベルで検出する。3層カスケードの中間に位置づける：
 *   第1層 COCO-SSD（約150ms・常時） → 第2層 本モジュール（数秒・柔軟） → 第3層 Gemini（10秒〜・深い理解）
 * ライブラリとモデルは初回利用時に遅延ロードする（モデル約155MB、ブラウザにキャッシュされる）。
 * クエリは英語ラベルで指定し、表示用に日本語へ対応付ける。
 */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2';
const MODEL_ID = 'Xenova/owlvit-base-patch32';

/** 部屋向けプリセットラベル（英語クエリ → 日本語表示）。 */
export const PRESET_LABELS = [
  { en: 'a potted plant', ja: '観葉植物' },
  { en: 'a hanging plant', ja: '吊り下げ植物' },
  { en: 'laundry hanging to dry', ja: '洗濯物' },
  { en: 'a coffee cup', ja: 'コーヒーカップ' },
  { en: 'a book', ja: '本' },
  { en: 'a laptop computer', ja: 'ノートPC' },
  { en: 'a person', ja: '人' },
  { en: 'a chair', ja: '椅子' },
  { en: 'a bed', ja: 'ベッド' },
  { en: 'a cat', ja: '猫' },
  { en: 'a dog', ja: '犬' },
];

const SCORE_THRESHOLD = 0.15;
const FRAME_MAX_WIDTH = 640;

export class OpenVocabDetector {
  constructor() {
    this.detector = null;
    this.loadPromise = null;
    this.frameCanvas = document.createElement('canvas');
  }

  /** ライブラリ＋モデルを遅延ロードする。onProgress に進捗テキストを渡す。 */
  async load(onProgress) {
    if (this.detector) return this.detector;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        if (onProgress) onProgress('Transformers.js を読み込み中…');
        const { pipeline } = await import(/* @vite-ignore */ TRANSFORMERS_URL);
        if (onProgress) onProgress('OWL-ViT モデルをダウンロード中…（初回のみ約155MB）');
        this.detector = await pipeline('zero-shot-object-detection', MODEL_ID, {
          dtype: 'q8',
        });
        if (onProgress) onProgress('OWL-ViT 準備完了');
        return this.detector;
      })();
    }
    return this.loadPromise;
  }

  get isLoaded() {
    return this.detector !== null;
  }

  /**
   * video の現在フレームをプリセットラベルで検出する。
   * @returns {{ results: Array<{en: string, ja: string, score: number}>, latencyMs: number }}
   *          results はラベルごとの最高スコアのみ、スコア降順。
   */
  async detect(video) {
    const detector = await this.load();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return { results: [], latencyMs: 0 };
    const scale = Math.min(1, FRAME_MAX_WIDTH / vw);
    this.frameCanvas.width = Math.round(vw * scale);
    this.frameCanvas.height = Math.round(vh * scale);
    const ctx = this.frameCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, this.frameCanvas.width, this.frameCanvas.height);

    const labels = PRESET_LABELS.map((l) => l.en);
    const started = performance.now();
    const output = await detector(this.frameCanvas, labels, { threshold: 0.05 });
    const latencyMs = performance.now() - started;

    const bestByLabel = new Map();
    for (const item of output) {
      if (item.score < SCORE_THRESHOLD) continue;
      const prev = bestByLabel.get(item.label);
      if (!prev || item.score > prev.score) bestByLabel.set(item.label, item);
    }
    const results = [...bestByLabel.values()]
      .map((item) => {
        const preset = PRESET_LABELS.find((l) => l.en === item.label);
        return { en: item.label, ja: preset ? preset.ja : item.label, score: item.score };
      })
      .sort((a, b) => b.score - a.score);
    return { results, latencyMs };
  }
}
