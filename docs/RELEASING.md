# Releasing Codex Ringside

Repository: `tccpc/codex-ringside`. npm package: `codex-ringside`. Tags use `v` followed by the exact package version. Work from a clean checkout of public `main`.

## Initial npm publication (historical setup)

1. Run `npm ci --ignore-scripts` and `npm run verify`; inspect the package and screenshot. Commit with a GitHub privacy email and push the clean history. Wait for all CI jobs.
2. Run `npm login --auth-type=web --registry=https://registry.npmjs.org/` and complete authentication in the browser. Never put passwords, tokens or OTPs in source, notes or command arguments.
3. At version `0.1.0-rc.0`, run `node scripts/release.cjs pack`, then `npm publish ./dist/codex-ringside-0.1.0-rc.0.tgz --access public --tag next`. This is the verified candidate, not a placeholder package.
4. Enable account 2FA if needed. Add an npm trusted publisher: GitHub owner `tccpc`, repository `codex-ringside`, workflow filename `release.yml`, no environment name. Explicitly allow direct `npm publish`; stage-only access is insufficient. No npm token is stored in GitHub.
5. Complete the first trusted publish within two days. Update manifest and lockfile to `0.1.0`, add the changelog entry, verify, commit and push `main`. When CI passes, create and push `v0.1.0`.
6. The Release workflow verifies the matrix, checks tag/version/main ancestry, packs once, publishes those bytes with provenance, verifies registry integrity and creates the GitHub Release with the same tarball and `SHA256SUMS.txt`.

The package must exist before configuring trust. See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and [trusted publishing](https://docs.npmjs.com/trusted-publishers/). The candidate uses interactive authentication; the stable release proves automation.

## Releases with one-command installation (0.2.0+)

The public entry point is the `install.sh` asset on the latest stable GitHub Release. It deliberately does not load an unpublished script from `main`. Both platform archives, the npm tarball and `install.sh` must be uploaded and checksum-verified before the draft becomes public. Versions before 0.2.0 do not have this entry point.

Before tagging, update `package.json`, `package-lock.json`, and `CHANGELOG.md` (remove “unreleased”). On macOS:

```bash
npm run verify
npm run build:standalone
npm run check:standalone
node scripts/build-standalone.cjs arm64
node scripts/build-standalone.cjs x64
node scripts/release.cjs pack
```

Inspect `dist/RELEASE_NOTES.md`, `dist/SHA256SUMS.txt` and all four covered assets. `pack` is local only and does not publish. Its standalone archives must already have been built. The build downloads official Node archives, checks their pinned SHA-256, compiles the helper for macOS 13+, rejects Homebrew/Xcode dynamic dependencies, and includes the Node license. It never bundles the developer's own Node. The npm tarball remains source-only.

The CI matrix builds and tests each native architecture using Node 24. The standalone smoke check executes the real bundled Node and helper with system development commands replaced by failures and an invalid `DEVELOPER_DIR`. Temporary fake hosts and services cover install, runtime paths, settings, reinstall, rollback and uninstall without changing a real desktop client or LaunchAgent.

After review and green CI, commit the release version to `main`, push it, then create and push the matching tag (for example `v0.2.0`). The Release workflow verifies the matrix, builds both architectures, checks tag/version/main ancestry, packs once, publishes npm with provenance, verifies registry integrity, uploads all GitHub assets and publishes the release last. A source change requires a new version; never overwrite a released bundle.

Prereleases publish to npm `next` and create a GitHub prerelease. Test them with a downloaded `install.sh --version X.Y.Z-rc.N`; the default installer follows the latest stable release. Stable versions publish to npm `latest`. npm is pinned to `11.21.1`; Actions use commit hashes with Dependabot updates.

Installed agents also follow the latest stable GitHub Release automatically every six hours. Publish the draft only after every asset and checksum is present. The updater never downgrades and ignores prereleases. Keep the standalone format compatible with the previous installer's copy/preflight contract: updates are applied by the installed version's transactional installer. For pinned-version or source-development testing, disable updates with `codex-ringside update --disable`.

## Updating the private Node runtime

Update `scripts/node-runtime.json` with a tested Node 22+ patch version and the two `.tar.gz` SHA-256 values from `https://nodejs.org/dist/vVERSION/SHASUMS256.txt`. Follow [Node's release verification guidance](https://github.com/nodejs/node#verifying-binaries). Build and test both architectures before release. Users receive the runtime with a newer Ringside release through automatic updates or by rerunning the one-command installer. Choosing and validating the bundled Node version remains a maintainer responsibility; the updater does not track Node releases independently.

The bundles target macOS 13 or newer. Host compatibility still depends on the user's desktop app. No Apple Developer identity/notarization is configured by this repository; the installer does not disable macOS protections. A future GUI installer would need its own signing/notarization workflow.

## Verification and retries

Verify the npm version, provenance, GitHub assets and checksums, then test the published one-command installer on each supported architecture. On macOS run `npx --yes codex-ringside@VERSION --version`. Package tests check help/version and compile Swift from the tarball; desktop behavior needs a signed-in-host smoke test.

Rerun failed jobs after network or provenance propagation errors. Published versions are accepted only when integrity matches the locally packed artifact. Existing GitHub assets are downloaded and compared, never blindly overwritten. Different bytes are a hard failure: issue a new version. Never move published tags or replace npm versions.

For a faulty release, deprecate it with an explanation and publish a patch. Installation backups remain local. If an unvalidated trusted-publisher configuration expires after two days, recreate it before retrying.
