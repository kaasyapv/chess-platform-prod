import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
// Named explicitly: flat config resolves a plugin per config object, and the
// override block below sets react-hooks rules without inheriting the plugin
// that eslint-config-next registered in its own object. Without this, `npm run
// lint` aborts before it lints a single file.
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Stockfish WASM loader — not our code, never lint it.
    "public/engine/**",
    // Vendored pdf.js worker (minified) — copied from pdfjs-dist at install,
    // used by the PDF-to-board cropper. Not our source.
    "public/pdf.worker.min.mjs",
    // Vendored agent skills (CommonJS helper scripts). Same reasoning: not
    // application source, and their `require()` calls were the only two
    // errors standing between `npm run lint` and a clean run.
    ".agents/**",
    // Reference-architecture research dossier + reverse-engineering artifacts
    // (minified third-party bundles, screenshots, audit notes). Working
    // material kept on disk, not application source - and .gitignored, so it
    // never ships to Vercel either.
    "final_boss_implement/**",
  ]),
  {
    // react-hooks v6 compiler diagnostics: advisory performance guidance, not
    // correctness bugs. Warn (visible) instead of error so `lint` gates on
    // real defects; tighten per-rule as components get refactored.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
