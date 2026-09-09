/* Activity-Based Curriculum (ABC) - types + the activity-kind registry.
 * Pure module (no React). Mirrors supabase/migrations/0039_curriculum.sql.
 *
 * The five kinds are the interactive-step vocabulary a coach builds a lesson
 * from (Chesslang parity - see market_platforms_research.md). `kind` drives
 * which player renders the activity (curriculum/activity-player.tsx). */

export type ActivityKind = "explanation" | "capture" | "puzzle" | "mcq" | "play";

export type CurriculumLevel = {
  id: string;
  academy_id: string;
  title: string;
  ordinal: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
};

export type CurriculumLesson = {
  id: string;
  level_id: string;
  academy_id: string;
  title: string;
  ordinal: number;
  objective: string | null;
  created_at: string;
};

export type CurriculumActivity = {
  id: string;
  lesson_id: string;
  academy_id: string;
  ordinal: number;
  kind: ActivityKind;
  title: string;
  prompt: string | null;
  fen: string | null;
  pgn: string | null;
  answer: string | null;
  choices: { id: string; text: string }[];
  meta: Record<string, unknown>;
  created_at: string;
};

export type CurriculumProgress = {
  student_id: string;
  activity_id: string;
  status: "not_started" | "attempted" | "completed";
  score: number | null;
  attempts: number;
  time_ms: number | null;
  updated_at: string;
};

/** icon = a lucide-react icon name; the client maps it to the component so this
 *  file stays React-free. */
export const ACTIVITY_KINDS: {
  kind: ActivityKind; label: string; icon: string; hint: string;
}[] = [
  { kind: "explanation", label: "Explanation", icon: "BookOpen",
    hint: "Teach a concept with a board and commentary." },
  { kind: "capture", label: "Capture", icon: "Swords",
    hint: "Beginner drill: capture the marked pieces." },
  { kind: "puzzle", label: "Puzzle", icon: "Puzzle",
    hint: "Find the key move(s) from a position." },
  { kind: "mcq", label: "Multiple choice", icon: "ListChecks",
    hint: "Answer a question about the position." },
  { kind: "play", label: "Play vs computer", icon: "Bot",
    hint: "Play out the position against the engine." },
];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> =
  Object.fromEntries(ACTIVITY_KINDS.map((k) => [k.kind, k.label])) as Record<ActivityKind, string>;
