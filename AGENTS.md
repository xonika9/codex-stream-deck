# Repository instructions

## Setup and validation

- Use Node.js 20 or newer and install dependencies with `npm ci`.
- For code changes, run `npm run check`, `npm test`, and `npm run validate`.
- For iOS changes, also run:

  ```zsh
  xcodebuild -project ios/CodexDeckMobile.xcodeproj \
    -scheme CodexDeckMobile \
    -destination 'generic/platform=iOS' \
    CODE_SIGNING_ALLOWED=NO build
  ```

- Run `npm run audit:release` after building release artifacts.
- Report automated, live-app, and physical-device validation separately. Never describe fixture, compile, build, or package validation as physical-device testing.

## Project invariants

- Preserve independent Windows-only, macOS-only, and optional multi-host operation. When shared bridge or relay behavior changes, state which paths were tested.
- Keep the Codex Chrome DevTools endpoint bound to loopback. Do not expose, forward, or rebind it to a network interface; use only the authenticated relay paths documented in `SECURITY.md`.
- Do not add hotkey or task-database fallbacks to the native bridge without a separate design decision.
- Do not commit or distribute proprietary OpenAI or Elgato assets, Codex installation files, databases, logs, rollout files, pairing tokens, personal paths, private runtime state, or generated release bundles.
- Update compatibility notes when renderer integration behavior changes.

See `CONTRIBUTING.md` for the pull-request contract and `SECURITY.md` for the complete security boundary.
