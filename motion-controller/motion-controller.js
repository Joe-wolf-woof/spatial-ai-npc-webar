/**
 * motion-controller/motion-controller.js
 * 感情タグ（emotion）→ アバターの動きの対応付け。
 *
 * Phase 3-B：3種類のアバターに対応する。
 *  1. プレースホルダー（parts.armR がある場合）：従来のパーツ別イージング
 *  2. GLB＋アニメーションクリップ：名前から感情に合うクリップを選びクロスフェード
 *  3. GLB（クリップなし）：モデル全体のプロシージャルモーション
 *     ＋名前付きパーツ（Head / Tail）があればそちらも動かす
 *
 * 感情タグ: idle / happy / thinking / pointing
 */
const DURATION_MS = 1200;

const CLIP_KEYWORDS = {
  idle: ['idle', 'stand', 'breath', 'wait'],
  happy: ['happy', 'joy', 'jump', 'celebrat', 'excit', 'dance', 'play'],
  thinking: ['think', 'confus', 'question'],
  pointing: ['point', 'show', 'present', 'wave', 'reach'],
};

export class MotionController {
  constructor(avatar) {
    this.current = { emotion: 'idle', startedAt: performance.now() };
    this.lastUpdate = performance.now();
    this.activeAction = null;
    this.setAvatar(avatar);
  }

  /** 表示中アバターの差し替え（GLB読込後に main.js から呼ぶ） */
  setAvatar(avatar) {
    this.avatar = avatar;
    this.activeAction = null;
    const idle = this.findClip('idle');
    if (idle) {
      idle.play();
      this.activeAction = idle;
    }
  }

  findClip(emotion) {
    const actions = this.avatar?.actions;
    if (!actions || Object.keys(actions).length === 0) return null;
    const keys = CLIP_KEYWORDS[emotion] || [];
    for (const name of Object.keys(actions)) {
      const n = name.toLowerCase();
      if (keys.some((k) => n.includes(k))) return actions[name];
    }
    return null;
  }

  play(emotion) {
    this.current = { emotion, startedAt: performance.now() };
    if (this.avatar?.mixer) {
      const next = this.findClip(emotion) || this.findClip('idle');
      if (next && next !== this.activeAction) {
        next.reset().fadeIn(0.25).play();
        if (this.activeAction) this.activeAction.fadeOut(0.25);
        this.activeAction = next;
      }
    }
  }

  /** レンダーループから毎フレーム呼ぶ */
  update(now) {
    if (!this.avatar) return;
    const delta = Math.min((now - this.lastUpdate) / 1000, 0.1);
    this.lastUpdate = now;
    if (this.avatar.mixer) this.avatar.mixer.update(delta);

    if (this.avatar.parts?.armR) {
      this.updatePlaceholder(now);
    } else if (this.avatar.isGlb) {
      this.updateGlb(now);
    }
  }

  updatePlaceholder(now) {
    const { group, parts } = this.avatar;
    const t = Math.min((now - this.current.startedAt) / DURATION_MS, 1);
    const wave = Math.sin(t * Math.PI); // 0→1→0

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

  updateGlb(now) {
    const { group, parts } = this.avatar;
    const emotion = this.current.emotion;
    // 感情に合うクリップが再生中なら、モデル全体の動きはクリップに任せる
    const clipDriven = !!this.findClip(emotion);

    const t = Math.min((now - this.current.startedAt) / DURATION_MS, 1);
    const wave = Math.sin(t * Math.PI);

    group.position.y = 0;
    group.rotation.set(0, 0, 0);
    if (parts.head) parts.head.rotation.set(0, 0, 0);

    if (!clipDriven) {
      switch (emotion) {
        case 'happy':
          group.position.y = Math.abs(Math.sin(t * Math.PI * 2)) * 0.12;
          if (parts.head) parts.head.rotation.x = -0.12 * wave; // 少し見上げる
          break;
        case 'thinking':
          group.rotation.z = 0.05 * wave;
          if (parts.head) parts.head.rotation.z = 0.28 * wave; // 首をかしげる
          break;
        case 'pointing':
          group.rotation.y = -0.45 * wave; // そちらを向く
          group.rotation.x = 0.06 * wave;
          if (parts.head) parts.head.rotation.y = -0.3 * wave;
          break;
        case 'idle':
        default:
          group.position.y = Math.sin(now / 900) * 0.012;
          break;
      }
    }

    // 尻尾のあるモデル（暫定オオカミ等）は常時しっぽを振る。クリップ再生中は触らない
    if (!this.avatar.mixer && parts.tail) {
      if (emotion === 'happy') {
        parts.tail.rotation.y = Math.sin(now / 90) * 0.5;
      } else {
        parts.tail.rotation.y = Math.sin(now / 700) * 0.18;
      }
    }
  }
}
