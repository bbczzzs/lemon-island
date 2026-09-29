/**
 * 30-day economy forecast: plays Lemon Island headlessly with the real crowd
 * sim, market and ledger (the same code the game runs) under a simple player
 * strategy, and records every RF flow day by day. Used by the in-game Economy
 * sheet and by `npm run economy`, which writes ECONOMY.md. Pure logic, no DOM.
 */
import {
  Ledger, BUILDS, WEATHER, DAY_SECONDS, HELPER_WAGE, CUPS_PER_LEMON, BASE_LEMON, STALLS,
  mulberry32, rollWeather, quoteLemons, nextLemonPrice, typicalPay, toRf,
  type BuildId, type Weather,
} from "./economy";
import { Island, type Stall } from "./sim";
import type { RosterFriend } from "./friends";
import { EVENTS, rollEvent, eventPayFactor, criticVerdict, type EventId } from "./events";

export interface Strategy {
  /** Cup price as a multiple of what Friends typically pay today (1 = the in-game "good price"). */
  priceFactor: number;
  /** Reinvest profits in stalls and upgrades. */
  builds: boolean;
}
export const STEADY: Strategy = { priceFactor: 1, builds: true };

export interface DayStat {
  day: number;
  weather: Weather;
  event: EventId | null;
  cups: number;
  sales: number;
  profit: number; // today's sales minus lemons squeezed/rotted, builds and wages
  balance: number;
  stalls: number;
  lemonPrice: number;
  // cumulative RF flows since day 1
  burned: number;
  toFarmers: number;
  toRewards: number;
  wages: number;
  toFriends: number; // farmers + rewards + wages: RF that lands in other Friends' wallets
}

/** The order a steady player grows the island in. */
const BUILD_PLAN: BuildId[] = ["stand", "cart", "jug", "umbrella", "sign", "bar", "stand", "farm", "balloon"];
const RESERVE = 25; // RF kept back for lemons and wages
const STEP = 0.1;

export function simulateIsland(roster: RosterFriend[], days = 30, seed = 7, strategy: Strategy = STEADY): DayStat[] {
  const rand = mulberry32(seed);
  const island = new Island(roster, rand);
  const ledger = new Ledger();
  const upgrades = new Set<BuildId>();
  const helpers: RosterFriend[] = [];
  island.addStall("stand", "you");
  let market = BASE_LEMON, reputation = 0.2, boughtToday = 0;
  let weather = rollWeather(rand, 1);
  let event: EventId | null = null;
  let planStep = 0;
  const out: DayStat[] = [];

  for (let day = 1; day <= days; day++) {
    // ---- morning: grove, forecast demand, stock up, set the price ----
    ledger.newDay();
    boughtToday = 0;
    if (upgrades.has("farm")) ledger.lemons += 12;
    const ev = event ? EVENTS[event] : null;
    if (ev) market = Math.min(1.6, market * ev.lemonShock);
    const w = WEATHER[weather];
    const demand = island.stalls.reduce((a, s) => a + 15 * STALLS[s.kind].lemonsMul, 0) * w.walkers * (w.thirst / 0.8) * (ev?.crowd ?? 1);
    const wantLemons = Math.ceil((demand * 1.1) / CUPS_PER_LEMON - ledger.lemons);
    if (wantLemons > 0) {
      const q = quoteLemons(market, boughtToday, wantLemons);
      const affordable = Math.min(wantLemons, Math.floor(toRf(ledger.balance) / Math.max(0.01, market * 1.05)));
      if (affordable > 0 && ledger.buyLemons(affordable, affordable === wantLemons ? q.cost : quoteLemons(market, boughtToday, affordable).cost)) boughtToday += affordable;
    }
    const price = Math.max(0.2, Math.round(typicalPay(weather, upgrades.has("umbrella"), reputation) * eventPayFactor(event) * strategy.priceFactor * 10) / 10);

    // ---- the selling day ----
    const ctx = () => ({ open: true, weather, price, upgrades, reputation, ledger, crowd: ev?.crowd, payMul: ev?.pay, tourists: ev?.tourists });
    let sold = 0, refused = 0;
    island.openUp(ctx());
    for (let t = 0; t < DAY_SECONDS; t += STEP) {
      for (const e of island.step(STEP, ctx())) {
        if (e.type === "sale") { sold++; reputation = Math.min(1, reputation + 0.003); }
        else if (e.type === "pricey") { refused++; reputation = Math.max(0, reputation - 0.0015); }
        else reputation = Math.max(0, reputation - 0.003);
      }
    }

    // ---- evening: wages, spoilage, market, rivals ----
    island.closeUp();
    if (event === "critic") reputation = Math.min(1, Math.max(0, reputation + criticVerdict(sold / Math.max(1, sold + refused) > 0.65 ? 0.7 : 0.3)));
    helpers.forEach(() => ledger.payWages(HELPER_WAGE));
    ledger.spoil();
    const rivalBought = 40 + Math.round(rand() * 45) + (weather === "hot" ? 25 : 0);
    market = nextLemonPrice(market, boughtToday, rivalBought, weather, rand);

    // ---- reinvest ----
    if (strategy.builds) {
      while (planStep < BUILD_PLAN.length) {
        const b = BUILDS.find(x => x.id === BUILD_PLAN[planStep])!;
        if (toRf(ledger.balance) - b.cost < RESERVE + helpers.length * HELPER_WAGE) break;
        ledger.build(b.cost);
        if (b.kind === "stall") {
          const helper = roster[(planStep * 7 + 3) % roster.length];
          helpers.push(helper);
          island.addStall(b.id as Stall["kind"], helper);
        } else upgrades.add(b.id);
        planStep++;
      }
    }

    const t = ledger.today, T = ledger.total;
    out.push({
      day, weather, event, cups: t.cups, sales: toRf(t.sales),
      profit: toRf(t.sales) - t.usedCost - t.rotCost - toRf(t.builds) - toRf(t.wages),
      balance: toRf(ledger.balance), stalls: island.stalls.length, lemonPrice: market,
      burned: toRf(T.burned), toFarmers: toRf(T.toFarmers), toRewards: toRf(T.toRewards), wages: toRf(T.wages),
      toFriends: toRf(T.toFarmers + T.toRewards + T.wages),
    });
    weather = rollWeather(rand, day + 1);
    event = rollEvent(rand, day + 1, weather);
  }
  return out;
}

/** Day-by-day mean of several seeded runs (the in-game forecast averages 5, the report 25). */
export function simulateAverage(roster: RosterFriend[], days = 30, runs = 5, strategy: Strategy = STEADY): DayStat[] {
  const all = Array.from({ length: runs }, (_, i) => simulateIsland(roster, days, (i + 1) * 7919, strategy));
  const avg = (d: number, k: keyof DayStat) => all.reduce((a, r) => a + (r[d][k] as number), 0) / runs;
  return all[0].map((first, d) => ({
    ...first,
    cups: avg(d, "cups"), sales: avg(d, "sales"), profit: avg(d, "profit"), balance: avg(d, "balance"),
    stalls: Math.round(avg(d, "stalls")), lemonPrice: avg(d, "lemonPrice"), burned: avg(d, "burned"),
    toFarmers: avg(d, "toFarmers"), toRewards: avg(d, "toRewards"), wages: avg(d, "wages"), toFriends: avg(d, "toFriends"),
  }));
}
