/**
 * motion-controller/motion-controller.js
 * 感情タグ（emotion）→ アバターの動きの対応付け。
 * Phase 1 は単純なイージングアニメーションのみ。
 * Phase 3 でGLTFアニメーションクリップ／BlendShapeへ差し替える。
 *
 * 感情タグ: idle / happy / thinking / pointing
 */
const DURATION_MS = 1200;

export class MotionController {
  constructor(avatar) {
    this.avatar = avatar; // { group, parts }
    this.current = { emotion: 'idle', startedAt: performance.now() };
  }

  play(emotion) {
    this.current = { emotion, startedAt: performance.now() };
  }

  /** レンダーループから毎フレーム呼ぶ */
  update(now) {
    if (!this.avatar) return;
    const { group, parts } = this.avatar;
    const t = Math.min((now - this.current.startedAt) / DURATION_MS, 1);
    const wave = Math.sin(t * Math.PI); // 0→1→0

    // 初期姿勢へ戻す
    group.position.y = 0;
    group.rotation.z = 0;
    parts.head.rotation.z = 0;
    parts.armR.rotation.z = -0.5;

    switch (this.current.emotion) {
      case 'happy':
        group.position.y = Math.abs(Math.sin(t * Math.PI * 2)) * 0.12;
        break;
      case 'thinking':
        parts.head.rotation.z = 0.22 * wave;
        group.rotation.z = 0.05 * wave;
        break;
      case 'pointing':
        parts.armR.rotation.z = -0.5 - 1.15 * wave; // 右腕を上げる
        break;
      case 'idle':
      default:
        group.position.y = Math.sin(now / 900) * 0.015; // 呼吸のような微動
        break;
    }
  }
}
