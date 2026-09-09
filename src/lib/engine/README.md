# Engine layer

Client-side chess evaluation. Zero server cost, zero engine microservice.

## Files

| Path | Role |
|---|---|
| `public/engine/stockfish.js` | Prebuilt **Stockfish 17.1** (Chess.com / nmrugg build). This is the emscripten worker entry — it runs as a dedicated `Worker` and speaks UCI over `postMessage`. |
| `public/engine/stockfish.wasm` | The engine WASM (~7 MB), fetched by `stockfish.js`. |
| `src/lib/engine/uci.ts` | `parseInfoLine()` — turns one UCI `info … pv …` line into a typed `EngineLine`. The only unit-tested part. |
| `src/hooks/use-engine.ts` | `useEngine(fen, enabled, opts?)` → `{ lines, state, depth, best }`. Spawns the worker, drives `go depth N multipv M`, debounces re-analysis. |
| `src/hooks/use-stockfish.ts` | Back-compat re-export of `useEngine` as `useStockfish`. |

## Why single-threaded

The multi-threaded Stockfish build needs `SharedArrayBuffer`, which the browser
only exposes when the document is **cross-origin isolated**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Those headers break things this app needs on the same pages the engine runs on:
the mesh-video `<iframe>` embeds, DiceBear avatar images, and any third-party
media without CORP headers. A single-threaded engine sidesteps the whole
problem — `new Worker("/engine/stockfish.js")` works with the app's normal
headers (see `next.config.ts`, which deliberately does **not** set COOP/COEP).

One thread reaches depth ~18 in a second or two on a teaching position, which is
all an eval bar and a few candidate lines need.

## No separate `.worker.ts`

The prebuilt `stockfish.js` is already a complete worker script. Wrapping it in
a bundled `src/lib/engine/stockfish.worker.ts` would mean a nested worker
(`new Worker` from inside a worker) for no gain. The worker entry is the public
asset; the typed protocol lives in `uci.ts`.
