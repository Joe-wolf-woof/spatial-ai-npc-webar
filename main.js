/**
 * main.js
 * 配線：3D表示 → 会話（テキスト）／視覚連動（カメラ→Gemini）→ 読み上げ＋モーション。
 * Phase 3（ハイブリッド化・仮説A）：
 *  - カメラ映像を端末内の COCO-SSD で常時検知し、結果と推論msを即表示する
 *  - 新しい物体クラスが現れたら、そのときだけ Gemini に画像を送って声かけさせる
 *  - ローカル検知ms と Gemini応答ms を並べて表示し、before/after を比較できるようにする
 */
import { createScene, tryLoadAvatarModel } from './ar-viewer/scene.js';
import { createPlaceholderAvatar } from './ar-viewer/avatar.js';
import { CameraManager } from './ar-viewer/camera.js';
import {
  generateReply,
  generateVisionReply,
  getApiKey,
  setApiKey,
} from './ai-agent-engine/gemini-client.js';
import { LocalDetector, labelJa } from './ai-agent-engine/local-detector.js';
import { OpenVocabDetector } from './ai-agent-engine/open-vocab-detector.js';
import { speak } from './ai-agent-engine/speech.js';
import { MotionController } from './motion-controller/motion-controller.js';

const container = document.getElementById('canvas-container');
const replyBox = document.getElementById('reply-box');
const userInput = document.getElementById('user-input');
const talkButton = document.getElementById('talk-button');
const statusLine = document.getElementById('status-line');
const emotionBadge = document.getElementById('emotion-badge');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyButton = document.getElementById('save-key-button');
const cameraVideo = document.getElementById('camera-video');
const cameraToggleButton = document.getElementById('camera-toggle-button');
const visionButton = document.getElementById('vision-button');
const autoVisionCheckbox = document.getElementById('auto-vision');
const detectStatus = document.getElementById('detect-status');
const detectList = document.getElementById('detect-list');
const latencyCompare = document.getElementById('latency-compare');
const ovToggle = document.getElementById('ov-toggle');
const ovStatus = document.getElementById('ov-status');
const ovList = document.getElementById('ov-list');
const ovRunButton = document.getElementById('ov-run-button');

const { renderer, scene, camera } = createScene(container);

const placeholder = createPlaceholderAvatar();
scene.add(placeholder.group);
const motion = new MotionController(placeholder);

tryLoadAvatarModel(scene).then((model) => {
  if (!model) return;
  scene.remove(placeholder.group);
  statusLine.textContent = 'GLTFモデル（assets/models/avatar.glb）を読み込みました。';
});

function loop(now) {
  motion.update(now);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- 遅延の比較表示（3層カスケードの検証データ） ---
let lastLocalMs = null;
let lastOvMs = null;
let lastGeminiMs = null;
function fmtMs(v) {
  return v !== null ? `${Math.round(v)} ms` : '-';
}
function updateLatencyCompare() {
  latencyCompare.textContent =
    `COCO-SSD: ${fmtMs(lastLocalMs)} ／ OWL-ViT: ${fmtMs(lastOvMs)} ／ Gemini: ${fmtMs(lastGeminiMs)}（ベースライン実測 11,442 ms）`;
}

function showReply(reply, latencyMs) {
  replyBox.textContent = reply.text;
  emotionBadge.textContent = `emotion: ${reply.emotion}`;
  motion.play(reply.emotion);
  speak(reply.text);
  if (typeof latencyMs === 'number') {
    lastGeminiMs = latencyMs;
    updateLatencyCompare();
  }
  const latency = typeof latencyMs === 'number' ? `（応答 ${Math.round(latencyMs)} ms）` : '';
  statusLine.textContent = reply.source === 'mock'
    ? `モック応答で動作しています（APIキー未設定）${latency}`
    : `${reply.source} で応答しました${latency}`;
}

apiKeyInput.value = getApiKey();
saveKeyButton.addEventListener('click', () => {
  setApiKey(apiKeyInput.value.trim());
  statusLine.textContent = 'APIキーを保存しました。';
});

talkButton.addEventListener('click', async () => {
  const text = userInput.value.trim() || 'こんにちは';
  talkButton.disabled = true;
  statusLine.textContent = '考え中…';
  const started = performance.now();
  try {
    const reply = await generateReply(text);
    showReply(reply, performance.now() - started);
  } catch (err) {
    statusLine.textContent = `エラー: ${err.message}`;
  } finally {
    talkButton.disabled = false;
  }
});
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') talkButton.click();
});

// --- カメラと視覚連動（Gemini） ---
const cameraManager = new CameraManager(cameraVideo);
let autoTimer = null;
let geminiBusy = false;

async function runVision(contextText = '') {
  if (geminiBusy) return;
  const frame = cameraManager.captureFrame();
  if (!frame) {
    statusLine.textContent = 'フレームを取得できませんでした（カメラ準備中）。';
    return;
  }
  geminiBusy = true;
  visionButton.disabled = true;
  statusLine.textContent = '空間を見ています…';
  const started = performance.now();
  try {
    const userText = userInput.value.trim() || contextText;
    const reply = await generateVisionReply(frame, userText);
    showReply(reply, performance.now() - started);
  } catch (err) {
    statusLine.textContent = `エラー: ${err.message}`;
  } finally {
    geminiBusy = false;
    visionButton.disabled = false;
  }
}
visionButton.addEventListener('click', () => runVision());

function startAutoVision() {
  stopAutoVision();
  autoTimer = setInterval(() => runVision(), 10000);
}
function stopAutoVision() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}
autoVisionCheckbox.addEventListener('change', () => {
  if (autoVisionCheckbox.checked) {
    startAutoVision();
    statusLine.textContent = '自動モード: 10秒ごとに空間を見ます。';
  } else {
    stopAutoVision();
  }
});

// --- ローカル検知（COCO-SSD）：常時・即時、Geminiはトリガー時のみ ---
const detector = new LocalDetector();
const seenClasses = new Set();
let detectTimeoutId = null;
let detectRunning = false;
let detecting = false;
let lastAutoTriggerAt = 0;
const AUTO_TRIGGER_COOLDOWN_MS = 20000;
const SCORE_THRESHOLD = 0.55;

function renderDetections(predictions, latencyMs) {
  lastLocalMs = latencyMs;
  updateLatencyCompare();
  detectStatus.textContent = `検知中（推論 ${Math.round(latencyMs)} ms）`;
  detectList.innerHTML = '';
  if (predictions.length === 0) {
    const li = document.createElement('li');
    li.textContent = '検出なし';
    detectList.appendChild(li);
    return;
  }
  for (const p of predictions) {
    const li = document.createElement('li');
    li.textContent = `${labelJa(p.class)} ${(p.score * 100).toFixed(0)}%`;
    detectList.appendChild(li);
  }
}

async function detectionTick() {
  if (detecting || !cameraManager.isRunning || document.hidden) return;
  detecting = true;
  try {
    const { predictions, latencyMs } = await detector.detect(cameraVideo);
    const reliable = predictions.filter((p) => p.score >= SCORE_THRESHOLD);
    renderDetections(reliable, latencyMs);

    const newClasses = reliable.filter((p) => !seenClasses.has(p.class));
    newClasses.forEach((p) => seenClasses.add(p.class));
    if (newClasses.length > 0) {
      // ローカル側の即時反応（LLMを待たない）
      motion.play('pointing');
      const names = newClasses.map((p) => labelJa(p.class)).join('、');
      detectStatus.textContent = `新しい物体を検知: ${names}（推論 ${Math.round(latencyMs)} ms）`;
      // Geminiへはトリガー時のみ（クールダウン付き）
      const now = Date.now();
      if (!geminiBusy && now - lastAutoTriggerAt >= AUTO_TRIGGER_COOLDOWN_MS) {
        lastAutoTriggerAt = now;
        runVision(`（ローカル検知で「${names}」が新しく視界に入りました）`);
      }
    }
  } catch (err) {
    detectStatus.textContent = `ローカル検知エラー: ${err.message}`;
    stopDetection();
  } finally {
    detecting = false;
  }
}

/**
 * 発熱対策：推論が重くなってきたら間隔を自動で広げる（適応間隔）。
 * 端末のサーマルスロットリングを「推論msの悪化」で間接的に検知する考え方。
 */
function nextDetectDelay() {
  if (lastLocalMs === null) return 1500;
  if (lastLocalMs > 350) return 5000;
  if (lastLocalMs > 250) return 3000;
  return 1500;
}

async function detectionLoop() {
  if (!detectRunning) return;
  await detectionTick();
  if (!detectRunning) return;
  detectTimeoutId = setTimeout(detectionLoop, nextDetectDelay());
}

async function startDetection() {
  detectStatus.textContent = '検知モデルを読み込み中…（初回のみ数秒かかります）';
  try {
    await detector.load();
  } catch (err) {
    detectStatus.textContent = `検知モデルを読み込めませんでした: ${err.message}`;
    return;
  }
  seenClasses.clear();
  detectStatus.textContent = '検知中…';
  stopDetection();
  detectRunning = true;
  detectionLoop();
}
function stopDetection() {
  detectRunning = false;
  if (detectTimeoutId) clearTimeout(detectTimeoutId);
  detectTimeoutId = null;
}

// --- 中間層：柔軟検知（OWL-ViT）— 自由ラベル、数秒間隔 ---
const ovDetector = new OpenVocabDetector();
let ovTimer = null;
let ovDetecting = false;

function renderOvResults(results, latencyMs, best) {
  lastOvMs = latencyMs;
  updateLatencyCompare();
  const backend = ovDetector.backend ? `・${ovDetector.backend}` : '';
  ovStatus.textContent = `柔軟検知中（推論 ${Math.round(latencyMs)} ms${backend}）`;
  ovList.innerHTML = '';
  if (results.length === 0) {
    const li = document.createElement('li');
    li.textContent = '該当なし';
    ovList.appendChild(li);
    if (best) {
      const hint = document.createElement('li');
      hint.textContent = `（参考）${best.ja} ${(best.score * 100).toFixed(0)}%`;
      ovList.appendChild(hint);
    }
    return;
  }
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = `${r.ja} ${(r.score * 100).toFixed(0)}%`;
    ovList.appendChild(li);
  }
}

async function ovTick() {
  if (ovDetecting || !cameraManager.isRunning || document.hidden) return;
  ovDetecting = true;
  try {
    const { results, best, latencyMs } = await ovDetector.detect(cameraVideo);
    renderOvResults(results, latencyMs, best);
    const newOnes = results.filter((r) => !seenClasses.has(`ov:${r.en}`));
    newOnes.forEach((r) => seenClasses.add(`ov:${r.en}`));
    if (newOnes.length > 0) {
      motion.play('pointing');
      const names = newOnes.map((r) => r.ja).join('、');
      const now = Date.now();
      if (!geminiBusy && now - lastAutoTriggerAt >= AUTO_TRIGGER_COOLDOWN_MS) {
        lastAutoTriggerAt = now;
        runVision(`（柔軟検知で「${names}」が新しく視界に入りました）`);
      }
    }
  } catch (err) {
    ovStatus.textContent = `柔軟検知エラー: ${err.message}`;
    stopOv();
    ovToggle.checked = false;
  } finally {
    ovDetecting = false;
  }
}

function startOvLoop() {
  stopOv();
  // 発熱対策：自動実行は15秒間隔に広げる（手動ボタンでも実行できる）
  ovTimer = setInterval(ovTick, 15000);
  ovTick();
}
function stopOv() {
  if (ovTimer) clearInterval(ovTimer);
  ovTimer = null;
}

ovToggle.addEventListener('change', async () => {
  if (!ovToggle.checked) {
    stopOv();
    ovStatus.textContent = '柔軟検知はOFFです';
    return;
  }
  ovToggle.disabled = true;
  try {
    await ovDetector.load((msg) => { ovStatus.textContent = msg; });
    ovStatus.textContent = '柔軟検知を開始します…';
    startOvLoop();
  } catch (err) {
    ovStatus.textContent = `柔軟検知を読み込めませんでした: ${err.message}`;
    ovToggle.checked = false;
  } finally {
    ovToggle.disabled = false;
  }
});

ovRunButton.addEventListener('click', async () => {
  if (!cameraManager.isRunning) return;
  ovRunButton.disabled = true;
  try {
    if (!ovDetector.isLoaded) {
      ovToggle.checked = true;
      await ovDetector.load((msg) => { ovStatus.textContent = msg; });
    }
    await ovTick();
  } catch (err) {
    ovStatus.textContent = `柔軟検知エラー: ${err.message}`;
  } finally {
    ovRunButton.disabled = false;
  }
});

cameraToggleButton.addEventListener('click', async () => {
  if (cameraManager.isRunning) {
    cameraManager.stop();
    stopDetection();
    stopOv();
    ovToggle.checked = false;
    ovToggle.disabled = true;
    ovRunButton.disabled = true;
    ovStatus.textContent = '柔軟検知はOFFです';
    ovList.innerHTML = '';
    document.body.classList.remove('camera-on');
    cameraToggleButton.textContent = 'カメラを開始';
    visionButton.disabled = true;
    autoVisionCheckbox.disabled = true;
    autoVisionCheckbox.checked = false;
    stopAutoVision();
    detectStatus.textContent = 'カメラ停止中';
    detectList.innerHTML = '';
    statusLine.textContent = 'カメラを停止しました。';
    return;
  }
  try {
    await cameraManager.start();
    document.body.classList.add('camera-on');
    cameraToggleButton.textContent = 'カメラを停止';
    visionButton.disabled = false;
    autoVisionCheckbox.disabled = false;
    ovToggle.disabled = false;
    ovRunButton.disabled = false;
    statusLine.textContent = 'カメラを開始しました。ローカル検知が常時動き、新しい物体のときだけGeminiに聞きます。';
    startDetection();
  } catch (err) {
    statusLine.textContent = `カメラを開始できませんでした: ${err.message}（localhost / HTTPS が必要です）`;
  }
});

updateLatencyCompare();
