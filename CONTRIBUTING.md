# Contributing

Thanks for helping improve Codex Deck.

## Before opening a pull request

1. Preserve independent Windows-only, macOS-only, and optional multi-host operation. State clearly which paths received automated, live-app, and physical-device testing.
2. Do not commit OpenAI/Elgato proprietary assets, Codex installation files, databases, logs, rollout files, personal paths, or generated release bundles.
3. Do not add hotkey or task-database fallbacks to the native bridge without a separate design discussion.
4. Update compatibility notes when changing renderer integration behavior.
5. Install and run the automated checks:

```sh
npm ci
npm run check
npm test
npm run validate
```

6. Build distributable Stream Deck artifacts with:

```sh
npm run pack
```

After all release artifacts have been built, audit the complete artifact set:

```sh
npm run audit:release
```

7. For iOS changes, also run:

```zsh
xcodebuild -project ios/CodexDeckMobile.xcodeproj \
  -scheme CodexDeckMobile \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Pull requests should explain the tested Codex version, Stream Deck version,
operating system, hardware model, and manual verification performed. Report
automated checks, live-app verification, and physical-device verification as
separate evidence. Never describe fixture, compile, build, or package validation
as physical-device verification.
