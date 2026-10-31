# Releasing Codex Ringside

Repository: `tccpc/codex-ringside`. npm package: `codex-ringside`. Tags use `v` followed by the exact package version. Work from a clean checkout of public `main`.

## First publication

1. Run `npm ci --ignore-scripts` and `npm run verify`; inspect the package and screenshot. Commit with a GitHub privacy email and push the clean history. Wait for all CI jobs.
2. Run `npm login --auth-type=web --registry=https://registry.npmjs.org/` and complete authentication in the browser. Never put passwords, tokens or OTPs in source, notes or command arguments.
3. At version `0.1.0-rc.0`, run `node scripts/release.cjs pack`, then `npm publish dist/codex-ringside-0.1.0-rc.0.tgz --access public --tag next`. This is the verified candidate, not a placeholder package.
4. Enable account 2FA if needed. Add an npm trusted publisher: GitHub owner `tccpc`, repository `codex-ringside`, workflow filename `release.yml`, no environment name. Explicitly allow direct `npm publish`; stage-only access is insufficient. No npm token is stored in GitHub.
5. Complete the first trusted publish within two days. Update manifest and lockfile to `0.1.0`, add the changelog entry, verify, commit and push `main`. When CI passes, create and push `v0.1.0`.
6. The Release workflow verifies the matrix, checks tag/version/main ancestry, packs once, publishes those bytes with provenance, verifies registry integrity and creates the GitHub Release with the same tarball and `SHA256SUMS.txt`.

The package must exist before configuring trust. See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/) and [trusted publishing](https://docs.npmjs.com/trusted-publishers/). The candidate uses interactive authentication; the stable release proves automation.

## Subsequent releases

```bash
npm version 0.1.1 --no-git-tag-version
# Update CHANGELOG.md, then:
npm run verify
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release 0.1.1"
git push origin main
# Wait for CI before creating the tag:
git tag v0.1.1
git push origin v0.1.1
```

Prerelease versions publish to `next` and create a GitHub prerelease. Stable versions publish to `latest`. The workflow pins npm to `11.21.1`; Actions use commit hashes with Dependabot updates.

## Verification and retries

Verify the npm version, provenance, GitHub assets and checksum. On macOS run `npx --yes codex-ringside@VERSION --version`. Package tests check help/version and compile Swift from the tarball; desktop behavior needs a signed-in-host smoke test.

Rerun failed jobs after network or provenance propagation errors. Published versions are accepted only when integrity matches the locally packed artifact. Existing GitHub assets are downloaded and compared, never blindly overwritten. Different bytes are a hard failure: issue a new version. Never move published tags or replace npm versions.

For a faulty release, deprecate it with an explanation and publish a patch. Installation backups remain local. If an unvalidated trusted-publisher configuration expires after two days, recreate it before retrying.
