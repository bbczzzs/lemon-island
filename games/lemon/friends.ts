/**
 * Real Rare Friends Generations NFTs: canonical on-chain sprites read from the
 * artwork registry and baked into friends.json. They walk the island as
 * customers, work as helpers and farm the lemons.
 */
import { decodeSpriteBitmap } from "@rarefriends/friendsdk";
import raw from "./friends.json";

export type SpriteRows = readonly string[];
export interface RosterFriend { id: number; familyId: number; frames: SpriteRows[] }

export const FAMILY_NAMES = [
  "Skeleton", "Mask", "Family", "Cellular", "Asymmetry",
  "Hoverer", "Colossus", "Sparkling", "Hollow",
] as const;

type Raw = { id: number; f: number; b: string[] }[];
export const ROSTER: RosterFriend[] = (raw as Raw).map(r => ({
  id: r.id,
  familyId: r.f,
  frames: r.b.filter(h => /[^0]/.test(h)).map(h => decodeSpriteBitmap(BigInt("0x" + h)).rows),
}));

export function fallbackSprite(seed: number): SpriteRows {
  let a = seed ^ 0x9e3779b9;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const g: string[][] = Array.from({ length: 16 }, () => Array(16).fill("."));
  for (let y = 3; y < 15; y++) for (let x = 3; x < 8; x++) {
    if (((x - 7.5) / 4.6) ** 2 + ((y - 8.5) / 5.8) ** 2 <= 1 && rnd() < 0.82) { g[y][x] = "#"; g[y][15 - x] = "#"; }
  }
  g[7][5] = "."; g[7][10] = ".";
  return g.map(r => r.join(""));
}
