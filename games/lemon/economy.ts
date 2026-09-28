/**
 * Lemon Island economy — pure logic, no DOM. All amounts are simulated demo RF
 * held as bigint base units (18 decimals).
 *
 * The loop: buy lemons on a shared market → sell cups to real Friends walking
 * past → reinvest in stands and upgrades. RF never appears from nowhere:
 *   - Lemons: 50% burned, 50% paid to the farmer Friends' wallets.
 *   - Buildings & upgrades: 50% burned, 50% to active Friend rewards
 *     (the Rare Friends 50/50 gameplay-payment rule).
 *   - Helpers: daily wages paid to the hired Friend's own wallet.
 *   - Customers: Friends pay you for every cup.
 * The lemon price is player-driven: buying pushes it up, quiet days let it
 * relax, and weather events shock it.
 */
export const ONE_RF = 10n ** 18n;
export const rfOf = (n: number): bigint => BigInt(Math.round(n * 100)) * ONE_RF / 100n;
export const toRf = (v: bigint): number => Number((v * 100n) / ONE_RF) / 100;

export const START_BALANCE = rfOf(100);
export const CUPS_PER_LEMON = 4;
export const DAY_SECONDS = 36;
export const SPOIL_SHARE = 0.25; // leftover lemons that rot overnight
export const BASE_LEMON = 0.5; // RF per lemon at a calm market
export const IMPACT = 0.0025; // each lemon bought today lifts the price 0.25%

export type Weather = "sunny" | "hot" | "cloudy" | "rain" | "festival";
export const WEATHER: Record<Weather, { label: string; icon: string; walkers: number; thirst: number; pay: number }> = {
  sunny: { label: "Sunny", icon: "☀", walkers: 1, thirst: 0.8, pay: 1 },
  hot: { label: "Heatwave", icon: "🔥", walkers: 1.1, thirst: 0.95, pay: 1.35 },
  cloudy: { label: "Cloudy", icon: "☁", walkers: 0.85, thirst: 0.65, pay: 0.85 },
  rain: { label: "Rain", icon: "☂", walkers: 0.65, thirst: 0.45, pay: 0.7 },
  festival: { label: "Festival", icon: "🎉", walkers: 1.8, thirst: 0.85, pay: 1.15 },
};

export type BuildId = "stand" | "bar" | "cart" | "umbrella" | "sign" | "jug" | "farm" | "balloon";
export interface Build {
  id: BuildId;
  name: string;
  cost: number; // RF
  kind: "stall" | "upgrade";
  max: number; // how many you can own
  blurb: string;
}
export const BUILDS: Build[] = [
  { id: "stand", name: "Lemon Stand", cost: 40, kind: "stall", max: 2, blurb: "Another stand on the path. More cups, shorter queues." },
  { id: "cart", name: "Ice Pop Cart", cost: 70, kind: "stall", max: 1, blurb: "Sells frozen pops at 1.4× price. Loves heatwaves, hates rain." },
  { id: "bar", name: "Juice Bar", cost: 150, kind: "stall", max: 1, blurb: "Premium fizz at 2× price. Uses 2× lemons." },
  { id: "umbrella", name: "Umbrellas", cost: 30, kind: "upgrade", max: 1, blurb: "Rainy days aren't a washout any more." },
  { id: "jug", name: "Big Jugs", cost: 45, kind: "upgrade", max: 1, blurb: "Serve 40% faster." },
  { id: "sign", name: "Neon Sign", cost: 60, kind: "upgrade", max: 1, blurb: "+20% of passers-by stop to look." },
  { id: "farm", name: "Lemon Grove", cost: 180, kind: "upgrade", max: 1, blurb: "Grows 12 free lemons every morning." },
  { id: "balloon", name: "Tour Balloon", cost: 260, kind: "upgrade", max: 1, blurb: "Brings +35% tourists to the island." },
];
export const buildById = (id: BuildId) => BUILDS.find(b => b.id === id)!;

/** Per-stall selling rules. */
export const STALLS: Record<"stand" | "cart" | "bar", { priceMul: number; lemonsMul: number; weather: Partial<Record<Weather, number>> }> = {
  stand: { priceMul: 1, lemonsMul: 1, weather: {} },
  cart: { priceMul: 1.4, lemonsMul: 0.75, weather: { hot: 1.5, sunny: 1.15, cloudy: 0.6, rain: 0.35 } },
  bar: { priceMul: 2, lemonsMul: 2, weather: { festival: 1.3 } },
};

export const HELPER_WAGE = 3; // RF per day, paid to the helper Friend's wallet

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollWeather(rand: () => number, day: number): Weather {
  if (day > 1 && day % 7 === 0) return "festival";
  const r = rand();
  if (r < 0.38) return "sunny";
  if (r < 0.58) return "hot";
  if (r < 0.8) return "cloudy";
  return "rain";
}

/** Cost to buy `qty` lemons now, with market impact (price climbs as you buy). */
export function quoteLemons(price: number, boughtToday: number, qty: number): { cost: number; after: number } {
  let cost = 0;
  let p = price * (1 + IMPACT * boughtToday);
  for (let i = 0; i < qty; i++) {
    cost += p;
    p = price * (1 + IMPACT * (boughtToday + i + 1));
  }
  return { cost: Math.round(cost * 100) / 100, after: Math.round(p * 1000) / 1000 };
}

/**
 * Overnight market move: today's demand (player + simulated rival tycoons)
 * pushes the price up; it relaxes toward the base otherwise. Events shock it.
 */
export function nextLemonPrice(price: number, playerBought: number, rivalBought: number, weather: Weather, rand: () => number): number {
  const demand = (playerBought + rivalBought) / 60; // 60 lemons/day ≈ neutral
  let p = price + (BASE_LEMON - price) * 0.18 + price * 0.06 * (demand - 1);
  if (weather === "hot") p *= 1.06; // heatwaves drain the groves
  if (rand() < 0.08) p *= 1.35; // grove blight
  p *= 0.97 + rand() * 0.06;
  return Math.max(0.25, Math.min(1.6, Math.round(p * 1000) / 1000));
}

export interface Flows {
  sales: bigint; // RF customers paid you
  lemons: bigint; // RF spent on lemons
  builds: bigint; // RF spent on buildings/upgrades
  wages: bigint; // RF paid to helper Friends
  burned: bigint; // total burned (half of lemons + half of builds)
  toFarmers: bigint; // half of lemon spend → farmer Friends
  toRewards: bigint; // half of build spend → active Friend rewards
  cups: number;
  spoiled: number;
  usedCost: number; // RF value of lemons actually squeezed (at average cost)
  rotCost: number; // RF value of lemons that rotted
}
export const emptyFlows = (): Flows => ({
  sales: 0n, lemons: 0n, builds: 0n, wages: 0n, burned: 0n, toFarmers: 0n, toRewards: 0n, cups: 0, spoiled: 0, usedCost: 0, rotCost: 0,
});

/** The player's simulated RF ledger and inventory. */
export class Ledger {
  balance = START_BALANCE;
  lemons = 0; // fractional lemons allowed (partial cups)
  avgCost = 0; // average RF paid per lemon in stock
  total = emptyFlows();
  today = emptyFlows();

  private add(key: keyof Flows, v: bigint) {
    (this.total[key] as bigint) += v;
    (this.today[key] as bigint) += v;
  }

  newDay() { this.today = emptyFlows(); }

  buyLemons(qty: number, cost: number): boolean {
    const c = rfOf(cost);
    if (qty <= 0 || c > this.balance) return false;
    this.balance -= c;
    this.avgCost = (this.avgCost * this.lemons + cost) / (this.lemons + qty);
    this.lemons += qty;
    const burn = c / 2n;
    this.add("lemons", c);
    this.add("burned", burn);
    this.add("toFarmers", c - burn);
    return true;
  }

  sell(price: number, lemonsUsed: number): boolean {
    if (this.lemons + 1e-9 < lemonsUsed) return false;
    this.lemons = Math.max(0, this.lemons - lemonsUsed);
    this.today.usedCost += lemonsUsed * this.avgCost;
    this.total.usedCost += lemonsUsed * this.avgCost;
    const v = rfOf(price);
    this.balance += v;
    this.add("sales", v);
    this.total.cups += 1;
    this.today.cups += 1;
    return true;
  }

  build(cost: number): boolean {
    const c = rfOf(cost);
    if (c > this.balance) return false;
    this.balance -= c;
    const burn = c / 2n;
    this.add("builds", c);
    this.add("burned", burn);
    this.add("toRewards", c - burn);
    return true;
  }

  payWages(rf: number): bigint {
    const c = rfOf(rf);
    const paid = c > this.balance ? this.balance : c;
    this.balance -= paid;
    this.add("wages", paid);
    return paid;
  }

  /** Overnight: a share of leftover lemons rots. Returns lemons lost. */
  spoil(): number {
    const lost = Math.floor(this.lemons * SPOIL_SHARE);
    this.lemons -= lost;
    this.total.spoiled += lost;
    this.today.spoiled += lost;
    this.today.rotCost += lost * this.avgCost;
    this.total.rotCost += lost * this.avgCost;
    return lost;
  }
}

export function fmtRf(v: bigint | number, dp = 2): string {
  const n = typeof v === "number" ? v : toRf(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
