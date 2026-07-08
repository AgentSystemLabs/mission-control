# Screen Recording permission on locally-built macOS apps

The native screenshot capture (`⌘⇧S` / toolbar camera → `captureScreenshotRegion`
in `electron/main.ts`) shells out to the macOS `screencapture` CLI, which
requires the **Screen Recording** permission (TCC).

## Symptom

In `pnpm dev` the capture works. But a locally-built app (`pnpm dist:mac`,
DMG dragged into `/Applications`) keeps re-showing the macOS
"…would like to record this computer's screen" prompt on **every launch**,
even after you enable it in
**System Settings → Privacy & Security → Screen Recording**.

## Cause

macOS keys the Screen Recording grant to a **valid, stable code-signing
identity** and reads it once, at process launch.

Without a Developer ID certificate in the keychain, electron-builder falls
back to **ad-hoc signing**. On some machines the resulting bundle has a
*broken* seal — you can confirm with:

```bash
codesign -dv --verbose=2 /Applications/MissionControl.app
# Identifier=Electron            <- should be labs.agentsystem.missioncontrol
# Signature=adhoc, TeamIdentifier=not set
codesign --verify --deep --strict /Applications/MissionControl.app
# "code has no resources but signature indicates they must be present"  <- broken
```

Because the signature is invalid, macOS can't validate the app's identity and
**refuses to persist the grant**, so it re-prompts forever. (Dev works because
the prebuilt Electron binary in `node_modules` is ad-hoc but has a *valid*,
stable seal, so its grant sticks.)

## Fix (local machine only)

Re-sign the installed bundle with a valid ad-hoc + hardened-runtime seal and
clear the stale grant:

```bash
node scripts/resign-local-macos.mjs
# or point it at a specific bundle:
# node scripts/resign-local-macos.mjs /path/to/MissionControl.app
```

The script runs:

```bash
codesign --force --deep --options runtime \
  --entitlements build/entitlements.mac.plist \
  --sign - /Applications/MissionControl.app
codesign --verify --deep --strict /Applications/MissionControl.app   # now silent
tccutil reset ScreenCapture labs.agentsystem.missioncontrol
```

Then **fully quit** MissionControl (`⌘Q` — closing the window is not enough),
relaunch, trigger a capture, and grant Screen Recording once. It will persist.

This holds **until the next `pnpm dist:mac`** — a rebuild produces a new cdhash
that invalidates the grant, so re-run the script after each rebuild.

## The real fix (for distribution)

The workaround is local only — anyone else installing the DMG hits the same
broken-signature wall. For a build that works on other Macs, sign with a
**Developer ID Application** certificate and **notarize**. The `mac` block in
`package.json` (`hardenedRuntime`, `entitlements`, `notarize: true`) is already
wired for this; you just need the certificate in the keychain and notarization
credentials (`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`).
