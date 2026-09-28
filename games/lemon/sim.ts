/**
 * The island crowd: real Rare Friends walk the path from the left bridge to
 * the right bridge. Thirsty ones compare each stall's price with what they are
 * willing to pay today (weather, reputation, upgrades) and either queue, grumble
 * about the price, or find the stall sold out. Pure logic; the scene draws it.
 */
import { STALLS, WEATHER, CUPS_PER_LEMON, type BuildId, type Weather, type Ledger } from "./economy";
import type { RosterFriend } from "./friends";

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

export const STALL_SLOTS = [0.34, 0.54, 0.72, 0.2, 0.86];

export interface SimCtx {
  open: boolean;
  weather: Weather;
  price: number; // base cup price set by the player
  upgrades: Set<BuildId>;
  reputation: number; // 0..1
  ledger: Ledger;
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
    return 1.3 * w.walkers * (1 + ctx.reputation * 0.7) * (ctx.upgrades.has("balloon") ? 1.35 : 1);
  }

  willingness(ctx: SimCtx): { thirst: number; pay: number } {
    const w = WEATHER[ctx.weather];
    let thirst = w.thirst, pay = w.pay;
    if (ctx.weather === "rain" && ctx.upgrades.has("umbrella")) { thirst = 0.7; pay = 0.9; }
    if (ctx.upgrades.has("sign")) thirst = Math.min(0.95, thirst * 1.2);
    return { thirst, pay };
  }

  private spawn(ctx: SimCtx) {
    if (this.walkers.length >= 48) return;
    const r = this.rand;
    const { thirst, pay } = this.willingness(ctx);
    const friend = this.roster[Math.floor(r() * this.roster.length)];
    this.walkers.push({
      id: this.nextId++, friend, u: -0.08, lane: r(), speed: 0.036 + r() * 0.02,
      thirsty: ctx.open && r() < thirst,
      maxPay: 0.5 * pay * (0.6 + r() * 0.9) * (1 + ctx.reputation * 0.3),
      bought: false, queuedAt: null, checked: new Set(), bubble: null, hop: r() * 6,
    });
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
        w.bubble = { text: this.rand() < 0.5 ? "YUM!" : `+${price.toFixed(2)}`, kind: "good", t: 1.4 };
        events.push({ type: "sale", stall: s, price, walker: w });
      } else {
        w.bubble = { text: "SOLD OUT", kind: "bad", t: 1.4 };
        s.flash = 1.5;
        events.push({ type: "soldout", stall: s, walker: w });
        for (const q of s.queue) { q.queuedAt = null; q.bubble = { text: "AWW", kind: "bad", t: 1.2 }; }
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
        const target = w.queuedAt.u - 0.022 * (idx + 1);
        w.u += Math.sign(target - w.u) * Math.min(Math.abs(target - w.u), dt * 0.05);
        keep.push(w);
        continue;
      }
      w.u += w.speed * dt;
      for (const s of this.stalls) {
        if (w.checked.has(s) || w.u < s.u - 0.035 || w.u > s.u + 0.02) continue;
        w.checked.add(s);
        if (!w.thirsty || w.bought || !ctx.open || !s.operator) continue;
        const rule = STALLS[s.kind];
        const price = ctx.price * rule.priceMul;
        const mood = rule.weather[ctx.weather] ?? 1;
        const limit = w.maxPay * rule.priceMul * mood;
        if (!this.canServe(s, ctx.ledger)) {
          w.bubble = { text: "SOLD OUT", kind: "bad", t: 1.3 };
          s.flash = 1.5;
          events.push({ type: "soldout", stall: s, walker: w });
        } else if (price > limit) {
          w.bubble = { text: price > limit * 1.5 ? "WAY $$$" : "TOO $$$", kind: "bad", t: 1.3 };
          events.push({ type: "pricey", stall: s, walker: w });
        } else if (s.queue.length < 8) {
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
    for (const w of this.walkers) { w.thirsty = this.rand() < thirst; w.bought = false; w.checked.clear(); }
    for (let i = 0; i < 7; i++) {
      this.spawn(ctx);
      const w = this.walkers[this.walkers.length - 1];
      if (w) w.u = -0.05 + this.rand() * 0.3;
    }
  }

  /** End of day: send everyone home and reset counters. */
  closeUp() {
    for (const s of this.stalls) { s.queue = []; s.serveT = 0; s.sold = 0; }
    for (const w of this.walkers) { w.queuedAt = null; w.thirsty = false; }
  }
}
