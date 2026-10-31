# Changelog

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
