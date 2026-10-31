# Codex Ringside

English · [简体中文](README.zh-CN.md)

Usage rings and customizable backgrounds for the Codex desktop sidebar on macOS.

See your remaining allowance at a glance, hover for reset times, and click a ring to configure a wallpaper, image or glass background. Image controls include cropping, positioning, zoom, blur and color adjustments.

**Unofficial community add-on. Not affiliated with or endorsed by OpenAI.** Parts are adapted from [Codex Usage Card](https://github.com/Lorie7813/codex-usage-card); see [NOTICE](NOTICE).

![Usage ring and background settings](https://raw.githubusercontent.com/tccpc/codex-ringside/main/docs/images/background-settings.png)

## Install

One-command installation requires **macOS 13+** (Apple Silicon or Intel) and a signed-in compatible desktop client. **You do not need Node.js, npm, Homebrew or Xcode Command Line Tools.** The release includes a private Node runtime and a precompiled helper. The development host is `/Applications/ChatGPT.app`, version `26.1027.30824`; other host versions depend on compatible internal interfaces. CLI and panel labels currently use Chinese.

### Option 1: One-command install (recommended)

Paste into Terminal:

```bash
curl -fsSL https://github.com/tccpc/codex-ringside/releases/latest/download/install.sh | /bin/bash
```

Available starting with release **0.2.0**. The script selects your native architecture (including Apple Silicon terminals running under Rosetta), downloads a release bundle over HTTPS, checks its SHA-256, and installs under your user account. It does not use or change your system Node, shell configuration or Homebrew installation; no `sudo` is required. The background task also uses the private runtime. Installation leaves an already-open desktop session running.

If rings do not appear, save your work, quit the desktop app with ⌘Q, and reopen its original icon. The add-on may reopen a freshly launched client once, subject to the safeguards below.

Observe mode disables that startup handoff:

```bash
curl -fsSL https://github.com/tccpc/codex-ringside/releases/latest/download/install.sh | /bin/bash -s -- --observe
```

To inspect the installer before running it, download `install.sh` from [Releases](https://github.com/tccpc/codex-ringside/releases), read it, then run `/bin/bash install.sh`. Use `--version 0.2.0` to select an exact release. To set a custom host path, export it before running the one-command installer:

```bash
export CODEX_RINGSIDE_APP="/Applications/ChatGPT.app"
```

After installation, status and uninstall work without npm:

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" uninstall
```

### Option 2: Ask an AI assistant

Copy this prompt into an assistant that can run commands on your Mac:

```text
Please install Codex Ringside on my Mac: https://github.com/tccpc/codex-ringside
Read the README and explain what will be installed, including the local debug port.
Check macOS 13+ and a compatible signed-in desktop client. If unsupported, stop.
Use the README's one-command installer. It bundles Node and the helper; do not install Homebrew, Node or Xcode tools for this task.
Preserve existing settings. If the app is outside the default location, export CODEX_RINGSIDE_APP with its detected path.
After installation, run "$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status.
Report whether the agent is running and the ring is placed, and give the uninstall command.
If needed, ask me to save my work and reopen the client manually. Do not close or force-quit it.
```

### Option 3: npm / source installation

For developers who already have **Node.js 22+ and Xcode Command Line Tools**:

```bash
npx codex-ringside@latest install
```

This path compiles the Swift helper locally. It requires a working system Node; if `npx` crashes with a missing Homebrew dynamic library, use Option 1. Downloading the npm package alone never installs or starts the agent: there are no install lifecycle hooks. npm users can continue using `npx codex-ringside@latest <command>` for status, background settings and uninstall.

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/CodexRingside` | Program, private Node and its license (one-command install), helper, settings and state |
| `~/Library/LaunchAgents/com.codexringside.agent.plist` | Background agent |
| `~/Library/Logs/CodexRingside` | Agent logs |
| `~/Library/Application Support/CodexRingside Backups` | Local installation/migration backups |

Host resolution order: `CODEX_RINGSIDE_APP`, legacy `CODEX_PLUS_APP`, saved path, then `/Applications/ChatGPT.app`.

## Upgrade and migrate from Codex Plus

**Automatic updates are enabled by default.** About one minute after the agent starts, it checks the latest stable GitHub Release, then checks every six hours. Check times survive restarts. A newer release is downloaded for the running architecture, verified against its SHA-256 manifest, checked for the expected version/runtime, and installed with its private Node. Drafts, prereleases and downgrades are skipped. Failed checks or installations retry after one hour.

An independent update job restarts only the Ringside agent, leaving the desktop session open. The app path, observe mode, background, images and update preference are preserved. Files are backed up before replacement; if the new watcher fails to become ready, the installer restores previous files, runtime and service state. Uninstalling, reinstalling or disabling updates during a download cancels that automatic installation. A lock prevents overlapping installation, update replacement and uninstall operations.

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --check
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --disable
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" update --enable
```

These commands update immediately, check only, disable or enable automatic updates. `status` includes an `update` object with the installed/latest versions, preference, check times and last error; timestamps are Unix milliseconds. Update logs are in `~/Library/Logs/CodexRingside/update.log` and `update.err.log`. A version-pinned install still follows future stable releases; disable automatic updates to keep a pinned version or source changes.

Older versions need one manual reinstall to receive this feature. Existing Ringside settings take precedence over Codex Plus settings; first migration preserves the old settings and retires `com.codexplus.agent`.

Backups remain in `CodexRingside Backups/install-*`. `receipt.json` records original paths and service states; `0` contains the previous Ringside installation and `1` the previous Codex Plus installation. Backups can contain private paths and images. Keep them local and remove them manually when satisfied with the upgrade. Uninstall preserves backups.

Reinstalling preserves observe mode; `--observe` explicitly disables startup handoff. To re-enable it, unload the agent, set `allowClientRestart` to `true` in the installed `settings.json`, then reinstall. npm/source users can use `npx codex-ringside@latest update`; a successful update switches the managed installation to the standalone bundle with private Node, without changing the source checkout. `npx codex-ringside@latest install` continues to require development tools.

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
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background image ~/Pictures/photo.jpg --transparency 50 --blur 8
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background --layout contain --zoom 120 --y 20
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background --crop 10,0,80,60
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" background default
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
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status
```

Look for `agent: "running"`, `cdp.windows[].card.placed`, and `cdp.windows[].background.applied`. `nativeGlass: false` means the host disables native glass. `startup.event` explains skipped handoffs. Status may contain private paths and window URLs; redact it before sharing.

If no ring appears, verify the signed-in host, application path and whether port 39222 is occupied. Node and Command Line Tools checks apply only to npm/source installations. A missing release asset means that version does not contain a standalone bundle; use 0.2.0 or later. A checksum or download failure stops before changing the installed app; retry when the network is available. Installing while the host is open does not trigger a restart. Save your work and reopen its original icon when convenient. Check `~/Library/Logs/CodexRingside` for errors.

Missing or expired allowance data is shown as unavailable. Account switches reset the app-server connection. The number of rings follows the valid allowance windows returned for your account.

## Startup safeguards

Only a newly launched, single instance is considered: it must be in the foreground, at most eight seconds old, and have received no keyboard, click or scroll input since launch. Its command line must be known with no debug port, port 39222 must be free, and the previous attempt must be over 120 seconds old.

An app already running when the agent starts is never handed off. Only normal system `terminate()` is used: refusal or a ten-second exit timeout ends the attempt. User activity during handoff prevents focus stealing. Normal startup can take a few extra seconds and show the window reopening once.

## Uninstall

```bash
"$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" uninstall
```

This removes current and legacy agents and the update job, moves the private Node runtime and program/settings/logs to the Trash and removes injected UI. Backups remain. The desktop application bundle is unchanged. The debug port remains active until that desktop process exits; the next ordinary launch has no Ringside debug flag.

## Security and privacy

Ringside starts the host's bundled `codex app-server`, reads `account/rateLimits/read` over stdio and refreshes every 60 seconds while a host window is connected. It injects UI through local Chrome DevTools Protocol port 39222 without modifying the signed app bundle.

**The debug endpoint has no authentication.** Local software can execute JavaScript in the desktop renderer through it. Never expose, forward or proxy port 39222. Use this add-on only where you trust the other local software.

Ringside does not read project files, chat content or the conversation database, and has no telemetry. It checks only the modification time of `auth.json`. The host CLI makes its own network requests. Automatic updates request the public GitHub release API and assets without account tokens or local settings, paths or images; `update --disable` stops automatic requests. Wallpaper and chosen image processing is local; images/configuration are not uploaded. See [SECURITY.md](SECURITY.md).

## Development

```bash
git clone https://github.com/tccpc/codex-ringside.git
cd codex-ringside
npm ci --ignore-scripts
npm run verify
```

Development requires Node.js 22+ and Xcode Command Line Tools. Verification runs syntax checks, unit tests and tests the actual packed CLI and Swift source. `npm run build:standalone` builds a native release bundle; `npm run check:standalone` tests its real runtime, helper, installation and rollback with simulated services and unusable system development tools. There are no runtime npm dependencies. CI covers Node.js 22/24/26 and compiles on Apple Silicon and Intel macOS. Full host compatibility requires a real signed-in client.

For the browser-only fixture, run `python3 -m http.server 4173 --bind 127.0.0.1` from the checkout and open `http://127.0.0.1:4173/test/fixtures/card.html`. It uses simulated data and gradient images.

See [CONTRIBUTING.md](CONTRIBUTING.md), [release guide](docs/RELEASING.md) and [changelog](CHANGELOG.md). Distributed under [MIT](LICENSE), with upstream notices in [NOTICE](NOTICE).
