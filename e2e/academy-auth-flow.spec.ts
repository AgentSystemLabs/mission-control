import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const missionControlOrigin = process.env.MC_E2E_URL ?? "http://127.0.0.1:4181";
const academyOrigin = process.env.ACADEMY_E2E_URL ?? "http://127.0.0.1:3001";

function readAcademyEnvValue(name: string): string | null {
  try {
    const envFile = readFileSync(resolve(process.cwd(), "../academy/.env"), "utf8");
    const line = envFile
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : null;
  } catch {
    return null;
  }
}

const academyPostgresPort =
  process.env.ACADEMY_E2E_POSTGRES_PORT ??
  readAcademyEnvValue("POSTGRES_PORT") ??
  "5432";
const academyDbUrl =
  process.env.ACADEMY_E2E_DATABASE_URL ??
  `postgresql://postgres:example@localhost:${academyPostgresPort}/agentsystem_test`;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createAcademyPasswordUser(
  request: APIRequestContext,
  input: { email: string; name: string; password: string },
) {
  const response = await request.post(`${academyOrigin}/api/auth/sign-up/email`, {
    data: {
      callbackURL: "/",
      email: input.email,
      name: input.name,
      password: input.password,
    },
    headers: {
      origin: academyOrigin,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function grantMissionControlHostedAccess(input: {
  email: string;
  name: string;
  stripeSessionId: string;
}) {
  const pool = new pg.Pool({ connectionString: academyDbUrl });
  try {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO "app_user" ("email", "emailVerified", "name", "image", "isPremium", "isAdmin", "isEarlyAccess")
        VALUES ($1, now(), $2, NULL, false, false, false)
        ON CONFLICT ("email") DO UPDATE
        SET "emailVerified" = COALESCE("app_user"."emailVerified", EXCLUDED."emailVerified"),
          "name" = EXCLUDED."name"
        RETURNING "id"`,
      [input.email, input.name],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error("failed to provision Academy app user");

    await pool.query(
      `INSERT INTO "app_purchase" (
          "userId", "stripeSessionId", "stripePaymentIntentId", "amountSubtotal",
          "amountTotal", "amountDiscount", "currency", "customerEmail",
          "productName", "tier", "purchased_at"
        )
        VALUES ($1, $2, NULL, 49900, 49900, 0, 'usd', $3, 'Full System', 'full_system', now())
        ON CONFLICT ("stripeSessionId") DO NOTHING`,
      [userId, input.stripeSessionId, input.email],
    );
  } finally {
    await pool.end();
  }
}

test("redirects to Academy login and returns to Mission Control after Academy sign in", async ({
  page,
  request,
}) => {
  const info = test.info();
  const unique = `${Date.now()}-${info.workerIndex}-${info.repeatEachIndex}-${info.retry}`;
  const email = `mc-academy-${unique}@example.com`;
  const password = "MissionControl123!";
  const name = "Mission Control E2E";

  await createAcademyPasswordUser(request, { email, name, password });
  await grantMissionControlHostedAccess({
    email,
    name,
    stripeSessionId: `cs_test_mc_academy_${unique}`,
  });

  await page.goto(missionControlOrigin);
  await expect(
    page.getByRole("heading", { name: "Sign in to Mission Control" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue with Academy" }).click();

  await expect(page).toHaveURL(
    new RegExp(`^${escapeRegex(academyOrigin)}/login\\?`),
  );
  await expect(page).toHaveURL(/redirect_uri=%2Fapi%2Fmission-control%2Fauthorize/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
    "href",
    /redirect_uri=%2Fapi%2Fmission-control%2Fauthorize/,
  );
  await page.waitForLoadState("networkidle");

  const signInPanel = page.getByRole("tabpanel", { name: "Sign in" });
  await signInPanel.getByLabel("Email").fill(email);
  await signInPanel.getByLabel("Password").fill(password);
  await signInPanel.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(new RegExp(`^${escapeRegex(missionControlOrigin)}/?$`), {
    timeout: 20_000,
  });
  await expect(page.getByText("Welcome back, Commander")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to Mission Control" }),
  ).toBeHidden();
});
