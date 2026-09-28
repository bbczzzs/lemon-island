// Interaction test for Lemon Island in the SDK's automated harness (mock
// wallet + sample Friend #7730): buy lemons, set a price, run a day, read the
// report, build a stall, hire a Friend, check the economy and the next morning.
//   node test-interaction.mjs [width]
import { testGame } from "@rarefriends/friendsdk/testing";

const width = Number(process.argv[2] || 960);
const num = s => Number(s.replace(/[^0-9.]/g, ""));

await testGame("./games/lemon", {
  width,
  screenshot: `./artifacts/lemon-${width}.png`,
  check: async ({ page, game }) => {
    const money = game.locator(".li-moneypill strong");
    await money.waitFor({ timeout: 30000 });
    await game.getByRole("button", { name: "Let's go" }).click();

    // Buy 50 lemons: the balance falls by the quoted cost.
    const before = num(await money.innerText());
    const buy = game.getByRole("button", { name: /\+50/ });
    const quote = num(await buy.locator("span").innerText());
    await buy.click();
    const after = num(await money.innerText());
    if (Math.abs(before - quote - after) > 0.02) throw new Error(`lemon cost mismatch: ${before} - ${quote} != ${after}`);
    await game.getByRole("button", { name: "Close" }).click();

    // Price control.
    await game.getByRole("button", { name: "Raise price" }).click();
    await game.getByText("0.90", { exact: true }).waitFor();
    await game.getByRole("button", { name: "Lower price" }).click();

    // Open the day, pause/resume via the runtime menu, then sell until evening.
    await game.getByRole("button", { name: /OPEN/ }).click();
    await game.getByText("SOLD", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Open Friend wallet" }).click();
    await game.locator('section[aria-busy="true"]').waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await game.locator('section[aria-busy="false"]').waitFor({ timeout: 5000 });
    await game.getByText(/Day 1 report/i).waitFor({ timeout: 60000 });
    const sold = num(await game.locator(".li-report dl div").first().locator("dd").innerText());
    if (!(sold > 0)) throw new Error("no cups sold on day 1");

    // Build a stand (needs staff), hire a Friend to run it.
    await game.locator(".li-bar .li-btn", { hasText: "Build" }).click();
    await game.getByRole("button", { name: /Build Lemon Stand/ }).click();
    await game.getByText("Looking for work").waitFor({ timeout: 3000 });
    await game.getByRole("button", { name: /^Hire #/ }).first().click();
    await game.getByText(/now runs your stand/).waitFor({ timeout: 3000 });

    // Economy sheet shows the burn split.
    await game.locator(".li-bar .li-btn", { hasText: "Economy" }).click();
    await game.getByText("Lemons → farmer Friends").waitFor();
    await game.getByText("Richest islands").waitFor();
    await game.getByRole("button", { name: "Close" }).click();

    // Next morning.
    await game.getByRole("button", { name: /NEXT DAY/ }).click();
    await game.getByText("DAY 2").waitFor({ timeout: 3000 });
    await game.getByRole("button", { name: "Sound on" }).click();
  },
});

console.log(`INTERACTION PASS at ${width}px: lemons, price, a full day, report, build, hire, economy, next day`);
