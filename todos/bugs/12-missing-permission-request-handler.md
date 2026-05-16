# [HIGH] No `setPermissionRequestHandler` — renderer can grant itself camera, mic, geolocation, notifications

**Files:** `electron/main.ts:131-148` (BrowserWindow + session setup)
**Category:** Missing privilege gate
**Severity:** High

## What's wrong

No `session.setPermissionRequestHandler` or `setPermissionCheckHandler` is installed anywhere in `electron/main.ts`. The window loads `http://127.0.0.1:5173` (dev) or `http://127.0.0.1:<runtimePort>` (prod). For HTTP origins Electron's defaults permit several powerful permissions without an explicit handler (`notifications`, `midi`, `pointerLock`); for others (`media`, `geolocation`), Electron surfaces a request to the missing handler which on some platforms defaults to allow.

## Why fixing this is important — what could go wrong

A compromised renderer (finding 04) can silently:

- Activate camera + microphone (`navigator.mediaDevices.getUserMedia`) and exfiltrate A/V to an attacker host
- Read coarse / precise geolocation (`navigator.geolocation`)
- Acquire persistent `Notification` permission for phishing prompts
- Use `pointerLock` to obscure cursor-jacking

The user has no per-origin UI prompt because this isn't a web browser — the renderer is implicitly trusted.

## How to fix it

In `electron/main.ts`, inside `app.whenReady()` (after the session is available, before the window loads anything):

```ts
const ses = session.defaultSession;

ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
  callback(false);                           // deny everything by default
});

ses.setPermissionCheckHandler(() => false);  // deny synchronous checks too
```

If a specific permission becomes needed later (e.g. clipboard-read, notifications for build-complete pings), allow-list it explicitly inside the handler — never broadly. Combine with finding 04 so even an allowed permission can't be requested from a non-app frame.
