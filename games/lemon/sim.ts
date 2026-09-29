/**
 * The island crowd: real Rare Friends walk the path from the left bridge to
 * the right bridge. Thirsty ones compare each stall's price with what they are
 * willing to pay today (weather, reputation, upgrades) and either queue, grumble
 * about the price, or find the stall sold out. Pure logic; the scene draws it.
 */
import { STALLS, WEATHER, CUPS_PER_LEMON, type BuildId, type Weather, type Ledger } from "./economy";
import type { RosterFriend } from "./friends";
import { BASE_TOURISTS, TOURIST_PAY } from "./events";

export type StallKind = "stand" | "cart" | "bar";

export interface Stall {
  kind: StallKind;
  u: number; // position along the path, 0..1
  queue: Walker[];
  serveT: number;
  operator: RosterFriend | "you" | null; // null = closed (needs a helper)
  flash: number; // seconds of "sold out" flash left
  sold: number; // cups sold today
}

export interface Walker {
  id: number;
  friend: RosterFriend;
  u: number;
  lane: number; // 0..1 depth offset on the path
  speed: number;
  thirsty: boolean;
  tourist: boolean; // sun hat, pays TOURIST_PAY× more
  thirstAt: number; // where on the beach they start looking for a drink (more stalls = more reach)
  maxPay: number;
  bought: boolean;
  queuedAt: Stall | null;
  checked: Set<Stall>;
  bubble: { text: string; kind: "good" | "bad" | "info"; t: number } | null;
  hop: number;
}

export type SimEvent =
  | { type: "sale"; stall: Stall; price: number; walker: Walker }
  | { type: "pricey"; stall: Stall; walker: Walker }
  | { type: "soldout"; stall: Stall; walker: Walker };

/** Walkers on screen at once — kept low so the beach stays readable. */
const MAX_WALKERS = 18;

export const STALL_SLOTS = [0.32, 0.55, 0.78, 0.1, 0.96];

/** Queues form beside the stall (to its left) so the counter stays readable. */
const QUEUE_FRONT = 0.085, QUEUE_GAP = 0.055, QUEUE_MAX = 3;
const queueSpot = (s: Stall, idx: number) => s.u - QUEUE_FRONT - QUEUE_GAP * idx;

export interface SimCtx {
  open: boolean;
  weather: Weather;
  price: number; // base cup price set by the player
  upgrades: Set<BuildId>;
  reputation: number; // 0..1
  ledger: Ledger;
  crowd?: number; // event walker multiplier (default 1)
  payMul?: number; // event willingness-to-pay multiplier (default 1)
  tourists?: number; // share of tourists among new walkers (default BASE_TOURISTS)
}

export class Island {
  walkers: Walker[] = [];
  stalls: Stall[] = [];
  private nextId = 1;
  private spawnAcc = 0;

  constructor(private roster: RosterFriend[], private rand: () => number) {}

  addStall(kind: StallKind, operator: Stall["operator"]): Stall {
    const used = new Set(this.stalls.map(s => s.u));
    const u = STALL_SLOTS.find(x => !used.has(x)) ?? 0.5;
    const s: Stall = { kind, u, queue: [], serveT: 0, operator, flash: 0, sold: 0 };
    this.stalls.push(s);
    this.stalls.sort((a, b) => a.u - b.u);
    return s;
  }

  /** Cups this stall can still make with the lemons in stock. */
  canServe(s: Stall, ledger: Ledger): boolean {
    return ledger.lemons + 1e-9 >= STALLS[s.kind].lemonsMul / CUPS_PER_LEMON;
  }

  walkersPerSecond(ctx: SimCtx): number {
    if (!ctx.open) return 0.35;
    const w = WEATHER[ctx.weather];
    return 2.0 * w.walkers * (ctx.crowd ?? 1) * (1 + ctx.reputation * 0.5) * (ctx.upgrades.has("balloon") ? 1.35 : 1);
  }

  willingness(ctx: SimCtx): { thirst: number; pay: number } {
    const w = WEATHER[ctx.weather];
    let thirst = w.thirst, pay = w.pay;
    if (ctx.weather === "rain" && ctx.upgrades.has("umbrella")) { thirst = 0.7; pay = 0.9; }
    if (ctx.upgrades.has("sign")) thirst = Math.min(0.95, thirst * 1.2);
    return { thirst, pay };
  }

  /** Adds a walker at `u` (default: off-screen at the ferry). */
  private spawn(ctx: SimCtx, u = -0.08) {
    // Busy event days get a slightly bigger (still tidy) crowd.
    if (this.walkers.length >= Math.round(MAX_WALKERS * Math.min(1.3, ctx.crowd ?? 1))) return;
    // Keep gaps so the crowd walks in a tidy, readable line.
    if (this.walkers.some(w => !w.queuedAt && Math.abs(w.u - u) < 0.05)) return;
    const r = this.rand;
    const { thirst, pay } = this.willingness(ctx);
    const friend = this.roster[Math.floor(r() * this.roster.length)];
    const tourist = r() < (ctx.tourists ?? BASE_TOURISTS);
    this.walkers.push({
      id: this.nextId++, friend, u, lane: r() < 0.5 ? 0 : 1, speed: 0.1,
      thirsty: ctx.open && r() < thirst, thirstAt: -0.35 + r() * 1.25, tourist,
      maxPay: 1.0 * pay * (0.6 + r() * 0.9) * (1 + ctx.reputation * 0.3) * (ctx.payMul ?? 1) * (tourist ? TOURIST_PAY : 1),
      bought: false, queuedAt: null, checked: new Set(), bubble: null, hop: r() * 6,
    });
  }

  /** Speech bubble, skipped if a neighbour is already talking (keeps the beach readable). */
  private say(w: Walker, text: string, kind: "good" | "bad", t: number) {
    if (this.walkers.some(o => o !== w && o.bubble && Math.abs(o.u - w.u) < 0.14)) return;
    w.bubble = { text, kind, t };
  }

  step(dt: number, ctx: SimCtx): SimEvent[] {
    const events: SimEvent[] = [];
    this.spawnAcc += dt * this.walkersPerSecond(ctx);
    while (this.spawnAcc >= 1) { this.spawnAcc -= 1; this.spawn(ctx); }

    const serviceTime = 0.75 / (ctx.upgrades.has("jug") ? 1.4 : 1);
    for (const s of this.stalls) {
      s.flash = Math.max(0, s.flash - dt);
      if (!s.queue.length || !s.operator) { s.serveT = 0; continue; }
      s.serveT += dt;
      if (s.serveT < serviceTime) continue;
      s.serveT = 0;
      const w = s.queue.shift()!;
      w.queuedAt = null;
      const rule = STALLS[s.kind];
      const price = Math.round(ctx.price * rule.priceMul * 100) / 100;
      if (ctx.ledger.sell(price, rule.lemonsMul / CUPS_PER_LEMON)) {
        w.bought = true;
        s.sold += 1;
        events.push({ type: "sale", stall: s, price, walker: w });
      } else {
        this.say(w, "SOLD OUT", "bad", 1.4);
        s.flash = 1.5;
        events.push({ type: "soldout", stall: s, walker: w });
        for (const q of s.queue) { q.queuedAt = null; this.say(q, "AWW", "bad", 1.2); }
        s.queue = [];
      }
    }

    const keep: Walker[] = [];
    for (const w of this.walkers) {
      w.hop += dt * 8;
      if (w.bubble) { w.bubble.t -= dt; if (w.bubble.t <= 0) w.bubble = null; }
      if (w.queuedAt) {
        // Shuffle up to your spot in the queue.
        const idx = w.queuedAt.queue.indexOf(w);
        const target = queueSpot(w.queuedAt, idx);
        w.u += Math.sign(target - w.u) * Math.min(Math.abs(target - w.u), dt * 0.05);
        keep.push(w);
        continue;
      }
      w.u += w.speed * dt;
      for (const s of this.stalls) {
        if (w.checked.has(s) || s.u < w.thirstAt || w.u < queueSpot(s, s.queue.length) - 0.01 || w.u > s.u + 0.02) continue;
        w.checked.add(s);
        if (!w.thirsty || w.bought || !ctx.open || !s.operator) continue;
        const rule = STALLS[s.kind];
        const price = ctx.price * rule.priceMul;
        const mood = rule.weather[ctx.weather] ?? 1;
        const limit = w.maxPay * rule.priceMul * mood;
        if (!this.canServe(s, ctx.ledger)) {
          this.say(w, "SOLD OUT", "bad", 1.3);
          s.flash = 1.5;
          events.push({ type: "soldout", stall: s, walker: w });
        } else if (price > limit) {
          this.say(w, "TOO $$$", "bad", 1.2);
          events.push({ type: "pricey", stall: s, walker: w });
        } else if (s.queue.length < QUEUE_MAX) {
          s.queue.push(w);
          w.queuedAt = s;
        }
        break;
      }
      if (w.u < 1.08) keep.push(w);
    }
    this.walkers = keep;
    return events;
  }

  /** Opening time: the beach is already busy — re-roll thirst and send a crowd in from the ferry. */
  openUp(ctx: SimCtx) {
    const { thirst } = this.willingness(ctx);
    for (const w of this.walkers) { w.thirsty = this.rand() < thirst; w.thirstAt = w.u - 0.1 + this.rand() * 0.6; w.bought = false; w.checked.clear(); }
    for (const u of [0.24, 0.14, 0.04]) this.spawn(ctx, u);
  }

  /** End of day: send everyone home and reset counters. */
  closeUp() {
    for (const s of this.stalls) { s.queue = []; s.serveT = 0; s.sold = 0; }
    for (const w of this.walkers) { w.queuedAt = null; w.thirsty = false; }
  }
}
