/**
 * ai-agent-engine/local-detector.js
 * 端末内（ブラウザ内）で動く軽量物体検知。TensorFlow.js + COCO-SSD。
 * 仮説Aの実装：まずローカルで即時に検知して反応し、LLM（Gemini）へ
 * 画像を送るのは「新しい物体が現れたとき」などのトリガー時のみに絞る。
 * ライブラリは初回利用時に CDN から遅延ロードする（初期表示を重くしない）。
 */
const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
const COCOSSD_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';

/** COCOラベル（英語）→ 表示用日本語。無いものは英語のまま表示する。 */
export const LABEL_JA = {
  person: '人',
  bicycle: '自転車',
  car: '車',
  dog: '犬',
  cat: '猫',
  chair: '椅子',
  couch: 'ソファ',
  'potted plant': '観葉植物',
  bed: 'ベッド',
  'dining table': 'テーブル',
  tv: 'テレビ',
  laptop: 'ノートPC',
  mouse: 'マウス',
  keyboard: 'キーボード',
  'cell phone': 'スマホ',
  book: '本',
  bottle: 'ボトル',
  cup: 'カップ',
  bowl: 'ボウル',
  clock: '時計',
  vase: '花瓶',
  backpack: 'リュック',
  umbrella: '傘',
  handbag: 'バッグ',
  remote: 'リモコン',
  microwave: '電子レンジ',
  refrigerator: '冷蔵庫',
  sink: 'シンク',
  toothbrush: '歯ブラシ',
  scissors: 'はさみ',
};

export function labelJa(cls) {
  return LABEL_JA[cls] || cls;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`ライブラリの読み込みに失敗しました: ${src}`));
    document.head.appendChild(script);
  });
}

export class LocalDetector {
  constructor() {
    this.model = null;
    this.loadPromise = null;
  }

  /** モデルを遅延ロードする（2回目以降は即座に返る）。 */
  async load() {
    if (this.model) return this.model;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        if (!window.tf) await loadScript(TFJS_URL);
        if (!window.cocoSsd) await loadScript(COCOSSD_URL);
        // lite_mobilenet_v2 は軽量版。端末内での速度を優先する（仮説Aの趣旨）
        this.model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        return this.model;
      })();
    }
    return this.loadPromise;
  }

  get isLoaded() {
    return this.model !== null;
  }

  /**
   * video要素に対して推論し、検出結果と推論時間(ms)を返す。
   * @returns {{ predictions: Array<{class: string, score: number, bbox: number[]}>, latencyMs: number }}
   */
  async detect(video) {
    const model = await this.load();
    const started = performance.now();
    const predictions = await model.detect(video);
    return { predictions, latencyMs: performance.now() - started };
  }
}
