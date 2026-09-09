"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Star, Clock, PlayCircle, BookOpen, MonitorPlay } from "lucide-react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, RowMenu, Select, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type Course = {
  id: string; title: string; description: string | null;
  tags: string[]; status: string; created_at: string;
};
export type Lesson = {
  id: string; course_id: string | null; title: string;
  kind: string; position: number; status: string;
};

// Coursera-style visual mock data, derived from the course id so it's stable.
const GRADIENTS = [
  ["#6366f1", "#8b5cf6"], ["#0ea5e9", "#22d3ee"], ["#f97316", "#f43f5e"],
  ["#22c55e", "#14b8a6"], ["#eab308", "#f97316"], ["#ec4899", "#8b5cf6"],
];
const INSTRUCTORS = [
  { name: "GM Anna Rudolf", initials: "AR", color: "#6366f1" },
  { name: "IM Levy Rozman", initials: "LR", color: "#0ea5e9" },
  { name: "GM Daniel Naroditsky", initials: "DN", color: "#f97316" },
  { name: "WGM Dina Belenkaya", initials: "DB", color: "#ec4899" },
  { name: "GM Simon Williams", initials: "SW", color: "#22c55e" },
];
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function visuals(c: Course) {
  const h = hash(c.id || c.title);
  return {
    grad: GRADIENTS[h % GRADIENTS.length],
    instructor: INSTRUCTORS[h % INSTRUCTORS.length],
    rating: (4 + (h % 10) / 10).toFixed(1),
    hours: 3 + (h % 12),
  };
}

export function CoursesClient({
  me, isStaff, base, initialCourses, lessons,
}: {
  me: Profile; isStaff: boolean; base: string;
  initialCourses: Course[]; lessons: Lesson[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [courses, setCourses] = useState(initialCourses);
  const [tagFilter, setTagFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Course | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", tags: "" });

  async function refetch() {
    const { data } = await supabase
      .from("courses")
      .select("id, title, description, tags, status, created_at")
      .eq("academy_id", me.academy_id)
      .order("created_at", { ascending: false });
    setCourses((data ?? []) as Course[]);
  }

  const allTags = useMemo(
    () => Array.from(new Set(courses.flatMap((c) => c.tags))).sort(),
    [courses],
  );
  const shown = courses.filter((c) =>
    (tagFilter === "all" || c.tags.includes(tagFilter)) &&
    (statusFilter === "all" || c.status === statusFilter));

  async function createCourse() {
    if (!form.title.trim()) return toast("Title is required", "error");
    const { error } = await supabase.from("courses").insert({
      academy_id: me.academy_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      status: "active",
      created_by: me.id,
    });
    if (error) return toast(error.message, "error");
    setCreateOpen(false); setForm({ title: "", description: "", tags: "" });
    toast("Course created", "success");
    refetch();
  }

  async function setStatus(c: Course, status: string) {
    const { error } = await supabase.from("courses").update({ status }).eq("id", c.id);
    if (error) return toast(error.message, "error");
    refetch();
  }

  async function deleteCourse(c: Course) {
    const { error } = await supabase.from("courses").delete().eq("id", c.id);
    if (error) return toast(error.message, "error");
    if (selected?.id === c.id) setSelected(null);
    toast("Course deleted", "success");
    refetch();
  }

  const courseLessons = selected ? lessons.filter((l) => l.course_id === selected.id) : [];

  return (
    <div>
      <PageHeader
        title="Courses"
        subtitle={`${courses.length} course${courses.length === 1 ? "" : "s"} to learn from`}
        action={
          <span className="flex gap-2">
            <Link href={`${base}/courses/player`}>
              <Button variant="secondary" className="flex items-center gap-1.5">
                <MonitorPlay size={15} /> Course player
              </Button>
            </Link>
            {isStaff && <Button onClick={() => setCreateOpen(true)}>+ New course</Button>}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="all">All topics</option>
          {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
      </div>

      {shown.length === 0 ? (
        <EmptyState text={`You have ${courses.length === 0 ? "no courses yet" : "no courses matching these filters"}.`}
          action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ New course</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {shown.map((c) => {
            const count = lessons.filter((l) => l.course_id === c.id).length;
            const v = visuals(c);
            const progress = count === 0 ? 0 : (hash(c.id) % 90) + 5;
            return (
              <button key={c.id}
                onClick={() => setSelected(selected?.id === c.id ? null : c)}
                className={`text-left bg-surface-1 border rounded-card overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                  selected?.id === c.id ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
                <div className="h-28 relative flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${v.grad[0]}, ${v.grad[1]})` }}>
                  <BookOpen size={34} className="text-white/90" />
                  {isStaff && (
                    <span onClick={(e) => { e.stopPropagation(); }} className="absolute top-2 right-2">
                      <RowMenu items={[
                        ...(c.status !== "archived"
                          ? [{ label: "Archive", onClick: () => setStatus(c, "archived") }]
                          : [{ label: "Activate", onClick: () => setStatus(c, "active") }]),
                        { label: "Delete", onClick: () => deleteCourse(c), danger: true },
                      ]} />
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: v.instructor.color }}>{v.instructor.initials}</span>
                    <span className="text-xs text-muted-foreground">{v.instructor.name}</span>
                  </div>
                  <h3 className="font-semibold leading-snug line-clamp-2">{c.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{c.description || "A guided course to sharpen your chess."}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Star size={13} className="text-warning fill-current" /> {v.rating}</span>
                    <span className="flex items-center gap-1"><PlayCircle size={13} /> {count} lesson{count === 1 ? "" : "s"}</span>
                    <span className="flex items-center gap-1"><Clock size={13} /> {v.hours}h</span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{progress}% complete</p>
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <StatusPill status={c.status} />
                    {c.tags.slice(0, 2).map((t) => (
                      <span key={t} className="bg-surface-3 rounded-full px-2 py-0.5 text-xs">{t}</span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="mt-6 bg-surface-1 border border-border rounded-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: visuals(selected).instructor.color }}>{visuals(selected).instructor.initials}</span>
            <div>
              <h2 className="font-semibold">{selected.title}</h2>
              <p className="text-xs text-muted-foreground">{visuals(selected).instructor.name} · {courseLessons.length} lessons</p>
            </div>
          </div>
          {courseLessons.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lessons in this course yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {courseLessons.map((l, i) => (
                <li key={l.id}>
                  <Link href={`${base}/courses/lesson/${l.id}`}
                    className="flex items-center gap-3 py-2.5 hover:bg-surface-2 rounded-btn px-2 -mx-2 transition-colors">
                    <span className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center shrink-0">
                      <PlayCircle size={16} className="text-primary" />
                    </span>
                    <span className="text-muted-foreground text-sm w-6">{i + 1}.</span>
                    <span className="flex-1">{l.title}</span>
                    <span className="text-xs text-muted-foreground capitalize">{l.kind}</span>
                    <StatusPill status={l.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New course">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={form.title} autoFocus
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea
              className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-20"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Topics (comma-separated)</span>
            <Input className="w-full mt-1" value={form.tags} placeholder="openings, beginner"
              onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createCourse}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
