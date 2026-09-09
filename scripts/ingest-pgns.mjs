#!/usr/bin/env node
// Bulk PGN ingestion - mirrors the Clone_reference PGN library into the
// `pgn_folders` / `pgns` tables, preserving the platform's exact folder names
// and nesting so the library reads the same in-app as it does on disk.
//
//   node scripts/ingest-pgns.mjs [--academy <uuid>] [--dir <path>] [--dry-run]
//
// Shape (matches Clone_reference/PGN_Library_Report.docx):
//   category folder  →  numbered subfolder  →  game-group  →  individual games
//   "Beginner"          "BM-1"                 "1. Movement of Pieces - 1"
//                                              └─ 54 games, one row each
//
// A .pgn FILE becomes a game-group FOLDER; every [Event] inside it becomes one
// `pgns` row, titled from its own Event tag. Empty directories are created too
// ("chess planning" ships empty on the platform).
//
// Idempotent: wipes the managed root folders (and their games) before rebuild.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_DIR = path.join(ROOT, "Clone_reference", "PGN_Library");
const DEFAULT_ACADEMY = "11111111-1111-1111-1111-111111111111"; // seeded Demo Academy

/* The root folders this script owns. "Public" is deliberately absent: on the
 * platform it renders greyed-out and cannot be browsed by a coach account, so
 * there is nothing to ingest. The UI draws it as a disabled tile. */
export const MANAGED_ROOTS = [
  "Beginner", "Intermediate", "Advance", "Master",
  "Beginner Homework", "Intermediate Homework", "Advance Homework", "Master Homework",
  "tactics", "chess planning",
];

// ── PGN parsing ──────────────────────────────────────────────────────────────

/** Split a multi-game PGN at each game's [Event tag.
 *  `\b` after "Event" keeps [EventDate ...] from starting a new game. */
export function splitGames(text) {
  return text.replace(/\r\n/g, "\n").split(/(?=^\[Event\b)/m)
    .map((g) => g.trim())
    .filter((g) => g.length > 8);
}

export function tag(pgn, name) {
  return new RegExp(`^\\[${name}\\s+"([^"]*)"`, "m").exec(pgn)?.[1];
}

/** These files already title each game exactly as the platform shows it
 *  (e.g. [Event "1. Movement of Pieces - 1 - 7"]). Fall back to a numbered
 *  name when the Event tag is absent or a bare "?" (the tactics dump). */
export function gameTitle(pgn, group, index) {
  const evt = tag(pgn, "Event");
  const name = evt && evt !== "?" ? evt : `${group} - ${index + 1}`;
  return name.slice(0, 140);
}

// ── Filesystem → folder tree ─────────────────────────────────────────────────

/** Numeric-aware sort so "9. Combat" precedes "10. Pawn Promotion". */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

const isPgn = (n) => n.toLowerCase().endsWith(".pgn") && n !== "all_pgns.pgn";

/** A directory whose name ends with a space held a "/" in its platform name:
 *  "25. Italian Game /Colle System (White)" was downloaded as a directory
 *  "25. Italian Game " containing "Colle System (White).pgn". Rejoin them so
 *  the group keeps its real name instead of gaining a bogus nesting level. */
function isSlashArtifact(dirPath, name) {
  if (!name.endsWith(" ")) return false;
  const kids = fs.readdirSync(dirPath).filter((n) => !n.startsWith("."));
  return kids.length === 1 && isPgn(kids[0]);
}

/** Recursively read `dir` into { folders, groups }, both sorted.
 *  A `group` is one .pgn file → one folder holding that file's games. */
export function readTree(dir) {
  const entries = fs.readdirSync(dir).filter((n) => !n.startsWith("."));
  const folders = [];
  const groups = [];

  for (const name of entries) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (isSlashArtifact(full, name)) {
        const file = fs.readdirSync(full).find(isPgn);
        groups.push({ name: `${name}/${path.basename(file, ".pgn")}`, file: path.join(full, file) });
      } else {
        folders.push({ name, ...readTree(full) });
      }
    } else if (isPgn(name)) {
      groups.push({ name: path.basename(name, ".pgn"), file: full });
    }
  }
  return { folders: folders.sort(byName), groups: groups.sort(byName) };
}

/** Read the library and put the root folders in the platform's curriculum
 *  order (Beginner → Master, then the Homework mirrors, then the odds and
 *  ends) rather than the alphabetical order readdir hands back. */
export function readLibrary(dir) {
  const tree = readTree(dir);
  tree.folders.sort((a, b) => MANAGED_ROOTS.indexOf(a.name) - MANAGED_ROOTS.indexOf(b.name));
  return tree;
}

/** Flatten a tree into the rows to write, parents always before their children.
 *  `readGames` is injected so tests can plan a tree without touching disk. */
export function planRows(tree, prefix = "", readGames = (f) => splitGames(fs.readFileSync(f, "utf8"))) {
  const folders = [];
  const games = [];
  const kids = [
    ...tree.folders.map((f) => ({ ...f, isGroup: false })),
    ...tree.groups.map((g) => ({ ...g, isGroup: true })),
  ];

  kids.forEach((kid, position) => {
    const self = `${prefix}/${kid.name}`;
    folders.push({ path: self, name: kid.name, parentPath: prefix || null, position });
    if (kid.isGroup) {
      readGames(kid.file).forEach((content, i) => {
        games.push({ folderPath: self, title: gameTitle(content, kid.name, i), content, position: i });
      });
    } else {
      const sub = planRows(kid, self, readGames);
      folders.push(...sub.folders);
      games.push(...sub.games);
    }
  });
  return { folders, games };
}

// ── DB ───────────────────────────────────────────────────────────────────────

function envFromLocal() {
  const txt = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const get = (k) => txt.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
  return {
    url: get("NEXT_PUBLIC_SUPABASE_URL"),
    key: get("SUPABASE_SERVICE_ROLE_KEY") || get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

/** Roots this script is allowed to delete: the ones it creates, plus the flat
 *  "📚 <topic>" folders an earlier version of this same script left behind.
 *  Anything else in the library (hand-made folders, the seeded demo folder) is
 *  left alone. */
const isManagedRoot = (name) => MANAGED_ROOTS.includes(name) || name.startsWith("📚 ");

/** Delete the managed roots and everything under them. pgn_folders.parent_id
 *  cascades, but pgns.folder_id is ON DELETE SET NULL - so the games must go
 *  first or they would survive as orphans. */
async function wipe(db, academyId) {
  const { data: all } = await db.from("pgn_folders")
    .select("id, name, parent_id").eq("academy_id", academyId);
  if (!all?.length) return 0;

  const roots = all.filter((f) => !f.parent_id && isManagedRoot(f.name));
  const byParent = new Map();
  for (const f of all) {
    if (!byParent.has(f.parent_id)) byParent.set(f.parent_id, []);
    byParent.get(f.parent_id).push(f);
  }
  const doomed = [];
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop();
    doomed.push(f.id);
    stack.push(...(byParent.get(f.id) ?? []));
  }
  if (!doomed.length) return 0;
  for (let i = 0; i < doomed.length; i += 100) {
    await db.from("pgns").delete().in("folder_id", doomed.slice(i, i + 100));
  }
  await db.from("pgn_folders").delete().in("id", roots.map((r) => r.id));
  return doomed.length;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const dir = flag("--dir") ?? DEFAULT_DIR;
  const academyId = flag("--academy") ?? DEFAULT_ACADEMY;
  const dryRun = args.includes("--dry-run");

  if (!fs.existsSync(dir)) { console.error(`No such directory: ${dir}`); process.exit(1); }

  const { folders, games } = planRows(readLibrary(dir));
  const groupCount = new Set(games.map((g) => g.folderPath)).size;
  console.log(`Parsed ${dir}`);
  console.log(`  ${folders.length} folders (${groupCount} non-empty game-groups), ${games.length} games`);
  for (const root of MANAGED_ROOTS) {
    const n = games.filter((g) => g.folderPath.startsWith(`/${root}/`)).length;
    console.log(`    ${root.padEnd(24)} ${String(n).padStart(6)} games`);
  }
  if (dryRun) { console.log("\n--dry-run: nothing written."); return; }

  const { createClient } = await import("@supabase/supabase-js");
  const { url, key } = envFromLocal();
  if (!url || !key) { console.error("Missing Supabase creds in .env.local"); process.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log("\nWiping managed folders…");
  console.log(`  removed ${await wipe(db, academyId)} old folders`);

  // planRows emits parents before children, so a child's parent id is always
  // already in `ids` by the time we need it.
  const ids = new Map();
  for (const f of folders) {
    const { data, error } = await db.from("pgn_folders").insert({
      academy_id: academyId,
      parent_id: f.parentPath ? ids.get(f.parentPath) : null,
      name: f.name,
      position: f.position,
    }).select("id").single();
    if (error) { console.error(`folder "${f.path}":`, error.message); process.exit(1); }
    ids.set(f.path, data.id);
  }
  console.log(`  created ${ids.size} folders`);

  let written = 0;
  for (let i = 0; i < games.length; i += 500) {
    const chunk = games.slice(i, i + 500).map((g) => ({
      academy_id: academyId,
      folder_id: ids.get(g.folderPath),
      title: g.title,
      position: g.position,
      content: g.content,
    }));
    const { error } = await db.from("pgns").insert(chunk);
    if (error) { console.error("insert games:", error.message); process.exit(1); }
    written += chunk.length;
    process.stdout.write(`\r  inserted ${written}/${games.length} games`);
  }
  console.log(`\n\nDone. ${ids.size} folders, ${written} games.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
