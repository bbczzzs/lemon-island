"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import {
  Ledger, BUILDS, WEATHER, CUPS_PER_LEMON, DAY_SECONDS, HELPER_WAGE, BASE_LEMON,
  mulberry32, rollWeather, quoteLemons, nextLemonPrice, fmtRf, toRf,
  type BuildId, type Weather,
} from "./economy";
import { Island, type Stall } from "./sim";
import { ROSTER, FAMILY_NAMES, type RosterFriend, type SpriteRows } from "./friends";
import { LemonScene, spriteCanvas, type Phase } from "./scene";
import { LemonAudio } from "./audio";
import { loadPilot, type PilotSprite } from "./pilot";
import { Px, WEATHER_ICON, type IconName } from "./icons";
import "./style.css";

type Sheet = "lemons" | "build" | "staff" | "economy";
interface Report { day: number; cups: number; sales: bigint; used: number; rot: number; builds: bigint; wages: bigint; spoiled: number; profit: number; rep: number; stock: number; }
interface Rival { friend: RosterFriend; value: number; }
interface Toast { id: number; text: string; kind: "good" | "bad" | "info"; }

const avatarCache = new Map<string, string>();
function avatar(key: string, rows: SpriteRows | undefined): string {
  if (!rows) return "";
  let url = avatarCache.get(key);
  if (!url) { url = spriteCanvas(rows).toDataURL(); avatarCache.set(key, url); }
  return url;
}

/**
 * Lemon Island Tycoon — the Rare Friends Vibeathon (Economy Potential).
 * The SDK runtime supplies wallet connection, Friend selection and the
 * ownership gate; every RF amount here is a simulated demo ledger.
 */
export default function LemonIsland({ friendId, client, paused }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const sceneRef = useRef<LemonScene | null>(null);
  const audioRef = useRef<LemonAudio | null>(null);
  const pausedRef = useRef(paused);
  const randRef = useRef(mulberry32((Date.now() ^ Number(BigInt.asUintN(32, friendId))) >>> 0));
  const ledgerRef = useRef(new Ledger());
  const islandRef = useRef<Island>(new Island(ROSTER.filter(f => f.id !== Number(friendId)), randRef.current));
  const upgradesRef = useRef<Set<BuildId>>(new Set());
  const helpersRef = useRef<RosterFriend[]>([]);
  const game = useRef({
    day: 1, phase: "morning" as Phase, t: 0, weather: "sunny" as Weather, forecast: "sunny" as Weather,
    price: 0.8, market: BASE_LEMON, boughtToday: 0, reputation: 0.2, marketHistory: [BASE_LEMON] as number[],
    grove: 0, mood: 0.5,
  });
  const rivalsRef = useRef<Rival[]>([]);
  const toastId = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pilot, setPilot] = useState<PilotSprite | null>(null);
  const [, setTick] = useState(0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [candidates, setCandidates] = useState<RosterFriend[]>([]);
  const [pops, setPops] = useState<{ id: number; v: number }[]>([]);
  const popId = useRef(0);
  const rerender = () => setTick(t => (t + 1) % 1_000_000);

  function toast(text: string, kind: Toast["kind"] = "info") {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-1), { id, text, kind }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
  }

  /** "+0.80" floats out of the balance on every sale. */
  function addPop(v: number) {
    const id = ++popId.current;
    setPops(p => [...p.slice(-2), { id, v }]);
    window.setTimeout(() => setPops(p => p.filter(x => x.id !== id)), 850);
  }

  function pickCandidates() {
    const r = randRef.current;
    const taken = new Set(helpersRef.current.map(h => h.id));
    const pool = ROSTER.filter(f => !taken.has(f.id) && f.id !== Number(friendId));
    const out: RosterFriend[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    setCandidates(out);
  }

  // ---- session + identity ----
  useEffect(() => {
    let live = true;
    loadPilot(friendId).then(p => { if (!live) return; setPilot(p); sceneRef.current?.setPilot(p.frames); });
    return () => { live = false; };
  }, [friendId]);

  useEffect(() => {
    let live = true;
    setReady(false);
    setError("");
    // The runtime finishes loading once the child reads its session, even
    // though Lemon Island runs its own simulated ledger.
    client.read()
      .then(() => { if (live) setReady(true); })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load the game session."); });
    return () => { live = false; };
  }, [client, friendId]);

  useEffect(() => { pausedRef.current = paused; audioRef.current?.setPaused(paused); }, [paused]);

  // ---- main loop ----
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new LemonScene(canvas);
    const audio = new LemonAudio();
    sceneRef.current = scene;
    audioRef.current = audio;
    const island = islandRef.current;
    if (!island.stalls.length) island.addStall("stand", "you");
    const g = game.current;
    g.weather = rollWeather(randRef.current, 1);
    g.forecast = rollWeather(randRef.current, 2);
    const r = randRef.current;
    rivalsRef.current = ROSTER.slice(0).sort(() => r() - 0.5).slice(0, 5).map(f => ({ friend: f, value: 80 + Math.round(r() * 60) }));
    pickCandidates();
    loadPilot(friendId).then(p => scene.setPilot(p.frames));

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => { setReduced(mq.matches); scene.setReducedMotion(mq.matches); };
    applyMotion();
    mq.addEventListener("change", applyMotion);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas);

    let raf = 0, last = 0, uiClock = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (pausedRef.current) return;
      step(dt);
      scene.frame({ phase: g.phase, dayT: g.phase === "open" ? g.t / DAY_SECONDS : 0, weather: g.weather, island, upgrades: upgradesRef.current, price: g.price }, dt);
      if (clockRef.current) clockRef.current.textContent = clockText();
      uiClock += dt;
      if (uiClock > 0.15) { uiClock = 0; rerender(); }
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      if (pausedRef.current) return;
      if (e.code === "Space") { e.preventDefault(); primary(); }
      else if (e.key === "[") nudgePrice(-0.1);
      else if (e.key === "]") nudgePrice(0.1);
      else if (e.key === "m" || e.key === "M") toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener("change", applyMotion);
      window.removeEventListener("keydown", onKey);
      audio.dispose();
      sceneRef.current = null;
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function clockText(): string {
    const g = game.current;
    if (g.phase !== "open") return g.phase === "morning" ? "9:00" : "18:00";
    const mins = 9 * 60 + Math.floor((g.t / DAY_SECONDS) * 9 * 60);
    return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  }

  function step(dt: number) {
    const g = game.current;
    const ledger = ledgerRef.current;
    const events = islandRef.current.step(dt, { open: g.phase === "open", weather: g.weather, price: g.price, upgrades: upgradesRef.current, reputation: g.reputation, ledger });
    for (const e of events) {
      if (e.type === "sale") { g.reputation = Math.min(1, g.reputation + 0.003); g.mood = Math.min(1, g.mood + 0.1); sceneRef.current?.sale(e.stall); audioRef.current?.coin(); addPop(e.price); }
      else if (e.type === "pricey") {
        g.reputation = Math.max(0, g.reputation - 0.0015);
        g.mood = Math.max(0, g.mood - 0.12);
      }
      else g.reputation = Math.max(0, g.reputation - 0.003);
    }
    if (g.phase === "open") {
      g.t += dt;
      if (g.t >= DAY_SECONDS) endDay();
    }
  }

  function typicalPay(): number {
    const g = game.current;
    const w = WEATHER[g.weather];
    // What most Friends will happily pay today (about 6 in 10 say yes at this price).
    return 0.95 * (g.weather === "rain" && upgradesRef.current.has("umbrella") ? 0.9 : w.pay) * (1 + g.reputation * 0.3);
  }

  function openDay() {
    const g = game.current;
    if (g.phase !== "morning") return;
    setShowIntro(false);
    setSheet(null);
    if (ledgerRef.current.lemons < 0.25) toast("No lemons! Buy some at the market first.", "bad");
    g.phase = "open";
    g.t = 0;
    g.mood = 0.5;
    islandRef.current.openUp({ open: true, weather: g.weather, price: g.price, upgrades: upgradesRef.current, reputation: g.reputation, ledger: ledgerRef.current });
    audioRef.current?.unlock();
    audioRef.current?.launchRumble();
    rerender();
  }

  function endDay() {
    const g = game.current;
    const ledger = ledgerRef.current;
    const island = islandRef.current;
    g.phase = "evening";
    island.closeUp();
    // Wages go straight into each helper Friend's own wallet.
    helpersRef.current.forEach(() => ledger.payWages(HELPER_WAGE));
    const spoiled = ledger.spoil();
    const t = ledger.today;
    const profit = toRf(t.sales) - t.usedCost - t.rotCost - toRf(t.builds) - toRf(t.wages);
    setReport({ day: g.day, cups: t.cups, sales: t.sales, used: t.usedCost, rot: t.rotCost, builds: t.builds, wages: t.wages, spoiled, profit, rep: g.reputation, stock: Math.floor(ledger.lemons) });
    // Market and rivals move overnight.
    const rivalBought = 40 + Math.round(randRef.current() * 45) + (g.weather === "hot" ? 25 : 0);
    g.market = nextLemonPrice(g.market, g.boughtToday, rivalBought, g.weather, randRef.current);
    g.marketHistory = [...g.marketHistory, g.market].slice(-14);
    for (const rv of rivalsRef.current) rv.value += Math.round(4 + randRef.current() * 22);
    audioRef.current?.milestone();
    rerender();
  }

  function nextDay() {
    const g = game.current;
    if (g.phase !== "evening") return;
    g.day += 1;
    g.phase = "morning";
    g.weather = g.forecast;
    g.forecast = rollWeather(randRef.current, g.day + 1);
    g.boughtToday = 0;
    ledgerRef.current.newDay();
    if (upgradesRef.current.has("farm")) { ledgerRef.current.lemons += 12; toast("Your grove grew 12 free lemons", "good"); }
    if (g.weather === "festival") toast("Festival day! Big crowds are coming.", "good");
    setReport(null);
    pickCandidates();
    audioRef.current?.tick(660);
    rerender();
  }

  function primary() {
    const g = game.current;
    if (g.phase === "morning") openDay();
    else if (g.phase === "evening") nextDay();
  }

  function buyLemons(qty: number) {
    const g = game.current;
    if (g.phase === "evening") return;
    const q = quoteLemons(g.market, g.boughtToday, qty);
    if (!ledgerRef.current.buyLemons(qty, q.cost)) { toast("Not enough demo RF", "bad"); return; }
    g.boughtToday += qty;
    audioRef.current?.unlock();
    audioRef.current?.burn();
    toast(`Bought ${qty} lemons · ${fmtRf(q.cost)} RF (half burned, half to farmer Friends)`, "good");
    rerender();
  }

  function nudgePrice(d: number) {
    const g = game.current;
    g.price = Math.max(0.2, Math.min(3, Math.round((g.price + d) * 100) / 100));
    audioRef.current?.tick(500 + g.price * 300);
    rerender();
  }

  function owned(id: BuildId): number {
    if (id === "stand") return islandRef.current.stalls.filter(s => s.kind === "stand").length - 1;
    if (id === "cart" || id === "bar") return islandRef.current.stalls.filter(s => s.kind === id).length;
    return upgradesRef.current.has(id) ? 1 : 0;
  }

  function build(id: BuildId) {
    const b = BUILDS.find(x => x.id === id)!;
    if (owned(id) >= b.max) return;
    if (!ledgerRef.current.build(b.cost)) { toast("Not enough demo RF", "bad"); return; }
    if (b.kind === "stall") {
      const helper = helpersRef.current.find(h => !islandRef.current.stalls.some(s => s.operator === h)) ?? null;
      islandRef.current.addStall(id as Stall["kind"], helper);
      if (!helper) { toast(`${b.name} built · hire a Friend to run it`, "info"); setSheet("staff"); }
      else toast(`${b.name} built · #${helper.id} runs it`, "good");
    } else {
      upgradesRef.current.add(id);
      toast(`${b.name} built · ${fmtRf(b.cost / 2)} RF burned`, "good");
    }
    audioRef.current?.unlock();
    audioRef.current?.burn();
    rerender();
  }

  function hire(f: RosterFriend) {
    helpersRef.current = [...helpersRef.current, f];
    const closed = islandRef.current.stalls.find(s => !s.operator);
    if (closed) closed.operator = f;
    setCandidates(c => c.filter(x => x.id !== f.id));
    audioRef.current?.unlock();
    audioRef.current?.tick(760);
    toast(closed ? `#${f.id} now runs your ${closed.kind === "bar" ? "Juice Bar" : closed.kind === "cart" ? "Ice Pop Cart" : "stand"}` : `#${f.id} hired · build a stall for them`, "good");
    rerender();
  }

  function fire(f: RosterFriend) {
    helpersRef.current = helpersRef.current.filter(h => h !== f);
    for (const s of islandRef.current.stalls) if (s.operator === f) s.operator = null;
    rerender();
  }

  function toggleMute() {
    const a = audioRef.current;
    setMuted(m => { const n = !m; a?.unlock(); a?.setMuted(n); if (!n) a?.tick(660); return n; });
  }

  // ---- render ----
  if (error) return <div className="li-loading" role="alert"><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>;
  if (!ready) return <div className="li-loading" role="status"><div className="li-loading-mark" aria-hidden="true"><i /><i /><i /><i /></div><p>Squeezing lemons…</p></div>;

  const g = game.current;
  const ledger = ledgerRef.current;
  const island = islandRef.current;
  const w = WEATHER[g.weather];
  const fc = WEATHER[g.forecast];
  const cups = Math.floor(ledger.lemons * CUPS_PER_LEMON + 1e-9);
  const typical = typicalPay();
  const priceState = g.price > typical * 1.06 ? "high" : g.price < typical * 0.6 ? "low" : "good";
  const moodKey = g.mood > 0.6 ? "good" : g.mood > 0.3 ? "ok" : "bad";
  const buildValue = BUILDS.reduce((a, b) => a + owned(b.id) * b.cost, 0) + 40;
  const islandValue = toRf(ledger.balance) + buildValue * 0.5 + ledger.lemons * g.market;
  const board = [{ name: "You", value: islandValue, rows: pilot?.frames[0], me: true },
    ...rivalsRef.current.map(r => ({ name: `#${r.friend.id}`, value: r.value, rows: r.friend.frames[0], me: false }))]
    .sort((a, b) => b.value - a.value);
  const closedStalls = island.stalls.filter(s => !s.operator).length;
  const balance = toRf(ledger.balance);
  // One plain-English "what now?" line above the dock, and a blinking outline on the button to press.
  const hint: ReactNode = showIntro || sheet || g.phase === "evening" ? null
    : g.phase === "morning" ? (cups < 8 ? <>Step 1 · buy lemons <Px name="lemon" size={14} /></> : <>Step 2 · set your price, then press OPEN <Px name="play" size={12} /></>)
    : cups === 0 ? <>Out of lemons! Tap <Px name="lemon" size={14} /> to buy more</>
    : priceState === "high" ? <>Too pricey! Friends pay ~{typical.toFixed(2)} today. Tap − to lower it</>
    : cups < 8 ? <>Running low. Tap <Px name="lemon" size={14} /> for more lemons</>
    : null;
  const hintWarn = g.phase === "open";
  const attn = showIntro || sheet || paused ? null
    : g.phase === "morning" ? (cups < 8 ? "lemons" : "go")
    : g.phase === "evening" ? (closedStalls > 0 ? "staff" : "go")
    : cups < 8 ? "lemons" : priceState === "high" ? "price" : null;
  const hist = g.marketHistory.length > 1 ? g.marketHistory : [g.market, g.market];
  const hMax = Math.max(...hist, 0.8), hMin = Math.min(...hist, 0.3);
  const sparkY = (v: number) => 31 - ((v - hMin) / Math.max(0.01, hMax - hMin)) * 28;
  const t = ledger.total;

  const toggle = (x: Sheet) => { setSheet(v => (v === x ? null : x)); audioRef.current?.tick(560); };
  const SHEETS: Record<Sheet, { title: string; icon: IconName }> = {
    lemons: { title: "Lemon market", icon: "lemon" },
    build: { title: "Build your empire", icon: "stand" },
    staff: { title: "Hire Friends", icon: "people" },
    economy: { title: "Island economy", icon: "chart" },
  };
  const cls = (...parts: (string | false)[]) => parts.filter(Boolean).join(" ");

  return (
    <section className={cls("li-root", `li-phase-${g.phase}`, reduced && "li-reduced")} aria-label="Lemon Island Tycoon" aria-busy={paused}>
      <canvas ref={canvasRef} className="li-canvas" />

      <header className="li-hud">
        <div className="li-hud-l">
          <div className="li-pill li-brandpill"><Px name="lemon" size={20} /><strong>LEMON ISLAND</strong><span className="li-demo">DEMO RF</span></div>
          <div className="li-pill li-daypill"><b>DAY {g.day}</b><Px name={WEATHER_ICON[g.weather]} size={18} /><span>{w.label}</span><span ref={clockRef} className="li-clock">9:00</span></div>
        </div>
        <div className="li-hud-r">
          <div className="li-pill li-burnpill" title="RF your island burned this session (simulated)"><Px name="flame" size={18} /><strong>{fmtRf(t.burned)}</strong><span>burned</span></div>
          <div className="li-pill li-moneypill" title="Your demo RF balance">
            <Px name="coin" size={20} /><strong>{fmtRf(ledger.balance)}</strong><span>RF</span>
            {pops.map(p => <em key={p.id} className="li-pop" aria-hidden="true">+{p.v.toFixed(2)}</em>)}
          </div>
          <button type="button" className="li-pill li-iconbtn" aria-pressed={!muted} aria-label={muted ? "Sound on" : "Sound off"} onClick={toggleMute}><Px name={muted ? "mute" : "sound"} size={18} /></button>
          <button type="button" className="li-pill li-iconbtn" aria-pressed={reduced} aria-label="Reduce motion" onClick={() => { const n = !reduced; setReduced(n); sceneRef.current?.setReducedMotion(n); }}><Px name={reduced ? "still" : "waves"} size={18} /></button>
        </div>
      </header>

      {g.phase === "open" && (
        <div className="li-live" role="status">
          <div><span>SOLD</span><strong><Px name="cup" size={16} />{ledger.today.cups}</strong></div>
          <div><span>EARNED</span><strong><Px name="coin" size={16} />{fmtRf(ledger.today.sales)}</strong></div>
          <div><span>CUPS LEFT</span><strong className={cups < 5 ? "low" : ""}><Px name="lemon" size={16} />{cups}</strong></div>
          <div className={`li-mood li-mood-${moodKey}`}><span>MOOD</span><strong><Px name={moodKey === "good" ? "happy" : moodKey === "ok" ? "meh" : "angry"} size={16} />{moodKey === "good" ? "HAPPY" : moodKey === "ok" ? "OK" : "PRICEY"}</strong></div>
          <i className="li-daybar" aria-hidden="true"><b style={{ width: `${(g.t / DAY_SECONDS) * 100}%` }} /></i>
        </div>
      )}

      <div className="li-toasts" aria-live="polite">{toasts.map(x => <div key={x.id} className={`li-toast li-toast-${x.kind}`}>{x.text}</div>)}</div>

      {showIntro && g.phase === "morning" && !sheet && (
        <div className="li-card li-intro" role="dialog" aria-label="How to play">
          <div className="li-card-bar"><Px name="lemon" size={22} /><strong>Welcome to Lemon Island!</strong></div>
          <p className="li-lead">Sell lemonade to Friends on the beach. Make RF, then grow your empire.</p>
          <ol className="li-steps">
            <li><i>1</i><Px name="lemon" size={26} /><div><b>Buy lemons</b><span>1 lemon makes 2 cups</span></div></li>
            <li><i>2</i><Px name="coin" size={26} /><div><b>Set a price</b><span>Too pricey and they walk past</span></div></li>
            <li><i>3</i><Px name="cup" size={26} /><div><b>Open the stand</b><span>Watch Friends grab a lemonade</span></div></li>
          </ol>
          <button type="button" className="li-cta" onClick={() => { setShowIntro(false); setSheet("lemons"); }}>Let's go <Px name="play" size={14} /></button>
        </div>
      )}

      {report && g.phase === "evening" && !sheet && (
        <div className="li-card li-report" role="status">
          <div className="li-card-bar"><strong>Day {report.day} report</strong><span className="li-fc">Tomorrow <Px name={WEATHER_ICON[g.forecast]} size={14} /> {fc.label}</span></div>
          <dl>
            <div><dt>Cups sold</dt><dd>{report.cups}</dd></div>
            <div><dt>Sales</dt><dd>+{fmtRf(report.sales)}</dd></div>
            <div><dt>Lemons squeezed</dt><dd>−{fmtRf(report.used)}</dd></div>
            {report.builds > 0n && <div><dt>Building</dt><dd>−{fmtRf(report.builds)}</dd></div>}
            {report.wages > 0n && <div><dt>Helper wages</dt><dd>−{fmtRf(report.wages)}</dd></div>}
            {report.spoiled > 0 && <div><dt>{report.spoiled} lemons rotted</dt><dd>−{fmtRf(report.rot)}</dd></div>}
            <div className="tot"><dt>Profit</dt><dd className={report.profit >= 0 ? "up" : "down"}>{report.profit >= 0 ? "+" : "−"}{fmtRf(Math.abs(report.profit))} RF</dd></div>
          </dl>
          <p>{report.stock} lemons in stock · reputation {Math.round(report.rep * 100)}% · lemons now {g.market.toFixed(2)} RF</p>
        </div>
      )}

      {sheet && (
        <div className={`li-sheet li-sheet-${sheet}`} role="dialog" aria-label={SHEETS[sheet].title}>
          <div className="li-sheet-bar"><Px name={SHEETS[sheet].icon} size={22} /><strong>{SHEETS[sheet].title}</strong><button type="button" className="li-x" aria-label="Close" onClick={() => setSheet(null)}>×</button></div>
          {sheet === "lemons" && (
            <div className="li-sheet-body li-lemons">
              <div className="li-market">
                <div>
                  <small>TODAY'S PRICE</small>
                  <strong>{g.market.toFixed(2)}<em> RF / lemon</em></strong>
                  <span className={`li-trend li-trend-${g.market > BASE_LEMON * 1.1 ? "up" : g.market < BASE_LEMON * 0.9 ? "down" : "calm"}`}>{g.market > BASE_LEMON * 1.1 ? "▲ pricey" : g.market < BASE_LEMON * 0.9 ? "▼ cheap" : "● calm"}</span>
                </div>
                <svg viewBox="0 0 120 34" className="li-spark" aria-hidden="true">
                  <polyline fill="none" stroke="#111" strokeWidth="2" strokeLinejoin="bevel" points={hist.map((v, i) => `${(i / Math.max(1, hist.length - 1)) * 114 + 3},${sparkY(v)}`).join(" ")} />
                  <rect x={114} y={sparkY(hist[hist.length - 1]) - 3} width="6" height="6" fill="#F2CE68" stroke="#111" strokeWidth="1.5" />
                </svg>
              </div>
              <div className="li-buy">
                {[10, 25, 50].map(q => {
                  const quote = quoteLemons(g.market, g.boughtToday, q);
                  const afford = balance >= quote.cost;
                  return (
                    <button key={q} type="button" onClick={() => buyLemons(q)} disabled={g.phase === "evening" || paused || !afford}>
                      <Px name="lemon" size={26} /><b>+{q}</b><small>{q * CUPS_PER_LEMON} cups</small><span>{fmtRf(quote.cost)} RF</span>
                    </button>
                  );
                })}
              </div>
              <p className="li-note">You have <b>{Math.floor(ledger.lemons)} lemons</b> ({cups} cups). A stand sells <b>~8–15 cups</b> on a normal day. Buying pushes the price up for everyone, and ¼ of leftovers rot overnight. Lemon RF: <b>50% burned</b>, 50% to the farmer Friends.</p>
            </div>
          )}
          {sheet === "build" && (
            <div className="li-sheet-body">
              <ul className="li-builds">
                {BUILDS.map(b => {
                  const have = owned(b.id);
                  const maxed = have >= b.max;
                  const afford = balance >= b.cost;
                  return (
                    <li key={b.id} className={maxed ? "maxed" : afford ? "" : "poor"}>
                      <div className="li-build-top"><span className="li-build-ic"><Px name={b.id} size={30} /></span>{b.max > 1 && <em>{have}/{b.max}</em>}</div>
                      <strong>{b.name}</strong>
                      <p>{b.blurb}</p>
                      <button type="button" disabled={maxed || paused || !afford} onClick={() => build(b.id)} aria-label={`Build ${b.name} for ${b.cost} RF`}>
                        {maxed ? "Built ✓" : afford ? <><Px name="coin" size={14} />{b.cost} RF</> : `Need ${Math.ceil(b.cost - balance)} more`}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="li-note">Building RF: <b>50% burned</b>, 50% to active Friend rewards.</p>
            </div>
          )}
          {sheet === "staff" && (
            <div className="li-sheet-body li-cols">
              <div>
                <h4>Looking for work</h4>
                <ul className="li-staff">
                  {candidates.map(c => (
                    <li key={c.id}>
                      <img src={avatar(`f${c.id}`, c.frames[0])} alt="" className="li-av" />
                      <span>#{c.id} <small>{FAMILY_NAMES[c.familyId]}</small></span>
                      <button type="button" className="hire" onClick={() => hire(c)} aria-label={`Hire #${c.id}`}>Hire · {HELPER_WAGE} RF/day</button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Your team {closedStalls > 0 && <em className="li-warn">{closedStalls} stall{closedStalls > 1 ? "s" : ""} need staff</em>}</h4>
                {helpersRef.current.length === 0 && <p className="li-note">Every extra stall needs a Friend to run it. Wages go <b>straight into their wallet</b>.</p>}
                <ul className="li-staff">
                  {helpersRef.current.map(h => {
                    const at = island.stalls.find(x => x.operator === h);
                    return (
                      <li key={h.id}>
                        <img src={avatar(`f${h.id}`, h.frames[0])} alt="" className="li-av" />
                        <span>#{h.id} <small>{at ? (at.kind === "bar" ? "Juice Bar" : at.kind === "cart" ? "Pop Cart" : "Stand") : "idle"}</small></span>
                        <button type="button" onClick={() => fire(h)} aria-label={`Let #${h.id} go`}>×</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
          {sheet === "economy" && (
            <div className="li-sheet-body li-cols">
              <div className="li-flow">
                <div className="in"><span>Customers paid you</span><strong>+{fmtRf(t.sales)}</strong></div>
                <div><span>Lemons → burned <Px name="flame" size={12} /></span><strong>{fmtRf(t.lemons / 2n)}</strong></div>
                <div><span>Lemons → farmer Friends</span><strong>{fmtRf(t.lemons - t.lemons / 2n)}</strong></div>
                <div><span>Building → burned <Px name="flame" size={12} /></span><strong>{fmtRf(t.builds / 2n)}</strong></div>
                <div><span>Building → Friend rewards</span><strong>{fmtRf(t.builds - t.builds / 2n)}</strong></div>
                <div><span>Wages → helper wallets</span><strong>{fmtRf(t.wages)}</strong></div>
                <div className="tot"><span>Total burned</span><strong><Px name="flame" size={14} />{fmtRf(t.burned)} RF</strong></div>
              </div>
              <div>
                <h4>Richest islands</h4>
                <ol className="li-board">
                  {board.map((b, i) => (
                    <li key={b.name} className={b.me ? "me" : ""}>
                      <span className="pos">{i + 1}</span>
                      {b.rows ? <img src={avatar(b.me ? "me" : b.name, b.rows)} alt="" className="li-av" /> : <span className="li-av" />}
                      <span className="nm">{b.name}</span>
                      <span className="v">{Math.round(b.value)}</span>
                    </li>
                  ))}
                </ol>
                <p className="li-note">{t.cups} cups sold · {t.spoiled} lemons rotted · rivals simulated · demo RF</p>
              </div>
            </div>
          )}
        </div>
      )}

      <nav className="li-bar" aria-label="Actions">
        {hint && <p className={cls("li-hint", hintWarn && "warn")} role="status">{hint}</p>}
        <button type="button" className={cls("li-btn", "li-btn-lemon", sheet === "lemons" && "on", attn === "lemons" && "li-attn")} onClick={() => toggle("lemons")} aria-label="Lemon market">
          <Px name="lemon" size={24} /><b>{Math.floor(ledger.lemons)}</b><small>{g.market.toFixed(2)} each</small>
        </button>
        <div className={cls("li-pricebox", `li-price-${priceState}`, attn === "price" && "li-attn")} aria-label="Cup price">
          <button type="button" aria-label="Lower price" onClick={() => nudgePrice(-0.1)}>−</button>
          <div><small>CUP PRICE</small><b>{g.price.toFixed(2)}</b><em>{priceState === "high" ? `too high · ~${typical.toFixed(2)}` : priceState === "low" ? "cheap · raise it" : "good price ✓"}</em></div>
          <button type="button" aria-label="Raise price" onClick={() => nudgePrice(0.1)}>+</button>
        </div>
        <button type="button" className={cls("li-go", `li-go-${g.phase}`, attn === "go" && "li-attn")} onClick={primary} disabled={paused || g.phase === "open"}>
          <small>{g.phase === "evening" ? <>Tomorrow <Px name={WEATHER_ICON[g.forecast]} size={14} /> {fc.label}</> : <><Px name={WEATHER_ICON[g.weather]} size={14} /> {g.phase === "open" ? "Selling…" : w.label}</>}</small>
          <span>{g.phase === "morning" ? <>OPEN <Px name="play" size={16} /></> : g.phase === "open" ? clockText() : <>NEXT DAY <Px name="ffwd" size={16} /></>}</span>
          {g.phase !== "open" && <kbd aria-hidden="true">SPACE</kbd>}
        </button>
        <button type="button" className={cls("li-btn", sheet === "build" && "on")} onClick={() => toggle("build")}><Px name="stand" size={22} /><b>Build</b></button>
        <button type="button" className={cls("li-btn", sheet === "staff" && "on", attn === "staff" && "li-attn")} onClick={() => toggle("staff")}><Px name="people" size={22} /><b>Staff</b>{closedStalls > 0 && <em className="li-badge">{closedStalls}</em>}</button>
        <button type="button" className={cls("li-btn", sheet === "economy" && "on")} onClick={() => toggle("economy")}><Px name="chart" size={22} /><b>Economy</b></button>
      </nav>
    </section>
  );
}
