"use client";

/* Course player: the learning surface, ahead of the content model.
 *
 * Everything here is deliberately front-of-house. The syllabus is a fixed
 * reference playlist rather than rows in `lessons`, progress and notes live in
 * localStorage rather than a table, and no watch telemetry is recorded. The
 * question being answered is what the player should feel like; wiring it to a
 * schema is the next piece of work, not this one.
 *
 * ponytail: localStorage keeps this to one file with no migration. Move both
 * keys to a `lesson_progress` table the moment a coach needs to see whether a
 * student finished a lesson, because a per-browser record cannot answer that.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CircleCheck, FileText,
  ListVideo, NotebookPen, PlayCircle,
} from "lucide-react";
import { Button, PageHeader } from "@/components/ui";

type Lesson = {
  id: string;
  /** YouTube id. Every one of these is a real, public chess lesson, so the
   *  demo plays instead of showing an unavailable-video box. */
  video: string;
  title: string;
  instructor: string;
  section: string;
  minutes: number;
  summary: string;
};

const LESSONS: Lesson[] = [
  {
    id: "l1", video: "jfcVjIa1EGM", section: "Opening",
    title: "Every opening principle, explained",
    instructor: "Remote Chess Academy", minutes: 18,
    summary: "Centre, development, king safety. The three rules that decide most games before move fifteen.",
  },
  {
    id: "l2", video: "MbMslp2WcI0", section: "Tactics",
    title: "Forks, pins and skewers",
    instructor: "Chess Vibes", minutes: 21,
    summary: "The three patterns behind the majority of material swings at club level.",
  },
  {
    id: "l3", video: "h7S9uE3lT0I", section: "Strategy",
    title: "Positional play from first principles",
    instructor: "Remote Chess Academy", minutes: 24,
    summary: "Weak squares, good and bad bishops, and what to do in a position with no tactics in it.",
  },
  {
    id: "l4", video: "yAnNQY2Ac6w", section: "Strategy",
    title: "Five pawn structures worth knowing",
    instructor: "GothamChess", minutes: 16,
    summary: "Isolated queen pawn, hanging pawns, the Carlsbad. Each structure comes with its own plan.",
  },
  {
    id: "l5", video: "u8MKyE9Qt8I", section: "Middlegame",
    title: "How to make a plan",
    instructor: "GothamChess", minutes: 15,
    summary: "Turning an assessment of the position into a concrete sequence of moves.",
  },
  {
    id: "l6", video: "nR8ULRlk9HA", section: "Endgame",
    title: "Rook endgames crash course",
    instructor: "Chess Vibes", minutes: 27,
    summary: "The most common endgame on the board, reduced to the handful of positions worth memorising.",
  },
];

const DONE_KEY = "course-player:completed";
const NOTE_KEY = (id: string) => `course-player:note:${id}`;

export function CoursePlayerClient({ base }: { base: string }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  /* Rendered only after mount so the server HTML and the first client render
   * agree: what localStorage holds is unknowable during SSR, and painting it
   * straight away is a hydration mismatch. */
  const [ready, setReady] = useState(false);

  const lesson = LESSONS[index];

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DONE_KEY);
      if (raw) setDone(JSON.parse(raw) as string[]);
    } catch { /* a cleared or blocked store just means an empty course */ }
    setReady(true);
  }, []);

  // Notes are per lesson, so switching lesson swaps the pad underneath.
  useEffect(() => {
    try { setNote(localStorage.getItem(NOTE_KEY(lesson.id)) ?? ""); }
    catch { setNote(""); }
    setNoteSaved(false);
  }, [lesson.id]);

  const writeNote = useCallback((text: string) => {
    setNote(text);
    try { localStorage.setItem(NOTE_KEY(lesson.id), text); setNoteSaved(true); }
    catch { /* private mode: the pad still works for this session */ }
  }, [lesson.id]);

  const markDone = useCallback((id: string, complete: boolean) => {
    setDone((cur) => {
      const next = complete ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
      try { localStorage.setItem(DONE_KEY, JSON.stringify(next)); } catch { /* see above */ }
      return next;
    });
  }, []);

  /* Moving on counts as finishing: a student who watched a lesson and pressed
   * Next should not have to also tick a box to see the bar move. */
  const go = useCallback((delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= LESSONS.length) return;
    if (delta > 0) markDone(LESSONS[index].id, true);
    setIndex(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [index, markDone]);

  const completed = useMemo(
    () => LESSONS.filter((l) => done.includes(l.id)).length,
    [done],
  );
  const percent = Math.round((completed / LESSONS.length) * 100);
  const totalMinutes = LESSONS.reduce((n, l) => n + l.minutes, 0);
  const isDone = done.includes(lesson.id);

  return (
    <div>
      <PageHeader
        title="Course player"
        action={
          <Link href={`${base}/courses`}>
            <Button variant="secondary" className="flex items-center gap-1.5">
              <ArrowLeft size={15} /> All courses
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        {/* ── Stage ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rounded-card overflow-hidden border border-border bg-black shadow-lg">
            <div className="relative w-full aspect-video">
              <iframe
                key={lesson.video}
                src={`https://www.youtube-nocookie.com/embed/${lesson.video}?rel=0&modestbranding=1`}
                title={lesson.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
          </div>

          <div className="bg-surface-1 border border-border rounded-card p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-primary font-semibold">
                  Lesson {index + 1} of {LESSONS.length}
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="text-muted-foreground normal-case tracking-normal font-normal">
                    {lesson.section}
                  </span>
                </p>
                <h2 className="text-xl font-bold mt-1 leading-snug">{lesson.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {lesson.instructor}
                  <span className="mx-2">·</span>
                  {lesson.minutes} min
                </p>
                <p className="text-sm mt-3 max-w-2xl">{lesson.summary}</p>
              </div>

              <button
                type="button"
                onClick={() => markDone(lesson.id, !isDone)}
                className={`shrink-0 flex items-center gap-2 rounded-btn px-3 py-2 text-sm border transition-colors ${
                  isDone
                    ? "border-success/50 bg-success/10 text-success"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <CircleCheck size={16} />
                {isDone ? "Completed" : "Mark complete"}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
              <Button
                variant="secondary"
                onClick={() => go(-1)}
                disabled={index === 0}
                className="flex items-center gap-1.5"
              >
                <ChevronLeft size={16} /> Previous lesson
              </Button>
              <span className="text-xs text-muted-foreground hidden sm:block">
                {totalMinutes} minutes of video in this course
              </span>
              <Button
                onClick={() => go(1)}
                disabled={index === LESSONS.length - 1}
                className="flex items-center gap-1.5"
              >
                Next lesson <ChevronRight size={16} />
              </Button>
            </div>
          </div>

          {/* ── Course completion ───────────────────────────────────────── */}
          <div className="bg-surface-1 border border-border rounded-card p-5">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold">Course completion</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {ready ? `${completed} of ${LESSONS.length} lessons finished` : "Reading your progress…"}
                </p>
              </div>
              <p className="text-3xl font-bold tabular-nums leading-none">{ready ? percent : 0}%</p>
            </div>
            <div className="h-2.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${ready ? percent : 0}%` }}
              />
            </div>
            <div className="flex gap-1 mt-3">
              {LESSONS.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  title={l.title}
                  aria-label={`Go to lesson ${i + 1}: ${l.title}`}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    done.includes(l.id) ? "bg-success"
                      : i === index ? "bg-primary"
                      : "bg-surface-3 hover:bg-border"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* ── Transcript ──────────────────────────────────────────────── */}
          <div className="bg-surface-1 border border-border rounded-card p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText size={16} className="text-primary" /> Transcript
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 mb-4">
              Timed captions for this lesson, searchable and clickable once transcripts are generated.
            </p>
            <div className="relative">
              <div className="flex flex-col gap-3 select-none" aria-hidden="true">
                {[
                  [8, 62], [4, 40], [7, 80], [5, 54], [8, 70], [3, 34],
                ].map(([words, width], row) => (
                  <div key={row} className="flex items-start gap-3">
                    <span className="text-xs tabular-nums text-muted-foreground/60 w-11 shrink-0 pt-0.5">
                      {String(Math.floor((row * 47) / 60)).padStart(2, "0")}:
                      {String((row * 47) % 60).padStart(2, "0")}
                    </span>
                    <span className="flex flex-wrap gap-1.5" style={{ width: `${width}%` }}>
                      {Array.from({ length: words }).map((_, w) => (
                        <span
                          key={w}
                          className="h-2.5 rounded-full bg-surface-3"
                          style={{ width: `${28 + ((row * 7 + w * 13) % 46)}px` }}
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-surface-1 via-surface-1/85 to-transparent">
                <p className="text-sm text-muted-foreground pb-1">
                  No transcript for this lesson yet.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5 xl:sticky xl:top-4">
          <div className="bg-surface-1 border border-border rounded-card p-5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="font-semibold flex items-center gap-2">
                <NotebookPen size={16} className="text-primary" /> Notes
              </h3>
              {noteSaved && (
                <span className="text-xs text-success flex items-center gap-1">
                  <Check size={13} /> Saved
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Kept per lesson, on this device.
            </p>
            <textarea
              value={note}
              onChange={(e) => writeNote(e.target.value)}
              placeholder={`What stood out in "${lesson.title}"?`}
              className="w-full min-h-56 bg-surface-2 border border-border rounded-btn px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-y leading-relaxed"
            />
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              {note.trim() ? `${note.trim().split(/\s+/).length} words` : "Empty"}
            </p>
          </div>

          <div className="bg-surface-1 border border-border rounded-card overflow-hidden">
            <div className="p-5 pb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <ListVideo size={16} className="text-primary" /> Course content
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {LESSONS.length} lessons
                <span className="mx-1.5">·</span>
                {totalMinutes} min
              </p>
            </div>
            <ul className="pb-2">
              {LESSONS.map((l, i) => {
                const current = i === index;
                const finished = done.includes(l.id);
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      className={`w-full text-left flex gap-3 px-5 py-3 transition-colors border-l-2 ${
                        current
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:bg-surface-2"
                      }`}
                    >
                      <span className="shrink-0 mt-0.5">
                        {finished
                          ? <CircleCheck size={17} className="text-success" />
                          : <PlayCircle size={17} className={current ? "text-primary" : "text-muted-foreground"} />}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm leading-snug ${current ? "font-semibold" : ""}`}>
                          {l.title}
                        </span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {l.section}
                          <span className="mx-1.5">·</span>
                          {l.minutes} min
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
