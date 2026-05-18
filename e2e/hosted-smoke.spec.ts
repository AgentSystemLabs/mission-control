import { expect, test } from "@playwright/test";

test("serves the hosted health endpoint", async ({ request }) => {
  const res = await request.get("/api/healthz");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: true,
    status: "ok",
    checks: {
      api: "ok",
      database: "disabled",
    },
  });
  expect(body.uptimeSeconds).toEqual(expect.any(Number));
});

test("rejects protected API routes without a hosted session or bearer token", async ({ request }) => {
  const res = await request.get("/api/projects");
  expect(res.status()).toBe(401);
  await expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("exposes the Academy sign-in handoff for hosted browser login", async ({ request }) => {
  const res = await request.get("/api/academy-auth/login", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = res.headers()["location"];
  expect(location).toContain("/api/mission-control/authorize");
  expect(location).toContain("redirect_uri=");
  expect(location).toContain("state=");
});

test("denies remote runtime creation without hosted auth and entitlement", async ({ request }) => {
  const res = await request.post("/api/remote-pty", {
    data: { projectId: "hp-1", cwd: "/home/workspace", command: "pwd" },
  });
  expect(res.status()).toBe(401);
  await expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("serves static assets from the production web build", async ({ page }) => {
  const res = await page.goto("/card.png");
  expect(res?.ok()).toBe(true);
  expect(res?.headers()["content-type"]).toContain("image/png");
});
