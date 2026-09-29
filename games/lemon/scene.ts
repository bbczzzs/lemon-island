/**
 * Lemon Island scene: a beach island on the sea in the Rare Friends world style
 * (ink outlines, paper, the FriendSDK GAME_PALETTE, checker-dither shading),
 * drawn into a small buffer and scaled up nearest-neighbour. Friends arrive by
 * ferry at the dock, walk the boardwalk past your stalls and leave by the
 * lighthouse pier. Friends stay canonical black-and-white with a white outline.
 */
import type { BuildId, Weather } from "./economy";
import type { Island, Stall, Walker } from "./sim";
import type { SpriteRows } from "./friends";

export type Phase = "morning" | "open" | "evening";

export interface SceneState {
  phase: Phase;
  dayT: number; // 0..1 through the open day
  weather: Weather;
  island: Island;
  upgrades: Set<BuildId>;
  price: number;
}

const K = "#000000", WHITE = "#ffffff";
const MEADOW = "#B9D984", POND = "#7DB4DB", SUN = "#F2CE68", CORAL = "#ED927E", LILAC = "#B3A0D8", SIGNAL = "#CCFF00";
const SEA_DEEP = "#4f86b0", SAND = "#f7dd8f";

const GLYPHS: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
  "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001111", ".": "000000000000010", "+": "000010111010000",
  "-": "000000111000000", " ": "000000000000000", "!": "010010010000010", "$": "011110010011110", "?": "111001010000010",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111",
  F: "111100110100100", G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010",
  K: "101101110101101", L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101", Y: "101101010010010",
  Z: "111001010100111",
};

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0")).join("");
};

/** 16x16 sprite on an 18x18 canvas with a 1px outline (Friends: black on white). */
export function spriteCanvas(rows: SpriteRows, fill = K, outline = WHITE): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 18; c.height = 18;
  const g = c.getContext("2d")!;
  const on = (x: number, y: number) => y >= 0 && y < 16 && x >= 0 && x < 16 && rows[y]?.[x] === "#";
  g.fillStyle = outline;
  for (let y = -1; y <= 16; y++) for (let x = -1; x <= 16; x++) {
    if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x + 1, y + 1, 1, 1);
  }
  g.fillStyle = fill;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (on(x, y)) g.fillRect(x + 1, y + 1, 1, 1);
  return c;
}

interface Coin { x: number; y: number; vy: number; t: number; }
interface Drop { x: number; y: number; s: number; }
interface Confetti { x: number; y: number; vx: number; vy: number; c: string; t: number; }
interface Spark { x: number; y: number; vx: number; vy: number; c: string; t: number; life: number; rocket?: boolean; ty?: number; }

export class LemonScene {
  private ctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement;
  private b: CanvasRenderingContext2D;
  private W = 400;
  private H = 225;
  private scale = 3;
  private dpr = 1;
  private time = 0;
  private reduced = false;
  private sprites = new Map<string, HTMLCanvasElement[]>();
  private pilot: HTMLCanvasElement[] = [];
  private coins: Coin[] = [];
  private drops: Drop[] = [];
  private confetti: Confetti[] = [];
  private sparks: Spark[] = [];
  private showT = 0;
  private rush = new Map<Stall, { times: number[]; until: number }>();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.buf = document.createElement("canvas");
    this.b = this.buf.getContext("2d")!;
    this.resize();
  }

  setReducedMotion(on: boolean) { this.reduced = on; }
  setPilot(frames: SpriteRows[] | null) { this.pilot = frames ? frames.map(f => spriteCanvas(f)) : []; }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.scale = Math.max(2, Math.min(7, Math.round(Math.min(cssH / 168, cssW / 290))));
    this.W = Math.ceil(cssW / this.scale);
    this.H = Math.ceil(cssH / this.scale);
    this.buf.width = this.W; this.buf.height = this.H;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    const r = mulberry32(5);
    this.drops = Array.from({ length: 90 }, () => ({ x: r() * this.W, y: r() * this.H, s: 0.8 + r() * 0.6 }));
  }

  private frames(key: string, rows: SpriteRows[]): HTMLCanvasElement[] {
    let s = this.sprites.get(key);
    if (!s) { s = rows.map(r => spriteCanvas(r)); this.sprites.set(key, s); }
    return s;
  }

  // ---- geometry (buffer px) ----
  private get horizon() { return Math.round(this.H * 0.36); }
  private get walkY() { return Math.round(this.H * 0.64); } // boardwalk line (feet)
  private get pad() { return Math.max(24, Math.round(this.W * 0.1)); }
  private xAt(u: number) { return Math.round(this.pad + u * (this.W - this.pad * 2)); }

  /** A coin pops out of a stall when a cup sells. */
  sale(stall: Stall) {
    // Four cups in three seconds at one stall flashes a "RUSH!" sign.
    const r = this.rush.get(stall) ?? { times: [], until: 0 };
    r.times = r.times.filter(t => this.time - t < 3);
    r.times.push(this.time);
    if (r.times.length >= 4) { r.until = this.time + 1.8; r.times = []; }
    this.rush.set(stall, r);
    if (this.reduced) return;
    const x = this.xAt(stall.u);
    for (let i = 0; i < 3; i++) this.coins.push({ x: x + (Math.random() - 0.5) * 10, y: this.walkY - 30, vy: -26 - Math.random() * 20, t: 0 });
  }

  /** Fireworks over the sea plus a confetti burst: a goal met, a good day. */
  celebrate(bursts = 3) {
    if (this.reduced) return;
    for (let i = 0; i < bursts; i++) this.launch(i * 0.35);
    const cols = [CORAL, SUN, LILAC, SIGNAL, POND];
    for (let i = 0; i < 36; i++) this.confetti.push({ x: Math.random() * this.W, y: -Math.random() * 30, vx: (Math.random() - 0.5) * 30, vy: 25 + Math.random() * 30, c: cols[i % 5], t: 0 });
  }

  private launch(delay = 0) {
    this.sparks.push({
      x: this.W * (0.18 + Math.random() * 0.64), y: this.horizon + 4, vx: (Math.random() - 0.5) * 10, vy: -(75 + Math.random() * 25),
      c: SUN, t: -delay, life: 1, rocket: true, ty: this.horizon * (0.22 + Math.random() * 0.35),
    });
  }

  private drawFireworks(dt: number, s: SceneState) {
    if (this.reduced) { this.sparks = []; return; }
    if (s.weather === "festival" && s.phase === "evening") {
      this.showT -= dt;
      if (this.showT <= 0) { this.launch(); this.showT = 0.6 + Math.random() * 0.7; }
    }
    const g = this.b, cols = [CORAL, SUN, LILAC, SIGNAL, POND, WHITE];
    const next: Spark[] = [];
    for (const p of this.sparks) {
      p.t += dt;
      if (p.t < 0) { next.push(p); continue; }
      if (p.rocket) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        g.fillStyle = SUN; g.fillRect(Math.round(p.x), Math.round(p.y), 1, 2);
        g.fillStyle = WHITE; g.fillRect(Math.round(p.x), Math.round(p.y + 3), 1, 1);
        if (p.y > (p.ty ?? 20)) { next.push(p); continue; }
        const c1 = cols[Math.floor(Math.random() * cols.length)], c2 = cols[Math.floor(Math.random() * cols.length)];
        for (let i = 0, n = 22; i < n; i++) {
          const a = (i / n) * Math.PI * 2, sp = 26 + Math.random() * 14;
          next.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: i % 3 ? c1 : c2, t: 0, life: 1 + Math.random() * 0.4 });
        }
        continue;
      }
      p.vy += 22 * dt; p.vx *= 1 - dt * 1.4; p.vy *= 1 - dt * 1.1;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t >= p.life) continue;
      const fade = p.t / p.life;
      if (fade < 0.8 || Math.floor(p.t * 20) % 2) { g.fillStyle = p.c; g.fillRect(Math.round(p.x), Math.round(p.y), fade < 0.45 ? 2 : 1, fade < 0.45 ? 2 : 1); }
      next.push(p);
    }
    this.sparks = next;
  }

  frame(s: SceneState, dt: number) {
    this.time += dt;
    this.b.imageSmoothingEnabled = false;
    this.drawSkyAndSea(s);
    this.drawSun(s);
    this.drawHorizon(s);
    if (s.weather === "cloudy" || s.weather === "rain") this.drawClouds(s);
    if (s.upgrades.has("balloon")) this.drawBalloon();
    this.drawFireworks(dt, s);
    this.drawBeach(s);
    this.drawStallsAndCrowd(s);
    this.drawForeground(s);
    this.stepCoins(dt);
    if (s.weather === "rain") this.drawRain(dt);
    this.drawConfetti(dt, s.weather === "festival" && s.phase !== "morning");
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.buf, 0, 0, this.W * this.scale * this.dpr, this.H * this.scale * this.dpr);
  }

  // ---- primitives ----
  private disc(x: number, y: number, r: number, fill: string) {
    const g = this.b;
    g.fillStyle = fill;
    for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(Math.round(x - w), Math.round(y + dy), w * 2 + 1, 1); }
  }
  private shade(x: number, y: number, r: number, color: string, amount = 0.25) {
    const g = this.b;
    g.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      for (let dx = -w; dx <= w; dx++) {
        const lit = (dx + dy * 0.6) / r, px = Math.round(x + dx), py = Math.round(y + dy);
        if (lit > 1 - amount * 2 || (lit > 1 - amount * 3 && (px + py) % 2 === 0)) g.fillRect(px, py, 1, 1);
      }
    }
  }
  private text(str: string, x: number, y: number, color: string) {
    const g = this.b;
    g.fillStyle = color;
    let px = x;
    for (const ch of str.toUpperCase()) {
      const gl = GLYPHS[ch];
      if (gl) for (let i = 0; i < 15; i++) if (gl[i] === "1") g.fillRect(px + (i % 3), y + Math.floor(i / 3), 1, 1);
      px += 4;
    }
  }
  sign(str: string, x: number, y: number, bg = WHITE, fg = K) {
    const g = this.b;
    const w = str.length * 4 + 3, left = Math.round(x - w / 2), top = Math.round(y);
    g.fillStyle = K; g.fillRect(left, top, w, 9);
    g.fillStyle = bg; g.fillRect(left + 1, top + 1, w - 2, 7);
    this.text(str, left + 2, top + 2, fg);
  }

  // ---- sky + sea ----
  /** Flat colour bands (no dither noise): a calm sky and a calm sea. */
  private drawSkyAndSea(s: SceneState) {
    const g = this.b, W = this.W, H = this.H, hz = this.horizon;
    let top = "#9cc9e8", mid = "#c4e0f2", low = "#e6f3fb", sea = POND, deep = SEA_DEEP;
    if (s.weather === "hot") { top = "#f5d77e"; mid = "#f9e6a8"; low = "#fdf4d6"; }
    if (s.weather === "cloudy") { top = "#b5bcc4"; mid = "#ccd2d8"; low = "#e3e6ea"; sea = "#8fb2cc"; }
    if (s.weather === "rain") { top = "#7d8591"; mid = "#9aa1ab"; low = "#b8bec6"; sea = "#6f97b8"; deep = "#3f6d92"; }
    if (s.weather === "festival") { top = "#c7b8e6"; mid = "#ddd2f0"; low = "#f1ecf9"; }
    const dusk = s.phase === "evening" ? 1 : s.phase === "open" ? Math.max(0, (s.dayT - 0.72) / 0.28) : 0;
    if (dusk > 0) { top = mix(top, "#3b2f63", dusk * 0.8); mid = mix(mid, CORAL, dusk * 0.7); low = mix(low, SUN, dusk * 0.8); }
    const bands: [number, string][] = [[0, top], [0.45, mid], [0.78, low]];
    for (let i = 0; i < bands.length; i++) {
      const y0 = Math.round(hz * bands[i][0]), y1 = i + 1 < bands.length ? Math.round(hz * bands[i + 1][0]) : hz;
      g.fillStyle = bands[i][1]; g.fillRect(0, y0, W, y1 - y0);
    }
    // Sea: two flat bands with a few slow wave dashes.
    const deepY = hz + Math.round((H - hz) * 0.55);
    g.fillStyle = sea; g.fillRect(0, hz, W, deepY - hz);
    g.fillStyle = deep; g.fillRect(0, deepY, W, H - deepY);
    const t = this.reduced ? 0 : this.time;
    g.fillStyle = WHITE;
    for (let row = 0, y = hz + 4; y < H; row++, y += 6) {
      for (let k = 0; k < 6; k++) {
        const x = Math.round(((k * 61 + row * 37 + t * (4 + (row % 3))) % (W + 20)) - 10);
        g.fillRect(x, y, 5, 1);
      }
    }
    if (dusk > 0) {
      g.fillStyle = mix(sea, SUN, dusk * 0.8);
      for (let y = hz + 2; y < hz + 14; y += 2) g.fillRect(Math.round(W / 2 - 12 + (y - hz)), y, Math.max(2, 24 - (y - hz) * 2), 1);
    }
    g.fillStyle = K; g.fillRect(0, hz, W, 1);
    if (s.phase === "evening") {
      const r = mulberry32(9);
      g.fillStyle = WHITE;
      for (let i = 0; i < 24; i++) { const x = Math.floor(r() * W), y = Math.floor(r() * hz * 0.6); if (Math.sin(this.time * 2 + i) > -0.3) g.fillRect(x, y, 1, 1); }
    }
  }

  private drawSun(s: SceneState) {
    if (s.weather === "rain") return;
    const g = this.b;
    if (s.phase === "evening") {
      // Setting sun, half under the horizon.
      const x = this.W * 0.5, y = this.horizon + 2, r = 14;
      this.disc(x, y, r + 1, K); this.disc(x, y, r, SUN); this.shade(x, y, r, CORAL, 0.3);
      g.fillStyle = K; g.fillRect(0, this.horizon, this.W, 1);
      return;
    }
    const t = s.phase === "morning" ? 0.1 : s.dayT;
    const x = this.W * (0.06 + t * 0.2), y = this.horizon * (0.62 - Math.sin(t * Math.PI) * 0.3);
    const r = s.weather === "hot" ? 9 : 7;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, len = s.weather === "hot" ? 4 : 3;
      for (let k = r + 3; k < r + 3 + len; k++) { g.fillStyle = K; g.fillRect(Math.round(x + Math.cos(a) * k), Math.round(y + Math.sin(a) * k), 2, 2); }
    }
    this.disc(x, y, r + 2, WHITE); this.disc(x, y, r + 1, K); this.disc(x, y, r, SUN);
    this.shade(x, y, r, CORAL, 0.15);
  }

  private cloud(x: number, y: number, w: number, fill = WHITE) {
    const bumps: [number, number, number][] = [[-w * 0.3, 0, w * 0.22], [0, -w * 0.12, w * 0.3], [w * 0.3, 0, w * 0.2], [w * 0.1, w * 0.05, w * 0.22]];
    const g = this.b;
    for (const [dx, dy, r] of bumps) this.disc(x + dx, y + dy, Math.round(r) + 1, K);
    g.fillStyle = K; g.fillRect(Math.round(x - w * 0.5), Math.round(y), Math.round(w) + 1, Math.round(w * 0.2) + 1);
    for (const [dx, dy, r] of bumps) this.disc(x + dx, y + dy, Math.round(r), fill);
    g.fillStyle = fill; g.fillRect(Math.round(x - w * 0.5) + 1, Math.round(y), Math.round(w) - 1, Math.round(w * 0.2));
  }

  private drawClouds(s: SceneState) {
    const fill = s.weather === "rain" ? "#d7dae0" : WHITE;
    const r = mulberry32(21);
    for (let i = 0; i < 3; i++) {
      const w = 16 + r() * 12, speed = 2 + r() * 3;
      const x = ((r() * this.W + this.time * speed) % (this.W + 60)) - 30;
      this.cloud(x, 10 + r() * this.horizon * 0.35, w, fill);
    }
  }

  /** Distant islands and sailboats on the horizon. */
  private drawHorizon(s: SceneState) {
    const g = this.b, hz = this.horizon;
    for (const [fx, w, h] of [[0.12, 34, 6], [0.78, 46, 8], [0.93, 20, 4]] as const) {
      const x = Math.round(this.W * fx);
      for (let i = 0; i < w; i++) {
        const hh = Math.round(h * Math.sin((i / w) * Math.PI));
        g.fillStyle = K; g.fillRect(x - w / 2 + i, hz - hh - 1, 1, hh + 1);
        g.fillStyle = MEADOW; if (hh > 1) g.fillRect(x - w / 2 + i, hz - hh, 1, hh);
      }
    }
    if (s.weather === "rain") return;
    for (let i = 0; i < 2; i++) {
      const x = Math.round(((this.time * (3 + i * 2) + i * 170) % (this.W + 40)) - 20), y = hz + 4 + i * 5;
      g.fillStyle = K; g.fillRect(x - 5, y, 11, 3); g.fillRect(x, y - 10, 1, 10);
      g.fillStyle = WHITE; g.fillRect(x - 4, y + 1, 9, 1);
      for (let k = 0; k < 8; k++) { g.fillStyle = K; g.fillRect(x + 1, y - 9 + k, Math.ceil(k * 0.7) + 1, 1); g.fillStyle = i ? CORAL : WHITE; if (k > 1) g.fillRect(x + 1, y - 9 + k, Math.ceil(k * 0.7) - 1, 1); }
    }
    // Gulls.
    if (!this.reduced) for (let i = 0; i < 3; i++) {
      const x = Math.round(((this.time * 9 + i * 90) % (this.W + 30)) - 15), y = Math.round(hz * 0.35 + i * 7 + Math.sin(this.time * 2 + i) * 3);
      const flap = Math.sin(this.time * 8 + i) > 0 ? -1 : 0;
      g.fillStyle = K; g.fillRect(x - 3, y + flap, 3, 1); g.fillRect(x, y, 1, 1); g.fillRect(x + 1, y + flap, 3, 1);
    }
  }

  private palm(x: number, y: number, h: number, lemons = false) {
    const g = this.b;
    for (let i = 0; i < h; i++) {
      const bx = Math.round(x + Math.sin(i / h * 1.4) * 4);
      g.fillStyle = K; g.fillRect(bx - 2, y - i, 5, 1);
      g.fillStyle = i % 3 === 0 ? CORAL : SUN; g.fillRect(bx - 1, y - i, 3, 1);
    }
    const tx = Math.round(x + Math.sin(1.4) * 4), ty = y - h;
    const sway = this.reduced ? 0 : Math.sin(this.time * 1.5 + x) * 1.5;
    for (const [dx, dy] of [[-1, 0], [1, 0], [-0.7, 0.35], [0.7, 0.35], [0, -0.4]] as const) {
      for (let k = 0; k < 14; k++) {
        const px = Math.round(tx + dx * k + sway * (k / 14)), py = Math.round(ty + dy * k + (k * k) / 40);
        g.fillStyle = K; g.fillRect(px - 1, py - 1, 3, 3);
      }
      for (let k = 0; k < 13; k++) {
        const px = Math.round(tx + dx * k + sway * (k / 14)), py = Math.round(ty + dy * k + (k * k) / 40);
        g.fillStyle = MEADOW; g.fillRect(px, py, 1, 1);
      }
    }
    if (lemons) for (const [dx, dy] of [[-2, 2], [2, 3], [0, 4]]) {
      g.fillStyle = K; g.fillRect(tx + dx - 1, ty + dy - 1, 4, 4);
      g.fillStyle = SUN; g.fillRect(tx + dx, ty + dy, 2, 2);
    }
  }

  private drawBalloon() {
    const g = this.b;
    const x = Math.round(((this.time * 6) % (this.W + 60)) - 30), y = Math.round(this.horizon * 0.45 + Math.sin(this.time) * 3);
    this.disc(x, y, 12, K);
    for (let dy = -11; dy <= 11; dy++) {
      const w = Math.floor(Math.sqrt(121 - dy * dy));
      for (let dx = -w; dx <= w; dx++) { g.fillStyle = Math.floor((dx + 12) / 4) % 2 ? CORAL : WHITE; g.fillRect(x + dx, y + dy, 1, 1); }
    }
    g.fillStyle = K; g.fillRect(x - 5, y + 11, 1, 7); g.fillRect(x + 5, y + 11, 1, 7); g.fillRect(x - 5, y + 18, 11, 6);
    g.fillStyle = SUN; g.fillRect(x - 4, y + 19, 9, 4);
  }

  /** Sand, grassy dune, palms, the boardwalk, the dock with its ferry and the lighthouse. */
  private drawBeach(s: SceneState) {
    const g = this.b, W = this.W, hz = this.horizon, wy = this.walkY;
    const back = hz + Math.round((wy - hz) * 0.35); // dune line
    const shore = wy + 18; // where sand meets water
    // Grassy dune behind the boardwalk.
    for (let x = 0; x < W; x++) {
      const top = back - Math.round(5 + Math.sin(x * 0.045) * 4 + Math.sin(x * 0.13) * 2);
      g.fillStyle = K; g.fillRect(x, top - 1, 1, 1);
      g.fillStyle = MEADOW; g.fillRect(x, top, 1, wy - top);
      if ((x * 7) % 11 === 0) { g.fillStyle = K; g.fillRect(x, top + 3 + (x % 5), 2, 1); }
    }
    // Sand.
    for (let x = 0; x < W; x++) {
      const top = wy - 12 + Math.round(Math.sin(x * 0.03) * 2);
      const bottom = shore + Math.round(Math.sin(x * 0.07 + 1) * 3);
      g.fillStyle = K; g.fillRect(x, top - 1, 1, 1);
      g.fillStyle = SAND; g.fillRect(x, top, 1, bottom - top);
      if ((x * 13) % 7 === 0) { g.fillStyle = SUN; g.fillRect(x, top + 4 + (x % 9), 1, 1); }
      // Foam line.
      const foam = this.reduced ? 0 : Math.round(Math.sin(this.time * 1.2 + x * 0.08) * 1.5);
      g.fillStyle = K; g.fillRect(x, bottom + foam, 1, 1);
      g.fillStyle = WHITE; g.fillRect(x, bottom + foam + 1, 1, 2);
    }
    // Palms and the lemon grove on the dune.
    this.palm(Math.round(W * 0.06), back + 4, 26);
    this.palm(Math.round(W * 0.94), back + 6, 22);
    if (s.upgrades.has("farm")) {
      for (let i = 0; i < 3; i++) this.palm(Math.round(W * (0.36 + i * 0.1)), back + 2 - (i % 2) * 2, 18 + (i % 2) * 4, true);
      this.sign("GROVE", Math.round(W * 0.46), back - 34);
    }
    // Lighthouse on the right point.
    const lx = W - Math.max(14, Math.round(W * 0.04)), ly = back + 2;
    g.fillStyle = K; g.fillRect(lx - 6, ly - 44, 13, 45);
    for (let y = ly - 43; y < ly; y++) { g.fillStyle = Math.floor((y - ly) / 5) % 2 ? CORAL : WHITE; g.fillRect(lx - 5 + Math.floor((ly - y) / 16), y, 11 - Math.floor((ly - y) / 8), 1); }
    g.fillStyle = K; g.fillRect(lx - 5, ly - 52, 11, 9);
    const beam = s.phase === "evening" || Math.floor(this.time * 2) % 2 === 0;
    g.fillStyle = beam ? SIGNAL : SUN; g.fillRect(lx - 4, ly - 51, 9, 7);
    // Boardwalk planks.
    for (let x = 0; x < W; x++) {
      g.fillStyle = K; g.fillRect(x, wy - 3, 1, 1); g.fillRect(x, wy + 5, 1, 1);
      g.fillStyle = x % 6 === 0 ? K : "#e8c27a"; g.fillRect(x, wy - 2, 1, 7);
    }
    // Dock + ferry on the left.
    const dx = Math.max(6, this.pad - 18);
    g.fillStyle = K; g.fillRect(dx - 2, wy + 5, 3, shore - wy + 6); g.fillRect(dx + 10, wy + 5, 3, shore - wy + 6);
    const cycle = (this.time % 14) / 14;
    const fx = Math.round(cycle < 0.3 ? -40 + (cycle / 0.3) * 40 : cycle < 0.7 ? 0 : (cycle - 0.7) / 0.3 * -40) + dx - 8;
    const fy = shore + 6 + Math.round(Math.sin(this.time * 2) * 1);
    g.fillStyle = K; g.fillRect(fx - 16, fy - 4, 34, 9);
    g.fillStyle = WHITE; g.fillRect(fx - 15, fy - 3, 32, 7);
    g.fillStyle = CORAL; g.fillRect(fx - 15, fy + 1, 32, 2);
    g.fillStyle = K; g.fillRect(fx - 8, fy - 11, 16, 7);
    g.fillStyle = POND; g.fillRect(fx - 7, fy - 10, 14, 5);
    g.fillStyle = K; g.fillRect(fx + 6, fy - 16, 3, 6);
    if (s.weather === "festival") {
      for (let x = 6; x < W - 6; x += 5) {
        const y = wy - 58 + Math.round(Math.sin((x / W) * Math.PI * 3) * 3);
        g.fillStyle = K; g.fillRect(x, y, 5, 1);
        g.fillStyle = [CORAL, SUN, LILAC, SIGNAL][Math.floor(x / 5) % 4]; g.fillRect(x + 1, y + 1, 3, 2); g.fillRect(x + 2, y + 3, 1, 1);
      }
    }
  }

  private drawForeground(s: SceneState) {
    // A few beach details in front of the boardwalk.
    const g = this.b, wy = this.walkY;
    const bx = Math.round(this.W * 0.2), by = wy + 13;
    this.disc(bx, by, 4, K); this.disc(bx, by, 3, WHITE);
    g.fillStyle = CORAL; g.fillRect(bx - 3, by - 1, 7, 2); g.fillStyle = POND; g.fillRect(bx - 1, by - 3, 2, 6);
    const cx = Math.round(this.W * 0.64), cy = wy + 12;
    g.fillStyle = K; g.fillRect(cx - 3, cy, 7, 3); g.fillStyle = CORAL; g.fillRect(cx - 2, cy + 1, 5, 1);
    g.fillStyle = K; g.fillRect(cx - 4, cy - 1, 1, 1); g.fillRect(cx + 4, cy - 1, 1, 1);
    if (s.phase === "evening") {
      // Lanterns glow along the boardwalk at night.
      for (let x = 20; x < this.W - 10; x += 38) { g.fillStyle = K; g.fillRect(x, wy - 22, 1, 20); g.fillRect(x - 2, wy - 26, 5, 5); g.fillStyle = SUN; g.fillRect(x - 1, wy - 25, 3, 3); }
    }
  }

  private drawRain(dt: number) {
    const g = this.b;
    for (const d of this.drops) {
      d.y += dt * 120 * d.s; d.x -= dt * 30 * d.s;
      if (d.y > this.H) { d.y = -4; d.x = Math.random() * (this.W + 30); }
      g.fillStyle = POND;
      for (let k = 0; k < 4; k++) g.fillRect(Math.round(d.x + k * 0.25), Math.round(d.y + k), 1, 1);
    }
  }

  private drawConfetti(dt: number, on: boolean) {
    const g = this.b;
    if (on && !this.reduced && Math.random() < dt * 14) {
      const cols = [CORAL, SUN, LILAC, SIGNAL, POND];
      this.confetti.push({ x: Math.random() * this.W, y: -3, vx: (Math.random() - 0.5) * 20, vy: 20 + Math.random() * 25, c: cols[Math.floor(Math.random() * 5)], t: 0 });
    }
    this.confetti = this.confetti.filter(c => c.y < this.H);
    for (const c of this.confetti) {
      c.t += dt; c.x += (c.vx + Math.sin(c.t * 5) * 8) * dt; c.y += c.vy * dt;
      g.fillStyle = c.c; g.fillRect(Math.round(c.x), Math.round(c.y), 2, 1 + (Math.floor(c.t * 8) % 2));
    }
  }

  // ---- stalls + crowd ----
  private drawStall(st: Stall, s: SceneState) {
    const g = this.b;
    const x = this.xAt(st.u), base = this.walkY - 4;
    const w = st.kind === "bar" ? 32 : st.kind === "cart" ? 22 : 26;
    const closed = !st.operator;
    const awning = st.kind === "bar" ? LILAC : st.kind === "cart" ? POND : SUN;
    const op = st.operator === "you" ? this.pilot : st.operator ? this.frames(`f${st.operator.id}`, st.operator.frames) : [];
    g.fillStyle = K;
    g.fillRect(x - w / 2, base - 32, 2, 32); g.fillRect(x + w / 2 - 2, base - 32, 2, 32);
    if (op.length && s.phase !== "evening") g.drawImage(op[Math.floor(this.time * 4) % op.length], x - 9, base - 29);
    g.fillStyle = K; g.fillRect(x - w / 2 - 3, base - 39, w + 6, 9);
    for (let i = 0; i < w + 4; i++) {
      g.fillStyle = closed ? ((i + Math.floor(this.time)) % 2 ? "#cfcfcf" : WHITE) : Math.floor(i / 4) % 2 ? awning : WHITE;
      g.fillRect(x - w / 2 - 2 + i, base - 38, 1, 7);
      if (i % 4 === 1) g.fillRect(x - w / 2 - 2 + i, base - 31, 2, 2);
    }
    g.fillStyle = K; g.fillRect(x - w / 2 - 1, base - 13, w + 2, 14);
    g.fillStyle = WHITE; g.fillRect(x - w / 2, base - 12, w, 12);
    g.fillStyle = st.kind === "bar" ? LILAC : st.kind === "cart" ? POND : CORAL;
    g.fillRect(x - w / 2, base - 6, w, 3);
    if (st.kind === "cart") for (const wx of [x - 6, x + 6]) { this.disc(wx, base + 1, 3, K); this.disc(wx, base + 1, 2, WHITE); }
    if (st.kind === "stand" || st.kind === "bar") {
      g.fillStyle = K; g.fillRect(x + w / 2 - 9, base - 20, 6, 8);
      g.fillStyle = POND; g.fillRect(x + w / 2 - 8, base - 19, 4, 6);
      g.fillStyle = SUN; g.fillRect(x + w / 2 - 8, base - 16, 4, 3);
    } else {
      for (let i = 0; i < 3; i++) { g.fillStyle = K; g.fillRect(x - 6 + i * 5, base - 20, 3, 7); g.fillStyle = [CORAL, SUN, LILAC][i]; g.fillRect(x - 5 + i * 5, base - 19, 1, 4); }
    }
    if (s.upgrades.has("umbrella") && st.kind !== "cart") {
      const ux = x - w / 2 - 9;
      g.fillStyle = K; g.fillRect(ux, base - 22, 1, 24);
      for (let i = 0; i < 6; i++) { const ww = 2 + i * 2; g.fillStyle = K; g.fillRect(ux - ww - 1, base - 28 + i, ww * 2 + 3, 1); g.fillStyle = i % 2 ? LILAC : WHITE; g.fillRect(ux - ww, base - 28 + i, ww * 2 + 1, 1); }
    }
    if (s.upgrades.has("sign") && st.operator && s.phase !== "evening") {
      const on = this.reduced || Math.floor(this.time * 3) % 4 !== 0;
      this.sign(st.kind === "bar" ? "FIZZ" : st.kind === "cart" ? "POPS" : "LEMON", x, base - 61, on ? SIGNAL : WHITE);
    }
    const price = Math.round(s.price * (st.kind === "bar" ? 2 : st.kind === "cart" ? 1.4 : 1) * 100) / 100;
    // One clear tag above the awning.
    const tagY = base - 50;
    if (closed) this.sign("NEEDS STAFF", x, tagY, CORAL);
    else if (st.flash > 0) this.sign("SOLD OUT", x, tagY, CORAL);
    else if (s.phase === "open") {
      this.sign(`${price.toFixed(2)} RF`, x, tagY, SUN);
      const rr = this.rush.get(st);
      if (rr && this.time < rr.until && (this.reduced || Math.floor(this.time * 6) % 2 === 0)) this.sign("RUSH!", x + w / 2 + 12, tagY - 7, SIGNAL);
    }
    else if (s.phase === "morning") this.sign("OPENS SOON", x, tagY, WHITE);
    else this.sign("CLOSED", x, tagY, WHITE);
  }

  private heads = new Map<number, { top: number; cx: number }>();
  /** Top row and centre column of a Friend's sprite, for hats. */
  private head(id: number, rows: SpriteRows) {
    let h = this.heads.get(id);
    if (!h) {
      const top = Math.max(0, rows.findIndex(r => r.includes("#")));
      const row = rows[top] ?? "";
      const first = row.indexOf("#"), last = row.lastIndexOf("#");
      h = { top, cx: first < 0 ? 8 : Math.round((first + last) / 2) };
      this.heads.set(id, h);
    }
    return h;
  }

  private drawWalker(w: Walker) {
    const g = this.b;
    const f = this.frames(`f${w.friend.id}`, w.friend.frames);
    const x = this.xAt(w.u), y = this.walkY - 17 + Math.round(w.lane * 6);
    const bob = w.queuedAt ? 0 : Math.round(Math.abs(Math.sin(w.hop)) * -2);
    g.drawImage(f[Math.floor(w.hop / 2) % f.length], x - 9, y + bob);
    if (w.tourist) {
      // A straw sun hat sitting on this Friend's own head: tourists pay more. (The Friend stays canonical.)
      const hd = this.head(w.friend.id, w.friend.frames[0]);
      const hx = x - 8 + hd.cx, hy = y + bob + hd.top;
      g.fillStyle = K; g.fillRect(hx - 6, hy - 1, 12, 3); g.fillRect(hx - 4, hy - 5, 8, 5);
      g.fillStyle = SUN; g.fillRect(hx - 5, hy, 10, 1); g.fillRect(hx - 3, hy - 4, 6, 4);
      g.fillStyle = CORAL; g.fillRect(hx - 3, hy - 2, 6, 1);
    }
    if (w.bought) {
      // A lemonade in hand: the clearest "they bought one" signal.
      const cx = x + 7, cy = y + 7 + bob;
      g.fillStyle = K; g.fillRect(cx - 1, cy - 1, 6, 8); g.fillRect(cx + 3, cy - 4, 1, 3);
      g.fillStyle = WHITE; g.fillRect(cx, cy, 4, 6);
      g.fillStyle = SUN; g.fillRect(cx, cy + 2, 4, 4);
    }
    // Bubbles hang to the walker's left (the side they came from) so they never cover the stall ahead.
    if (w.bubble) this.sign(w.bubble.text, x + 9 - (w.bubble.text.length * 4 + 3) / 2, y - (w.tourist ? 15 : 11) + bob, w.bubble.kind === "bad" ? CORAL : SIGNAL);
  }

  private drawStallsAndCrowd(s: SceneState) {
    for (const st of s.island.stalls) this.drawStall(st, s);
    const ws = [...s.island.walkers].sort((a, b) => a.lane - b.lane);
    for (const w of ws) this.drawWalker(w);
  }

  private stepCoins(dt: number) {
    const g = this.b;
    this.coins = this.coins.filter(c => c.t < 0.9);
    for (const c of this.coins) {
      c.t += dt; c.vy += 60 * dt; c.y += c.vy * dt;
      const x = Math.round(c.x), y = Math.round(c.y);
      g.fillStyle = K; g.fillRect(x - 1, y - 1, 5, 5);
      g.fillStyle = SUN; g.fillRect(x, y, 3, 3);
      g.fillStyle = WHITE; g.fillRect(x, y, 1, 1);
    }
  }
}
