"use client";

/* Activity-Based Curriculum.
 *
 * Navigable tree: levels → lessons → activities. Staff add rows through small
 * modals; students Start an activity → activity-player.tsx runs it and writes
 * curriculum_progress. Players: explanation / capture / puzzle / mcq are live;
 * `play` (vs-engine) hands off to the Play Area. Interactive puzzle *trees*
 * (branching lines) are the next step - `answer` is a single line for now. */

import { useMemo, useState } from "react";
import {
  BookOpen, Swords, Puzzle, ListChecks, Bot, Check, Plus, Layers,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { Button, EmptyState, Input, Modal, PageHeader, Select } from "@/components/ui";
import {
  ACTIVITY_KINDS, ACTIVITY_KIND_LABEL,
  type ActivityKind, type CurriculumLevel, type CurriculumLesson,
  type CurriculumActivity, type CurriculumProgress,
} from "@/lib/curriculum";
import { ActivityPlayer } from "./activity-player";

const KIND_ICON: Record<ActivityKind, typeof BookOpen> = {
  explanation: BookOpen, capture: Swords, puzzle: Puzzle, mcq: ListChecks, play: Bot,
};

export function CurriculumClient({
  academyId, studentId, isStaff, levels: initialLevels, lessons: initialLessons,
  activities: initialActivities, progress: initialProgress,
}: {
  academyId: string;
  studentId: string;
  isStaff: boolean;
  levels: CurriculumLevel[];
  lessons: CurriculumLesson[];
  activities: CurriculumActivity[];
  progress: CurriculumProgress[];
}) {
  const supabase = createClient();
  const toast = useToast();

  const [levels, setLevels] = useState(initialLevels);
  const [lessons, setLessons] = useState(initialLessons);
  const [activities, setActivities] = useState(initialActivities);
  const [progress, setProgress] = useState(initialProgress);

  const [levelId, setLevelId] = useState<string | null>(initialLevels[0]?.id ?? null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "level" | "lesson" | "activity">(null);
  const [playing, setPlaying] = useState<CurriculumActivity | null>(null);

  const progressByActivity = useMemo(
    () => new Map(progress.map((p) => [p.activity_id, p])),
    [progress],
  );

  const levelLessons = lessons
    .filter((l) => l.level_id === levelId)
    .sort((a, b) => a.ordinal - b.ordinal);
  const lessonActivities = activities
    .filter((a) => a.lesson_id === lessonId)
    .sort((a, b) => a.ordinal - b.ordinal);

  // ── Staff: create rows ────────────────────────────────────────────────────
  const [levelForm, setLevelForm] = useState({ title: "", description: "" });
  const [lessonForm, setLessonForm] = useState({ title: "", objective: "" });
  const [activityForm, setActivityForm] = useState<{
    kind: ActivityKind; title: string; prompt: string; fen: string; answer: string;
  }>({ kind: "explanation", title: "", prompt: "", fen: "", answer: "" });

  async function addLevel() {
    const { data, error } = await supabase.from("curriculum_levels").insert({
      academy_id: academyId, title: levelForm.title.trim(),
      description: levelForm.description.trim() || null,
      ordinal: levels.length,
    }).select().single();
    if (error) { toast(error.message, "error"); return; }
    setLevels((xs) => [...xs, data as CurriculumLevel]);
    setLevelId((data as CurriculumLevel).id);
    setLevelForm({ title: "", description: "" });
    setModal(null);
  }

  async function addLesson() {
    if (!levelId) return;
    const { data, error } = await supabase.from("curriculum_lessons").insert({
      academy_id: academyId, level_id: levelId, title: lessonForm.title.trim(),
      objective: lessonForm.objective.trim() || null,
      ordinal: levelLessons.length,
    }).select().single();
    if (error) { toast(error.message, "error"); return; }
    setLessons((xs) => [...xs, data as CurriculumLesson]);
    setLessonId((data as CurriculumLesson).id);
    setLessonForm({ title: "", objective: "" });
    setModal(null);
  }

  async function addActivity() {
    if (!lessonId) return;
    const { data, error } = await supabase.from("curriculum_activities").insert({
      academy_id: academyId, lesson_id: lessonId,
      kind: activityForm.kind, title: activityForm.title.trim(),
      prompt: activityForm.prompt.trim() || null,
      fen: activityForm.fen.trim() || null,
      answer: activityForm.answer.trim() || null,
      ordinal: lessonActivities.length,
    }).select().single();
    if (error) { toast(error.message, "error"); return; }
    setActivities((xs) => [...xs, data as CurriculumActivity]);
    setActivityForm({ kind: "explanation", title: "", prompt: "", fen: "", answer: "" });
    setModal(null);
  }

  return (
    <div>
      <PageHeader
        title="Curriculum"
        action={isStaff && (
          <Button onClick={() => setModal("level")}><Plus size={15} /> Level</Button>
        )}
      />

      {levels.length === 0 ? (
        <EmptyState
          text={isStaff
            ? "No levels yet. Build the ladder your academy walks beginners up."
            : "Your coach hasn't published the curriculum yet."}
          action={isStaff && <Button onClick={() => setModal("level")}>Add the first level</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          {/* Left rail: levels */}
          <div className="flex flex-col gap-1">
            {levels.map((lv) => (
              <button
                key={lv.id}
                onClick={() => { setLevelId(lv.id); setLessonId(null); }}
                className={`flex items-center gap-2 rounded-btn border px-3 py-2 text-left text-sm transition-colors ${
                  lv.id === levelId
                    ? "border-primary bg-primary/10 font-medium"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <Layers size={15} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{lv.title}</span>
              </button>
            ))}
          </div>

          {/* Right: lessons + activities of the selected level */}
          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {levels.find((l) => l.id === levelId)?.title}
              </h2>
              {isStaff && (
                <Button variant="secondary" onClick={() => setModal("lesson")}>
                  <Plus size={15} /> Lesson
                </Button>
              )}
            </div>

            {levelLessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lessons in this level yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {levelLessons.map((ls) => {
                  const acts = activities
                    .filter((a) => a.lesson_id === ls.id)
                    .sort((a, b) => a.ordinal - b.ordinal);
                  const done = acts.filter(
                    (a) => progressByActivity.get(a.id)?.status === "completed",
                  ).length;
                  const open = ls.id === lessonId;
                  return (
                    <div key={ls.id} className="rounded-card border border-border bg-surface-1">
                      <button
                        onClick={() => setLessonId(open ? null : ls.id)}
                        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{ls.title}</p>
                          {ls.objective && (
                            <p className="truncate text-xs text-muted-foreground">{ls.objective}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {acts.length ? `${done}/${acts.length}` : "empty"}
                        </span>
                      </button>

                      {open && (
                        <div className="border-t border-border px-4 py-3">
                          {acts.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No activities yet.</p>
                          ) : (
                            <ul className="flex flex-col gap-1.5">
                              {acts.map((a) => {
                                const Icon = KIND_ICON[a.kind];
                                const st = progressByActivity.get(a.id)?.status;
                                return (
                                  <li
                                    key={a.id}
                                    className="flex items-center gap-2.5 rounded-btn border border-border bg-surface-2 px-3 py-2"
                                  >
                                    <Icon size={15} className="shrink-0 text-muted-foreground" />
                                    <span className="flex-1 truncate text-sm">{a.title}</span>
                                    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted-foreground">
                                      {ACTIVITY_KIND_LABEL[a.kind]}
                                    </span>
                                    {st === "completed" ? (
                                      <Check size={15} className="shrink-0 text-success" />
                                    ) : !isStaff ? (
                                      <button
                                        onClick={() => setPlaying(a)}
                                        className="shrink-0 rounded-btn bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                                      >
                                        {st === "attempted" ? "Resume" : "Start"}
                                      </button>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {isStaff && (
                            <Button
                              variant="ghost"
                              className="mt-2 !px-2 text-xs"
                              onClick={() => setModal("activity")}
                            >
                              <Plus size={14} /> Activity
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add-level modal ───────────────────────────────────────────────── */}
      <Modal open={modal === "level"} onClose={() => setModal(null)} title="New level">
        <div className="flex flex-col gap-3">
          <Input placeholder="Title, e.g. Level 1 - The Board & Pieces"
            value={levelForm.title} onChange={(e) => setLevelForm({ ...levelForm, title: e.target.value })} />
          <Input placeholder="Description (optional)"
            value={levelForm.description} onChange={(e) => setLevelForm({ ...levelForm, description: e.target.value })} />
          <Button onClick={addLevel} disabled={!levelForm.title.trim()}>Create level</Button>
        </div>
      </Modal>

      {/* ── Add-lesson modal ──────────────────────────────────────────────── */}
      <Modal open={modal === "lesson"} onClose={() => setModal(null)} title="New lesson">
        <div className="flex flex-col gap-3">
          <Input placeholder="Title, e.g. How the knight moves"
            value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
          <Input placeholder="Objective (optional)"
            value={lessonForm.objective} onChange={(e) => setLessonForm({ ...lessonForm, objective: e.target.value })} />
          <Button onClick={addLesson} disabled={!lessonForm.title.trim() || !levelId}>Create lesson</Button>
        </div>
      </Modal>

      {/* ── Add-activity modal ────────────────────────────────────────────── */}
      <Modal open={modal === "activity"} onClose={() => setModal(null)} title="New activity">
        <div className="flex flex-col gap-3">
          <label className="text-sm text-muted-foreground">
            Kind
            <Select
              className="mt-1 w-full"
              value={activityForm.kind}
              onChange={(e) => setActivityForm({ ...activityForm, kind: e.target.value as ActivityKind })}
            >
              {ACTIVITY_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </Select>
          </label>
          <p className="-mt-1 text-xs text-muted-foreground">
            {ACTIVITY_KINDS.find((k) => k.kind === activityForm.kind)?.hint}
          </p>
          <Input placeholder="Title"
            value={activityForm.title} onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })} />
          <Input placeholder="Prompt / instruction (optional)"
            value={activityForm.prompt} onChange={(e) => setActivityForm({ ...activityForm, prompt: e.target.value })} />
          <Input placeholder="Start FEN (optional)"
            value={activityForm.fen} onChange={(e) => setActivityForm({ ...activityForm, fen: e.target.value })} />
          {(activityForm.kind === "puzzle" || activityForm.kind === "mcq") && (
            <Input placeholder={activityForm.kind === "mcq" ? "Correct choice id" : "Answer (SAN / UCI)"}
              value={activityForm.answer} onChange={(e) => setActivityForm({ ...activityForm, answer: e.target.value })} />
          )}
          <Button onClick={addActivity} disabled={!activityForm.title.trim() || !lessonId}>
            Create activity
          </Button>
        </div>
      </Modal>

      {/* ── Activity player ──────────────────────────────────────────────── */}
      <Modal open={!!playing} onClose={() => setPlaying(null)} title={playing?.title ?? ""} wide>
        {playing && (
          <ActivityPlayer
            activity={playing}
            studentId={studentId}
            prior={progressByActivity.get(playing.id)}
            onDone={(p) => {
              setProgress((xs) => [...xs.filter((x) => x.activity_id !== p.activity_id), p]);
              if (p.status === "completed") setPlaying(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
