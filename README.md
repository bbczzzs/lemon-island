# Lemon Island Tycoon 🍋

**Your Rare Friend opens a lemonade stand on a sunny beach island and grows it into a juice empire, in a living economy where lemon prices move with demand, RF circulates between real Friends, and every build burns RF.**

Rare Friends Vibeathon · **Economy Potential** · FriendSDK **v0.1.4**

![Lemon Island gameplay](media/lemon-demo.gif)

🎮 **Play:** https://bbczzzs.github.io/lemon-island/ requires a browser wallet on Robinhood mainnet (4663) holding a hardwired Rare Friends Generations NFT (gen ≥ 1), the SDK's standard gate. All RF is **simulated demo RF**.
👀 **No wallet? Preview page:** https://bbczzzs.github.io/lemon-island/preview/ (GIF, video, screens, economy)
📈 **[Economy report](ECONOMY.md):** 30-day simulation of four play styles × 25 seeds, run on the game's own code (`npm run economy`)
🎬 [Full recording (MP4)](media/lemon-demo.mp4)

| Morning market | Selling day | Evening report | Build your empire |
|---|---|---|---|
| ![Market](media/market.png) | ![Day](media/day.png) | ![Report](media/report.png) | ![Build](media/build.png) |

## In one minute
- **Buy lemons** on a shared market (the price rises as players buy), **set your cup price** for the weather, **open**. Real Rare Friends arrive by ferry and decide whether your lemonade is worth it.
- **Grow:** more stands, an Ice Pop Cart, a Juice Bar, umbrellas, big jugs, a neon sign, a lemon grove, a tour balloon.
- **Hire real Friends** to run extra stalls; their wages go into their own wallets.
- **Island events** shake up the day: a cruise ship full of tourists in sun hats (they pay 30% more), a lemon shortage, a rival stand's price war, a food critic. **8 goals** with trophies give every run a shape.
- **RF flows:** lemons are 50% burned and 50% paid to farmer Friends; builds are 50% burned and 50% to Friend rewards; a quarter of unsold lemons rot overnight.
- Weather matters: heatwaves, rain, and a Festival every 7th day.
- **Paired with the real $RAREFRIENDS token:** the Economy sheet reads the live RF supply from Robinhood chain (one read-only `totalSupply()` call, on demand) and shows what 100, 1K or 10K steady players would burn, as a share of it (10K players ≈ 7.5% a year).
- **Proven in simulation:** a steady player burns ~591 RF and pays ~723 RF to other Friends in 30 days; overcharging sells 60% fewer cups; builders overtake savers around day 36 and end day 60 2.2× richer. See [ECONOMY.md](ECONOMY.md).

Full rules, economy and checks: [`games/lemon/README.md`](games/lemon/README.md).

## Develop
```sh
npm install
npx friendsdk dev games/lemon                    # local preview (real wallet gate)
npx friendsdk build games/lemon --outdir dist    # static build
npm run typecheck
npm run economy                                  # regenerates ECONOMY.md from the game's own sim
node test-interaction.mjs 960                    # needs: npx playwright install chromium
```

The repo root (`index.html`, `game.*`, `runtime.*`, `assets/`) is the built static preview served by GitHub Pages; `preview/` is the no-wallet landing page.

All art is drawn in code, all audio is synthesized, and Friend sprites are canonical Rare Friends artwork via FriendSDK. Fonts: Silkscreen, Sometype Mono, Archivo (SIL OFL).
