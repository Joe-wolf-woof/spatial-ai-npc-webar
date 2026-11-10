/**
 * ai-agent-engine/gemini-client.js
 * 返答生成の窓口。{ text, emotion } のJSONを返す契約で統一する。
 * - Gemini API キーがあれば実APIを呼ぶ
 * - 無ければモック応答（動作確認・デモ用）
 * emotion は motion-controller が解釈する感情タグ（idle / happy / thinking / pointing など）。
 *
 * モデルについて（2026年時点の注意）:
 * 新規発行キーでは gemini-2.x 系が 404（new users 不可）になるため、
 * 3.x 系から順に試し、成功したモデルを localStorage に覚えるフォールバック方式にする。
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_CANDIDATES = [
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];
const MODEL_STORAGE_KEY = 'gemini_working_model';

const SYSTEM_PROMPT = [
  'あなたはWebAR空間に住むアシスタントエージェントです。',
  'ユーザーの発言に対して、日本語で1〜2文の短い返答をしてください。',
  '必ず次のJSON形式だけで答えてください: {"text": "返答文", "emotion": "happy|thinking|pointing|idle のいずれか"}',
].join('\n');

const VISION_PROMPT = [
  '添付の画像は、ユーザーのいる空間のカメラ映像です。',
  '画像に写っている物体や状況（例：机の上にコーヒーカップがある、ユーザーがPC作業をしている等）を把握してください。',
  'その上で、空間にいるエージェントとして、その状況に合った自然な声かけを日本語で1〜2文で返してください。',
  '画像から読み取れないことは断定しないでください。',
  '必ず次のJSON形式だけで答えてください: {"text": "返答文", "emotion": "happy|thinking|pointing|idle のいずれか"}',
].join('\n');

const MOCK_REPLIES = [
  { text: 'こんにちは。ぼくは空間エージェントの試作機です。カメラ越しの世界を理解できるよう、練習中です。', emotion: 'happy' },
  { text: 'うーん、それは面白い問いですね。仮説を立てて考えてみます。', emotion: 'thinking' },
  { text: 'あちらをご覧ください。……という具合に、空間を指さす案内もできるようになります。', emotion: 'pointing' },
  { text: '作業お疲れさまです。少し休憩しませんか。', emotion: 'idle' },
];
let mockIndex = 0;

export function getApiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

export function setApiKey(key) {
  localStorage.setItem('gemini_api_key', key);
  localStorage.removeItem(MODEL_STORAGE_KEY); // キーが変われば使えるモデルも変わり得る
}

function orderedModels() {
  const saved = localStorage.getItem(MODEL_STORAGE_KEY);
  if (saved && MODEL_CANDIDATES.includes(saved)) {
    return [saved, ...MODEL_CANDIDATES.filter((m) => m !== saved)];
  }
  return MODEL_CANDIDATES;
}

async function callModel(model, key, parts) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const res = await fetch(`${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || '';
    } catch { /* 詳細が取れない場合はステータスのみ */ }
    const err = new Error(`Gemini API error: ${res.status}${detail ? ` — ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = JSON.parse(raw);
  return { text: parsed.text, emotion: parsed.emotion || 'idle', source: `gemini (${model})` };
}

async function requestWithFallback(parts) {
  const key = getApiKey();
  let lastError = null;
  for (const model of orderedModels()) {
    try {
      const reply = await callModel(model, key, parts);
      localStorage.setItem(MODEL_STORAGE_KEY, model);
      return reply;
    } catch (err) {
      lastError = err;
      if (err.status !== 404) throw err; // 404（モデル不可）だけ次候補を試す
    }
  }
  throw lastError;
}

export async function generateReply(userText) {
  const key = getApiKey();
  if (!key) {
    const reply = MOCK_REPLIES[mockIndex % MOCK_REPLIES.length];
    mockIndex += 1;
    return { ...reply, source: 'mock' };
  }
  return requestWithFallback([
    { text: `${SYSTEM_PROMPT}\n\nユーザーの発言: ${userText}` },
  ]);
}

/**
 * Phase 2：カメラフレーム（画像）を Gemini に渡し、空間の状況に応じた返答を得る。
 * @param {{mimeType: string, data: string}} frame captureFrame() の戻り値
 * @param {string} userText 任意のユーザー発言（空なら状況への声かけのみ）
 */
export async function generateVisionReply(frame, userText = '') {
  const key = getApiKey();
  if (!key) {
    return {
      text: 'カメラの映像は受け取りましたが、APIキー未設定のためモック応答です。キー設定後に実解析します。',
      emotion: 'thinking',
      source: 'mock',
    };
  }
  const parts = [
    { text: VISION_PROMPT + (userText ? `\n\nユーザーの発言: ${userText}` : '') },
    { inline_data: { mime_type: frame.mimeType, data: frame.data } },
  ];
  return requestWithFallback(parts);
}
