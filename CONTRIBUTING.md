# Contributing

Bug reports and pull requests in English or Chinese are welcome. Include a concrete reproduction and desktop, macOS, Node.js and Ringside versions. Redact account details, paths and chat URLs. Report vulnerabilities via [private security reporting](https://github.com/tccpc/codex-ringside/security/advisories/new).

Use macOS, Node.js 22+ and Xcode Command Line Tools:

```bash
npm ci --ignore-scripts
npm run verify
```

Tests cover allowance handling, background settings, startup guards, transactional migration and automatic updates using temporary directories and simulated services. Update tests cover version ordering, checksum validation, failure retries, concurrent operations and stale-download cancellation. Package checks extract the actual tarball, validate its contents, invoke help/version and compile Swift. Tests do not install a real LaunchAgent or restart the desktop client. For installer changes also run `npm run build:standalone && npm run check:standalone`; this checks installation and the complete verified-update/rollback path using real bundled Node/helpers, a local fake release source and unusable system development tools. Keep the npm source package free of binaries; standalone release assets are built separately.

Use `test/fixtures/card.html` with simulated data. Serve the checkout with `python3 -m http.server 4173 --bind 127.0.0.1`. Renderer scripts must remain self-contained, tolerate repeated injection, and clean up DOM nodes, observers, timers and object URLs on destruction.

Keep startup safeguards, loopback checks, privacy and migration behavior covered when changing them. Do not commit credentials, account fixtures, private logs, user backgrounds or compiled helpers. Add regression tests for behavior changes where they catch real failures. Preserve LICENSE and NOTICE in distributed copies.

Submit focused PRs explaining the trigger, resulting behavior and validation. Propose new platforms or startup-model changes in an issue first. The maintainer reviews and merges changes; publication follows [RELEASING.md](docs/RELEASING.md).
