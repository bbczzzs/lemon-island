/**
 * Island events: about half the days bring a surprise that changes the day's
 * economics and asks for a decision (stock up? cut prices? keep the crowd
 * happy?). Pure data + rules, shared by the game and the 30-day forecast.
 */
import type { Weather } from "./economy";

export type EventId = "cruise" | "shortage" | "rival" | "critic";

export interface IslandEvent {
  id: EventId;
  title: string;
  blurb: string; // what happens
  tip: string; // the decision it asks for
  crowd: number; // walker multiplier
  pay: number; // willingness-to-pay multiplier
  tourists: number; // share of walkers who are tourists (pay +30%)
  lemonShock: number; // lemon market multiplier this morning
}

/** Share of walkers who are tourists on an ordinary day. */
export const BASE_TOURISTS = 0.1;
/** Tourists pay this much more for a cup. */
export const TOURIST_PAY = 1.3;

export const EVENTS: Record<EventId, IslandEvent> = {
  cruise: {
    id: "cruise", title: "Cruise ship docks!", blurb: "Tourists in sun hats pour off the ship: a bigger crowd that pays 30% more.",
    tip: "Stock extra lemons and nudge your price up.", crowd: 1.35, pay: 1, tourists: 0.55, lemonShock: 1,
  },
  shortage: {
    id: "shortage", title: "Lemon shortage", blurb: "Blight hit the groves overnight. Lemons cost 40% more today.",
    tip: "Sell from yesterday's stock, or raise your price to cover costs.", crowd: 1, pay: 1, tourists: BASE_TOURISTS, lemonShock: 1.4,
  },
  rival: {
    id: "rival", title: "Rival stand opens", blurb: "A rival sells cheap lemonade down the beach. Friends pay 15% less today.",
    tip: "Price war: lower your price or watch them walk past.", crowd: 1, pay: 0.85, tourists: BASE_TOURISTS, lemonShock: 1,
  },
  critic: {
    id: "critic", title: "Food critic in town", blurb: "End the day with a HAPPY crowd for +10% reputation. An unhappy one costs 5%.",
    tip: "Keep the price fair and don't run out.", crowd: 1, pay: 1, tourists: BASE_TOURISTS, lemonShock: 1,
  },
};

/** Roll tomorrow's event. Never on day 1 or on festival days (the festival is the event). */
export function rollEvent(rand: () => number, day: number, weather: Weather): EventId | null {
  const r = rand();
  if (day < 2 || weather === "festival") return null;
  if (r < 0.13) return "cruise";
  if (r < 0.25) return "shortage";
  if (r < 0.37) return "rival";
  if (r < 0.48) return "critic";
  return null;
}

/** How today's event shifts what Friends pay on average (tourists and rivals). */
export const eventPayFactor = (id: EventId | null) => {
  if (!id) return 1;
  const e = EVENTS[id];
  return e.pay * (1 + (e.tourists - BASE_TOURISTS) * (TOURIST_PAY - 1));
};

/** The critic's verdict: reputation change for the day's final crowd mood (0..1). */
export const criticVerdict = (mood: number) => (mood > 0.6 ? 0.1 : -0.05);
