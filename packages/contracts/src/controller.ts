import * as Schema from "effect/Schema";

export const DesktopControllerEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("microphone"),
    captureId: Schema.String,
    pressed: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("dictation"),
    captureId: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    captureId: Schema.String,
    message: Schema.String,
  }),
]);
export type DesktopControllerEvent = typeof DesktopControllerEvent.Type;
