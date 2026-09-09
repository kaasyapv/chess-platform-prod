"use client";

/* Back-compat shim. The engine hook now lives at `@/hooks/use-engine` as
 * `useEngine`, with UCI parsing split into `@/lib/engine/uci`. Existing call
 * sites import `useStockfish` / `EngineLine` from here and keep working -
 * `{ lines, state, depth }` is unchanged. */

export { useEngine as useStockfish } from "./use-engine";
export type { EngineLine, EngineState } from "./use-engine";
