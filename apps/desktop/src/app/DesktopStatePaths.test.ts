// @effect-diagnostics nodeBuiltinImport:off - tests use POSIX path joining to match the Linux runtime.
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { resolveDesktopBaseDir, resolveDesktopStateDir } from "./DesktopStatePaths.ts";

describe("DesktopStatePaths", () => {
  it("uses an isolated personal home by default", () => {
    const baseDir = resolveDesktopBaseDir({
      homeDirectory: "/home/mario",
      joinPath: NodePath.posix.join,
      t3Home: Option.none(),
    });

    assert.equal(baseDir, "/home/mario/.t3-personal");
    assert.equal(
      resolveDesktopStateDir({
        baseDir,
        isDevelopment: false,
        joinPath: NodePath.posix.join,
        t3Home: Option.none(),
      }),
      "/home/mario/.t3-personal/userdata",
    );
  });

  it("continues to honor an explicit T3CODE_HOME", () => {
    assert.equal(
      resolveDesktopBaseDir({
        homeDirectory: "/home/mario",
        joinPath: NodePath.posix.join,
        t3Home: Option.some("/srv/t3-personal"),
      }),
      "/srv/t3-personal",
    );
  });
});
