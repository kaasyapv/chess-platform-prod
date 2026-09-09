"use client";

/* Live classroom - rebuilt 1-to-1 against Clone_reference/Classroom_Report.docx
 * and the classroom screenshots.
 *
 * Three zones: a 2-column icon toolbar hugging the left of the board (coach
 * only - hidden entirely for an admin viewing someone else's class, see
 * isAdminViewer), the board centered, and a right panel (Video · Students ·
 * PGN Library · Chat · Moves · Leaderboard · Syllabus) with the session
 * title, Logs, and Load PGNs / End Classroom pinned beneath it. Academy
 * Database import lives in the left toolbar as a spacious centered modal
 * (src/components/class/master-database.tsx), not a right-panel tab.
 *
 * Board+chat sync over Supabase Realtime; beforeunload guard while live.
 * Assigned sides, coordinates toggle, gamify mode, instant quiz, PDF materials
 * + snap-to-FEN, save game to PGN library, whiteboard, screen recorder,
 * network meter and supervisor moderation all ride along inside that shell. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Lock, Unlock, TriangleAlert, ExternalLink, ZoomIn, FlipVertical2, CircleHelp,
  RotateCcw, Volume2, VolumeX, LayoutGrid, FileText, ChevronLeft, ChevronRight,
  Pause, Play, Video, Square, Grid2x2, Database, Hand,
  BookOpen, Eye, EyeOff, ListChecks, Presentation, Save, Paperclip, Camera, StickyNote,
  Settings, Settings2, ScrollText, Puzzle, Check, X, Send, Gift, Cpu,
  Eraser, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Chess } from "chess.js";
import { Whiteboard, type WhiteboardHandle } from "@/components/class/whiteboard";
import { logActivity } from "@/lib/activity";
import { NetworkMeter, useScreenRecorder } from "@/components/class/class-tools";
import { GamesLibrary, type Game as LibGame } from "@/components/class/games-library";
import { MasterDatabase } from "@/components/class/master-database";
import { CustomizePosition } from "@/components/class/customize-position";
import { createClient } from "@/lib/supabase/client";
import { ChessBoard, type Arrow, type Highlight, type ChessBoardHandle } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { pieceUrl, type PieceKind } from "@/components/board/piece-sets";
import { BoardSettingsModal } from "@/components/board/board-settings-modal";
import { ClassroomSettingsModal } from "@/components/classroom/classroom-settings-modal";
import { useClassroomPrefs } from "@/components/classroom/use-classroom-prefs";
import { useBoardSettings } from "@/lib/board-settings";
import { useChessSounds, soundForMove } from "@/hooks/use-chess-sounds";
import {
  useClassroomChannel, type BoardState, type ChatMessage, type QuizEvent, type QuizItem, type QuizAnswer,
  type QuizResult,
} from "@/hooks/use-classroom-channel";
import {
  serializeSnapshot, shouldApplyDurableSnapshot, type ClassroomSnapshot,
} from "@/lib/classroom-sync";
import { normalizeGameText, pgnTag } from "@/lib/pgn";
import { isRenderableFen, formatClock } from "@/lib/chess-pure";
import { simulResult } from "@/lib/chess-answer";
import { loadPgnLenient } from "@/lib/pgn-load";
import { useEngine } from "@/hooks/use-engine";
import { formatScore } from "@/lib/engine/uci";
import { MeshVideoRoom } from "@/components/class/mesh-video-room";
import { useVideoDock, VideoDockSlot } from "@/components/class/video-dock";
import { startImpersonation } from "@/components/shell/impersonation-banner";
import { PreflightModal, preflightDone, loadPreflightDevices } from "@/components/class/preflight-modal";
import { MiniBoard } from "@/components/board/mini-board";
import { EvalBar } from "@/components/board/eval-bar";
import { SimulGrid } from "@/components/class/simul-grid";
import { useSimulBoards } from "@/hooks/use-simul-boards";
import { RewardOverlay, REWARD_KINDS, REWARD_TTL_MS } from "@/components/class/reward-popup";
// Lazy: pdfjs-dist is ~455 KB and cropping a diagram is a rare action - keep it
// out of the classroom's first load, pull it in when the modal opens.
const PdfCropper = dynamic(
  () => import("@/components/class/pdf-cropper").then((m) => m.PdfCropper),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading PDF tools…</p> },
);
import { Avatar, Button, Input, Modal, SegmentedTabs, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { Profile } from "@/lib/auth";
import type { RewardEvent } from "@/hooks/use-classroom-channel";
import { NONCAPTURABLE_ICON_IDS } from "@/lib/gamified-icons";
import { fetchLichessPuzzle, LICHESS_PUZZLE_THEMES, type LichessPuzzle } from "@/lib/lichess-puzzle";

type SyllabusItem = { id: string; title: string; done: boolean };

type Classroom = {
  id: string; title: string; status: string; notes: string | null;
  topic: string | null; syllabus: SyllabusItem[] | null;
  started_at: string | null; coach_id: string; batch_id: string | null;
  meeting_url: string | null;
  coach: { display_name: string } | null;
  /* Durable board snapshot (0042) - the floor for late-joiner / reconnect
   * recovery when no live coach broadcast is available. Optional: null on a
   * class that has never gone live, or when prod is still behind 0042. */
  live_state?: ClassroomSnapshot | null;
  live_state_at?: string | null;
};

type Sides = { white?: string; black?: string };

/* One consistent snapshot per broadcast - and ONLY the revealed world goes
 * out. `fen` is the live head; `history` holds the moves the class has already
 * been shown. A loaded game's remaining moves - the ANSWERS - live solely in
 * the coach's `loadedGameRef` and are never broadcast, so neither a student
 * nor a late joiner can read the solution off the wire. */
type SyncState = BoardState & {
  history?: string[];
  locked?: boolean;
  annotations?: { arrows: Arrow[]; highlights: Highlight[] };
  sides?: Sides;
  coords?: boolean;
  gamify?: boolean;
  quizActive?: boolean;   // quiz running - students' screen share is paused
  free?: boolean;         // Free Move (Teaching Mode) - illegal positions allowed
  hideMoves?: boolean;    // coach hid the move list; students' history is sent as []
  startFen?: string;      // where the loaded game begins, so students replay it right
  simulActive?: boolean;  // coach has the simul grid open - students mirror their board
  notice?: string;        // one-shot lifecycle message the student shows as a toast (not persisted)
};

type Folder = { id: string; name: string };
type MaterialFile = { name: string };

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/* Stable empty props for the student's quiz-solving board. Inline `{}` / `[]`
 * get a fresh identity every render, so the 1s quiz countdown re-render used to
 * defeat ChessBoard's `memo` and rebuild the shapes SVG once per second. */
const NO_ICONS: Record<string, string> = {};
const NO_ARROWS: Arrow[] = [];
const NO_HIGHLIGHTS: Highlight[] = [];
// ponytail: confetti dots drawn with CSS instead of a text glyph, so no decorative symbol is needed.
const GAMIFY_COLORS = ["#81b64c", "#26c2a3", "#e6912c", "#5b8def", "#ca3431", "#f2c14e"];
const PRAISE = ["Great capture!", "Nice one!", "Brilliant!", "Keep it up!", "Sharp eyes!"];

/* The right panel has an Activity / Library toggle (the reference platforms all
 * split it this way): Activity holds the five live-teaching tabs, Library holds
 * the PGN Library and the syllabus checklist. Academy Database import is a
 * centered modal off the left toolbar, not a tab. */
/* Figurine notation (MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2.3): a SAN token
 * renders the moving piece as a small SVG image next to the destination text
 * ("Nf3" -> [knight] f3). Pawn moves and castling stay plain text. The full
 * plain-letter SAN goes in `title` for a11y / tooltip, exactly as the
 * reference does. `ply` is 1-based; odd = White to move. */
function FigurineSan({ san, ply, pieceSet }: { san: string; ply: number; pieceSet: string }) {
  const letter = /^[NBRQK]/.test(san) ? san[0] : null;
  const color: "w" | "b" = ply % 2 === 1 ? "w" : "b";
  return (
    <span title={san} className="inline-flex items-center gap-0.5 leading-none">
      {letter && (
        <img
          src={pieceUrl(pieceSet, letter.toLowerCase() as PieceKind, color)}
          alt="" aria-hidden className="inline-block h-[1.15em] w-[0.85em] shrink-0 select-none"
        />
      )}
      {letter ? san.slice(1) : san}
    </span>
  );
}

type TabId = "Participants" | "Moves" | "Chat" | "Leaderboard" | "Engine" | "Responses" | "library" | "Syllabus";
const ACTIVITY_TABS: TabId[] = ["Moves", "Chat", "Leaderboard", "Participants", "Engine"];
/** Coach also gets "Responses" - the private answer stream from every quiz /
 *  poll this session, which otherwise vanishes when the quiz panel closes. */
const COACH_ACTIVITY_TABS: TabId[] = ["Moves", "Chat", "Responses", "Leaderboard", "Participants", "Engine"];
/* Short labels for the right-panel tab strip so five tabs fit a narrow panel
 * without the words colliding. Keys are TabId values; anything not listed shows
 * its own name. */
const TAB_SHORT_LABEL: Partial<Record<TabId, string>> = {
  Leaderboard: "Scores",
  Participants: "People",
  Responses: "Replies",
};
const LIBRARY_TABS: { id: TabId; icon: LucideIcon; label: string }[] = [
  { id: "library", icon: BookOpen, label: "Studies" },
  { id: "Syllabus", icon: ListChecks, label: "Syllabus" },
];

/* The video box's height. Fixed on purpose: it lives in its own column and
 * must never take height from the board. */
const VIDEO_HEIGHT = 260;

type Snapshot = { at: string; fen: string; pgn: string; line: string };

/** Pull the saved snapshots back out of the notes text. One per line:
 *  `[snapshot <iso>] <fen> || <pgn>`   (the `|| <pgn>` part is optional) */
function parseSnapshots(notes: string): Snapshot[] {
  const out: Snapshot[] = [];
  for (const line of notes.split("\n")) {
    const m = /^\[snapshot ([^\]]+)\]\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const [fen, pgn = ""] = m[2].split(" || ");
    if (fen.trim()) out.push({ at: m[1], fen: fen.trim(), pgn: pgn.trim(), line });
  }
  return out;
}

/** Only the pawns (a "pawn structure" x-ray). Every other piece becomes an
 *  empty square; runs of digits re-collapse so the FEN stays valid. */
function pawnStructureFen(f: string): string {
  const [placement, ...rest] = f.split(" ");
  const filtered = placement.replace(/[^pP/0-8]/g, "1")
    .replace(/\d+/g, (d) => String(d.split("").reduce((n, x) => n + Number(x), 0)));
  return [filtered, ...rest].join(" ");
}

/** Same position on the board? Compare placement, turn and castling - enough
 *  to recognise a PGN position the coach wandered back into. */
function sameBoard(a: string, b: string): boolean {
  return a.split(" ").slice(0, 3).join(" ") === b.split(" ").slice(0, 3).join(" ");
}

/** A real chess pawn, not a stand-in icon: ball head, collar, tapered body and
 *  a flared base - the Cburnett silhouette, on the toolbar like every other
 *  lucide glyph.
 *
 *  Every shape is SYMMETRIC ABOUT x=12, the centre of the 24x24 box, and each
 *  is a primitive rather than one long hand-tuned path. The previous single
 *  path drifted: its head arc was centred on x=12 but its base ran x=7.2..20.8
 *  (centre ~14), so the pawn leaned about two units to the right - which is the
 *  "distorted" look. Building from mirrored coordinates makes that class of bug
 *  impossible to reintroduce by eye. fill=currentColor is inherited by all of
 *  them, so the icon still takes its colour from the button. */
function PawnIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      {/* head */}
      <circle cx="12" cy="5.8" r="3.5" />
      {/* collar */}
      <rect x="9.2" y="8.6" width="5.6" height="1.6" rx="0.8" />
      {/* body: flares from the collar out to the skirt, mirrored either side */}
      <path d="M10.1 9.6C10.1 11.3 9.4 13 8.1 14.5C7.3 15.4 6.9 16.3 6.9 17.2h10.2c0-0.9-0.4-1.8-1.2-2.7C14.6 13 13.9 11.3 13.9 9.6z" />
      {/* base */}
      <rect x="5.4" y="17.8" width="13.2" height="3.2" rx="1.1" />
    </svg>
  );
}

function countPieces(fen: string) {
  return fen.split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
}

/** One item of a self-paced Multi-Ask run, as a standalone QuizEvent. Its id is
 *  `<runId>-<index>` so its answers ride the normal `quiz_answer` path and land
 *  in `classroom_responses` (0043) / `score_quiz` (0037) keyed per item. */
function runItemToEvent(runId: string, items: QuizItem[], index: number): QuizEvent {
  const it = items[index];
  return {
    id: `${runId}-${index}`, fen: it.fen,
    seconds: it.seconds, points: it.points, negative: it.negative,
    endsAt: Date.now() + Math.max(5, it.seconds) * 1000,
    active: true, hint: it.hint, attempts: it.attempts,
    run: { id: runId, total: items.length, items },
  };
}

/** Does the student's SAN match the coach's solution? Notation is forgiving:
 *  "Qxf7#", "Qf7" and "h5f7" should all count when they are the same move, so
 *  compare the RESULTING positions, falling back to a normalized string check. */
function isCorrectAnswer(quizFen: string, studentSan: string, answer: string): boolean {
  const norm = (s: string) => s.replace(/[+#x=!?]/g, "").toLowerCase();
  if (norm(studentSan) === norm(answer)) return true;
  try {
    const a = new Chess(quizFen); a.move(answer);
    const b = new Chess(quizFen); b.move(studentSan);
    return a.fen() === b.fen();
  } catch { return false; }
}

/* A submitted quiz answer survives a page reload (sessionStorage, keyed by quiz
 * id) so refreshing mid-quiz can't be used to answer the same quiz twice - the
 * broadcast-only version simply lost the quiz on reload, which hid the hole. */
function rememberQuizAnswer(id: string, san: string) {
  try { sessionStorage.setItem(`quiz-ans:${id}`, san); } catch { /* private mode */ }
}
function recallQuizAnswer(id: string): string | null {
  try { return sessionStorage.getItem(`quiz-ans:${id}`); } catch { return null; }
}

/* A student's answer plus the verdict. `correct` is filled by the COACH's
 * client (scoring against its private copy of the solution) or by the
 * `quiz_result` broadcast after `score_quiz` has run - never self-reported by
 * the answering student. */
type ScoredAnswer = QuizAnswer & { correct: boolean | null };

export function ClassroomClient({
  profile, classroom, isCoach, spectate = false,
}: { profile: Profile; classroom: Classroom; isCoach: boolean; spectate?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { settings, update } = useBoardSettings();
  const { prefs: crPrefs, update: updateCrPrefs } = useClassroomPrefs();
  const { play } = useChessSounds(settings.sounds);
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  // Manager/CEO get a read-only supervisory view: board + video + chat for
  // moderation, no teaching tools. Only true when they're NOT the assigned
  // coach stepping in to actually run the class, and not the silent Live Ops
  // spectate mode (which is already fully read-only + chat-disabled on its
  // own). isCoach itself stays true for ceo/manager here (topic/syllabus
  // editing and the supervisor mute/remove tools rely on that) - this flag
  // is layered on top, only at the specific sites that drive the shared
  // board or open teaching-only tools.
  const isAdmin = profile.role === "manager" || profile.role === "ceo";
  const isAssignedCoach = classroom.coach_id === profile.id;
  const isAdminViewer = isAdmin && !isAssignedCoach && !spectate;

  // ── Board state ────────────────────────────────────────────────────────────
  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState(START_FEN);
  /* The position the current game BEGINS from. Most reference PGNs set up a
   * puzzle with a [FEN] header, so move history must be replayed from here -
   * not from the standard opening - or ‹ › walks the wrong game. */
  const [startFen, setStartFen] = useState(START_FEN);
  const [history, setHistory] = useState<string[]>([]);
  const [viewPly, setViewPly] = useState(0);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [locked, setLocked] = useState(true);          // students gated by default
  const [paused, setPaused] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [pawnsOnly, setPawnsOnly] = useState(false);   // local x-ray view, not synced
  /* The folder the coach last browsed. Next walks it from the live board, so
   * a lesson runs without reopening the library between puzzles. */
  const [libGames, setLibGames] = useState<LibGame[]>([]);
  const [libAt, setLibAt] = useState(-1);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const boardRef = useRef<ChessBoardHandle>(null);
  /* A pawn is on the last rank and Auto-Queen is off: hold the move, show the
   * piece picker. `mode` says which board completes it - the shared live board
   * or a student's quiz-solving board. */
  const [promo, setPromo] = useState<{ from: string; to: string; color: "w" | "b"; mode: "board" | "quiz" } | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({}); // gamified board stickers, square -> emoji
  const iconsRef = useRef(icons);
  iconsRef.current = icons;
  const [engineOn, setEngineOn] = useState(false);
  const [status, setStatus] = useState(classroom.status);
  const [startedAt, setStartedAt] = useState(classroom.started_at);
  const [notes, setNotes] = useState(classroom.notes ?? "");
  const [helpRequestOpen, setHelpRequestOpen] = useState(false);
  // Fallback link (client req #8): manager/CEO-only - page.tsx already nulls
  // meeting_url out of `classroom` for everyone else before it reaches here.
  const [fallbackUrl, setFallbackUrl] = useState(classroom.meeting_url ?? "");
  const [savingFallback, setSavingFallback] = useState(false);
  const saveFallback = useCallback(async () => {
    setSavingFallback(true);
    const supabase = createClient();
    const { error } = await supabase.from("classrooms")
      .update({ meeting_url: fallbackUrl.trim() || null }).eq("id", classroom.id);
    setSavingFallback(false);
    toast(error ? error.message : "Fallback link saved", error ? "error" : "success");
  }, [fallbackUrl, classroom.id, toast]);

  // Topic label + syllabus checklist - coach/ceo/manager editable, everyone reads.
  const [topic, setTopic] = useState(classroom.topic ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [syllabus, setSyllabus] = useState<SyllabusItem[]>(classroom.syllabus ?? []);
  const [newSyllabusItem, setNewSyllabusItem] = useState("");

  async function saveTopic() {
    const supabase = createClient();
    await supabase.from("classrooms").update({ topic: topic.trim() || null }).eq("id", classroom.id);
    setEditingTopic(false);
  }

  async function persistSyllabus(next: SyllabusItem[]) {
    setSyllabus(next);
    const supabase = createClient();
    await supabase.from("classrooms").update({ syllabus: next }).eq("id", classroom.id);
  }
  function addSyllabusItem() {
    if (!newSyllabusItem.trim()) return;
    void persistSyllabus([...syllabus, { id: crypto.randomUUID(), title: newSyllabusItem.trim(), done: false }]);
    setNewSyllabusItem("");
  }
  function toggleSyllabusItem(id: string) {
    if (!isCoach) return;
    void persistSyllabus(syllabus.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  }
  function removeSyllabusItem(id: string) {
    void persistSyllabus(syllabus.filter((s) => s.id !== id));
  }

  // Demo-parity state (synced to students via broadcast)
  const [sides, setSides] = useState<Sides>({});
  const [showCoords, setShowCoords] = useState(true);
  const [hideMoves, setHideMoves] = useState(false);   // synced; students get history:[]
  const [gamify, setGamify] = useState(false);
  const [quizActive, setQuizActive] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [showLichessPuzzle, setShowLichessPuzzle] = useState(false);
  const [puzzleLoading, setPuzzleLoading] = useState<string | null>(null);
  const [lastPuzzle, setLastPuzzle] = useState<LichessPuzzle | null>(null);
  /* Strokes are pushed straight at the canvas instead of through state.
   * Holding each incoming point in useState re-rendered this whole component
   * - board, chat, roster, tab strip - once per point, and points arrive as
   * fast as a hand moves. */
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const [studentsCanDraw, setStudentsCanDraw] = useState(false);
  const [burst, setBurst] = useState<{ id: number; color: string; left: number }[]>([]);
  // Gamification rewards over the board (coach-fired or on a correct quiz answer)
  const [rewards, setRewards] = useState<RewardEvent[]>([]);
  // Right panel: Activity (5 live tabs) vs Library (PGN + syllabus)
  const [panelView, setPanelView] = useState<"activity" | "library">("activity");
  // Centre zone: the shared board, or the simul grid of every student's game
  const [centerView, setCenterView] = useState<"board" | "simul">("board");
  const [simulFocus, setSimulFocus] = useState<string | null>(null);
  // Bumped after an illegal coach move on a focused simul board so it remounts
  // and snaps the piece back (chessground already moved it visually).
  const [simulNonce, setSimulNonce] = useState(0);
  // Coach-set per-student clock for the simul (minutes; 0 = untimed).
  const [simulClockMin, setSimulClockMin] = useState(0);
  const simul = useSimulBoards();
  // Video floats automatically (VideoDockProvider) when the coach/student
  // navigates away from this classroom - no local "spotlight" toggle needed.
  // Pre-flight runs once per classroom per session; spectate + external-link
  // paths skip it. The dock provider owns the running <MeshVideoRoom>.
  const videoDock = useVideoDock();
  const [showPreflight, setShowPreflight] = useState(false);
  // The video panel only claims its full height when there's a call, an
  // external link, or a student's paused quiz view in it. Idle it collapses to
  // a slim bar so the tab content below is actually usable.
  const videoExpanded =
    spectate ||
    !!classroom.meeting_url ||
    videoDock.isLive(classroom.id) ||
    (quizActive && !isCoach);
  const [showPdfCrop, setShowPdfCrop] = useState<File | null>(null);

  // ── Live quiz ──────────────────────────────────────────────────────────────
  // The active quiz rides its own broadcast event; answers stream back the same
  // way and feed the session Leaderboard tab for everyone.
  const [quiz, setQuiz] = useState<QuizEvent | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<ScoredAnswer[]>([]);
  const [myQuizSan, setMyQuizSan] = useState<string | null>(null);
  const [quizBoardFen, setQuizBoardFen] = useState<string | null>(null); // student's local solving board
  const [quizPopupOpen, setQuizPopupOpen] = useState(false);
  const [quizLeft, setQuizLeft] = useState(0);
  // Student's in-flight answer: what they've played but not yet submitted, plus
  // how many tries they've spent. Lets a student change their move (up to
  // `quiz.attempts`, or freely) before committing - matches the reference's
  // "Ask a Question" flow. `null` = nothing tried yet.
  const [pendingQuizMove, setPendingQuizMove] = useState<{ san: string; fen: string } | null>(null);
  const [quizTriesUsed, setQuizTriesUsed] = useState(0);
  const [quizHintShown, setQuizHintShown] = useState(false);
  /* Multi-Ask self-paced run (student side): every question up front, the
   * student advances through their own copy. `runItems` empty = a normal
   * single question. `runIndex` is which item this student is on. */
  const [runItems, setRunItems] = useState<QuizItem[]>([]);
  const [runIndex, setRunIndex] = useState(0);
  const runItemsRef = useRef<QuizItem[]>([]);
  runItemsRef.current = runItems;
  const runIndexRef = useRef(0);
  runIndexRef.current = runIndex;
  const runIdRef = useRef<string | null>(null);
  // Item ids this client has already submitted an answer for (synchronous
  // double-submit guard; ids never repeat within a class).
  const submittedRef = useRef<Set<string>>(new Set());
  const pendingQuizMoveRef = useRef<{ san: string; fen: string } | null>(null);
  pendingQuizMoveRef.current = pendingQuizMove;
  const quizTriesUsedRef = useRef(0);
  quizTriesUsedRef.current = quizTriesUsed;
  const quizChessRef = useRef<Chess | null>(null);
  const quizzesRef = useRef<Record<string, QuizEvent>>({});  // quizId → scoring rules (points/negative)
  /* The coach's PRIVATE copy of each quiz's solution SAN, keyed by quiz id.
   * Same pattern as loadedGameRef: the answer is set here at launch and never
   * broadcast, so a student can't read it off the wire (0037). */
  const quizAnswerRef = useRef<Record<string, string>>({});
  const quizRef = useRef<QuizEvent | null>(null);
  quizRef.current = quiz;
  // Coach-side mirrors so the channel handlers (stable closure) read live values.
  const centerViewRef = useRef(centerView);
  centerViewRef.current = centerView;
  const simulClockMinRef = useRef(simulClockMin);
  simulClockMinRef.current = simulClockMin;
  // Mirror so the channel handlers can tell "already answered this quiz" without
  // re-arming on a re-broadcast of the same quiz.
  const myQuizSanRef = useRef<string | null>(null);
  myQuizSanRef.current = myQuizSan;
  // endQuiz can fire from the countdown timer, whose closure is frozen at quiz
  // start - read the answers through a ref so late answers still score.
  const quizAnswersRef = useRef<ScoredAnswer[]>([]);
  quizAnswersRef.current = quizAnswers;

  /* The coach's PRIVATE copy of the loaded game: original text, the full move
   * list (the answers), and every position comment. Never broadcast. */
  const loadedGameRef = useRef<{
    pgn: string; sans: string[]; startFen: string;
    comments: { fen: string; comment: string }[];
    fens: string[];   // position BEFORE each answer move - reveal finds itself here
  } | null>(null);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>("Moves");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showClassroomSettings, setShowClassroomSettings] = useState(false);
  // Focus layout: the meeting panel is a right-side drawer; this toggles it.
  const [focusPanelOpen, setFocusPanelOpen] = useState(false);
  const focusLayout = crPrefs.layout === "focus";
  // Board size = global zoom × the classroom-level size slider (0.5–1.25).
  const effectiveBoardZoom = settings.boardZoom * crPrefs.boardScale;
  const [showHelp, setShowHelp] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [showClassTools, setShowClassTools] = useState(false);
  const [showDatabase, setShowDatabase] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [showMaterials, setShowMaterials] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  // `answer` is the solution move in SAN (recorded by the coach playing it on
  // the setup board, or pre-filled from a loaded PGN). `hint` is an optional
  // nudge shown to students; `attempts` (0 = unlimited) caps their tries.
  const [quizForm, setQuizForm] = useState({ fen: "", answer: "", seconds: 60, points: 10, negative: 1, hint: "", attempts: 0 });
  // Multi-Ask: the coach stages several questions ("Add question"), then "Start
  // run" launches them all as a self-paced set. Each item is a full quizForm.
  const [quizQueue, setQuizQueue] = useState<(typeof quizForm)[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [saveFolder, setSaveFolder] = useState("");
  const [saveTitle, setSaveTitle] = useState("");
  const [materials, setMaterials] = useState<MaterialFile[]>([]);
  const [snapBusy, setSnapBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const boardZoneRef = useRef<HTMLDivElement>(null);
  /* Width of the right meeting panel - resizable by dragging the divider
   * between it and the board zone. The board follows on its own: it is a CSS
   * `aspect-ratio: 1` square that fills whatever the flex row leaves it, and
   * chessground re-measures via its own ResizeObserver. No JS sizing. */
  const [panelW, setPanelW] = useState(384);
  const dragDivider = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = panelW;
    const move = (ev: PointerEvent) =>
      setPanelW(Math.min(600, Math.max(280, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /* Height of the video box, resizable by dragging the divider below it -
   * within the right column only, so it still never touches the board's
   * width/pixel math (playmate-ui-analysis.md §2 is about cross-column
   * theft, not about the video being a fixed number forever). */
  const [videoHeight, setVideoHeight] = useState(VIDEO_HEIGHT);
  const dragVideoHeight = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY, startH = videoHeight;
    const move = (ev: PointerEvent) =>
      setVideoHeight(Math.min(520, Math.max(160, startH + ev.clientY - startY)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const recorder = useScreenRecorder();

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const redoStack = useRef<string[]>([]);   // SANs popped by undo
  const sidesRef = useRef(sides);
  sidesRef.current = sides;

  const materialsPath = `${profile.academy_id}/classroom-${classroom.id}`;

  // ── Realtime sync ──────────────────────────────────────────────────────────
  const prevSyncFen = useRef<string | null>(null);
  /* Durable-snapshot (0042) guards:
   *  - haveLiveBroadcastRef: once a live `board` broadcast has been seen, the
   *    DB row must never overwrite the board.
   *  - lastDurableAppliedAtRef: monotonic - ignore a stale re-read of live_state.
   *  - requestedInitialSyncRef: only ask the room for a snapshot once per mount. */
  const haveLiveBroadcastRef = useRef(false);
  const lastDurableAppliedAtRef = useRef<string | null>(null);
  const requestedInitialSyncRef = useRef(false);
  const {
    connected, authError, resyncNonce, roster,
    sendBoard, sendAnnotation, sendChat, sendQuiz, sendQuizAnswer,
    sendQuizResult, sendWhiteboard, sendWhiteboardPermission, sendReward, sendSimulGame,
    sendSimulMove, sendSimulConfig, sendRequestSync,
  } =
    useClassroomChannel(
      classroom.id,
      { userId: profile.id, name: profile.display_name, role: profile.role, avatar: profile.avatar },
      // handlers below; spectators are receive-only (no presence, no sends)
      {
        onBoard: (b) => {
          const s = b as SyncState;
          // A live broadcast has arrived: from here on the durable `live_state`
          // row is never allowed to overwrite the board (see hydrateFromSnapshot).
          haveLiveBroadcastRef.current = true;
          // In Free Move the coach can send a position chess.js rejects. Show it
          // anyway; just leave the rules engine on the last legal position.
          try { chessRef.current = new Chess(s.fen); } catch { /* illegal position */ }
          setFen(s.fen);
          if (s.startFen) setStartFen(s.startFen);
          // Keep the SAME object when from/to are unchanged: a coords/lock toggle
          // re-broadcasts the whole snapshot with a freshly-deserialized lastMove,
          // and a new identity there made ChessBoard re-apply the move and re-fire
          // the piece transition on pieces that never moved (a static shimmer).
          setLastMove((prev) =>
            prev?.from === s.lastMove?.from && prev?.to === s.lastMove?.to ? prev : s.lastMove);
          if (s.history) { setHistory(s.history); setViewPly(s.history.length); }
          if (typeof s.locked === "boolean") setLocked(s.locked);
          if (s.sides) setSides(s.sides);
          if (typeof s.coords === "boolean") setShowCoords(s.coords);
          if (typeof s.gamify === "boolean") setGamify(s.gamify);
          if (typeof s.quizActive === "boolean") setQuizActive(s.quizActive);
          if (typeof s.free === "boolean") setFreeMode(s.free);
          if (typeof s.hideMoves === "boolean") setHideMoves(s.hideMoves);
          if (typeof s.simulActive === "boolean") {
            simulActiveRef.current = s.simulActive;
            if (s.simulActive && !isCoach) publishSimul(s.lastMove);
            if (!s.simulActive) { simulClockMsRef.current = 0; setSimulFlagged(false); }
          }
          if (s.icons) setIcons(s.icons);
          // One-shot lifecycle message from the coach (class ended, etc.).
          if (typeof s.notice === "string" && !isCoach) toast(s.notice, "info");
          // Only a position CHANGE makes a sound - a lock/coords toggle
          // rebroadcasts the same snapshot and used to click for no reason.
          if (s.lastMove && s.fen !== prevSyncFen.current) play("move");
          prevSyncFen.current = s.fen;
        },
        onAnnotation: (a) => { setArrows(a.arrows); setHighlights(a.highlights); },
        onChat: (m) => setChat((c) => [...c, m]),
        onQuiz: (q) => {
          quizzesRef.current[q.id] = q;
          if (!q.active) {
            setQuiz(null); setQuizActive(false);
            setRunItems([]); setRunIndex(0); runIdRef.current = null;
            return;
          }
          // Self-paced Multi-Ask run: a student enters their OWN copy at item 0
          // and advances independently. The coach gets the plain event and
          // watches the progress grid instead of solving.
          if (q.run && !isCoach && !spectate) {
            setQuizActive(true);
            if (runIdRef.current === q.run.id) return; // already running our copy
            runIdRef.current = q.run.id;
            q.run.items.forEach((_, i) => {
              quizzesRef.current[`${q.run!.id}-${i}`] = runItemToEvent(q.run!.id, q.run!.items, i);
            });
            setRunItems(q.run.items);
            // Reload mid-run: resume at the first item we haven't answered yet.
            let start = 0;
            while (start < q.run.items.length && recallQuizAnswer(`${q.run.id}-${start}`) !== null) start++;
            setRunIndex(start);
            if (start >= q.run.items.length) { // already finished this run
              setQuiz(null); setMyQuizSan("done"); setQuizPopupOpen(false);
              return;
            }
            const ev = runItemToEvent(q.run.id, q.run.items, start);
            setQuiz(ev);
            setMyQuizSan(null); setQuizBoardFen(ev.fen); setQuizPopupOpen(true);
            setPendingQuizMove(null); setQuizTriesUsed(0); setQuizHintShown(false);
            try { quizChessRef.current = new Chess(ev.fen); } catch { quizChessRef.current = null; }
            return;
          }
          setQuiz(q);
          setQuizActive(true);
          if (q.run) return; // coach: watch progress, don't arm a solving board
          // A re-send of the SAME quiz (coach re-broadcasts on roster growth /
          // request_sync) must not wipe an answer the student already gave or
          // yank the popup back up. Only a genuinely new quiz id re-arms.
          if (quizRef.current?.id === q.id && myQuizSanRef.current !== null) return;
          const prior = recallQuizAnswer(q.id);
          setMyQuizSan(prior);
          setQuizBoardFen(q.fen);
          setQuizPopupOpen(prior === null);
          setPendingQuizMove(null);
          setQuizTriesUsed(0);
          setQuizHintShown(false);
          try { quizChessRef.current = new Chess(q.fen); } catch { quizChessRef.current = null; }
        },
        onQuizAnswer: (a) => {
          // The coach is the scorer: check the intent against the private
          // solution here, so the student never sends (or sees) a verdict.
          // Everyone else keeps it unscored until the quiz_result broadcast.
          const solution = isCoach ? quizAnswerRef.current[a.quizId] : undefined;
          const rules = quizzesRef.current[a.quizId];
          const correct = isCoach && solution
            ? isCorrectAnswer(rules?.fen ?? "", a.san, solution)
            : null;
          setQuizAnswers((xs) => [...xs, { ...a, correct }]);
        },
        onQuizResult: (r) => {
          const map = new Map(r.verdicts.map((v) => [v.userId, v.correct]));
          setQuizAnswers((xs) => xs.map((a) =>
            a.quizId === r.quizId && map.has(a.userId)
              ? { ...a, correct: map.get(a.userId)! }
              : a));
          const mine = r.verdicts.find((v) => v.userId === profile.id);
          if (mine && !isCoach) {
            toast(mine.correct ? "Correct! Points awarded." : "Not this time.", mine.correct ? "success" : "info");
          }
        },
        onWhiteboard: (e) => {
          if (e.kind === "open") setShowWhiteboard(true);
          else if (e.kind === "close") setShowWhiteboard(false);
          else whiteboardRef.current?.apply(e);
        },
        onWhiteboardPermission: (p) => { if (p.userId === "*") setStudentsCanDraw(p.allowed); },
        onReward: (r) => {
          setRewards((xs) => [...xs, r]);
          window.setTimeout(() => setRewards((xs) => xs.filter((x) => x.id !== r.id)), REWARD_TTL_MS);
          if (!r.toUserId || r.toUserId === profile.id) play("game-end");
        },
        onSimulGame: (g) => simul.ingest(g),
        // Coach set the simul time budget. Students arm their clock; a late
        // joiner gets it when the coach answers request_sync (below).
        onSimulConfig: (c) => {
          if (isCoach || spectate) return;
          simulClockMsRef.current = c.clockMs > 0 ? c.clockMs : 0;
          setSimulFlagged(false);
          if (simulActiveRef.current) publishSimul();
        },
        // Coach played a move on MY simul board: apply it and echo my position
        // back so the coach's grid confirms. Only the addressed student acts.
        onSimulMove: (m) => {
          if (isCoach || spectate || m.studentId !== profile.id) return;
          try { chessRef.current = new Chess(m.fen); } catch { return; }
          setFen(m.fen);
          setLastMove({ from: m.from, to: m.to });
          setHistory(chessRef.current.history());
          setViewPly(chessRef.current.history().length);
          play("move");
          publishSimul({ from: m.from, to: m.to });
        },
        // The channel re-subscribed after a drop: pull the durable snapshot so
        // the board is right even before the coach's next broadcast. A live
        // broadcast that lands afterwards still wins (haveLiveBroadcastRef).
        onResync: () => { haveLiveBroadcastRef.current = false; void rehydrateFromDb(); },
        // Someone asked the room for a fresh snapshot (late join / reconnect).
        // Only the coach answers, by re-pushing the full current board.
        onRequestSync: () => {
          if (isCoach && !isAdminViewer && !pausedRef.current) {
            broadcast();
            if (quizRef.current) sendQuiz(quizRef.current); // late joiner also needs the live quiz
            if (centerViewRef.current === "simul") sendSimulConfig({ clockMs: simulClockMinRef.current * 60_000 });
          }
        },
      },
      { silent: spectate },
    );

  // Live-ops persistence: the coach mirrors board state into classrooms.live_fen
  // (debounced - at most one row update per 1.5s of activity). The Live Ops
  // wall reads it through ONE postgres_changes subscription for all boards.
  useEffect(() => {
    if (!isCoach || isAdminViewer || !configured || status !== "live") return;
    const t = setTimeout(() => {
      const supabase = createClient();
      supabase.from("classrooms")
        .update({ live_fen: fen, live_updated_at: new Date().toISOString() })
        .eq("id", classroom.id)
        .then(({ error }) => { if (error) console.error("live_fen:", error.message); });
    }, 1500);
    return () => clearTimeout(t);
  }, [fen, isCoach, configured, status, classroom.id]);

  /* Every broadcast is the FULL current snapshot (merged with the patch), read
   * from a ref so it can never go out through a stale closure. The old version
   * sent chessRef's END position even while the coach was browsing an earlier
   * move - that one line was most of "students see the answer / boards
   * diverge". */
  const syncRef = useRef<SyncState>({ fen });
  syncRef.current = {
    fen, startFen, history, lastMove, locked,
    sides, coords: showCoords, gamify, quizActive, free: freeMode, icons,
    simulActive: centerView === "simul", hideMoves,
  };

  // Bumps whenever the coach pushes shared state - drives the debounced durable
  // `live_state` write below (0042) on exactly the same trigger as a broadcast.
  const [durableRev, setDurableRev] = useState(0);
  const broadcast = useCallback((patch?: Partial<SyncState>) => {
    if (pausedRef.current) return;
    const merged = { ...syncRef.current, ...patch };
    // "Hide moves" is enforced on the wire: recipients are all students
    // (self: false), so an empty history here means the notation never leaves
    // the coach's machine. Toggling it back off re-sends the real history.
    if (merged.hideMoves) merged.history = [];
    sendBoard(merged as BoardState);
    setDurableRev((r) => r + 1);
  }, [sendBoard]);

  /* Durable board snapshot (0042). The coach mirrors the SAME full snapshot it
   * broadcasts into `classrooms.live_state`, so a member who joins late or
   * whose websocket dropped can recover the board even when the coach's tab is
   * backgrounded / asleep and its roster-growth re-broadcast never fires.
   *
   * Additive and separate from the `live_fen` write above: same 1.5s debounce,
   * its own row update, so the Live Ops wall's cadence is untouched. Never
   * carries anything the broadcast wouldn't (serializeSnapshot whitelists). */
  useEffect(() => {
    if (!isCoach || isAdminViewer || !configured || status !== "live") return;
    const t = setTimeout(() => {
      // syncRef is the live snapshot; arrows/highlights are in this effect's
      // deps so the closure here has the current annotations.
      const snap = serializeSnapshot({
        ...syncRef.current,
        annotations: { arrows, highlights },
        quiz: quizRef.current ?? undefined, // solution is stripped by the whitelist
      });
      const at = new Date().toISOString();
      createClient().from("classrooms")
        .update({ live_state: snap, live_state_at: at })
        .eq("id", classroom.id)
        .then(({ error }) => { if (error) console.error("live_state:", error.message); });
    }, 1500);
    return () => clearTimeout(t);
    // durableRev covers moves/toggles/loads; arrows+highlights cover annotations;
    // quiz covers a quiz starting or ending (launchQuiz/endQuiz also bump durableRev).
  }, [durableRev, arrows, highlights, quiz, isCoach, isAdminViewer, configured, status, classroom.id]);

  /* Apply a durable snapshot to the local board. Used on first mount for a late
   * joiner, and after a reconnect. Refuses to run once a live broadcast has
   * been seen, and is monotonic on `live_state_at`. Reuses the same setters as
   * the `onBoard` handler so behaviour matches a normal sync exactly. */
  const hydrateFromSnapshot = useCallback((snap: ClassroomSnapshot | null | undefined, atIso: string | null | undefined) => {
    if (!snap || !snap.fen) return;
    if (!shouldApplyDurableSnapshot({
      atIso, haveLiveBroadcast: haveLiveBroadcastRef.current,
      lastAppliedAtIso: lastDurableAppliedAtRef.current,
    })) return;
    try { chessRef.current = new Chess(snap.fen); } catch { /* illegal / free-move position */ }
    setFen(snap.fen);
    if (snap.startFen) setStartFen(snap.startFen);
    setLastMove(snap.lastMove);
    if (snap.history) { setHistory(snap.history); setViewPly(snap.history.length); }
    if (typeof snap.locked === "boolean") setLocked(snap.locked);
    if (snap.sides) setSides(snap.sides);
    if (typeof snap.coords === "boolean") setShowCoords(snap.coords);
    if (typeof snap.gamify === "boolean") setGamify(snap.gamify);
    if (typeof snap.quizActive === "boolean") setQuizActive(snap.quizActive);
    if (typeof snap.free === "boolean") setFreeMode(snap.free);
    if (typeof snap.hideMoves === "boolean") setHideMoves(snap.hideMoves);
    // Student joined mid-quiz: rebuild the quiz locally from the durable copy so
    // the board/timer/rules show without waiting for the coach to re-broadcast.
    // Only when we have no quiz at all - a reconnect must not reopen a finished
    // quiz or wipe an answer already submitted for the one in progress.
    if (snap.quiz && !isCoach && snap.quiz.endsAt > Date.now() && !quizRef.current) {
      const q = { ...snap.quiz, active: true };
      const prior = recallQuizAnswer(q.id);
      quizzesRef.current[q.id] = q;
      setQuiz(q);
      setQuizActive(true);
      setMyQuizSan(prior);
      setQuizBoardFen(q.fen);
      setQuizPopupOpen(prior === null);
      setPendingQuizMove(null);
      setQuizTriesUsed(0);
      setQuizHintShown(false);
      try { quizChessRef.current = new Chess(q.fen); } catch { quizChessRef.current = null; }
    }
    if (typeof snap.simulActive === "boolean") simulActiveRef.current = snap.simulActive;
    if (snap.icons) setIcons(snap.icons);
    if (snap.annotations) { setArrows(snap.annotations.arrows ?? []); setHighlights(snap.annotations.highlights ?? []); }
    lastDurableAppliedAtRef.current = atIso ?? new Date().toISOString();
    prevSyncFen.current = snap.fen;
  }, [isCoach]);

  /* Re-read `classrooms.live_state` and hydrate. Called when the channel
   * re-subscribes after a drop (onResync). The row may be newer than what we
   * left with; a live broadcast landing afterwards still wins. */
  const rehydrateFromDb = useCallback(async () => {
    if (!configured || spectate) return;
    const { data } = await createClient().from("classrooms")
      .select("live_state, live_state_at").eq("id", classroom.id).maybeSingle();
    if (data) hydrateFromSnapshot(data.live_state as ClassroomSnapshot | null, data.live_state_at as string | null);
  }, [configured, spectate, classroom.id, hydrateFromSnapshot]);

  /* First mount: a late joiner whose coach isn't actively broadcasting sees the
   * durable snapshot the server already delivered on the page row. Only for a
   * class that is ALREADY live (a scheduled class is flipped live below, which
   * also clears any leftover snapshot from a previous session on this reused
   * row). The coach's own first mount hydrates only if they haven't touched the
   * board yet - a refresh mid-class restores their position; starting fresh is
   * byte-for-byte the old behaviour. */
  useEffect(() => {
    if (spectate || classroom.status !== "live") return;
    const pristine = history.length === 0 && fen === START_FEN;
    if (!isCoach || pristine) {
      hydrateFromSnapshot(classroom.live_state, classroom.live_state_at);
    }
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* First connect: ask the room for a fresh snapshot (the coach's client
   * answers with a full broadcast). Faster than the roster-growth path and
   * covers a student who joined before the coach; the durable row is the
   * fallback when no coach is present. */
  useEffect(() => {
    if (spectate || isCoach || !connected || requestedInitialSyncRef.current) return;
    requestedInitialSyncRef.current = true;
    sendRequestSync();
  }, [connected, isCoach, spectate, sendRequestSync]);

  /* Reconnect: the channel came back after a drop. Pull the durable snapshot;
   * the coach (if present) also re-broadcasts because we sent request_sync from
   * the hook on re-subscribe. */
  useEffect(() => {
    if (resyncNonce === 0) return;
    void rehydrateFromDb();
  }, [resyncNonce, rehydrateFromDb]);

  // Coach re-syncs late joiners when the roster grows - including any quiz
  // that is mid-flight, so a student who reconnects can still answer.
  const rosterSize = useRef(0);
  useEffect(() => {
    if (isCoach && !isAdminViewer && roster.length > rosterSize.current && connected) {
      broadcast();
      if (quizRef.current) sendQuiz(quizRef.current);
    }
    rosterSize.current = roster.length;
  }, [roster.length, isCoach, connected, broadcast, sendQuiz]);

  /* Everyone else's arrival is logged once per room, so the Full Report can
   * show "joined Endgames B at 10:02" next to the coach's "started class".
   * Silent spectators are excluded - the whole point of that mode is to leave
   * no trace in the room. */
  useEffect(() => {
    if (isCoach || spectate || !configured) return;
    void logActivity(profile.academy_id, profile.id, "class_join",
      { classroomId: classroom.id, detail: classroom.title });
  }, [isCoach, spectate, configured, classroom.id, classroom.title, profile.academy_id, profile.id]);

  /* Leaving the room, with the span spent in it. Nothing recorded this before,
   * so "how long were they actually in the class" had no answer -- class_join
   * gave the arrival and class_end only ever fired for the coach who closed
   * the room. Coaches included: a coach who walks out without ending the class
   * has left it just the same.
   *
   * ponytail: unmount only. Closing the tab outright skips this, and the day's
   * "last seen" from the heartbeat is the fallback there. Upgrade path is a
   * sendBeacon endpoint if the gap ever matters. */
  useEffect(() => {
    if (spectate || !configured) return;
    const enteredAt = Date.now();
    return () => {
      const seconds = Math.round((Date.now() - enteredAt) / 1000);
      if (seconds < 5) return; // a bounced-in-and-out render is not attendance
      void logActivity(profile.academy_id, profile.id, "class_leave", {
        classroomId: classroom.id,
        detail: classroom.title,
        seconds: Math.min(seconds, 7200), // the column's own ceiling (0023)
      });
    };
  }, [spectate, configured, classroom.id, classroom.title, profile.academy_id, profile.id]);

  // Coach joining a scheduled class flips it live
  useEffect(() => {
    if (!isCoach || isAdminViewer || !configured || status !== "scheduled") return;
    const supabase = createClient();
    const now = new Date().toISOString();
    supabase.from("classrooms").update({ status: "live", started_at: now }).eq("id", classroom.id)
      .then(({ error }) => {
        if (!error) {
          setStatus("live"); setStartedAt(now);
          toast("Class is live — students can join now", "success");
          void logActivity(profile.academy_id, profile.id, "class_start",
            { classroomId: classroom.id, detail: classroom.title });
        }
      });
    // Best-effort, separate from the status write above: clear any durable
    // snapshot (0042) left on this reused row by a previous session, so a fresh
    // class never hydrates yesterday's position. Tolerates a prod still behind
    // 0042 (unknown column -> this update errors, the status flip still lands).
    void supabase.from("classrooms")
      .update({ live_state: null, live_state_at: null }).eq("id", classroom.id)
      .then(() => {});
  }, [isCoach, configured, status, classroom.id]);

  /* Reload mid-class: the pre-flight was already done this session, so drop
   * straight back into the call (the reference does the same) instead of
   * showing "Start video" again. Skips spectate + external-link classes. */
  useEffect(() => {
    if (spectate || classroom.meeting_url) return;
    if (!preflightDone(classroom.id) || videoDock.isLive(classroom.id)) return;
    videoDock.start({
      classroomId: classroom.id,
      me: { userId: profile.id, name: profile.display_name, role: profile.role },
      devices: loadPreflightDevices(),
    });
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // beforeunload guard while live (observed behavior, MASTER-REPORT §13)
  useEffect(() => {
    if (status !== "live") return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [status]);

  // Chat history from DB
  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.from("classroom_messages")
      .select("sender_id, text, created_at, sender:profiles!classroom_messages_sender_id_fkey(display_name)")
      .eq("classroom_id", classroom.id).order("created_at")
      .then(({ data }) => {
        if (!data) return;
        setChat(data.map((m) => ({
          from: m.sender_id,
          name: (m.sender as unknown as { display_name: string })?.display_name ?? "?",
          text: m.text,
          at: new Date(m.created_at).getTime(),
        })));
      });
  }, [configured, classroom.id]);

  // "Call Manager" escalation - one open help_requests row per classroom;
  // realtime keeps the button's state in sync across everyone in the room.
  useEffect(() => {
    if (!configured || spectate) return;
    const supabase = createClient();
    supabase.from("help_requests").select("id").eq("classroom_id", classroom.id).eq("status", "open")
      .maybeSingle().then(({ data }) => setHelpRequestOpen(!!data));

    const channel = supabase
      .channel(`help-request:${classroom.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "help_requests", filter: `classroom_id=eq.${classroom.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { status?: string } | null;
          setHelpRequestOpen(row?.status === "open");
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [configured, spectate, classroom.id]);

  const callManager = useCallback(async () => {
    const supabase = createClient();
    const { error } = await supabase.from("help_requests").insert({
      academy_id: profile.academy_id,
      classroom_id: classroom.id,
      requested_by: profile.id,
      requested_role: profile.role,
    });
    if (!error) { setHelpRequestOpen(true); toast("Manager notified, help is on the way", "success"); }
    else if (error.code === "23505") setHelpRequestOpen(true); // already open, someone beat us to it
    else toast("Could not reach a manager, try again", "error");
  }, [profile.academy_id, profile.id, profile.role, toast]);

  // Students auto-face their assigned side (demo §4:42)
  useEffect(() => {
    if (isCoach) return;
    if (sides.white === profile.id) setOrientation("white");
    else if (sides.black === profile.id) setOrientation("black");
  }, [sides, isCoach, profile.id]);

  // Gamify: celebrate a capture with a confetti burst + praise toast. Fired
  // both when a real piece count drops AND when a piece lands on a reward
  // sticker (food/toy/etc) that isn't backed by a FEN piece.
  const fireGamifyBurst = useCallback(() => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: Date.now() + i,
      color: GAMIFY_COLORS[Math.floor(Math.random() * GAMIFY_COLORS.length)],
      left: 10 + Math.random() * 80,
    }));
    setBurst((b) => [...b, ...items]);
    toast(PRAISE[Math.floor(Math.random() * PRAISE.length)], "success");
    setTimeout(() => setBurst((b) => b.filter((x) => !items.includes(x))), 1300);
  }, [toast]);

  const prevPieces = useRef(countPieces(START_FEN));
  const gamifyRef = useRef(gamify);
  gamifyRef.current = gamify;
  useEffect(() => {
    const n = countPieces(fen);
    if (gamify && n < prevPieces.current) fireGamifyBurst();
    prevPieces.current = n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, gamify]);

  // Squares a piece may not move onto or slide through — the "roadblock"
  // stickers (rock / wall / fence). Only meaningful while gamify is on.
  const blockedSquares = useMemo(
    () => Object.entries(icons).filter(([, id]) => NONCAPTURABLE_ICON_IDS.has(id)).map(([sq]) => sq),
    [icons],
  );

  // ── Moves ──────────────────────────────────────────────────────────────────
  const mySide: "w" | "b" | "both" | null =
    sides.white === profile.id && sides.black === profile.id ? "both"
      : sides.white === profile.id ? "w" : sides.black === profile.id ? "b" : null;
  const sidesAssigned = Boolean(sides.white || sides.black);
  const canMove = !spectate && !isAdminViewer && (isCoach || (!locked && (!sidesAssigned || mySide !== null)));

  /* Simul: while the coach has the grid open, each student mirrors their board
   * to the `simul_game` sub-channel so it populates. ponytail: this group-class
   * model has one shared board, so a student's mirror IS that shared position -
   * a true one-vs-many simul (a separate game per student, moves routed to the
   * coach) is the follow-up. The transport, the grid and the coach view are all
   * here and working. */
  const simulActiveRef = useRef(false);
  /* Per-student simul clock (client-side; the reference runs simuls on a
   * separate game-server, out of scope for the classroom). `simulClockMsRef`
   * is this student's remaining time, ticked down while the simul is open and
   * their game isn't over; published with every mirror + a 5s heartbeat, and
   * at 0 the board resigns. ponytail: no host-colour config, so a flag = the
   * coach (host, White) wins that board. */
  const simulClockMsRef = useRef(0);
  const [simulFlagged, setSimulFlagged] = useState(false);

  /* Illegal move: the click sound plus a throttled toast (dragging a piece to
   * three wrong squares in a row shouldn't stack three toasts). */
  const lastIllegalToast = useRef(0);
  const illegalMove = useCallback((message = "That move isn't legal") => {
    play("illegal");
    const now = Date.now();
    if (now - lastIllegalToast.current > 1500) {
      lastIllegalToast.current = now;
      toast(message, "error");
    }
  }, [play, toast]);

  const publishSimul = useCallback((move?: { from: string; to: string }) => {
    if (isCoach || !simulActiveRef.current) return;
    sendSimulGame({
      studentId: profile.id, name: profile.display_name,
      fen: chessRef.current.fen(),
      lastMove: move,
      result: simulFlagged ? "1-0" : simulResult(chessRef.current.fen()),
      clockMs: simulClockMsRef.current > 0 ? simulClockMsRef.current : undefined,
    });
  }, [isCoach, profile.id, profile.display_name, sendSimulGame, simulFlagged]);

  /* Student simul clock: tick once a second while the simul is open and this
   * game is live; publish a heartbeat every 5s so the coach's grid stays
   * current between moves; resign the board at 0. */
  useEffect(() => {
    if (isCoach || spectate) return;
    let acc = 0;
    const id = window.setInterval(() => {
      if (!simulActiveRef.current || simulClockMsRef.current <= 0 || simulFlagged) return;
      simulClockMsRef.current = Math.max(0, simulClockMsRef.current - 1000);
      acc += 1000;
      if (simulClockMsRef.current === 0) { setSimulFlagged(true); publishSimul(); return; }
      if (acc >= 5000) { acc = 0; publishSimul(); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isCoach, spectate, simulFlagged, publishSimul]);

  /* Coach plays a move on one student's simul board. Validates against that
   * board's own position (chess.js), routes it to that student via `simul_move`,
   * and optimistically updates the grid so the coach can move on without waiting
   * for the echo. Returns false on an illegal move so the board snaps back. */
  const playSimulMove = useCallback((studentId: string, from: string, to: string): boolean => {
    if (!isCoach) return false;
    const b = simul.boards.find((x) => x.studentId === studentId);
    if (!b) return false;
    let c: Chess;
    try { c = new Chess(b.fen); } catch { return false; }
    let mv;
    try { mv = c.move({ from, to, promotion: "q" }); } catch { return false; }
    if (!mv) return false;
    const fen = c.fen();
    const result = simulResult(fen);
    sendSimulMove({ studentId, from, to, fen });
    simul.ingest({ studentId, name: b.name, fen, lastMove: { from, to }, result });
    play(result ? "game-end" : soundForMove(mv, c.inCheck()));
    return true;
  }, [isCoach, simul, sendSimulMove, play]);

  const onMove = useCallback((from: string, to: string) => {
    const c = chessRef.current;
    // Students with an assigned side may only move on their turn (demo §4:42)
    if (!isCoach && sidesAssigned) {
      const sr = sidesRef.current;
      const mine = sr.white === profile.id && sr.black === profile.id ? "both"
        : sr.white === profile.id ? "w" : sr.black === profile.id ? "b" : null;
      if (mine !== "both" && mine !== c.turn()) {
        illegalMove("Wait for your turn");
        setFen(c.fen());
        return;
      }
    }
    const piece = c.get(from as Parameters<Chess["get"]>[0]);
    const needsPromo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    if (needsPromo && !settings.autoQueen) {
      setPromo({ from, to, color: c.turn() as "w" | "b", mode: "board" });
      return; // chessground keeps the pawn on the last rank; the picker overlays it
    }
    let move;
    try {
      move = c.move({ from, to, promotion: needsPromo ? "q" : undefined });
    } catch {
      illegalMove();
      setFen(c.fen());
      return;
    }
    redoStack.current = [];
    play(soundForMove(move, c.inCheck()));
    setFen(c.fen());
    setHistory(c.history());
    setViewPly(c.history().length);
    const lm = { from: move.from, to: move.to };
    setLastMove(lm);
    // During a simul a student is playing their OWN game - it rides `simul_game`
    // only, never the shared class board.
    if (isCoach || !simulActiveRef.current) {
      broadcast({ fen: c.fen(), lastMove: lm, history: c.history() });
    }
    publishSimul(lm);

    // Gamified board: a piece that lands on a reward sticker (not a roadblock)
    // "eats" it — clear the sticker, celebrate, and sync. Capturing a
    // FEN-backed skinned piece is already handled by the piece-count effect.
    if (gamifyRef.current) {
      const ic = iconsRef.current;
      const id = ic[to];
      if (id && !NONCAPTURABLE_ICON_IDS.has(id)) {
        const next = { ...ic };
        delete next[to];
        setIcons(next);
        broadcast({ icons: next });
        fireGamifyBurst();
      }
    }
  }, [play, illegalMove, broadcast, isCoach, sidesAssigned, profile.id, publishSimul, settings.autoQueen, fireGamifyBurst]);

  /** Complete a held pawn promotion (Auto-Queen off) with the chosen piece,
   *  on whichever board started it. Cancel snaps the pawn back. */
  const finishPromotion = useCallback((p: "q" | "r" | "b" | "n") => {
    const pr = promo;
    setPromo(null);
    if (!pr) return;
    if (pr.mode === "quiz") {
      const q = quizRef.current;
      if (!q) return;
      let c: Chess;
      try { c = new Chess(q.fen); } catch { return; }
      let move;
      try { move = c.move({ from: pr.from, to: pr.to, promotion: p }); }
      catch { illegalMove(); setQuizBoardFen(q.fen); return; }
      quizChessRef.current = c;
      play(soundForMove(move, c.inCheck()));
      setQuizBoardFen(c.fen());
      setPendingQuizMove({ san: move.san, fen: c.fen() });
      setQuizTriesUsed((n) => n + 1);
      return;
    }
    const c = chessRef.current;
    let move;
    try { move = c.move({ from: pr.from, to: pr.to, promotion: p }); }
    catch { illegalMove(); setFen(c.fen()); boardRef.current?.setPosition(c.fen()); return; }
    redoStack.current = [];
    play(soundForMove(move, c.inCheck()));
    setFen(c.fen());
    setHistory(c.history());
    setViewPly(c.history().length);
    const lm = { from: move.from, to: move.to };
    setLastMove(lm);
    if (isCoach || !simulActiveRef.current) {
      broadcast({ fen: c.fen(), lastMove: lm, history: c.history() });
    }
    publishSimul(lm);
  }, [promo, play, illegalMove, broadcast, isCoach, publishSimul]);

  const cancelPromotion = useCallback(() => {
    const pr = promo;
    setPromo(null);
    if (!pr) return;
    const backTo = pr.mode === "quiz" ? (quizRef.current?.fen ?? null) : chessRef.current.fen();
    if (pr.mode === "quiz") setQuizBoardFen(backTo);
    boardRef.current?.setPosition(backTo ?? START_FEN);
  }, [promo]);

  /** Free Move (Teaching Mode): the coach drags any piece to any square. The
   *  position may well be illegal - two kings in check, a pawn on the back
   *  rank, no king at all - so chess.js is NOT allowed to veto it. We keep the
   *  new position either way, and only refresh the rules engine when the
   *  position happens to be legal.
   *
   *  Gamified stickers (candy/toys/food/etc, see gamified-icons.tsx) live
   *  outside the FEN as a square->id map, so a drag doesn't move or capture
   *  them on its own - this replays the same from/to onto `icons`. Roadblock
   *  signs (NONCAPTURABLE_ICON_IDS) are the one category the spec calls
   *  non-capturable: dragging a piece onto one leaves the sticker in place
   *  rather than deleting it. ponytail: doesn't yet stop the piece from
   *  landing there at all (would need chessground movable.dests wired to
   *  the icon map) - upgrade if "can't land on a roadblock" matters later. */
  const onFreeMove = useCallback((boardFen: string, from: string, to: string) => {
    const full = `${boardFen} w - - 0 1`;
    try { chessRef.current = new Chess(full); } catch { /* illegal on purpose */ }
    loadedGameRef.current = null;
    setFen(full);
    setStartFen(full);
    setHistory([]);
    setViewPly(0);
    setLastMove(undefined);
    play("move");

    let nextIcons = iconsRef.current;
    if (from in nextIcons || to in nextIcons) {
      nextIcons = { ...nextIcons };
      const movedIcon = nextIcons[from];
      const destIcon = nextIcons[to];
      if (destIcon && NONCAPTURABLE_ICON_IDS.has(destIcon)) {
        // Roadblock at the destination: it survives, uncaptured. The piece
        // still visually landed there (see ponytail note above).
        if (movedIcon) delete nextIcons[from];
      } else {
        delete nextIcons[from];
        delete nextIcons[to];
        if (movedIcon) nextIcons[to] = movedIcon; // sticker travels with its square's contents
      }
      setIcons(nextIcons);
    }
    broadcast({ fen: full, history: [], lastMove: undefined, free: true, startFen: full, icons: nextIcons });
  }, [play, broadcast]);

  const onAnnotate = useCallback((a: Arrow[], h: Highlight[]) => {
    setArrows(a); setHighlights(h);
    sendAnnotation({ arrows: a, highlights: h });
  }, [sendAnnotation]);

  function setPosition(newFen: string, resetHistory = true, newIcons: Record<string, string> = {}) {
    /* Gamified/teaching setups are usually positions chess.js refuses (a few
     * pawns and blocker icons, no kings - exactly what the reference platform
     * accepts). Load and broadcast those anyway, in free-move mode; only a FEN
     * that isn't even board-shaped is refused. This was the break in the
     * icon pipeline: the throw below used to bail out before setIcons ran. */
    let legal = true;
    try { chessRef.current = new Chess(newFen); } catch { legal = false; }
    if (!legal && !isRenderableFen(newFen)) { toast("Invalid FEN", "error"); return false; }
    redoStack.current = [];
    loadedGameRef.current = null;
    setFen(newFen);
    setStartFen(newFen);
    setIcons(newIcons);
    if (!legal) setFreeMode(true);
    if (resetHistory) { setHistory([]); setViewPly(0); setLastMove(undefined); }
    broadcast({ fen: newFen, history: [], lastMove: undefined, startFen: newFen, free: !legal, icons: newIcons });
    return true;
  }

  async function loadLichessPuzzle(theme: string) {
    setPuzzleLoading(theme);
    try {
      const puzzle = await fetchLichessPuzzle(theme);
      if (!puzzle) { toast("Lichess didn't return a puzzle, try again", "error"); return; }
      setPosition(puzzle.fen);
      setLastPuzzle(puzzle);
      toast(`Puzzle loaded (rated ${puzzle.rating}): solution ${puzzle.solutionSan.join(" ")}`, "success");
      setShowLichessPuzzle(false);
    } catch {
      toast("Couldn't reach Lichess, check your connection", "error");
    } finally {
      setPuzzleLoading(null);
    }
  }

  function undo() {
    const c = chessRef.current;
    const popped = c.undo();
    if (!popped) return;
    redoStack.current.push(popped.san);
    setFen(c.fen());
    setHistory(c.history());
    setViewPly(c.history().length);
    setLastMove(undefined);
    broadcast({ fen: c.fen(), history: c.history(), lastMove: undefined });
  }

  /** Play the next move onto the live board for everyone: a move the coach
   *  undid, or - when the shown moves still follow the loaded game - the next
   *  ANSWER move from the coach's private line. This is how a solution is
   *  revealed: one move at a time, by the coach, never over the wire. */
  function revealNext() {
    const c = chessRef.current;
    // The loaded game comes FIRST: wherever the board sits on the PGN's line -
    // even if the coach wandered off to explain and came back - › continues
    // the game. Only off the line does › replay an undone exploration move.
    let san: string | undefined;
    const lg = loadedGameRef.current;
    if (lg) {
      const idx = lg.fens.findIndex((f) => sameBoard(f, c.fen()));
      if (idx !== -1) { san = lg.sans[idx]; redoStack.current = []; }
    }
    san ??= redoStack.current.pop();
    if (!san) return;
    let move;
    try { move = c.move(san); } catch { return; }
    play(soundForMove(move, c.inCheck()));
    setFen(c.fen());
    setHistory(c.history());
    setViewPly(c.history().length);
    setLastMove({ from: move.from, to: move.to });
    broadcast({ fen: c.fen(), history: c.history(), lastMove: { from: move.from, to: move.to } });
  }

  /** Replay `ply` half-moves from the game's own opening position. */
  const fenAtPly = useCallback((ply: number) => {
    let c: Chess;
    try { c = new Chess(startFen); } catch { return null; }
    try { for (let i = 0; i < ply; i++) c.move(history[i]); } catch { return null; }
    return c.fen();
  }, [startFen, history]);

  // Prev/next navigation broadcasts the viewed position (students follow along)
  const browsing = viewPly < history.length;
  const viewFen = useMemo(() => {
    if (!browsing) return fen;
    return fenAtPly(viewPly) ?? fen;
  }, [browsing, viewPly, fen, fenAtPly]);

  /** Look back through the REVEALED moves - a private view, never broadcast.
   *  The shared board moves only through moves (onMove/revealNext/undo). */
  function navigate(ply: number) {
    setViewPly(Math.max(0, Math.min(history.length, ply)));
  }

  const { lines, depth, state: engineState } = useEngine(viewFen, engineOn && isCoach && !isAdminViewer);

  /** Coach: execute the engine's top line on the live board (UCI, e.g. e2e4). */
  function playBestMove() {
    const m = lines[0]?.move;
    if (!m || browsing) return;
    onMove(m.slice(0, 2), m.slice(2, 4));
  }

  // ── Coach actions ──────────────────────────────────────────────────────────

  /** The Logs button shows what happened in this session, newest last. */
  const log = useCallback((line: string) => {
    setLogs((l) => [...l, `${new Date().toLocaleTimeString()} · ${line}`].slice(-200));
  }, []);

  function toggleLock() {
    const next = !locked;
    setLocked(next);
    broadcast({ locked: next });
    log(next ? "Board locked" : "Board unlocked");
    toast(next ? "Board locked: students cannot move" : "Board unlocked", "info");
  }

  function toggleCoords() {
    const next = !showCoords;
    setShowCoords(next);
    broadcast({ coords: next });
  }

  /** Hide / show the move list for students. Enforced: `broadcast` sends an
   *  empty history while hidden, so students never receive the notation. */
  function toggleHideMoves() {
    const next = !hideMoves;
    setHideMoves(next);
    broadcast({ hideMoves: next });
    toast(next ? "Moves hidden from students" : "Moves visible to students", "info");
  }

  function flipBoard() {
    setOrientation((o) => (o === "white" ? "black" : "white"));
  }

  /** Free Move lets the coach drag any piece anywhere, with no rule checks.
   *  Students follow along, so what they see always matches the coach. */
  function toggleFreeMode(on: boolean) {
    setFreeMode(on);
    // Send the position on screen, not chessRef's - in Free Move they differ.
    broadcast({ free: on, fen, history });
    log(on ? "Free Move turned on" : "Free Move turned off");
    toast(on ? "Free Move on: the board no longer checks the rules" : "Free Move off", "info");
  }

  function resetGame() {
    setPosition(START_FEN);
    setOrientation("white");
    log("Board reset to the starting position");
  }

  /** C / R / Q, coach-only board controls. F (flip) and Esc (clear annotations)
   *  are wired in the universal handler below - they're safe for students too. */
  useEffect(() => {
    if (!isCoach || isAdminViewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      switch (e.key.toLowerCase()) {
        case "c": toggleCoords(); break;
        case "r": resetGame(); break;
        case "q": setShowCustomize(true); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, isAdminViewer, showCoords, gamify, quizActive, locked]);

  /* ← → step through the game, exactly like chess.com and Lichess. For the
   * coach at the live head they act on the CLASS (take back / reveal next);
   * anywhere else they page through the revealed moves privately.
   * F flips the board (local view only, safe for everyone). Esc clears the
   * user arrows + square highlights - the last-move highlight is separate and
   * stays (MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2.5, "Erase"). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        if (isCoach && !isAdminViewer && !browsing) undo(); else navigate(viewPly - 1);
      } else if (e.key === "ArrowRight") {
        if (browsing) navigate(viewPly + 1); else if (isCoach && !isAdminViewer) revealNext();
      } else if (e.key.toLowerCase() === "f") {
        flipBoard();
      } else if (e.key === "Escape") {
        if (!arrows.length && !highlights.length) return;
        onAnnotate([], []);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, isAdminViewer, browsing, viewPly, history.length, arrows.length, highlights.length, onAnnotate]);

  function toggleGamify() {
    const next = !gamify;
    setGamify(next);
    broadcast({ gamify: next });
    toast(next ? "Gamify mode ON: captures celebrate" : "Gamify mode off", "info");
  }

  /** Drop a reward over the board. `toUserId` null = the whole class sees it;
   *  set = that one student gets the big centre-screen version. Shows locally
   *  right away, then rides the `reward` broadcast to everyone else. */
  const giveReward = useCallback((icon: string, label: string, toUserId?: string | null) => {
    const r: RewardEvent = {
      id: crypto.randomUUID(), icon, label,
      toUserId: toUserId ?? null, from: profile.id, at: Date.now(),
    };
    setRewards((xs) => [...xs, r]);
    window.setTimeout(() => setRewards((xs) => xs.filter((x) => x.id !== r.id)), REWARD_TTL_MS);
    sendReward(r);
    play("game-end");
  }, [profile.id, sendReward, play]);

  function assignSide(userId: string, side: "white" | "black" | "both" | "") {
    const next: Sides = {
      white: sides.white === userId ? undefined : sides.white,
      black: sides.black === userId ? undefined : sides.black,
    };
    if (side === "both") { next.white = userId; next.black = userId; }
    else if (side) next[side] = userId;
    setSides(next);
    broadcast({ sides: next });
  }

  function markMistake() {
    if (!lastMove) { toast("No move to mark", "info"); return; }
    const h = [...highlights, { square: lastMove.to, color: "red" }];
    setHighlights(h);
    sendAnnotation({ arrows, highlights: h });
  }

  /** Pause = prepare in private. Resuming pushes the finished position out in
   *  one shot, so students never watched the setup happen. */
  function togglePause() {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    if (!next) broadcast();
    toast(next ? "Sync paused: students keep the last position" : "Sync resumed: position pushed to the class", "info");
  }

  function popOut() {
    const el = boardZoneRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => toast("Fullscreen unavailable", "error"));
  }

  /** Save the position on the board into the notes. The line below is what
   *  gets stored; the notes screen turns it back into a small board with the
   *  moves printed underneath. */
  async function snapshot() {
    const pgn = (chessRef.current.pgn() || "").replace(/\s+/g, " ").trim();
    const line = `[snapshot ${new Date().toISOString()}] ${viewFen}${pgn ? ` || ${pgn}` : ""}`;
    setNotes((n) => (n && !n.endsWith("\n") ? `${n}\n` : n) + line + "\n");
    setShowNotes(true);
    await navigator.clipboard.writeText(viewFen).catch(() => {});
    log("Position snapshot added to notes");
    toast("Snapshot added to notes", "success");
  }

  async function saveNotes() {
    if (!configured) return;
    const supabase = createClient();
    const { error } = await supabase.from("classrooms").update({ notes }).eq("id", classroom.id);
    if (error) toast(error.message, "error");
    else toast("Notes saved", "success");
  }

  /** Load a game onto the live board. Starts at the game's own opening
   *  position (its [FEN] header when it sets one up), with the moves loaded
   *  into history so the coach can step through with ‹ ›. */
  function loadPgn(content: string, title = "PGN") {
    /* Library rows hold whatever was saved into them: a PGN, several PGNs in
     * one row, a bare FEN "position", or a course file with damaged markup.
     * loadPgnLenient repairs what it can and salvages the longest loadable
     * game from the rest - "Invalid PGN" is the last resort, not the first. */
    const loaded = loadPgnLenient(content);
    if (loaded) {
      const full = loaded.chess;
      const sans = full.history();
      const opening = full.getHeaders().FEN || START_FEN;
      /* The class starts at the game's OPENING position with an empty shared
       * history. The moves and comments stay in the coach's pocket; each press
       * of › reveals exactly one of them. */
      chessRef.current = new Chess(opening);
      const fens: string[] = [];
      { const t = new Chess(opening); for (const m of sans) { fens.push(t.fen()); t.move(m); } }
      loadedGameRef.current = {
        pgn: normalizeGameText(content), sans, startFen: opening,
        comments: full.getComments(), fens,
      };
      redoStack.current = [];
      setFen(opening);
      setStartFen(opening);
      setHistory([]);
      setViewPly(0);
      setLastMove(undefined);
      setShowDatabase(false);
      broadcast({ fen: opening, startFen: opening, history: [], lastMove: undefined, free: false });
      log(`Loaded "${title}"${loaded.exact ? "" : " (damaged tail skipped)"}`);
      toast(sans.length ? `${title} loaded, press › to reveal each move` : `${title} loaded`, "success");
      if (crPrefs.soundOnLoad) play("move");
    } else {
      /* Teaching positions can be rules-illegal on purpose - the beginner
       * "Movement of Pieces" lessons have no kings, so chess.js refuses them.
       * Show the diagram anyway, exactly like Free Move does. */
      const fen = pgnTag(content, "FEN");
      if (fen) {
        try { chessRef.current = new Chess(fen); } catch { /* rules stay on the last legal position */ }
        loadedGameRef.current = null;
        redoStack.current = [];
        setFen(fen);
        setStartFen(fen);
        setHistory([]);
        setViewPly(0);
        setLastMove(undefined);
        setShowDatabase(false);
        broadcast({ fen, startFen: fen, history: [], lastMove: undefined, free: true });
        setFreeMode(true);
        log(`Loaded "${title}" (position only)`);
        toast(`${title} loaded: free-move lesson position`, "success");
        if (crPrefs.soundOnLoad) play("move");
      } else {
        toast("Invalid PGN", "error");
      }
    }
  }

  /** The loaded game's next move at `fen`, if the board is sitting on the PGN's
   *  line - so "Ask a Question" from a loaded study pre-fills the answer the
   *  coach already has instead of making them replay it. */
  function loadedAnswerAt(fen: string): string {
    const lg = loadedGameRef.current;
    if (!lg) return "";
    const idx = lg.fens.findIndex((f) => sameBoard(f, fen));
    return idx >= 0 ? (lg.sans[idx] ?? "") : "";
  }

  /** Open the quiz setup modal, pre-filled with the current position (and, if
   *  the class is on a loaded game, its next move as the answer). */
  function openQuizSetup() {
    setQuizForm({
      fen: viewFen, answer: loadedAnswerAt(viewFen),
      seconds: 60, points: 10, negative: 1, hint: "", attempts: 0,
    });
    setShowQuiz(true);
  }

  /** "Ask" from a library card: quiz that position WITHOUT loading it onto the
   *  live board, so the class keeps looking at whatever is on screen. */
  function askFromLibrary(fens: string[], title: string) {
    if (!fens.length) return;
    setQuizForm({ fen: fens[0], answer: "", seconds: 60, points: 10, negative: 1, hint: "", attempts: 0 });
    setShowQuiz(true);
    log(`Quiz drafted from "${title}"`);
  }

  /** The setup-modal answer board: the question position with the recorded
   *  answer move applied (so the coach sees the result of their move). */
  const quizAnswerBoard = useMemo(() => {
    const base = quizForm.fen;
    if (!base) return { fen: base, legal: false };
    let c: Chess;
    try { c = new Chess(base); } catch { return { fen: base, legal: false }; }
    const san = quizForm.answer.trim();
    if (san) { try { c.move(san); } catch { /* answer no longer fits this position */ } }
    return { fen: c.fen(), legal: true };
  }, [quizForm.fen, quizForm.answer]);

  /** Coach plays one move on the setup board = the recorded solution (SAN).
   *  Always evaluated from the question position, never a running line. */
  const recordQuizAnswer = useCallback((from: string, to: string) => {
    setQuizForm((q) => {
      let c: Chess;
      try { c = new Chess(q.fen); } catch { return q; }
      try {
        const piece = c.get(from as Parameters<Chess["get"]>[0]);
        const needsPromo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
        const m = c.move({ from, to, promotion: needsPromo ? "q" : undefined });
        return { ...q, answer: m.san };
      } catch { return q; }
    });
  }, []);

  /** Load the folder's next game straight from the board. */
  const loadLibIndex = useCallback((i: number) => {
    const g = libGames[i];
    if (!g) return;
    setLibAt(i);
    loadPgn(g.content, g.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libGames]);

  /** Launch the configured quiz: push it to every student over the channel,
   *  pause their screen share, and mirror it into Homework so absent batch
   *  members can still solve it later (demo §14:11). */
  /** Stage the current question; the board is left where it is. */
  function addToQueue() {
    if (!quizForm.fen.trim()) return;
    setQuizQueue((qq) => [...qq, quizForm]);
    setQuizForm((f) => ({ ...f, answer: "", hint: "" }));
    toast(`Added to queue (${quizQueue.length + 1} waiting)`, "info");
  }

  function launchQuiz(form?: typeof quizForm) {
    const q = form ?? quizForm;
    // Push the quiz position onto the board and pause student screen share.
    if (!setPosition(q.fen)) return;
    const ev: QuizEvent = {
      id: `${classroom.id}-${Date.now()}`,
      fen: q.fen,
      seconds: Math.max(5, q.seconds),
      points: q.points,
      negative: q.negative,
      endsAt: Date.now() + Math.max(5, q.seconds) * 1000,
      active: true,
      hint: q.hint.trim() || undefined,
      attempts: q.attempts > 0 ? q.attempts : undefined,
    };
    quizzesRef.current[ev.id] = ev;
    // The solution stays on the coach's machine and in the DB - never on the wire.
    quizAnswerRef.current[ev.id] = q.answer.trim();
    setQuiz(ev);
    setQuizActive(true);
    broadcast({ quizActive: true, fen: q.fen });
    if (configured) {
      createClient().from("quizzes").insert({
        id: ev.id, classroom_id: classroom.id, academy_id: profile.academy_id,
        fen: ev.fen, answer: q.answer.trim(),
        points: ev.points, negative: ev.negative, seconds: ev.seconds,
        created_by: profile.id,
      }).then(({ error }) => {
        if (error) toast(`Quiz not saved (points can't be banked): ${error.message}`, "error");
      });
    }
    sendQuiz(ev);
    setShowQuiz(false);
    log(`Quiz started (${ev.seconds}s, ${q.points} points)`);
    toast("Quiz started: it pops up on every student's screen", "success");
    // ponytail: no homework mirror - a class quiz lives and dies in the class.
  }

  /** Launch a SELF-PACED Multi-Ask run: every staged question at once, each
   *  student advances through their own copy independently. The coach watches
   *  the progress grid; each item's answers land in `classroom_responses` /
   *  `score_quiz` keyed `<runId>-<index>`. Solutions never leave this client. */
  function launchRun(forms: (typeof quizForm)[]) {
    const clean = forms.filter((f) => f.fen.trim());
    if (clean.length < 2) { launchQuiz(clean[0]); return; }
    const runId = `${classroom.id}-${Date.now()}`;
    const items: QuizItem[] = clean.map((f) => ({
      fen: f.fen, seconds: Math.max(5, f.seconds), points: f.points, negative: f.negative,
      hint: f.hint.trim() || undefined, attempts: f.attempts > 0 ? f.attempts : undefined,
    }));
    clean.forEach((f, i) => {
      const id = `${runId}-${i}`;
      quizzesRef.current[id] = runItemToEvent(runId, items, i);
      quizAnswerRef.current[id] = f.answer.trim();
      if (configured) {
        createClient().from("quizzes").insert({
          id, classroom_id: classroom.id, academy_id: profile.academy_id,
          fen: items[i].fen, answer: f.answer.trim(),
          points: items[i].points, negative: items[i].negative, seconds: items[i].seconds,
          created_by: profile.id,
        }).then(({ error }) => { if (error) console.error("quizzes run insert:", error.message); });
      }
    });
    const ev0 = runItemToEvent(runId, items, 0);
    setQuiz(ev0);
    setQuizActive(true);
    setQuizQueue([]);
    setShowQuiz(false);
    if (!setPosition(items[0].fen)) { /* coach board is illegal-tolerant */ }
    broadcast({ quizActive: true, fen: items[0].fen });
    sendQuiz(ev0);
    log(`Multi-Ask run started (${items.length} questions, self-paced)`);
    toast(`Multi-Ask started: ${items.length} questions, students self-pace`, "success");
  }

  /** End the quiz, resume the students' screen share, and bank the points
   *  through the server-authoritative `score_quiz` RPC (0037): the coach's
   *  client sends its verdicts, the RPC re-checks the caller is staff of the
   *  academy, refuses to score twice, and pays from the STORED points values -
   *  a student can neither self-report a verdict nor inflate the amount. */
  /** Bank one quiz id's points through score_quiz (0037) and write the verdict
   *  onto each persisted response (0043). Used for a single quiz and for every
   *  item of a Multi-Ask run. */
  function scoreQuizId(quizId: string, opts: { toast?: boolean } = {}) {
    const scored = quizAnswersRef.current.filter((a) => a.quizId === quizId && a.correct !== null);
    if (!configured || !scored.length) return;
    const verdicts = scored.map((a) => ({ userId: a.userId, correct: !!a.correct }));
    createClient()
      .rpc("score_quiz", {
        p_quiz_id: quizId,
        p_results: scored.map((a) => ({ student_id: a.userId, correct: !!a.correct, ms: a.ms })),
      })
      .then(({ data, error }) => {
        if (error) { if (opts.toast) toast(`Points could not be saved: ${error.message}`, "error"); return; }
        sendQuizResult({ quizId, verdicts });
        if (opts.toast) {
          const n = typeof data === "number" ? data : scored.length;
          toast(`Quiz ended, points banked for ${n} student${n === 1 ? "" : "s"}`, "success");
        }
        for (const v of verdicts) {
          createClient().from("classroom_responses")
            .update({ is_correct: v.correct })
            .eq("classroom_id", classroom.id).eq("quiz_id", quizId).eq("user_id", v.userId)
            .then(() => {});
        }
      });
  }

  function endQuiz() {
    const ended = quizRef.current;
    setQuiz(null);
    setQuizActive(false);
    broadcast({ quizActive: false });
    if (ended?.run) {
      // Self-paced run: score every item, tell students the run is over.
      sendQuiz({ ...ended, active: false });
      for (let i = 0; i < ended.run.total; i++) scoreQuizId(`${ended.run.id}-${i}`);
      toast("Multi-Ask ended, points banked", "success");
    } else if (ended) {
      sendQuiz({ ...ended, active: false });
      const hasScored = quizAnswersRef.current.some((a) => a.quizId === ended.id && a.correct !== null);
      if (configured && hasScored) scoreQuizId(ended.id, { toast: true });
      else toast("Quiz ended: screen share resumed", "info");
    }
    log("Quiz ended");
  }

  /* A student's quiz attempt lives on their OWN board - one move, played and
   * (optionally) re-tried up to `quiz.attempts` times, then committed with
   * Submit. Nothing here touches the shared board, so nobody's attempt can
   * drag the class around. The move is always re-evaluated from the question
   * position, so a retry never stacks on a previous try. */
  const solvingQuiz = !!quiz && !isCoach && !spectate;
  const onQuizMove = useCallback((from: string, to: string) => {
    const q = quizRef.current;
    if (!q || myQuizSanRef.current !== null) return;
    const cap = q.attempts ?? 0;
    if (cap > 0 && quizTriesUsedRef.current >= cap) return;
    let c: Chess;
    try { c = new Chess(q.fen); } catch { return; }
    const piece = c.get(from as Parameters<Chess["get"]>[0]);
    const needsPromo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    if (needsPromo && !settings.autoQueen) {
      setPromo({ from, to, color: c.turn() as "w" | "b", mode: "quiz" });
      return;
    }
    let move;
    try {
      move = c.move({ from, to, promotion: needsPromo ? "q" : undefined });
    } catch {
      illegalMove();
      setQuizBoardFen(q.fen);
      return;
    }
    quizChessRef.current = c;
    play(soundForMove(move, c.inCheck()));
    setQuizBoardFen(c.fen());
    setPendingQuizMove({ san: move.san, fen: c.fen() });
    setQuizTriesUsed((n) => n + 1);
  }, [play, illegalMove, settings.autoQueen]);

  /** Put the student's board back to the question position for another try
   *  (the spent attempt is not refunded). */
  const retryQuizMove = useCallback(() => {
    const q = quizRef.current;
    if (!q) return;
    try { quizChessRef.current = new Chess(q.fen); } catch { quizChessRef.current = null; }
    setQuizBoardFen(q.fen);
    setPendingQuizMove(null);
  }, []);

  /** Commit the pending move. The student reports only what they played and how
   *  fast - never a verdict; the coach scores it (onQuizAnswer) and the result
   *  comes back on quiz_result. */
  const submitQuizAnswer = useCallback((auto = false) => {
    const q = quizRef.current;
    const pending = pendingQuizMoveRef.current;
    // `submittedRef` is a SYNCHRONOUS latch keyed by the item id: `myQuizSan`
    // only updates on the next render, so a Submit click and a same-frame
    // countdown tick could both pass the `myQuizSan` check and, in a run,
    // double-submit + skip an item. Item ids never repeat within a class.
    if (!q || submittedRef.current.has(q.id) || myQuizSanRef.current !== null || !pending) return;
    submittedRef.current.add(q.id);
    setMyQuizSan(pending.san);
    rememberQuizAnswer(q.id, pending.san);
    const answer: QuizAnswer = {
      quizId: q.id, userId: profile.id, name: profile.display_name,
      san: pending.san,
      ms: Math.max(0, q.seconds * 1000 - (q.endsAt - Date.now())),
    };
    setQuizAnswers((xs) => [...xs, { ...answer, correct: null }]); // broadcast skips self
    sendQuizAnswer(answer);
    // Persist the answer so it survives the class ending (0043). Additive - the
    // coach's verdict still flows through the live broadcast + score_quiz; this
    // row is for the post-class review. is_correct is written by the coach.
    if (configured && !isCoach) {
      createClient().from("classroom_responses").upsert({
        classroom_id: classroom.id, quiz_id: q.id, user_id: profile.id,
        academy_id: profile.academy_id, san: pending.san, ms: answer.ms,
        tries: quizTriesUsedRef.current || 1,
      }, { onConflict: "classroom_id,quiz_id,user_id" })
        .then(({ error }) => { if (error) console.error("classroom_responses:", error.message); });
    }
    // Self-paced Multi-Ask: advance to OUR next item, or finish.
    const items = runItemsRef.current;
    if (items.length && runIdRef.current) {
      if (runIndexRef.current < items.length - 1) {
        const nextIdx = runIndexRef.current + 1;
        const nextEv = runItemToEvent(runIdRef.current, items, nextIdx);
        setRunIndex(nextIdx);
        setQuiz(nextEv);
        setMyQuizSan(null);
        setQuizBoardFen(nextEv.fen);
        setPendingQuizMove(null);
        setQuizTriesUsed(0);
        setQuizHintShown(false);
        try { quizChessRef.current = new Chess(nextEv.fen); } catch { quizChessRef.current = null; }
        toast(`Question ${nextIdx + 1} of ${items.length}`, "info");
        return;
      }
      setMyQuizSan("done");
      toast("All questions done - waiting for the class", "success");
      return;
    }
    toast(auto ? "Time's up - your last move was submitted" : "Answer submitted - your coach will score it", "info");
  }, [profile.id, profile.display_name, profile.academy_id, isCoach, configured, classroom.id, sendQuizAnswer, toast]);

  // Quiz countdown - everyone counts against the shared endsAt timestamp; the
  // coach's clock is the one that actually ends the quiz.
  useEffect(() => {
    if (!quiz) { setQuizLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((quiz.endsAt - Date.now()) / 1000));
      setQuizLeft(left);
      // A single quiz auto-ends on the coach's clock. A self-paced run does NOT
      // (each student has their own per-item timer) - the coach ends it manually.
      if (left === 0 && isCoach && !isAdminViewer && !quiz.run) endQuiz();
      if (left === 0 && !isCoach && myQuizSanRef.current === null) {
        // Time's up on this item: submit the pending move if there is one,
        // otherwise (in a run) move on with no answer for it.
        const itemId = quiz.id;
        if (pendingQuizMoveRef.current) submitQuizAnswer(true);
        else if (runItemsRef.current.length && runIndexRef.current < runItemsRef.current.length - 1
                 && !submittedRef.current.has(itemId)) {
          submittedRef.current.add(itemId);
          const nextIdx = runIndexRef.current + 1;
          const nextEv = runItemToEvent(runIdRef.current!, runItemsRef.current, nextIdx);
          rememberQuizAnswer(itemId, ""); // mark as seen
          setRunIndex(nextIdx);
          setQuiz(nextEv);
          setQuizBoardFen(nextEv.fen);
          setPendingQuizMove(null); setQuizTriesUsed(0); setQuizHintShown(false);
          try { quizChessRef.current = new Chess(nextEv.fen); } catch { quizChessRef.current = null; }
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, isCoach]);

  /** Save the current game to the PGN library (demo §15:18). */
  async function openSave() {
    setSaveTitle(`${classroom.title} (${new Date().toLocaleDateString()})`);
    setShowSave(true);
    if (!configured) return;
    const supabase = createClient();
    const { data } = await supabase.from("pgn_folders").select("id, name").order("name");
    setFolders(data ?? []);
    if (data?.length) setSaveFolder((cur) => cur || data[0].id);
  }

  async function saveGame() {
    if (!configured) return;
    const supabase = createClient();
    const c = chessRef.current;
    const lg = loadedGameRef.current;
    // While the class stayed on the loaded game's line, save the ORIGINAL text
    // - headers, comments and all - instead of a lossy re-print.
    const onLine = lg && c.history().every((m, i) => m === lg.sans[i]);
    const pgn = onLine
      ? lg.pgn
      : (c.pgn() || `[SetUp "1"]\n[FEN "${viewFen}"]\n\n*`);
    const { error } = await supabase.from("pgns").insert({
      academy_id: profile.academy_id,
      folder_id: saveFolder || null,
      title: saveTitle.trim() || "Classroom game",
      content: pgn,
      created_by: profile.id,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Game saved to PGN library", "success");
    setShowSave(false);
  }

  // ── Class materials (PDFs) + snap-to-FEN ──────────────────────────────────
  async function openMaterials() {
    setShowMaterials(true);
    if (!configured) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from("sources").list(materialsPath);
    setMaterials((data ?? []).filter((f) => f.name !== ".emptyFolderPlaceholder"));
  }

  async function uploadMaterial(file: File) {
    const supabase = createClient();
    const { error } = await supabase.storage.from("sources")
      .upload(`${materialsPath}/${Date.now()}-${file.name}`, file);
    if (error) { toast(error.message, "error"); return; }
    toast("Uploaded", "success");
    void openMaterials();
  }

  async function openMaterial(name: string) {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("sources")
      .createSignedUrl(`${materialsPath}/${name}`, 3600);
    if (error || !data) { toast(error?.message ?? "Could not open file", "error"); return; }
    window.open(data.signedUrl, "_blank");
  }

  /** Snap a diagram (image or PDF) → FEN onto the live board (demo §14:42). */
  async function snapFile(file: File) {
    setSnapBusy(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const res = await fetch("/api/knowledge/snap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ base64: btoa(bin), mediaType: file.type || "image/png" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast(body.error ?? "Snap failed", "error"); return; }
      if (setPosition(body.fen)) {
        setShowMaterials(false);
        toast(`Diagram snapped to board (confidence ${(Number(body.confidence) * 100).toFixed(0)}%)`, "success");
      }
    } finally {
      setSnapBusy(false);
    }
  }

  async function endClassroom() {
    if (!configured) { router.back(); return; }
    // Tell whoever is still connected before the row flips to "completed".
    broadcast({ notice: "The coach has ended the class" });
    const supabase = createClient();
    const { error } = await supabase.from("classrooms")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", classroom.id);
    if (error) { toast(error.message, "error"); return; }
    // Best-effort: drop the durable snapshot (0042) now the class is over. A
    // separate update so a prod still behind 0042 (unknown column) can't fail
    // the status write above; the scheduled->live clear is the real guard.
    void supabase.from("classrooms")
      .update({ live_state: null, live_state_at: null }).eq("id", classroom.id)
      .then(() => {});
    void logActivity(profile.academy_id, profile.id, "class_end",
      { classroomId: classroom.id, detail: classroom.title });
    videoDock.stop(); // don't let the ended class's video follow the coach out as a PiP
    toast("Classroom ended", "success");
    router.push("../classrooms");
  }

  async function submitChat(e: React.FormEvent) {
    e.preventDefault();
    if (spectate) return; // silent observers never write
    const text = chatInput.trim();
    if (!text) return;
    const msg: ChatMessage = { from: profile.id, name: profile.display_name, text, at: Date.now() };
    setChat((c) => [...c, msg]);
    sendChat(msg);
    setChatInput("");
    if (configured) {
      const supabase = createClient();
      supabase.from("classroom_messages").insert({ classroom_id: classroom.id, sender_id: profile.id, text })
        .then(({ error }) => { if (error) console.error("chat persist:", error.message); });
    }
  }

  // Reveal state: › continues the class along the coach's private answer line
  // (or replays undone moves). Computed each render so the buttons stay honest.
  const lgNow = loadedGameRef.current;
  const answerIdx = lgNow ? lgNow.fens.findIndex((f) => sameBoard(f, fen)) : -1;
  const onAnswerLine = answerIdx !== -1;
  const canReveal = redoStack.current.length > 0 || onAnswerLine;
  /** The loaded PGN's comment for the position on screen - coach's eyes only. */
  const coachNote = isCoach && !isAdminViewer
    ? loadedGameRef.current?.comments.find((c) => c.fen === viewFen)?.comment?.trim()
    : undefined;

  /* Coach tool palette - a 2-column grid in the order and with the tooltips of
   * the reference toolbar (Classroom_Report.docx "Left Toolbar" +
   * MICRO_INTERACTIONS_AND_INTEGRATIONS.md §2.6). The icons the reference never
   * exercised (warning, external-link, zoom, document) carry this platform's
   * own tools. */
  type Tool = {
    icon: LucideIcon | ((p: { size?: number }) => React.ReactElement);
    label: string; onClick: () => void; active?: boolean; disabled?: boolean;
  };
  /* The palette follows the reference classroom's grouping: board controls,
   * then position/content loaders, then the teaching tools, then the session
   * controls. Our own tools that the reference has no equivalent for
   * (Whiteboard, Pawn structure, Snapshot, Mark mistake, Reward, Engine) live
   * in the Teaching group — never removed, just organised. */
  const toolGroups: Tool[][] = [
    // ── Board ────────────────────────────────────────────────────────────
    [
      { icon: Grid2x2, label: "Show Coordinates (C Key)", onClick: toggleCoords, active: showCoords },
      { icon: locked ? Lock : Unlock, label: locked ? "Unlock board (allow student moves)" : "Lock board", onClick: toggleLock, active: locked },
      { icon: LayoutGrid, label: "Customize Position (Q Key)", onClick: () => setShowCustomize(true) },
      { icon: FlipVertical2, label: `Flip Board (Current: ${orientation}) (F Key)`, onClick: flipBoard },
      { icon: RotateCcw, label: "Reset Game (R Key)", onClick: resetGame },
      { icon: ZoomIn, label: "Board theme & piece set", onClick: () => setShowSettings(true) },
      { icon: Settings2, label: "Classroom Settings (layout, board size, sound)", onClick: () => setShowClassroomSettings(true) },
    ],
    // ── Content / position loaders ───────────────────────────────────────
    [
      { icon: BookOpen, label: "Load PGN / Studies: push a game or position to the class", onClick: () => { setPanelView("library"); setTab("library"); }, active: panelView === "library" && tab === "library" },
      { icon: Database, label: "Import from the Academy Database", onClick: () => setShowDatabase(true) },
      { icon: Puzzle, label: "Lichess Puzzle: topic-based, not from a saved PGN", onClick: () => setShowLichessPuzzle(true) },
      { icon: ChevronLeft, label: browsing ? "Previous move (your view only)" : "Step the class back one move", onClick: () => (browsing ? navigate(viewPly - 1) : undo()), disabled: viewPly === 0 },
      { icon: ChevronRight, label: browsing ? "Next move (your view only)" : "Reveal the next move to the class", onClick: () => (browsing ? navigate(viewPly + 1) : revealNext()), disabled: !browsing && !canReveal },
    ],
    // ── Teaching (our custom tools live here — kept, not removed) ─────────
    [
      { icon: Hand, label: freeMode ? "Free Move off" : "Free Move (Teaching Mode): drag any piece anywhere, illegal positions allowed", onClick: () => toggleFreeMode(!freeMode), active: freeMode },
      { icon: PawnIcon, label: pawnsOnly ? "Show all the pieces again" : "Pawn structure: show only the pawns", onClick: () => setPawnsOnly((v) => !v), active: pawnsOnly },
      { icon: Presentation, label: showWhiteboard ? "Hide whiteboard" : "Whiteboard", onClick: () => {
        const next = !showWhiteboard;
        setShowWhiteboard(next);
        sendWhiteboard({ kind: next ? "open" : "close", from: profile.id });
        if (next) void logActivity(profile.academy_id, profile.id, "whiteboard",
          { classroomId: classroom.id, detail: classroom.title });
      }, active: showWhiteboard },
      { icon: Camera, label: "Snapshot position (append to lesson notes)", onClick: () => void snapshot() },
      { icon: TriangleAlert, label: "Mark mistake (red highlight on the last move)", onClick: markMistake },
      { icon: Eraser, label: "Erase Annotations (Escape Key)", onClick: () => onAnnotate([], []), disabled: !arrows.length && !highlights.length },
      { icon: hideMoves ? EyeOff : Eye, label: hideMoves ? "Show moves to students" : "Hide moves from students", onClick: toggleHideMoves, active: hideMoves },
      { icon: CircleHelp, label: "Ask a Question (quiz from the board)", onClick: openQuizSetup, active: quizActive },
      { icon: Cpu, label: engineOn ? "Stop engine analysis" : "Engine analysis", onClick: () => {
        if (engineOn) { setEngineOn(false); return; }
        setEngineOn(true); setPanelView("activity"); setTab("Engine");
      }, active: engineOn },
      { icon: Gift, label: "Reward the class", onClick: () => {
        const k = REWARD_KINDS[Math.floor(Math.random() * REWARD_KINDS.length)];
        giveReward(k.icon, k.label);
      } },
    ],
    // ── Session ─────────────────────────────────────────────────────────
    [
      { icon: paused ? Play : Pause, label: paused ? "Resume board sync" : "Pause board sync", onClick: togglePause, active: paused },
      { icon: recorder.recording ? Square : Video, label: recorder.recording ? "Stop Recording" : "Start Recording", onClick: recorder.toggle, active: recorder.recording },
      { icon: settings.sounds ? Volume2 : VolumeX, label: settings.sounds ? "Sound effects on" : "Sound effects off", onClick: () => update({ sounds: !settings.sounds }), active: settings.sounds },
      { icon: ExternalLink, label: "Pop out board (fullscreen)", onClick: popOut },
      { icon: FileText, label: "More class tools: notes, materials, save game, shortcuts", onClick: () => setShowClassTools(true) },
    ],
  ];

  /** Announce a supervisor action to everyone in the room (real-time). */
  function announce(text: string) {
    const msg: ChatMessage = { from: profile.id, name: "Supervisor", text, at: Date.now() };
    setChat((c) => [...c, msg]);
    sendChat(msg);
  }
  function removeCoach(name: string) {
    announce(`${name} (coach) was removed from the class by a supervisor.`);
    toast("Coach removed", "success");
  }
  function muteStudent(name: string) {
    announce(`${name} was muted by a supervisor.`);
    toast(`Muted ${name}`, "info");
  }
  function removeStudent(name: string) {
    announce(`${name} was removed from the class by a supervisor.`);
    toast(`Removed ${name}`, "success");
  }
  /** Admin "view as student": server mints a one-time sign-in link (audited),
   *  opens it in a new tab; the ImpersonationBanner marks + time-boxes it. */
  async function viewAsStudent(userId: string, name: string) {
    let res: Response;
    try {
      res = await fetch("/api/admin/impersonate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: userId }),
      });
    } catch { return toast("Could not reach the server", "error"); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast((body as { error?: string }).error ?? "Could not open the student view", "error");
    startImpersonation(name, profile.display_name);
    window.open((body as { url: string }).url, "_blank", "noopener");
  }

  // Board snapshots live inside the notes text, so they save with the notes.
  const snapshots = useMemo(() => parseSnapshots(notes), [notes]);

  // Session quiz leaderboard - every answer scores by its own quiz's rules.
  const leaderboard = useMemo(() => {
    const rows = new Map<string, { userId: string; name: string; points: number; answered: number }>();
    for (const a of quizAnswers) {
      const rules = quizzesRef.current[a.quizId];
      const delta = a.correct === true ? (rules?.points ?? 0) : a.correct === false ? -(rules?.negative ?? 0) : 0;
      const row = rows.get(a.userId) ?? { userId: a.userId, name: a.name, points: 0, answered: 0 };
      row.points += delta;
      row.answered += 1;
      rows.set(a.userId, row);
    }
    return [...rows.values()].sort((x, y) => y.points - x.points || x.name.localeCompare(y.name));
  }, [quizAnswers]);

  /* Multi-Ask run progress (coach view): per student, how many of the run's
   *  questions they've answered and how many they got right. Keyed off the
   *  `<runId>-<index>` quiz ids in the answer stream. */
  const runProgress = useMemo(() => {
    const run = quiz?.run;
    if (!run) return [];
    const rows = new Map<string, { name: string; done: number; correct: number }>();
    for (const a of quizAnswers) {
      if (!a.quizId.startsWith(`${run.id}-`)) continue;
      const r = rows.get(a.userId) ?? { name: a.name, done: 0, correct: 0 };
      r.done += 1;
      if (a.correct === true) r.correct += 1;
      rows.set(a.userId, r);
    }
    return roster.filter((p) => p.role === "student").map((p) => {
      const r = rows.get(p.userId);
      return { userId: p.userId, name: p.name, done: r?.done ?? 0, correct: r?.correct ?? 0 };
    });
  }, [quiz, quizAnswers, roster]);

  const movePairs: { n: number; w?: string; b?: string }[] = [];
  history.forEach((san, i) => {
    if (i % 2 === 0) movePairs.push({ n: i / 2 + 1, w: san });
    else movePairs[movePairs.length - 1].b = san;
  });

  // The simul board the coach has zoomed in on to actually play a move.
  const focusedSimul = simulFocus ? simul.boards.find((b) => b.studentId === simulFocus) ?? null : null;

  // Responses tab: every quiz/poll answer this session, grouped by question,
  // newest question first, one row per student (their latest answer wins).
  const responseGroups = (() => {
    const order: string[] = [];
    const byQuiz = new Map<string, Map<string, ScoredAnswer>>();
    for (const a of quizAnswers) {
      if (!byQuiz.has(a.quizId)) { byQuiz.set(a.quizId, new Map()); order.push(a.quizId); }
      byQuiz.get(a.quizId)!.set(a.userId, a);
    }
    return order.reverse().map((quizId) => ({
      quizId,
      answers: [...byQuiz.get(quizId)!.values()].sort((x, y) => x.name.localeCompare(y.name)),
    }));
  })();

  return (
    <div className="relative flex gap-4 h-[calc(100vh-7rem)] min-h-0 overflow-hidden" data-cr-layout={crPrefs.layout}>
      {/* Focus layout: the meeting panel is a slide-over drawer, so the board
          zone gets the full width. This button opens / closes it. */}
      {focusLayout && (
        <button
          onClick={() => setFocusPanelOpen((v) => !v)}
          title={focusPanelOpen ? "Hide meeting panel" : "Show meeting panel"}
          aria-label={focusPanelOpen ? "Hide meeting panel" : "Show meeting panel"}
          className="absolute right-3 top-3 z-50 rounded-btn border border-border bg-surface-1 p-2 shadow-md hover:bg-surface-2 no-print"
        >
          {focusPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      )}
      {/* A refused realtime channel is otherwise indistinguishable from a
          quiet class: the board simply stops agreeing with everyone else's.
          Say so on screen rather than leaving people to guess. */}
      {authError && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-card border border-destructive/40 bg-surface-1 px-4 py-2 text-sm text-destructive shadow-lg no-print">
          {authError}
        </div>
      )}
      {/* LEFT: coach tool palette - 2 columns, hugging the left of the board.
          Hidden for an admin viewing someone else's class: read-only board,
          no teaching/board-setup tools. */}
      {isCoach && !isAdminViewer && (
        <div className="shrink-0 self-start no-print rounded-card border border-border bg-surface-1 p-2 flex flex-col gap-2 overflow-y-auto max-h-full">
          {toolGroups.map((group, gi) => (
            <div
              key={gi}
              className={`grid grid-cols-2 gap-1.5 content-start ${gi > 0 ? "pt-2 border-t border-border" : ""}`}
            >
              {group.map((t) => (
                <button
                  key={t.label}
                  title={t.label}
                  aria-label={t.label}
                  onClick={t.onClick}
                  disabled={t.disabled}
                  className={`w-9 h-9 rounded-btn border flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    t.active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface-2 hover:bg-surface-3 text-foreground"
                  }`}
                >
                  <t.icon size={17} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* CENTER: shared board, sitting inside its own card so it reads as one
          piece of furniture instead of floating in empty space. flex-1 makes
          this zone eat the leftover width, which pushes the right panel to the
          edge of the screen. */}
      <div
        ref={boardZoneRef}
        className="flex-1 min-w-0 min-h-0 flex flex-col items-center gap-2 rounded-card border border-border bg-surface-1 p-3"
      >
        {/* Coach: swap the centre between the shared teaching board and the
            simul grid (every student's game at once). */}
        {isCoach && !isAdminViewer && (
          <div className="flex w-full shrink-0 items-center justify-between gap-2 no-print">
            <SegmentedTabs
              tabs={["Board", "Simul grid"]}
              active={centerView === "simul" ? "Simul grid" : "Board"}
              onChange={(v) => {
                const on = v === "Simul grid";
                setCenterView(on ? "simul" : "board");
                // Tell students to start / stop mirroring their board.
                broadcast({ simulActive: on });
                if (on) sendSimulConfig({ clockMs: simulClockMin * 60_000 });
                if (!on) { simul.clear(); setSimulFocus(null); }
              }}
            />
            {centerView === "simul" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-1">
                  clock
                  <select
                    value={simulClockMin}
                    onChange={(e) => {
                      const m = Number(e.target.value);
                      setSimulClockMin(m);
                      sendSimulConfig({ clockMs: m * 60_000 });
                    }}
                    className="rounded-btn border border-border bg-surface-1 px-1.5 py-0.5"
                  >
                    <option value={0}>off</option>
                    <option value={3}>3m</option>
                    <option value={5}>5m</option>
                    <option value={10}>10m</option>
                    <option value={15}>15m</option>
                  </select>
                </label>
                <span className="tabular-nums">{simul.boards.length} {simul.boards.length === 1 ? "game" : "games"}</span>
              </div>
            )}
          </div>
        )}
        {/* The board sizes itself: `aspect-ratio: 1` + `height: 100%` + `max-width:
            100%` resolves to a min(availW, availH) square with zero JS, in the
            flex row this role's layout gives it. chessground fills it via its own
            container-query sizing and re-measures on its own ResizeObserver. */}
        <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
        {centerView === "simul" ? (
        <div className="flex h-full w-full flex-col gap-2">
          {focusedSimul && (
            <div className="flex shrink-0 items-center justify-between gap-2 no-print">
              <span className="text-sm font-medium truncate">
                Playing <span className="text-primary-hover">{focusedSimul.name}</span>
                {focusedSimul.result
                  ? <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-bold">{focusedSimul.result}</span>
                  : typeof focusedSimul.clockMs === "number"
                    ? <span className={`ml-2 tabular-nums text-xs font-semibold ${focusedSimul.clockMs <= 30_000 ? "text-destructive" : "text-muted-foreground"}`}>{formatClock(focusedSimul.clockMs)}</span>
                    : focusedSimul.away && <span className="ml-2 text-xs text-warning">away</span>}
              </span>
              <button
                onClick={() => setSimulFocus(null)}
                className="rounded-btn border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
              >
                ← All boards
              </button>
            </div>
          )}
          {focusedSimul ? (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <div style={{ height: "100%", aspectRatio: "1 / 1", maxWidth: "100%" }}>
                  <ChessBoard
                    key={`simul-${simulFocus}-${simulNonce}`}
                    fen={focusedSimul.fen}
                    orientation={orientation}
                    coordinates={showCoords}
                    movable={!focusedSimul.result}
                    lastMove={focusedSimul.lastMove}
                    boardTheme={settings.boardTheme}
                    pieceSet={settings.pieceSet}
                    onMove={(from, to) => {
                      if (!playSimulMove(focusedSimul.studentId, from, to)) {
                        illegalMove();
                        setSimulNonce((n) => n + 1);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="h-32 shrink-0 overflow-hidden">
                <SimulGrid boards={simul.boards} focusedId={simulFocus} onFocus={setSimulFocus} pieceSet={settings.pieceSet} />
              </div>
            </>
          ) : (
            <SimulGrid boards={simul.boards} focusedId={simulFocus} onFocus={setSimulFocus} pieceSet={settings.pieceSet} />
          )}
        </div>
        ) : (
        <div className="relative" style={{ height: "100%", aspectRatio: "1 / 1", maxWidth: "100%" }}>
          <ChessBoard
            ref={boardRef}
            fen={solvingQuiz ? (quizBoardFen ?? viewFen) : pawnsOnly ? pawnStructureFen(viewFen) : viewFen}
            orientation={orientation}
            coordinates={showCoords}
            blindfold={settings.blindfold}
            movable={solvingQuiz ? (myQuizSan === null && quizLeft > 0 && (!quiz?.attempts || quizTriesUsed < quiz.attempts)) : canMove && !browsing && !pawnsOnly}
            free={freeMode && canMove && !solvingQuiz}
            icons={solvingQuiz ? NO_ICONS : icons}
            blockedSquares={!solvingQuiz && gamify ? blockedSquares : undefined}
            arrows={solvingQuiz ? NO_ARROWS : arrows}
            highlights={solvingQuiz ? NO_HIGHLIGHTS : highlights}
            lastMove={solvingQuiz || browsing ? undefined : lastMove}
            lastMoveMode={settings.lastMoves}
            check={!solvingQuiz && !freeMode && !browsing && chessRef.current.inCheck()}
            showLegal={settings.legalMoves === "dots"}
            boardTheme={settings.boardTheme}
            pieceSet={settings.pieceSet}
            animation={settings.animation}
            smoothMoves={settings.smoothMoves}
            dragAnimation={settings.dragAnimation}
            highlightChecks={settings.highlightChecks}
            pieceShadows={settings.pieceShadows}
            moveTrails={settings.moveTrails}
            premove={settings.premove}
            boardZoom={effectiveBoardZoom}
            onMove={solvingQuiz ? onQuizMove : onMove}
            onFreeMove={onFreeMove}
            onAnnotate={onAnnotate}
          />
          {/* Gamify celebration overlay - CSS-dot confetti on captures */}
          {burst.map((b) => (
            <span key={b.id} aria-hidden
              className="absolute bottom-1/3 w-3 h-3 rounded-full gamify-pop pointer-events-none"
              style={{ left: `${b.left}%`, background: b.color }} />
          ))}
          {/* Reward drops (Trophy / star / treat) - coach-fired or on a correct
              quiz answer, Framer Motion, mirrored to everyone over `reward`. */}
          <RewardOverlay rewards={rewards} meId={profile.id} />
          {promo && (
            <PromotionPicker
              color={promo.color}
              pieceSet={settings.pieceSet}
              onPick={finishPromotion}
              onCancel={cancelPromotion}
            />
          )}
          {/* Whiteboard draw layer (coach) */}
          {!spectate && (
            <Whiteboard
              open={showWhiteboard}
              onClose={() => { setShowWhiteboard(false); if (isCoach) sendWhiteboard({ kind: "close", from: profile.id }); }}
              canDraw={isCoach || studentsCanDraw}
              myUserId={profile.id}
              ref={whiteboardRef}
              onSend={sendWhiteboard}
              studentPermission={isCoach ? {
                allowed: studentsCanDraw,
                onToggle: () => {
                  const next = !studentsCanDraw;
                  setStudentsCanDraw(next);
                  sendWhiteboardPermission({ userId: "*", allowed: next });
                },
              } : undefined}
            />
          )}
        </div>
        )}
        </div>
        {/* The PGN's own commentary for this position - the coach's teaching
            notes. Rendered locally for the coach and never sent anywhere.
            The slot keeps a fixed height whether or not there's a note, so a
            note appearing mid-walkthrough never resizes the board above it. */}
        {isCoach && !isAdminViewer && (
          <div className="w-full shrink-0 min-h-[1.75rem] no-print">
            {coachNote && (
              <div className="rounded-btn border border-warning/40 bg-warning/10 px-3 py-1 text-xs truncate">
                <b className="text-warning">Coach note:</b> {coachNote}
              </div>
            )}
          </div>
        )}
        {/* Under the board: who moves, and your connection. Nothing else. */}
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground no-print shrink-0 w-full border-t border-border pt-2 px-1">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-semibold text-foreground shadow-sm">
            <span
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                viewFen.split(" ")[1] === "b" ? "bg-neutral-900 ring-1 ring-white/40" : "bg-white ring-1 ring-black/30"
              }`}
            />
            {viewFen.split(" ")[1] === "b" ? "Black" : "White"} to move
            {!isCoach && mySide && (
              <b className="ml-1">· you play {mySide === "both" ? "both sides" : mySide === "w" ? "White" : "Black"}</b>
            )}
          </span>

          {/* Puzzle stepper - walk the last-browsed folder without reopening
              the library. Lives on the board, where the coach already is. */}
          {isCoach && libGames.length > 0 && (
            <span className="flex items-center gap-1.5">
              <button
                onClick={() => loadLibIndex(libAt - 1)}
                disabled={libAt <= 0}
                title="Previous puzzle in this folder"
                className="rounded-btn border border-border bg-surface-2 px-2 py-1 hover:bg-surface-3 disabled:opacity-30 transition-colors"
              >
                ‹ Prev
              </button>
              <span className="tabular-nums">
                {libAt >= 0
                  ? `${libAt + 1} of ${libGames.length}`
                  : `${libGames.length} ${libGames.length === 1 ? "game" : "games"}`}
              </span>
              <button
                onClick={() => loadLibIndex(libAt + 1)}
                disabled={libAt >= libGames.length - 1}
                title="Next puzzle in this folder"
                className="rounded-btn border border-primary bg-primary text-primary-foreground px-2 py-1 hover:bg-primary-hover disabled:opacity-30 transition-colors font-medium"
              >
                Next puzzle ›
              </button>
            </span>
          )}

          <NetworkMeter />
        </div>
        {/* The engine read-out lives in the Engine tab (EvalBar + lines +
            "Play best move"). The old under-board strip re-rendered on every
            UCI info tick and shared a flex column with the board, which was a
            source of board jitter. */}
      </div>

      {/* Divider - drag to trade width between the board zone and the meeting
          panel, like the reference classroom. Arrow keys nudge it when focused. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={dragDivider}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault(); e.stopPropagation();
          setPanelW((w) => Math.min(600, Math.max(280, w + (e.key === "ArrowLeft" ? 16 : -16))));
        }}
        className={`shrink-0 self-stretch w-1.5 rounded-full bg-border hover:bg-primary/60 active:bg-primary cursor-col-resize no-print focus:outline-none focus:ring-2 focus:ring-primary/50 ${focusLayout ? "hidden" : ""}`}
      />

      {/* RIGHT: meeting panel. shrink-0, min-h-0/min-w-0 - it owns its own
          column and can never take height from the board (see
          playmate-ui-analysis.md §2). Width comes from the divider above. */}
      <div
        className={`flex flex-col gap-2 shrink-0 ml-auto h-full min-h-0 min-w-0 no-print ${
          focusLayout
            ? `absolute inset-y-0 right-0 z-40 rounded-l-card border-l border-border bg-surface-1 p-3 shadow-2xl transition-transform duration-200 ${focusPanelOpen ? "translate-x-0" : "translate-x-full"}`
            : ""
        }`}
        style={{ width: panelW }}
      >
        {isAdmin && (
          <div className="shrink-0 flex items-center gap-2 rounded-btn border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">
            <Eye size={14} className="text-primary shrink-0" />
            <span className="font-medium">Supervising as {profile.role === "ceo" ? "CEO" : "Manager"}</span>
          </div>
        )}
        {isAdmin && (
          <details className="shrink-0 rounded-btn border border-border bg-surface-2 px-3 py-2 text-xs [&_summary]:cursor-pointer">
            <summary className="font-medium select-none">Fallback link</summary>
            <div className="mt-2 flex gap-2">
              <input
                type="url" placeholder="Google Meet / Zoom URL"
                value={fallbackUrl} onChange={(e) => setFallbackUrl(e.target.value)}
                className="flex-1 min-w-0 rounded-btn border border-border bg-surface-1 px-2 py-1.5"
              />
              <Button variant="secondary" onClick={saveFallback} disabled={savingFallback}>
                {savingFallback ? "Saving…" : "Save"}
              </Button>
            </div>
          </details>
        )}
        {/* Video area. Docked in this column, resizable by height, never
            negotiating size with the board (playmate-ui-analysis.md §2). The
            <MeshVideoRoom> itself is mounted by VideoDockProvider above the
            router; <VideoDockSlot> just reserves this space and it portals in.
            Navigate away and it detaches into a floating PiP card. */}
        <div className="relative shrink-0 overflow-hidden" style={{ height: videoExpanded ? videoHeight : undefined }}>
          {/* Quiz running: students' screen share is paused so they solve alone. */}
          {quizActive && !isCoach ? (
            <div className="h-full bg-surface-1 border border-primary rounded-card flex flex-col items-center justify-center gap-2 p-4 text-center">
              <ListChecks size={28} className="text-primary" />
              <p className="text-sm font-medium">
                {runItems.length ? `Question ${Math.min(runIndex + 1, runItems.length)} of ${runItems.length}` : "Quiz in progress"}
              </p>
              {quiz && myQuizSan !== "done" && (
                <p className={`text-2xl font-bold tabular-nums ${quizLeft <= 10 ? "text-destructive" : "text-primary-hover"}`}>
                  {Math.floor(quizLeft / 60)}:{String(quizLeft % 60).padStart(2, "0")}
                </p>
              )}
              {myQuizSan === "done" ? (
                <p className="text-xs font-medium text-success">All questions done — waiting for the class</p>
              ) : myQuizSan ? (
                <p className="text-xs font-medium text-success">Submitted: {myQuizSan}</p>
              ) : quizLeft > 0 ? (
                <div className="flex gap-2">
                  <Button variant="ghost" className="!py-1 !px-2 text-xs" onClick={() => setQuizPopupOpen(true)}>Open board</Button>
                  {pendingQuizMove && (
                    <Button className="!py-1 !px-2 text-xs" onClick={() => submitQuizAnswer(false)}>Submit {pendingQuizMove.san}</Button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Time&apos;s up.</p>
              )}
            </div>
          ) : spectate ? (
            <div className="h-full">
              <MeshVideoRoom
                classroomId={classroom.id}
                me={{ userId: profile.id, name: profile.display_name, role: profile.role }}
                viewOnly
              />
            </div>
          ) : classroom.meeting_url ? (
            <div className="h-full bg-surface-1 border border-border rounded-card flex flex-col items-center justify-center gap-3 p-4 text-center">
              <p className="text-sm text-muted-foreground">This class uses an external meeting link.</p>
              <a href={classroom.meeting_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center justify-center rounded-btn px-4 py-2 bg-primary hover:bg-primary-hover text-primary-foreground font-medium">
                Join meeting ↗
              </a>
            </div>
          ) : videoDock.isLive(classroom.id) ? (
            <VideoDockSlot className="h-full" />
          ) : (
            <button
              onClick={() => setShowPreflight(true)}
              className="w-full flex items-center justify-center gap-2 rounded-card border border-border bg-surface-1 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            >
              <Video size={16} /> Start video meeting
            </button>
          )}
        </div>
        <PreflightModal
          open={showPreflight}
          classroomId={classroom.id}
          onCancel={() => setShowPreflight(false)}
          onStart={(d) => {
            setShowPreflight(false);
            videoDock.start({
              classroomId: classroom.id,
              me: { userId: profile.id, name: profile.display_name, role: profile.role },
              devices: d,
            });
          }}
        />

        {videoExpanded && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize video area"
            tabIndex={0}
            title="Drag to resize"
            onPointerDown={dragVideoHeight}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault(); e.stopPropagation();
              setVideoHeight((h) => Math.min(520, Math.max(160, h + (e.key === "ArrowUp" ? -16 : 16))));
            }}
            className="shrink-0 self-stretch h-1.5 rounded-full bg-border hover:bg-primary/60 active:bg-primary cursor-row-resize no-print focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        )}

        {quizActive && isCoach && (
          <div className="shrink-0 bg-primary/10 border border-primary rounded-card px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium flex items-center gap-2">
                <ListChecks size={16} className="text-primary" />
                {quiz?.run ? `Multi-Ask · ${quiz.run.total} questions` : "Quiz running"}
                {quiz && !quiz.run && (
                  <span className="tabular-nums text-muted-foreground">
                    · {Math.floor(quizLeft / 60)}:{String(quizLeft % 60).padStart(2, "0")}
                    {" · "}{quizAnswers.filter((a) => a.quizId === quiz.id).length} answered
                  </span>
                )}
              </span>
              <Button variant="secondary" className="!py-1 !px-3 text-sm" onClick={endQuiz}>End{quiz?.run ? " run" : " quiz"}</Button>
            </div>
            {quiz?.run && runProgress.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
                {runProgress.map((r) => (
                  <div key={r.userId} className="flex items-center gap-2 text-xs">
                    <span className="truncate flex-1">{r.name}</span>
                    <span className="tabular-nums text-muted-foreground">{r.done}/{quiz.run!.total}</span>
                    <span className="tabular-nums text-success w-8 text-right">{r.correct ? `${r.correct}✓` : ""}</span>
                    <span className="h-1.5 w-16 rounded-full bg-surface-3 overflow-hidden">
                      <span className="block h-full bg-primary" style={{ width: `${(r.done / quiz.run!.total) * 100}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Activity / Library toggle, then the tab strip for whichever side is
            selected. An admin here only to moderate never sees Library (loading
            PGNs is a teaching action) - the toggle collapses for them. */}
        {!isAdminViewer && (
          <div className="shrink-0">
            <SegmentedTabs
              tabs={["Activity", "Library"]}
              active={panelView === "activity" ? "Activity" : "Library"}
              onChange={(v) => {
                const next = v === "Activity" ? "activity" : "library";
                setPanelView(next);
                setTab(next === "activity" ? "Moves" : "library");
              }}
            />
          </div>
        )}
        {/* 5 activity tabs in a panel as narrow as 280px. "Leaderboard" and
            "Participants" used to render as one word ("LeaderboardParticipants")
            because the labels filled their flex cells edge to edge. Short
            display labels + `min-w-0 truncate` keep them separated and, at the
            extreme, clip one label rather than push the panel out of bounds.
            The TabId values are unchanged, so every `tab === "..."` check still
            works. */}
        <div className="flex items-stretch gap-0.5 border-b border-border shrink-0">
          {(panelView === "activity" || isAdminViewer
            ? (isCoach && !isAdminViewer ? COACH_ACTIVITY_TABS : ACTIVITY_TABS).map((id) => ({ id, label: id }))
            : LIBRARY_TABS
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              className={`flex-1 min-w-0 truncate px-1.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? "border-primary text-primary-hover" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_SHORT_LABEL[t.label as TabId] ?? t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto bg-surface-1 border border-border rounded-card p-3 min-h-0">
          {tab === "library" && (
            <GamesLibrary
              academyId={profile.academy_id}
              onLoad={(content, title) => {
                setLibAt(libGames.findIndex((g) => g.content === content));
                loadPgn(content, title);
              }}
              onAsk={askFromLibrary}
              onGamesChange={setLibGames}
            />
          )}

          {tab === "Leaderboard" && (
            <div className="border border-border rounded-card overflow-hidden">
              <div className="grid grid-cols-4 gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                <span>#</span><span>Student</span><span>Points</span><span>Quizzes</span>
              </div>
              {leaderboard.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground border-t border-border">
                  No scores yet
                </p>
              ) : leaderboard.map((r, i) => (
                <div key={r.userId}
                  className={`grid grid-cols-4 gap-2 px-3 py-2.5 text-sm border-t border-border ${r.userId === profile.id ? "bg-primary/10" : ""}`}>
                  <span className="font-semibold tabular-nums">{`#${i + 1}`}</span>
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="tabular-nums">{r.points}</span>
                  <span className="tabular-nums text-muted-foreground">{r.answered} quiz{r.answered === 1 ? "" : "zes"}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "Responses" && (
            <div className="flex flex-col gap-4">
              {responseGroups.length === 0 ? (
                <p className="bg-surface-2 border border-border rounded-card py-8 text-center text-sm text-muted-foreground">
                  No responses yet. Launch a question and each student&apos;s answer lands here — privately, only you see it.
                </p>
              ) : responseGroups.map((g, gi) => (
                <div key={g.quizId} className="rounded-card border border-border overflow-hidden">
                  <div className="flex items-center justify-between gap-2 bg-surface-2 px-3 py-2 text-xs font-semibold">
                    <span>Question {responseGroups.length - gi}</span>
                    <span className="text-muted-foreground tabular-nums">{g.answers.length} {g.answers.length === 1 ? "reply" : "replies"}</span>
                  </div>
                  {g.answers.map((a) => (
                    <div key={a.userId} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-border px-3 py-2 text-sm">
                      <span className="truncate font-medium">{a.name}</span>
                      <span className="font-mono text-xs">{a.san}</span>
                      <span className="flex items-center gap-1.5 tabular-nums text-xs text-muted-foreground">
                        {(a.ms / 1000).toFixed(1)}s
                        {a.correct === true && <Check size={13} className="text-success" />}
                        {a.correct === false && <X size={13} className="text-destructive" />}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === "Syllabus" && (
            <div className="flex flex-col gap-3">
              {isCoach && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addSyllabusItem(); }}>
                  <Input className="flex-1" placeholder="Add a topic, e.g. Sicilian Defense Masterclass"
                    value={newSyllabusItem} onChange={(e) => setNewSyllabusItem(e.target.value)} />
                  <Button type="submit" disabled={!newSyllabusItem.trim()}>Add</Button>
                </form>
              )}
              {syllabus.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No topics yet</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {syllabus.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-btn border border-border bg-surface-2">
                      <button
                        onClick={() => toggleSyllabusItem(s.id)}
                        disabled={!isCoach}
                        title={s.done ? "Completed" : "Mark completed"}
                        className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center text-[10px] transition-colors ${
                          s.done ? "bg-success border-success text-white" : "border-border"
                        }`}
                      >
                        {s.done && <Check size={12} />}
                      </button>
                      <span className={`flex-1 text-sm ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.title}</span>
                      {isCoach && (
                        <button onClick={() => removeSyllabusItem(s.id)} aria-label="Remove"
                          className="text-muted-foreground hover:text-destructive text-xs px-1"><X size={12} /></button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "Participants" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-medium">Participants</h3>
                <span className="text-xs text-muted-foreground tabular-nums">{roster.length} in room</span>
              </div>
              {roster.filter((p) => p.role === "student").length === 0 && (
                <p className="text-sm text-muted-foreground">No students yet</p>
              )}
              {roster.map((p) => {
                const isWhite = sides.white === p.userId;
                const isBlack = sides.black === p.userId;
                return (
                <div key={p.userId} className="flex items-center gap-2">
                  <span aria-hidden className="w-2 h-2 rounded-full bg-live shrink-0" title="In the classroom" />
                  <Avatar name={p.name} avatar={p.avatar} seed={p.userId} role={p.role} size={28} />
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  {(isWhite || isBlack) && (
                    <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium">
                      {isWhite && isBlack ? "Both" : isWhite ? "White" : "Black"}
                    </span>
                  )}
                  <span className="flex-1" />

                  {/* Coach: set who this student may play (White / Black / Lock) */}
                  {isCoach && p.role === "student" && (
                    <div className="flex items-center gap-1">
                      <PermBtn active={isWhite && !isBlack} onClick={() => assignSide(p.userId, "white")} title="Let this student play White">White</PermBtn>
                      <PermBtn active={isBlack && !isWhite} onClick={() => assignSide(p.userId, "black")} title="Let this student play Black">Black</PermBtn>
                      <PermBtn active={isWhite && isBlack} onClick={() => assignSide(p.userId, "both")} title="Let this student play BOTH colours, ideal for solving a puzzle">Both</PermBtn>
                      <PermBtn active={!isWhite && !isBlack} onClick={() => assignSide(p.userId, "")} title="Lock: this student cannot move">Lock</PermBtn>
                      <button
                        onClick={() => giveReward("star", "Gold star", p.userId)}
                        title={`Give ${p.name} a gold star`}
                        className="grid h-6 w-6 place-items-center rounded-btn border border-border text-warning hover:bg-warning/10"
                      >
                        <Gift size={13} />
                      </button>
                    </div>
                  )}

                  {/* Manager/CEO: moderation controls, hidden from coach/student */}
                  {isAdmin && (
                    <div className="flex gap-1">
                      {p.role === "student" && (
                        <>
                          <PermBtn onClick={() => viewAsStudent(p.userId, p.name)} title="Open this student's dashboard as them (audited)">View as</PermBtn>
                          <PermBtn onClick={() => muteStudent(p.name)} title="Mute this student">Mute</PermBtn>
                          <PermBtn danger onClick={() => removeStudent(p.name)} title="Remove this student">Remove</PermBtn>
                        </>
                      )}
                      {p.role === "coach" && (
                        <PermBtn danger onClick={() => removeCoach(p.name)} title="Remove the coach">Remove coach</PermBtn>
                      )}
                    </div>
                  )}

                  {!isCoach && !isAdmin && !isWhite && !isBlack && (
                    <span className="text-xs text-muted-foreground capitalize">{p.role}</span>
                  )}
                </div>
              );})}
            </div>
          )}

          {tab === "Chat" && (
            <div className="flex flex-col h-full">
              <div className="flex-1 overflow-y-auto flex flex-col gap-2 mb-2">
                {chat.map((m, i) => (
                  <div key={i} className={`max-w-[85%] ${m.from === profile.id ? "self-end" : ""}`}>
                    <p className="text-[11px] text-muted-foreground">
                      {m.name} · {new Date(m.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className={`text-sm rounded-card px-3 py-1.5 ${m.from === profile.id ? "bg-primary/25" : "bg-surface-3"}`}>{m.text}</p>
                  </div>
                ))}
                {chat.length === 0 && <p className="text-sm text-muted-foreground">No messages</p>}
              </div>
              {!spectate && (
                <form onSubmit={submitChat} className="flex gap-2">
                  <Input className="flex-1" placeholder="Type your message…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
                  <Button type="submit" aria-label="Send"><Send size={14} /></Button>
                </form>
              )}
            </div>
          )}

          {tab === "Moves" && (
            <div>
                <div className="mt-1">
                  {hideMoves && !isCoach ? (
                    <p className="bg-surface-2 border border-border rounded-card py-8 text-center text-sm text-muted-foreground">
                      Moves hidden by coach
                    </p>
                  ) : movePairs.length === 0 ? (
                    <p className="bg-surface-2 border border-border rounded-card py-8 text-center text-sm text-muted-foreground">
                      No moves yet
                    </p>
                  ) : (
                    <table className="w-full text-sm bg-surface-2 border border-border rounded-card">
                      <tbody>
                        {movePairs.map((p) => (
                          <tr key={p.n} className="border-t border-border first:border-0">
                            <td className="py-1 pl-3 pr-2 text-muted-foreground w-8">{p.n}</td>
                            <td className={`py-1 pr-2 cursor-pointer ${viewPly === p.n * 2 - 1 ? "text-primary-hover font-semibold" : ""}`}
                                onClick={() => navigate(p.n * 2 - 1)}>
                              {p.w && <FigurineSan san={p.w} ply={p.n * 2 - 1} pieceSet={settings.pieceSet} />}
                            </td>
                            <td className={`py-1 cursor-pointer ${viewPly === p.n * 2 ? "text-primary-hover font-semibold" : ""}`}
                                onClick={() => p.b && navigate(p.n * 2)}>
                              {p.b && <FigurineSan san={p.b} ply={p.n * 2} pieceSet={settings.pieceSet} />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {/* The rest of the loaded game - the ANSWER - coach only. */}
                  {isCoach && lgNow && onAnswerLine && (
                    <div className="mt-3 rounded-btn border border-warning/40 bg-warning/10 px-3 py-2">
                      <p className="text-[11px] font-semibold text-warning mb-0.5">● answer line (you only)</p>
                      <p className="text-sm font-mono break-words">{lgNow.sans.slice(answerIdx).join(" ")}</p>
                    </div>
                  )}
                  {isCoach && (
                    <div className="flex justify-center gap-3 mt-4">
                      <button onClick={undo} title="Take the last move back (for everyone)"
                        className="w-11 h-11 rounded-btn bg-surface-2 border border-border hover:bg-surface-3 transition-colors">↺</button>
                      <button onClick={revealNext} disabled={!canReveal} title="Reveal the next move (for everyone)"
                        className="w-11 h-11 rounded-btn bg-surface-2 border border-border hover:bg-surface-3 transition-colors disabled:opacity-30">↻</button>
                    </div>
                  )}
                </div>
            </div>
          )}

          {tab === "Engine" && (
            <div className="flex flex-col gap-3">
              {!isCoach ? (
                <p className="text-sm text-muted-foreground">Coach tool.</p>
              ) : !engineOn ? (
                <div className="flex flex-col items-start gap-2">
                  <Button onClick={() => setEngineOn(true)}>
                    <Cpu size={14} /> Start engine
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-stretch gap-3">
                    <div className="h-40">
                      <EvalBar
                        score={lines[0]?.score ?? 0}
                        mate={lines[0]?.mate ?? null}
                        sideToMove={viewFen.split(" ")[1] === "b" ? "b" : "w"}
                        orientation={orientation}
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-center gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold tabular-nums">{formatScore(lines[0])}</span>
                        <span className="text-xs text-muted-foreground">
                          depth {depth} · {engineState === "thinking" ? "thinking…" : "Stockfish 17.1"}
                        </span>
                      </div>
                      <button
                        onClick={playBestMove}
                        disabled={!lines[0] || browsing}
                        className="w-fit rounded-btn bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
                      >
                        ▶ Play best move for the class
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {lines.map((l, i) => (
                      <div key={l.multipv} className="rounded-btn border border-border bg-surface-2 px-2.5 py-1.5 text-sm">
                        <span className={`mr-2 tabular-nums font-semibold ${i === 0 ? "text-primary-hover" : "text-muted-foreground"}`}>
                          {formatScore(l)}
                        </span>
                        <span className="break-all text-muted-foreground">{l.pv.slice(0, 10).join(" ")}</span>
                      </div>
                    ))}
                    {lines.length === 0 && <p className="text-sm text-muted-foreground">Thinking…</p>}
                  </div>
                  <button
                    onClick={() => setEngineOn(false)}
                    className="w-fit text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    Stop engine
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Title + session actions - compact, pinned at the foot of the panel
            (reference keeps class title + End/Load pinned here). Kept short so
            the scrolling tab content above it stays usable. */}
        <div className="bg-surface-1 border border-border rounded-card px-3 py-2 shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              {editingTopic ? (
                <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void saveTopic(); }}>
                  <Input autoFocus className="flex-1 !py-1 !text-xs" placeholder="e.g. Sicilian Defense Masterclass"
                    value={topic} onChange={(e) => setTopic(e.target.value)} />
                  <Button type="submit" className="!py-1 !px-2.5 text-xs">Save</Button>
                </form>
              ) : (
                <>
                  <p className="text-sm font-semibold truncate leading-tight" title={classroom.title}>{classroom.title}</p>
                  {topic ? (
                    <button onClick={() => isCoach && setEditingTopic(true)} disabled={!isCoach}
                      className="block text-xs text-primary-hover truncate disabled:cursor-default" title={isCoach ? "Edit topic" : undefined}>
                      {topic}
                    </button>
                  ) : isCoach ? (
                    <button onClick={() => setEditingTopic(true)} className="block text-xs text-muted-foreground hover:text-foreground">
                      + Set a topic
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground truncate">Instructor: {classroom.coach?.display_name ?? ""}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="Session logs" onClick={() => setShowLogs(true)}
                className="w-7 h-7 rounded-btn hover:bg-surface-3 flex items-center justify-center text-muted-foreground">
                <ScrollText size={14} />
              </button>
              <button title="Board settings" onClick={() => setShowSettings(true)}
                className="w-7 h-7 rounded-btn hover:bg-surface-3 flex items-center justify-center text-muted-foreground">
                <Settings size={14} />
              </button>
              <button title="Print a lesson summary" onClick={() => window.print()}
                className="w-7 h-7 rounded-btn hover:bg-surface-3 flex items-center justify-center text-muted-foreground">
                <ScrollText size={14} />
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            {!spectate && !isAdminViewer && (
              <Button
                variant={helpRequestOpen ? "secondary" : "secondary"}
                className="flex-1 !py-1.5 !text-xs"
                onClick={callManager}
                disabled={helpRequestOpen}
              >
                {helpRequestOpen ? "Manager notified" : "Call Manager"}
              </Button>
            )}
            {isCoach && !isAdminViewer && (
              <>
                <Button className="flex-1 !py-1.5 !text-xs" onClick={() => { setPanelView("library"); setTab("library"); }}>Studies</Button>
                <Button variant="danger" className="flex-1 !py-1.5 !text-xs" onClick={endClassroom}>End</Button>
              </>
            )}
            {isAdminViewer && (
              <Button variant="danger" className="flex-1 !py-1.5 !text-xs" onClick={endClassroom}>End Classroom</Button>
            )}
            {!isCoach && (
              <Button variant="secondary" className="flex-1 !py-1.5 !text-xs" onClick={openMaterials}>Materials</Button>
            )}
          </div>
        </div>
      </div>

      {/* Print-only lesson summary */}
      <div className="hidden print:block fixed inset-0 bg-white text-black p-8">
        <h1 className="text-2xl font-bold mb-2">{classroom.title}</h1>
        <p className="mb-4">Instructor: {classroom.coach?.display_name}</p>
        <p className="font-mono text-sm mb-4">Position: {viewFen}</p>
        <h2 className="font-semibold mb-1">Moves</h2>
        <p className="mb-4">{history.join(" ") || ""}</p>
        <h2 className="font-semibold mb-1">Notes</h2>
        <pre className="whitespace-pre-wrap text-sm">{notes || ""}</pre>
      </div>

      {/* Academy Database - spacious centered modal, opened from the left
          toolbar's "Import Database" button (no longer a cramped right-panel tab). */}
      <MasterDatabase
        academyId={profile.academy_id}
        open={showDatabase}
        onClose={() => setShowDatabase(false)}
        onLoad={loadPgn}
      />

      {/* Lichess Puzzle - topic-based puzzles from Lichess's public API
          (client req #6), separate from the PGN-library puzzle stepper. */}
      <Modal open={showLichessPuzzle} onClose={() => setShowLichessPuzzle(false)} title="Lichess Puzzle">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Pick a topic, loads a fresh puzzle position onto the board for everyone.</p>
          <div className="grid grid-cols-2 gap-2">
            {LICHESS_PUZZLE_THEMES.map((t) => (
              <Button key={t.id} variant="secondary" disabled={!!puzzleLoading}
                onClick={() => void loadLichessPuzzle(t.id)}>
                {puzzleLoading === t.id ? "Loading…" : t.label}
              </Button>
            ))}
          </div>
          {lastPuzzle && (
            <p className="text-xs text-muted-foreground">
              Last loaded: rated {lastPuzzle.rating} · solution {lastPuzzle.solutionSan.join(" ")}
            </p>
          )}
        </div>
      </Modal>

      {/* Customize Position - full board / FEN editor (toolbar grid icon) */}
      <CustomizePosition
        open={showCustomize}
        onClose={() => setShowCustomize(false)}
        classroomId={classroom.id}
        fen={viewFen}
        gamify={gamify}
        onGamify={(on) => { if (on !== gamify) toggleGamify(); }}
        onApply={(f, ic) => setPosition(f, true, ic)}
      />

      {/* Modals */}
      <Modal open={showLogs} onClose={() => setShowLogs(false)} title="Session logs" wide>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto">{logs.join("\n")}</pre>
        )}
      </Modal>

      {/* The reference toolbar's document icon: this platform's own extras. */}
      <Modal open={showClassTools} onClose={() => setShowClassTools(false)} title="Class tools">
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: StickyNote, label: "Lesson notes", onClick: () => { setShowClassTools(false); setShowNotes(true); } },
            { icon: Presentation, label: showWhiteboard ? "Hide whiteboard" : "Whiteboard", onClick: () => {
              setShowClassTools(false);
              const next = !showWhiteboard;
              setShowWhiteboard(next);
              sendWhiteboard({ kind: next ? "open" : "close", from: profile.id });
              if (next) void logActivity(profile.academy_id, profile.id, "whiteboard",
                { classroomId: classroom.id, detail: classroom.title });
            } },
            { icon: Paperclip, label: "Class materials", onClick: () => { setShowClassTools(false); void openMaterials(); } },
            { icon: Camera, label: "Snapshot position", onClick: () => { setShowClassTools(false); void snapshot(); } },
            { icon: Save, label: "Save game to library", onClick: () => { setShowClassTools(false); void openSave(); } },
            { icon: Cpu, label: engineOn ? "Stop engine" : "Engine analysis", onClick: () => {
              setShowClassTools(false);
              if (engineOn) { setEngineOn(false); return; }
              setEngineOn(true); setPanelView("activity"); setTab("Engine");
            } },
            { icon: Gift, label: "Reward the class", onClick: () => {
              setShowClassTools(false);
              const k = REWARD_KINDS[Math.floor(Math.random() * REWARD_KINDS.length)];
              giveReward(k.icon, k.label);
            } },
            { icon: CircleHelp, label: "Shortcuts", onClick: () => { setShowClassTools(false); setShowHelp(true); } },
          ].map((t) => (
            <button key={t.label} onClick={t.onClick}
              className="flex items-center gap-2 rounded-btn border border-border bg-surface-2 px-3 py-2.5 text-sm text-left hover:bg-surface-3 transition-colors">
              <t.icon size={16} className="shrink-0 text-muted-foreground" />
              {t.label}
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={showSave} onClose={() => setShowSave(false)} title="Save game to PGN library">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-muted-foreground">Folder
            <Select className="w-full mt-1" value={saveFolder} onChange={(e) => setSaveFolder(e.target.value)}>
              {folders.length === 0 && <option value="">(no folders, saves to root)</option>}
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </label>
          <label className="text-sm text-muted-foreground">Title
            <Input className="w-full mt-1" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowSave(false)}>Cancel</Button>
            <Button onClick={saveGame} disabled={!saveTitle.trim()}>Save game</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showMaterials} onClose={() => setShowMaterials(false)} title="Class materials" wide>
        <div className="flex flex-col gap-3">
          {materials.length === 0 ? (
            <p className="text-sm text-muted-foreground">No materials uploaded for this class yet.</p>
          ) : (
            <div className="flex flex-col max-h-64 overflow-y-auto">
              {materials.map((f) => (
                <button key={f.name} onClick={() => openMaterial(f.name)}
                  className="text-left px-3 py-2.5 rounded-btn hover:bg-surface-2 border-b border-border last:border-0 text-sm flex items-center gap-2">
                  <FileText size={15} className="shrink-0 text-muted-foreground" /> {f.name.replace(/^\d+-/, "")}
                </button>
              ))}
            </div>
          )}
          {isCoach && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <label className="inline-flex">
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMaterial(f); e.target.value = ""; }} />
                <span className="cursor-pointer rounded-btn px-4 py-2 text-sm font-medium bg-primary hover:bg-primary-hover text-primary-foreground">
                  Upload PDF
                </span>
              </label>
              <label className="inline-flex">
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void snapFile(f); e.target.value = ""; }} />
                <span className={`cursor-pointer rounded-btn px-4 py-2 text-sm font-medium border border-border hover:bg-surface-3 ${snapBusy ? "opacity-50" : ""}`}>
                  {snapBusy ? "Reading diagram…" : "Snap whole file → board"}
                </span>
              </label>
              <label className="inline-flex">
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { setShowMaterials(false); setShowPdfCrop(f); } e.target.value = ""; }} />
                <span className="cursor-pointer rounded-btn px-4 py-2 text-sm font-medium border border-border hover:bg-surface-3">
                  Crop diagram from PDF
                </span>
              </label>
              <p className="w-full text-xs text-muted-foreground">
                Snap sends the whole page to AI vision. Crop renders the PDF so you box
                one diagram and send just that to the recognizer - onto the live board.
              </p>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!showPdfCrop} onClose={() => setShowPdfCrop(null)} title="Crop a diagram from the PDF" wide>
        {showPdfCrop && (
          <PdfCropper
            file={showPdfCrop}
            onClose={() => setShowPdfCrop(null)}
            onFen={(fen, confidence) => {
              setShowPdfCrop(null);
              const ok = setPosition(fen);
              if (ok) {
                toast(
                  confidence > 0
                    ? `Diagram read onto the board (${(confidence * 100).toFixed(0)}% confidence)`
                    : "Diagram read onto the board",
                  "success",
                );
                log("Loaded a position from a PDF diagram crop");
              }
            }}
          />
        )}
      </Modal>

      <Modal open={showNotes} onClose={() => setShowNotes(false)} title="Lesson notes" wide>
        {snapshots.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">Saved positions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {snapshots.map((s) => (
                <div key={s.line} className="rounded-card border border-border bg-surface-2 p-3">
                  <MiniBoard fen={s.fen} className="mb-2" />
                  <p className="text-xs text-muted-foreground mb-1">
                    {new Date(s.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </p>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground max-h-20 overflow-y-auto">
                    {s.pgn || s.fen}
                  </pre>
                  <div className="flex gap-2 mt-2">
                    {isCoach && (
                      <Button variant="secondary" className="!py-1 !px-2.5 text-xs"
                        onClick={() => { if (setPosition(s.fen)) { setShowNotes(false); toast("Position loaded onto the board", "success"); } }}>
                        Load onto board
                      </Button>
                    )}
                    <Button variant="secondary" className="!py-1 !px-2.5 text-xs"
                      onClick={() => { void navigator.clipboard.writeText(s.fen).catch(() => {}); toast("FEN copied", "info"); }}>
                      Copy FEN
                    </Button>
                    <button
                      onClick={() => setNotes((n) => n.split("\n").filter((l) => l.trim() !== s.line.trim()).join("\n"))}
                      className="ml-auto text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm font-medium mb-2">Notes</p>
        <textarea
          className="w-full bg-surface-2 border border-border rounded-btn px-3 py-2 text-sm min-h-40 font-mono"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Write anything you want to remember from this class…"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Snapshot lines start with <code>[snapshot …]</code> and draw the boards above. Edit them here if you need to.
        </p>
        <div className="flex justify-end mt-3">
          <Button onClick={saveNotes}>Save notes</Button>
        </div>
      </Modal>

      <Modal open={showHelp} onClose={() => setShowHelp(false)} title="Shortcuts">
        <ul className="text-sm flex flex-col gap-1.5 text-muted-foreground">
          <li><b className="text-foreground">Arrows:</b> right-drag to draw, right-click to highlight, Esc to clear</li>
          <li><b className="text-foreground">Navigate:</b> ← → step moves · F flip · C coords · R reset · Q set position</li>
          <li><b className="text-foreground">Reveal:</b> › plays the loaded game&apos;s next move for the class</li>
        </ul>
      </Modal>

      {/* "Ask a Question" - the CircleHelp toolbar icon. Two-pane: record the
          answer by PLAYING it on the board (left), configure time / attempts /
          hint / points (right). The answer never leaves this client - it goes
          into quizAnswerRef + the quizzes row, never the broadcast. */}
      <Modal open={showQuiz} onClose={() => setShowQuiz(false)} title="Ask a Question" size="xl">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-sm font-medium">Play the answer on the board</span>
              {quizForm.answer.trim()
                ? <span className="text-xs font-semibold px-2 py-0.5 rounded-btn bg-success/15 text-success tabular-nums">{quizForm.answer.trim()}</span>
                : <span className="text-xs text-muted-foreground">no answer recorded</span>}
            </div>
            <div className="w-full max-w-[420px] mx-auto aspect-square">
              <ChessBoard
                fen={quizAnswerBoard.fen}
                movable={quizAnswerBoard.legal && !quizForm.answer.trim()}
                boardTheme={settings.boardTheme}
                pieceSet={settings.pieceSet}
                animation={settings.animation}
                smoothMoves={settings.smoothMoves}
                onMove={recordQuizAnswer}
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="secondary" className="!py-1 !px-3 text-sm"
                disabled={!quizForm.answer.trim()}
                onClick={() => setQuizForm((q) => ({ ...q, answer: "" }))}>Undo answer</Button>
              {(() => {
                const g = loadedAnswerAt(quizForm.fen);
                return g && g !== quizForm.answer.trim() ? (
                  <Button variant="ghost" className="!py-1 !px-3 text-sm"
                    onClick={() => setQuizForm((q) => ({ ...q, answer: g }))}>Use game&apos;s move ({g})</Button>
                ) : null;
              })()}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {quizAnswerBoard.legal
                ? "Empty = you review answers manually."
                : "Illegal position — answers reviewed manually."}
            </p>
          </div>

          <div className="lg:w-64 shrink-0 flex flex-col gap-4">
            <div>
              <span className="text-sm font-medium">Time</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[30, 60, 120, 180, 300].map((s) => (
                  <QuizChip key={s} active={quizForm.seconds === s}
                    onClick={() => setQuizForm((q) => ({ ...q, seconds: s }))}>
                    {s < 60 ? `${s}s` : `${s / 60}m`}
                  </QuizChip>
                ))}
              </div>
              <label className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                Custom
                <Input type="number" min={5} className="w-20" value={quizForm.seconds}
                  onChange={(e) => setQuizForm((q) => ({ ...q, seconds: Number(e.target.value) }))} />
                sec
              </label>
            </div>

            <div>
              <span className="text-sm font-medium">Attempts</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[1, 2, 3, 5, 0].map((n) => (
                  <QuizChip key={n} active={quizForm.attempts === n}
                    onClick={() => setQuizForm((q) => ({ ...q, attempts: n }))}>
                    {n === 0 ? "∞" : n}
                  </QuizChip>
                ))}
              </div>
            </div>

            <label className="text-sm font-medium">Hint <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              <Input className="w-full mt-1" placeholder="e.g. Look for a fork" value={quizForm.hint}
                onChange={(e) => setQuizForm((q) => ({ ...q, hint: e.target.value }))} />
            </label>

            <div className="flex gap-3">
              <label className="text-sm flex-1">Points
                <Input type="number" min={0} className="w-full mt-1" value={quizForm.points}
                  onChange={(e) => setQuizForm((q) => ({ ...q, points: Number(e.target.value) }))} />
              </label>
              <label className="text-sm flex-1">Negative
                <Input type="number" min={0} className="w-full mt-1" value={quizForm.negative}
                  onChange={(e) => setQuizForm((q) => ({ ...q, negative: Number(e.target.value) }))} />
              </label>
            </div>
          </div>
        </div>

        {quizQueue.length > 0 && (
          <p className="text-xs text-primary-hover mt-3">
            {quizQueue.length + 1} questions staged — students self-pace through their own copy.
          </p>
        )}
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" onClick={() => setShowQuiz(false)}>Cancel</Button>
          <Button variant="secondary" className="flex-1" onClick={addToQueue} disabled={!quizForm.fen.trim()}>
            Add question
          </Button>
          <button
            onClick={() => (quizQueue.length ? launchRun([quizForm, ...quizQueue]) : launchQuiz())}
            disabled={!quizForm.fen.trim()}
            className="flex-1 rounded-btn px-4 py-2 font-medium bg-success text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
            {quizQueue.length > 0 ? `Start run (${quizQueue.length + 1})` : "Start question"}
          </button>
        </div>
      </Modal>

      {/* Quiz popup - lands on every student's screen the moment the coach
          starts a question. Play a move, retry within your attempt budget,
          then Submit (or the timer submits your last move for you). */}
      {solvingQuiz && quiz && (() => {
        const cap = quiz.attempts ?? 0;
        const triesLeft = cap > 0 ? Math.max(0, cap - quizTriesUsed) : null;
        const canTry = myQuizSan === null && quizLeft > 0 && (cap === 0 || quizTriesUsed < cap);
        return (
        <Modal open={quizPopupOpen} onClose={() => setQuizPopupOpen(false)} title="Play your best move" size="xl">
          <div className="flex flex-col items-center gap-3">
            <p className={`text-3xl font-bold tabular-nums ${quizLeft <= 10 ? "text-destructive" : "text-primary-hover"}`}>
              {Math.floor(quizLeft / 60)}:{String(quizLeft % 60).padStart(2, "0")}
            </p>
            {/* Sized off the viewport, not a fixed 320px: the student solves on
                this board, so it needs to be as big as the modal can hold. */}
            <div className="w-full max-w-[min(78vw,58vh)] aspect-square">
              <ChessBoard
                fen={quizBoardFen ?? quiz.fen}
                movable={canTry}
                boardTheme={settings.boardTheme}
                pieceSet={settings.pieceSet}
                animation={settings.animation}
                smoothMoves={settings.smoothMoves}
                onMove={onQuizMove}
              />
            </div>
            {quiz.hint && (
              quizHintShown
                ? <p className="text-sm text-warning">💡 {quiz.hint}</p>
                : <button className="text-xs text-warning hover:underline" onClick={() => setQuizHintShown(true)}>Show hint 💡</button>
            )}
            {myQuizSan ? (
              <>
                <p className="text-sm font-semibold text-success">Answer submitted: {myQuizSan}</p>
                <Button onClick={() => setQuizPopupOpen(false)}>Back to class</Button>
              </>
            ) : quizLeft > 0 ? (
              <>
                <div className="flex gap-2">
                  {pendingQuizMove && canTry && (
                    <Button variant="secondary" onClick={retryQuizMove}>Try again</Button>
                  )}
                  <Button disabled={!pendingQuizMove} onClick={() => submitQuizAnswer(false)}>
                    {pendingQuizMove ? `Submit ${pendingQuizMove.san}` : "Play a move first"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {quiz.points} points · {triesLeft === null ? "unlimited tries" : `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left`}
                  {quiz.negative ? ` · −${quiz.negative} if wrong` : " · no negative marking"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Time&apos;s up, waiting for your coach.</p>
            )}
          </div>
        </Modal>
        );
      })()}

      <BoardSettingsModal open={showSettings} onClose={() => setShowSettings(false)} settings={settings} onChange={update} />
      <ClassroomSettingsModal
        open={showClassroomSettings}
        onClose={() => setShowClassroomSettings(false)}
        prefs={crPrefs}
        onChange={updateCrPrefs}
      />
    </div>
  );
}



/** Preset chip used in the Ask-a-Question setup (time / attempts). */
function QuizChip({ active, onClick, children }: {
  active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-btn px-2.5 py-1 text-xs font-semibold border transition-colors tabular-nums ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}

/** Small pill button used for coach play-permissions and admin controls. */
function PermBtn({ active, danger, onClick, title, children }: {
  active?: boolean; danger?: boolean; onClick: () => void; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-btn px-2 py-1 text-xs font-medium border transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : danger
            ? "border-border text-destructive hover:bg-destructive/10"
            : "border-border hover:bg-surface-3"
      }`}
    >
      {children}
    </button>
  );
}
