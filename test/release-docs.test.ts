import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("iPhone source-install docs state the current Mac and distribution boundary", async () => {
  const [readme, install] = await Promise.all([
    text("README.md"), text("docs/IOS_INSTALL.md")
  ]);
  for (const document of [readme, install]) {
    const prose = document.replace(/^> ?/gm, "");
    assert.match(prose, /Mac(?: with)?[^.\n]*Xcode/i);
    assert.match(prose, /control only\s+(?:a\s+)?Windows/i);
    assert.match(prose, /App Store/);
  }
  assert.match(install, /git clone --depth 1 https:\/\/github\.com\/xonika9\/codex-stream-deck\.git/);
  assert.doesNotMatch(install, /git clone --branch v\d/);
});

test("current project docs preserve inspiration credit and independent implementation wording", async () => {
  const readme = await text("README.md");
  assert.match(readme, /Shikhar \(@xikhar\)/);
  assert.match(readme, /https:\/\/x\.com\/xikhar/);
  assert.match(readme, /independent implementation/i);
});

test("current iPhone docs preserve the pinned-TLS Nearby security boundary", async () => {
  const mobile = await text("docs/IOS.md");
  assert.match(mobile, /pinned self-signed TLS \+ token/);
  assert.match(mobile, /Chrome DevTools always stays on loopback/);
  assert.match(mobile, /one explicit private address/);
  assert.doesNotMatch(mobile, /Chrome DevTools[^.\n]*(?:public|LAN) address/i);
});

test("local Wi-Fi guide proves Nearby works with Tailscale off and keeps CDP private", async () => {
  const guide = await text("docs/IOS_LOCAL_WIFI.md");
  assert.match(guide, /mobile-local-config/);
  assert.match(guide, /Configure-CodexDeckMobile\.ps1 -Local/);
  assert.match(guide, /turn Tailscale off/i);
  assert.match(guide, /Keep Wi-Fi enabled/i);
  assert.match(guide, /Chrome DevTools/);
  assert.doesNotMatch(guide, /0\.0\.0\.0/);
});

test("release checksums use portable LF line endings on every platform", async () => {
  const source = await text("scripts/prepare-release.mjs");
  assert.match(source, /checksums\.join\("\\n"\)/);
  assert.match(source, /SHA256SUMS\.txt/);
});

test("release preparation audits the completed release directory", async () => {
  const source = await text("scripts/prepare-release.mjs");
  const checksum = source.indexOf("SHA256SUMS.txt");
  const audit = source.indexOf('"audit-release.mjs"');
  assert.ok(checksum >= 0);
  assert.ok(audit > checksum);
});

test("release preparation is cross-platform and keeps platform archive boundaries", async () => {
  const [packageJson, source, windows] = await Promise.all([
    text("package.json"), text("scripts/prepare-release.mjs"), text("scripts/package-windows-release.ps1")
  ]);
  assert.match(packageJson, /"release:prepare": "node scripts\/prepare-release\.mjs"/);
  assert.match(source, /process\.platform === "win32"/);
  assert.match(source, /"npm\.cmd"/);
  assert.match(source, /process\.platform !== "darwin"/);
  assert.match(source, /package-macos-release\.sh/);
  assert.match(windows, /Compress-Archive/);
});

test("npm and Stream Deck release versions use their required compatible forms", async () => {
  const [packageJson, manifest] = await Promise.all([
    text("package.json").then(JSON.parse), text("static/manifest.json").then(JSON.parse)
  ]);
  const hotfix = /^(\d+\.\d+\.\d+)-hotfix\.(\d+)$/u.exec(packageJson.version);
  const expectedManifest = hotfix ? `${hotfix[1]}.${hotfix[2]}` : `${packageJson.version}.0`;
  assert.equal(manifest.Version, expectedManifest);
});

test("release skill verifies relative checksum entries from the artifact directory", async () => {
  const checks = await text(".claude/skills/release/references/checks.md");
  assert.match(checks, /\(cd outputs\/release-vX\.Y\.Z && shasum -a 256 -c SHA256SUMS\.txt\)/);
});
