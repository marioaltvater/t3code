import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseAssetUrl,
  cliReleaseIndexPageUrl,
  personalReleaseBaseOverride,
  newestCliReleaseVersion,
  parseChecksums,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("keeps personal builds on the fork when the configured release source is blank", () => {
    expect(personalReleaseBaseOverride("0.1.7-personal.2026110502", "   ")).toBe(
      "https://github.com/marioaltvater/t3code/releases/download",
    );
    expect(
      personalReleaseBaseOverride("0.1.7-personal.2026110502", " https://mirror.example "),
    ).toBe("https://mirror.example");
    expect(personalReleaseBaseOverride("0.1.7", " ")).toBeUndefined();
  });
  it("uses the personal fork for personal server builds", () => {
    expect(cliReleaseAssetUrl("0.1.7-personal.2026110502", "SHA256SUMS")).toBe(
      "https://github.com/marioaltvater/t3code/releases/download/v0.1.7-personal.2026110502/SHA256SUMS",
    );
    expect(cliReleaseAssetUrl("0.1.7", "SHA256SUMS")).toBe(
      "https://github.com/pingdotgg/t3code/releases/download/v0.1.7/SHA256SUMS",
    );
    expect(
      cliReleaseAssetUrl(
        "0.1.7-personal.2026110502",
        "SHA256SUMS",
        "https://mirror.example/download",
      ),
    ).toBe("https://mirror.example/download/v0.1.7-personal.2026110502/SHA256SUMS");
    expect(cliReleaseIndexPageUrl(1, "0.1.7-personal.2026110502")).toContain(
      "/repos/marioaltvater/t3code/releases",
    );
    expect(
      newestCliReleaseVersion(
        [{ tag_name: "v0.1.8" }, { tag_name: "v0.1.7-personal.2026110503" }],
        "stable",
        true,
      ),
    ).toBe("0.1.7-personal.2026110503");
  });
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  t3-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *t3-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("t3-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("t3-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });
});
