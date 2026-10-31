# Codex Ringside

English · [简体中文](README.zh-CN.md)

Usage rings and customizable backgrounds for the Codex desktop sidebar on macOS.

See your remaining allowance at a glance, hover for reset times, and click a ring to configure a wallpaper, image or glass background. Image controls include cropping, positioning, zoom, blur and color adjustments.

**Unofficial community add-on. Not affiliated with or endorsed by OpenAI.** Parts are adapted from [Codex Usage Card](https://github.com/Lorie7813/codex-usage-card); see [NOTICE](NOTICE).

![Usage ring and background settings](https://raw.githubusercontent.com/tccpc/codex-ringside/main/docs/images/background-settings.png)

## Install

Requirements: macOS, Node.js 22+, Xcode Command Line Tools (`xcode-select --install`), and a signed-in compatible desktop client. The development host is `/Applications/ChatGPT.app`, version `26.1027.30824`, on Apple Silicon. Other host versions depend on compatible internal interfaces and are not individually verified. The CLI and settings panel currently use Chinese labels.

### Option 1: Ask an AI assistant

Copy the prompt below into an AI assistant that can run commands on your Mac. The assistant can check prerequisites, install Ringside and verify the result. Complete any macOS authorization or host sign-in prompts yourself when needed.

```text
Please install Codex Ringside on my Mac: https://github.com/tccpc/codex-ringside

Read the repository's README first and briefly explain what will be installed, including the local debug port.
Check macOS, Node.js 22+, Xcode Command Line Tools and a compatible signed-in desktop client.
If this is not macOS, explain that it is unsupported and stop.
Help resolve missing prerequisites, and tell me when a system dialog needs my input.

Install from the official npm registry:
npx --yes --registry=https://registry.npmjs.org/ codex-ringside@latest install

Preserve existing Ringside or Codex Plus settings.
If the compatible desktop app is outside the default location, use CODEX_RINGSIDE_APP to specify the detected path.

After installation, run:
npx --yes --registry=https://registry.npmjs.org/ codex-ringside@latest status

Report whether the background agent is running and the usage ring is placed, then give me the uninstall command.
If the ring is not visible yet, explain the status and tell me to save my work and reopen the client manually.
Do not close or force-quit the client I am using.
```

### Option 2: Install from the terminal

```bash
npx codex-ringside@latest install
```

If rings do not appear, save your work, quit the desktop app with ⌘Q, and reopen its original icon. The add-on may reopen a freshly launched client once, subject to the safeguards below.

Observe mode installs the agent without allowing it to restart the desktop client:

```bash
npx codex-ringside@latest install --observe
```

You can also use `npm install -g codex-ringside`, then `codex-ringside install`. Downloading the npm package alone never installs or starts the agent: there are no install lifecycle hooks. No `sudo` is needed with npx.

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/CodexRingside` | Runtime, locally compiled bridge, settings and state |
| `~/Library/LaunchAgents/com.codexringside.agent.plist` | Background agent |
| `~/Library/Logs/CodexRingside` | Agent logs |
| `~/Library/Application Support/CodexRingside Backups` | Local installation/migration backups |

The installed runtime is independent of the checkout. For a custom application path:

```bash
CODEX_RINGSIDE_APP="/Applications/ChatGPT.app" npx codex-ringside@latest install
```

Resolution order: `CODEX_RINGSIDE_APP`, legacy `CODEX_PLUS_APP`, saved path, then `/Applications/ChatGPT.app`.

## Upgrade and migrate from Codex Plus

Run `npx codex-ringside@latest install` again. Existing Ringside settings take precedence. First migration preserves the old application path, observe mode, background settings and images, then retires `com.codexplus.agent`.

The helper is compiled in a staging directory before services are stopped. Files are backed up before replacement; if the new watcher fails to become ready, the installer restores previous files and service state. A lock prevents overlapping install/uninstall operations. Installation itself does not restart an existing desktop session.

Backups remain in `CodexRingside Backups/install-*`. `receipt.json` records original paths and service states; `0` contains the previous Ringside installation and `1` the previous Codex Plus installation. Backups can contain private paths and images. Keep them local and remove them manually when satisfied with the upgrade. Uninstall preserves backups.

Reinstalling preserves observe mode; `install --observe` explicitly disables startup handoff. To re-enable it, unload the agent, set `allowClientRestart` to `true` in the installed `settings.json`, then run `install` again.

## Background controls

Click a ring to open settings. Panel changes apply immediately; CLI changes apply within five seconds.

| Source | Behavior |
| --- | --- |
| `default` | Original appearance |
| `image` | Chosen image, positioned within the window |
| `wallpaper` | Desktop wallpaper aligned with the screen |
| `glass` | Host system glass, with a blurred-wallpaper fallback |

Transparency and blur control the effect. Images support cover, contain, stretch, center and tile layouts; drag positioning, scroll-to-zoom, crop and color adjustments. A new image resets position, crop and color while keeping transparency and blur. If transparency would hide a newly chosen image, it returns to 45% unless explicitly overridden.

The appearance switch uses the host's own system/light/dark setting and synchronizes with its settings page. It is hidden when compatible internal functions cannot be found.

```bash
npx codex-ringside@latest background image ~/Pictures/photo.jpg --transparency 50 --blur 8
npx codex-ringside@latest background --layout contain --zoom 120 --y 20
npx codex-ringside@latest background --crop 10,0,80,60
npx codex-ringside@latest background default
```

Options without a source keep the current source. `background` without arguments prints the saved configuration. Crop values are left, top, width and height in percentages; `--crop none` clears the crop. `--help` lists flags and `--version` prints the version; both work without an installed host.

### Limitations

- Native glass depends on the host window state. In the tested host, unfocused, opaque or very large windows lose native glass; the glass source then uses blurred wallpaper. Ringside cannot change native window properties to produce clear transparency.
- Dynamic/aerial wallpapers may expose a different static image through macOS. Use a chosen image when an exact match matters.
- Wallpaper changes can take 60 seconds to refresh; alignment can briefly lag during window movement.
- Background cleanup uses host DOM heuristics. Terminals, code blocks, canvases and embedded web content are left alone; an unfamiliar page may retain opaque areas.
- Host updates can break rate-limit reading, placement or theme integration. Disable the background or uninstall if problems arise.

## Status and troubleshooting

```bash
npx codex-ringside@latest status
```

Look for `agent: "running"`, `cdp.windows[].card.placed`, and `cdp.windows[].background.applied`. `nativeGlass: false` means the host disables native glass. `startup.event` explains skipped handoffs. Status may contain private paths and window URLs; redact it before sharing.

If no ring appears, verify the signed-in host, application path, Node version, Command Line Tools and whether port 39222 is occupied. Installing while the host is open does not trigger a restart. Save your work and reopen its original icon when convenient. Check `~/Library/Logs/CodexRingside` for errors.

Missing or expired allowance data is shown as unavailable. Account switches reset the app-server connection. The number of rings follows the valid allowance windows returned for your account.

## Startup safeguards

Only a newly launched, single instance is considered: it must be in the foreground, at most eight seconds old, and have received no keyboard, click or scroll input since launch. Its command line must be known with no debug port, port 39222 must be free, and the previous attempt must be over 120 seconds old.

An app already running when the agent starts is never handed off. Only normal system `terminate()` is used: refusal or a ten-second exit timeout ends the attempt. User activity during handoff prevents focus stealing. Normal startup can take a few extra seconds and show the window reopening once.

## Uninstall

```bash
npx codex-ringside@latest uninstall
```

This removes current and legacy agents, moves runtime/settings/logs to the Trash and removes injected UI. Backups remain. The desktop application bundle is unchanged. The debug port remains active until that desktop process exits; the next ordinary launch has no Ringside debug flag.

## Security and privacy

Ringside starts the host's bundled `codex app-server`, reads `account/rateLimits/read` over stdio and refreshes every 60 seconds while a host window is connected. It injects UI through local Chrome DevTools Protocol port 39222 without modifying the signed app bundle.

**The debug endpoint has no authentication.** Local software can execute JavaScript in the desktop renderer through it. Never expose, forward or proxy port 39222. Use this add-on only where you trust the other local software.

Ringside does not read project files, chat content or the conversation database, and has no telemetry. It checks only the modification time of `auth.json`. The host CLI makes its own network requests. Wallpaper and chosen image processing is local; images/configuration are not uploaded. See [SECURITY.md](SECURITY.md).

## Development

```bash
git clone https://github.com/tccpc/codex-ringside.git
cd codex-ringside
npm ci --ignore-scripts
npm run verify
```

Verification runs syntax checks, unit tests and tests the actual packed CLI and Swift source. There are no runtime npm dependencies. CI covers Node.js 22/24/26 and compiles on Apple Silicon and Intel macOS. Full host compatibility requires a real signed-in client.

For the browser-only fixture, run `python3 -m http.server 4173 --bind 127.0.0.1` from the checkout and open `http://127.0.0.1:4173/test/fixtures/card.html`. It uses simulated data and gradient images.

See [CONTRIBUTING.md](CONTRIBUTING.md), [release guide](docs/RELEASING.md) and [changelog](CHANGELOG.md). Distributed under [MIT](LICENSE), with upstream notices in [NOTICE](NOTICE).
