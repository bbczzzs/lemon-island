"use client";

import { useEffect, useRef, useState } from "react";
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
    price: 0.4, market: BASE_LEMON, boughtToday: 0, reputation: 0.2, marketHistory: [BASE_LEMON] as number[],
    grove: 0,
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
  const rerender = () => setTick(t => (t + 1) % 1_000_000);

  function toast(text: string, kind: Toast["kind"] = "info") {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-1), { id, text, kind }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
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
      else if (e.key === "[") nudgePrice(-0.05);
      else if (e.key === "]") nudgePrice(0.05);
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
      if (e.type === "sale") { g.reputation = Math.min(1, g.reputation + 0.003); sceneRef.current?.sale(e.stall); audioRef.current?.coin(); }
      else if (e.type === "pricey") g.reputation = Math.max(0, g.reputation - 0.0015);
      else g.reputation = Math.max(0, g.reputation - 0.003);
    }
    if (g.phase === "open") {
      g.t += dt;
      if (g.t >= DAY_SECONDS) endDay();
    }
  }

  function openDay() {
    const g = game.current;
    if (g.phase !== "morning") return;
    setShowIntro(false);
    setSheet(null);
    if (ledgerRef.current.lemons < 0.25) toast("No lemons! Buy some at the market first.", "bad");
    g.phase = "open";
    g.t = 0;
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
    if (upgradesRef.current.has("farm")) { ledgerRef.current.lemons += 12; toast("The grove grew 12 lemons 🍋", "good"); }
    if (g.weather === "festival") toast("🎉 Festival day! Crowds are coming.", "good");
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
    g.price = Math.max(0.1, Math.min(1.5, Math.round((g.price + d) * 100) / 100));
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
  const typical = 0.5 * (g.weather === "rain" && upgradesRef.current.has("umbrella") ? 0.9 : w.pay) * 1.02 * (1 + g.reputation * 0.3);
  const buildValue = BUILDS.reduce((a, b) => a + owned(b.id) * b.cost, 0) + 40;
  const islandValue = toRf(ledger.balance) + buildValue * 0.5 + ledger.lemons * g.market;
  const board = [{ name: "You", value: islandValue, rows: pilot?.frames[0], me: true },
    ...rivalsRef.current.map(r => ({ name: `#${r.friend.id}`, value: r.value, rows: r.friend.frames[0], me: false }))]
    .sort((a, b) => b.value - a.value);
  const closedStalls = island.stalls.filter(s => !s.operator).length;
  const hist = g.marketHistory;
  const hMax = Math.max(...hist, 0.8), hMin = Math.min(...hist, 0.3);
  const t = ledger.total;

  let primaryLabel = "";
  if (g.phase === "morning") primaryLabel = "Open for business";
  else if (g.phase === "evening") primaryLabel = `Start day ${g.day + 1}`;

  const toggle = (x: Sheet) => { setSheet(v => (v === x ? null : x)); audioRef.current?.tick(560); };
  const sheetTitle = sheet === "lemons" ? "Lemon market" : sheet === "build" ? "Build your empire" : sheet === "staff" ? "Hire Friends" : "Island economy";

  return (
    <section className={`li-root${reduced ? " li-reduced" : ""}`} aria-label="Lemon Island Tycoon" aria-busy={paused}>
      <canvas ref={canvasRef} className="li-canvas" />

      <header className="li-hud">
        <div className="li-hud-l">
          <div className="li-pill li-brandpill"><span className="li-logo" aria-hidden="true" /><strong>LEMON ISLAND</strong><span className="li-demo">DEMO RF</span></div>
          <div className="li-pill li-daypill"><b>DAY {g.day}</b><span>{w.icon} {w.label}</span><span ref={clockRef} className="li-clock">9:00</span></div>
        </div>
        <div className="li-hud-r">
          <div className="li-pill li-burnpill" title="RF your island burned this session (simulated)"><span className="li-flame" aria-hidden="true" /><strong>{fmtRf(t.burned)}</strong><span>burned</span></div>
          <div className="li-pill li-moneypill"><span>RF</span><strong>{fmtRf(ledger.balance)}</strong></div>
          <button type="button" className="li-pill li-iconbtn" aria-pressed={!muted} aria-label={muted ? "Sound on" : "Sound off"} onClick={toggleMute}>{muted ? "🔇" : "🔊"}</button>
          <button type="button" className="li-pill li-iconbtn" aria-pressed={reduced} aria-label="Reduce motion" onClick={() => { const n = !reduced; setReduced(n); sceneRef.current?.setReducedMotion(n); }}>{reduced ? "◐" : "◑"}</button>
        </div>
      </header>

      {g.phase === "open" && (
        <div className="li-live" role="status">
          <div><span>SOLD</span><strong>{ledger.today.cups}</strong></div>
          <div><span>EARNED</span><strong>{fmtRf(ledger.today.sales)}</strong></div>
          <div><span>CUPS LEFT</span><strong className={cups < 5 ? "low" : ""}>{cups}</strong></div>
          <i className="li-daybar" aria-hidden="true"><b style={{ width: `${(g.t / DAY_SECONDS) * 100}%` }} /></i>
        </div>
      )}

      <div className="li-toasts" aria-live="polite">{toasts.map(x => <div key={x.id} className={`li-toast li-toast-${x.kind}`}>{x.text}</div>)}</div>

      {showIntro && g.phase === "morning" && !sheet && (
        <div className="li-intro" role="dialog" aria-label="How to play">
          <strong>Welcome to Lemon Island!</strong>
          <ol>
            <li><b>🍋 Lemons</b>: buy them at the market. 1 lemon = 4 cups.</li>
            <li><b>Price</b>: pick what a cup costs. Hot days pay more.</li>
            <li><b>Open</b>: Friends arrive by ferry. Grow from one stand to an empire.</li>
          </ol>
          <button type="button" onClick={() => { setShowIntro(false); setSheet("lemons"); }}>Let's go</button>
        </div>
      )}

      {report && g.phase === "evening" && !sheet && (
        <div className="li-report" role="status">
          <div className="li-report-bar"><span>Day {report.day} report</span><span>Tomorrow {fc.icon} {fc.label}</span></div>
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
        <div className="li-sheet" role="dialog" aria-label={sheetTitle}>
          <div className="li-sheet-bar"><strong>{sheetTitle}</strong><button type="button" aria-label="Close" onClick={() => setSheet(null)}>×</button></div>
          {sheet === "lemons" && (
            <div className="li-sheet-body li-lemons">
              <div className="li-market">
                <div><small>TODAY</small><strong>{g.market.toFixed(2)}</strong><span>RF / lemon · {g.market > BASE_LEMON * 1.1 ? "▲ pricey" : g.market < BASE_LEMON * 0.9 ? "▼ cheap" : "calm"}</span></div>
                <svg viewBox="0 0 120 34" className="li-spark" aria-hidden="true">
                  <polyline fill="none" stroke="#111" strokeWidth="2" points={hist.map((v, i) => `${(i / Math.max(1, hist.length - 1)) * 116 + 2},${32 - ((v - hMin) / Math.max(0.01, hMax - hMin)) * 30}`).join(" ")} />
                </svg>
              </div>
              <div className="li-buy">
                {[10, 25, 50].map(q => {
                  const quote = quoteLemons(g.market, g.boughtToday, q);
                  return <button key={q} type="button" onClick={() => buyLemons(q)} disabled={g.phase === "evening" || paused}><b>+{q} 🍋</b><span>{fmtRf(quote.cost)} RF</span></button>;
                })}
              </div>
              <p className="li-note">Tip: each stall sells up to <b>~{Math.round(48 * (upgradesRef.current.has("jug") ? 1.4 : 1))} cups a day</b> (≈{Math.round(12 * (upgradesRef.current.has("jug") ? 1.4 : 1))} lemons). You have <b>{Math.floor(ledger.lemons)} lemons</b> ({cups} cups). Buying pushes the price up for everyone; ¼ of leftovers rot overnight. Lemon RF: <b>50% burned</b>, 50% to the farmer Friends.</p>
            </div>
          )}
          {sheet === "build" && (
            <div className="li-sheet-body">
              <ul className="li-builds">
                {BUILDS.map(b => {
                  const have = owned(b.id);
                  const maxed = have >= b.max;
                  return (
                    <li key={b.id} className={maxed ? "maxed" : ""}>
                      <strong>{b.name}{b.max > 1 && <em> {have}/{b.max}</em>}</strong>
                      <span>{b.blurb}</span>
                      <button type="button" disabled={maxed || paused} onClick={() => build(b.id)} aria-label={`Build ${b.name} for ${b.cost} RF`}>{maxed ? "Built ✓" : `${b.cost} RF`}</button>
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
                <div><span>Lemons → 🔥 burned</span><strong>{fmtRf(t.lemons / 2n)}</strong></div>
                <div><span>Lemons → farmer Friends</span><strong>{fmtRf(t.lemons - t.lemons / 2n)}</strong></div>
                <div><span>Building → 🔥 burned</span><strong>{fmtRf(t.builds / 2n)}</strong></div>
                <div><span>Building → Friend rewards</span><strong>{fmtRf(t.builds - t.builds / 2n)}</strong></div>
                <div><span>Wages → helper wallets</span><strong>{fmtRf(t.wages)}</strong></div>
                <div className="tot"><span>Total burned</span><strong>{fmtRf(t.burned)} RF</strong></div>
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
        <button type="button" className={`li-btn${sheet === "lemons" ? " on" : ""}`} onClick={() => toggle("lemons")} aria-label="Lemon market">
          <i>🍋</i><b>{Math.floor(ledger.lemons)}</b><small>{g.market.toFixed(2)} RF</small>
        </button>
        <div className="li-pricebox" aria-label="Cup price">
          <button type="button" aria-label="Lower price" onClick={() => nudgePrice(-0.05)}>−</button>
          <div><small>CUP PRICE</small><b>{g.price.toFixed(2)}</b><em>pay ~{typical.toFixed(2)}</em></div>
          <button type="button" aria-label="Raise price" onClick={() => nudgePrice(0.05)}>+</button>
        </div>
        <button type="button" className={`li-go li-go-${g.phase}`} onClick={primary} disabled={paused || g.phase === "open"}>
          <small>{g.phase === "morning" ? `${w.icon} ${w.label}` : g.phase === "open" ? "Selling…" : `${fc.icon} Tomorrow`}</small>
          <span>{g.phase === "morning" ? "OPEN ▶" : g.phase === "open" ? clockText() : "NEXT DAY ▶"}</span>
        </button>
        <button type="button" className={`li-btn${sheet === "build" ? " on" : ""}`} onClick={() => toggle("build")}><i>🏗</i><b>Build</b></button>
        <button type="button" className={`li-btn${sheet === "staff" ? " on" : ""}`} onClick={() => toggle("staff")}><i>👥</i><b>Staff</b>{closedStalls > 0 && <em className="li-badge">{closedStalls}</em>}</button>
        <button type="button" className={`li-btn${sheet === "economy" ? " on" : ""}`} onClick={() => toggle("economy")}><i>📊</i><b>Economy</b></button>
      </nav>
    </section>
  );
}
