# Security and privacy

## Reporting

Use [private vulnerability reporting](https://github.com/tccpc/codex-ringside/security/advisories/new). Include the affected version, reproduction and impact; do not post credentials or exploit details in public issues. The latest published version is the security-update target. This community project has no guaranteed response deadline.

## Debug endpoint

Ringside requests loopback port 39222 and rejects CDP WebSocket URLs outside allowed loopback hosts and that port. Address checking is **not authentication**. Local software can use this powerful endpoint to execute JavaScript in the desktop renderer and access data available there. Never expose, forward or proxy it. Avoid using the add-on alongside untrusted local software.

Uninstall removes the agent and UI. The listener belongs to the desktop process and closes when that process exits; reopen normally to run without the debug flag. Ringside never modifies the signed application bundle or disables operating-system protections.

## Data handling

- The app-server client requests rate-limit data and receives rate-limit updates. It does not request projects or chats. Server stderr is drained without logging because it can contain account details.
- Only the modification time of `auth.json` is checked. Ringside does not read its contents. The host CLI has its own authentication/network behavior.
- Wallpaper and selected-image processing is local. Settings, images, backups and logs stay on the machine. There is no Ringside telemetry or upload endpoint.
- Automatic updates request the public GitHub latest-release API and release assets over HTTPS, without authentication tokens or local settings, paths or images. They are enabled by default and can be disabled with `codex-ringside update --disable`.
- The Swift helper reads event counts and idle timestamps, not key contents. It requests normal termination only under the startup safeguards and never force-kills the desktop client.
- Diagnostics can include application/image paths and window URLs. Redact before sharing. Migration backups contain private local data and must not be attached to issues.

## Distribution

Packages include readable JavaScript and Swift source, no installation lifecycle hooks and no runtime npm dependencies. npm/source installation compiles the helper locally. Standalone bundles include the official Node binary and its license plus a helper compiled by the release workflow for macOS 13+. The build verifies pinned Node archive SHA-256 values in `scripts/node-runtime.json` and rejects non-system dynamic library dependencies. The shell installer downloads only over HTTPS and verifies the selected release bundle against that release’s SHA-256 manifest before execution. This check detects corrupted downloads; its trust is the GitHub release, not an independent signature. The shell installer and managed CLI do not use or modify the system Node. No Gatekeeper or quarantine settings are changed. Releases include SHA-256 checksums; official automated npm releases include provenance. The initial interactively published candidate has no CI provenance.

Publishing uses GitHub Actions OIDC bound to this repository and `release.yml`, without a stored npm publish token. Pull request CI has read-only repository permissions and does not publish.

The updater uses the same release trust as the shell installer. It only selects higher stable versions from the canonical repository, checks SHA-256 before extraction or execution, rejects archive links and paths outside the package directory, and validates package/runtime metadata. Updates use the installer's backup and rollback path in an independent one-shot job, preserving the running desktop session. The installation is rechecked under the install lock before replacement so a stale download cannot reinstall after uninstall or overwrite a concurrent reinstall.

中文：请通过上面的私密漏洞入口报告问题。39222 是无认证的本机调试端口，不要转发或暴露。日志分享前删除账号、路径、窗口链接等隐私信息，迁移备份留在本机。
