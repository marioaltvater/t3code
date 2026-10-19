import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopConfig from "./DesktopConfig.ts";

it.effect("disables automatic updates by default but honors an explicit override", () =>
  Effect.gen(function* () {
    const defaults = yield* DesktopConfig.DesktopConfig.pipe(
      Effect.provide(DesktopConfig.layerTest({})),
    );
    const explicitlyEnabled = yield* DesktopConfig.DesktopConfig.pipe(
      Effect.provide(DesktopConfig.layerTest({ T3CODE_DISABLE_AUTO_UPDATE: "false" })),
    );

    assert.isTrue(defaults.disableAutoUpdate);
    assert.isFalse(explicitlyEnabled.disableAutoUpdate);
  }),
);
