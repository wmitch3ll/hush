# Security

## Reporting a problem
If you find a security issue in Hush, please don't open a public issue. Contact the maintainer privately
(GitHub: @wmitch3ll, via a private security advisory on this repository) with steps to reproduce.
You'll get an answer within a few days.

## What Hush promises
- **Web pages can't control Hush.** Pages run in separate tab webviews with no access to Hush's own commands
  (checked by `security_tests` on every build).
- **No data leaves your device** except requests to the sites you visit, and — only when you ask — filter-list
  downloads and the update check on GitHub.
- **No dangerous links.** The address bar and tabs refuse `file:`, `javascript:`, `intent:` and app-internal schemes.
- **Private tabs** use a separate, throw-away browser profile (Windows: in-memory; Android: separate profile on WebView 123+).

## How it's checked
- Unit tests for the rules above run on Windows, macOS and Linux for every change.
- `cargo audit` (known-vulnerable Rust libraries) and GitHub CodeQL (static analysis) run on every change and weekly.
- Dependabot opens update pull requests for Rust libraries and build tools.
- Web engines (Microsoft WebView2, Android System WebView) are patched by Windows Update and Google Play.

## Not yet
No independent audit has been done. Test builds are debug builds and the Windows installer is not code-signed.
