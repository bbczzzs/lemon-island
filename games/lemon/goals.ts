/**
 * Island goals: eight milestones that give a run its shape. Each one pays a
 * reputation boost (never RF: the game never mints RF). Pure rules.
 */
import type { IconName } from "./icons";

export interface GoalCtx {
  totalCups: number;
  todayCups: number;
  dayProfit: number | null; // set at the end of a day
  happyEnd: boolean; // the day ended with a HAPPY crowd
  stalls: number;
  helpers: number;
  burned: number;
  touristsServed: number;
}

export interface Goal {
  id: string;
  name: string;
  text: string;
  icon: IconName;
  progress: (c: GoalCtx) => [number, number]; // [current, target]
}

export const GOAL_REPUTATION = 0.05;

export const GOALS: Goal[] = [
  { id: "open", name: "Grand opening", text: "Sell your first cup", icon: "cup", progress: c => [Math.min(1, c.totalCups), 1] },
  { id: "rush", name: "Lunch rush", text: "Sell 25 cups in one day", icon: "lemon", progress: c => [Math.min(25, c.todayCups), 25] },
  { id: "black", name: "In the black", text: "Make 15 RF profit in one day", icon: "coin", progress: c => [Math.max(0, Math.min(15, Math.floor(c.dayProfit ?? 0))), 15] },
  { id: "happy", name: "Crowd pleaser", text: "End a day with a HAPPY crowd", icon: "happy", progress: c => [c.happyEnd ? 1 : 0, 1] },
  { id: "tourist", name: "Tourist trap", text: "Serve 20 tourists in sun hats", icon: "ship", progress: c => [Math.min(20, c.touristsServed), 20] },
  { id: "crew", name: "Team player", text: "Build a second stall and hire a Friend", icon: "people", progress: c => [Math.min(2, (c.stalls >= 2 ? 1 : 0) + (c.helpers >= 1 ? 1 : 0)), 2] },
  { id: "burn", name: "Fire starter", text: "Burn 100 RF", icon: "flame", progress: c => [Math.min(100, Math.floor(c.burned)), 100] },
  { id: "empire", name: "Juice empire", text: "Run 5 stalls", icon: "stand", progress: c => [Math.min(5, c.stalls), 5] },
];

export const goalDone = (g: Goal, c: GoalCtx) => { const [a, b] = g.progress(c); return a >= b; };
