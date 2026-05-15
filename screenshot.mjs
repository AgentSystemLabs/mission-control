// Capture Mission Control routes via puppeteer. Usage:
//   node screenshot.mjs <label>   -> writes <label>-<route>.png for each route
//
// Routes: / (dashboard), /projects/<id> (project), plus zoomed crops on a card
// to verify minimal-mode card texture rendering.
import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "baseline";
const outDir = "/tmp/mc-design-iter";
mkdirSync(outDir, { recursive: true });

const BASE = "http://127.0.0.1:5173";
const PROJECT_ID = "p-mof8fixc-3069f7"; // Academy

const browser = await puppeteer.launch({
  headless: "new",
  defaultViewport: { width: 1380, height: 880, deviceScaleFactor: 2 },
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox"],
});

async function shot(page, url, name, waitFor) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-minimal") === "true",
    { timeout: 5000 }
  ).catch(() => {});
  if (waitFor) {
    await page.waitForSelector(waitFor, { timeout: 5000 }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 700));
  const file = path.join(outDir, `${label}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`saved ${file}`);
}

async function cardCloseup(page, name, index = 0) {
  const cards = await page.$$(".mc-card-frame");
  const card = cards[index];
  if (!card) {
    console.log(`no card[${index}] found for ${name} (count=${cards.length})`);
    return;
  }
  const file = path.join(outDir, `${label}-${name}.png`);
  await card.screenshot({ path: file });
  console.log(`saved ${file} (card index=${index} of ${cards.length})`);
}

const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(m.text())) {
    console.error("CONSOLE", m.text());
  }
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
// Pre-seed only the minimal flag; let React hydrate the real accent from
// settings (don't pin the screenshot script to a specific theme color).
await page.evaluate(() => {
  localStorage.setItem("mc:minimal", "1");
});

await shot(page, "/", "dashboard", ".mc-dashboard-frame");
// dashboard: ProjectCard is what we care about (skip the leading panel card)
for (const i of [0, 1, 2, 3, 4]) {
  await cardCloseup(page, `dashboard-card${i}`, i);
}
await shot(page, `/projects/${PROJECT_ID}`, "project", "[data-task-column]");
for (const i of [0, 1, 2, 3]) {
  await cardCloseup(page, `project-card${i}`, i);
}

await browser.close();
console.log("done");
