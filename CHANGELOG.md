# Changelog

## 0.2.0 (2026-10-31)

- Automatically check stable GitHub releases every six hours, verify and install newer standalone bundles, and retry failures after one hour. Preserve settings, back up and roll back failed updates without closing the desktop client.
- Add `update`, `update --check`, `update --enable`, `update --disable` and update diagnostics in `status`; serialize updates with installation/uninstallation and cancel stale downloads.
- Add a one-command macOS 13+ installer that verifies release checksums and selects native Apple Silicon or Intel bundles, including when Terminal runs under Rosetta.
- Ship private Node 22.23.4 and precompiled Swift helpers so users do not need Node, Homebrew or Xcode Command Line Tools. LaunchAgents and the installed CLI use the private Node.
- Preserve settings, migration backups and transactional rollback across standalone upgrades; uninstall removes the private runtime too.
- Build/check standalone bundles on both macOS architectures in CI, publish both archives and the installer with checksums, and update English/Chinese installation and release documentation.

## 0.1.1

- Add copyable English and Chinese AI installation prompts to the README, covering prerequisites, installation, existing settings and status verification.
- Present AI-assisted and terminal installation as separate options. Runtime behavior is unchanged.

## 0.1.0

First stable public release. Includes all candidate features, with verified Codex Plus migration, preserved backgrounds and a single active renderer component on the development Mac.

Validation: 85 tests; Node.js 22, 24 and 26 on Apple Silicon; Node.js 24 on Intel; Swift compiled from the published package contents on both architectures. Official publishing uses GitHub Actions OIDC with provenance and matching release checksums.

## 0.1.0-rc.0

First public candidate of Codex Ringside, formerly the local Codex Plus project.

- Usage allowance rings with reset-time tooltips.
- Images, desktop wallpaper, native glass fallback, cropping and color controls.
- Host appearance-mode integration when compatible functions are available.
- Explicit macOS agent installation and guarded startup handoff.
- Transactional Codex Plus migration, local backups and rollback on failure.
- CLI help/version commands; no automatic installation hooks.
- English/Chinese documentation, macOS CI and tag-driven trusted publishing.

Known limits: CLI/panel labels are Chinese; host internals can change; glass and dynamic wallpapers depend on host/macOS behavior. Read the README before installation.
