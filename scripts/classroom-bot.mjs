#!/usr/bin/env node
/* Headless student in a live classroom - the other browser tab, without a browser.
 *
 * Joins the `class:<id>` realtime channel exactly the way the student client
 * does (private channel, presence track, same broadcast events), logs
 * everything the coach pushes, and optionally answers quizzes / publishes a
 * simul game. Lets one operator drive the coach UI and see the class react.
 *
 *   node scripts/classroom-bot.mjs <classroomId> [--as student2|student3] \
 *        [--answer <san>] [--simul] [--quiet]
 *
 * Defaults: signs in as student@chessacademy.test, answers quizzes with the
 * loaded position's side-to-move e-pawn push ("e4"/"e5"), no simul.
 */

import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const args = process.argv.slice(2);
const classroomId = args.find((a) => !a.startsWith("--"));
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!classroomId) {
  console.error("usage: node scripts/classroom-bot.mjs <classroomId> [--as student2] [--answer e4] [--simul] [--quiet]");
  process.exit(1);
}

const WHO = {
  student: "student@chessacademy.test",
  student2: "student2@chessacademy.test",
  student3: "student3@chessacademy.test",
};
const email = WHO[opt("as", "student")] ?? WHO.student;
const answerSan = opt("answer", null);
const doSimul = flag("simul");
const quiet = flag("quiet");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const vlog = (...a) => { if (!quiet) log(...a); };

const sb = createClient(URL_BASE, ANON);
const { data: auth, error } = await sb.auth.signInWithPassword({ email, password: "chesspass123" });
if (error) { console.error("login:", error.message); process.exit(1); }
const me = { userId: auth.user.id, name: email.split("@")[0] };
log(`signed in as ${me.name} (${me.userId})`);

// academy of this classroom — needed for the classroom_responses upsert (0043),
// exactly the row the real student client writes in submitQuizAnswer.
const { data: room } = await sb.from("classrooms").select("academy_id").eq("id", classroomId).maybeSingle();
const academyId = room?.academy_id ?? null;

await sb.realtime.setAuth();

// answer helper: pick a plausible legal move for the given FEN without a chess
// engine - the e-pawn double push, or a knight develop if that square is taken.
function pickAnswer(fen) {
  if (answerSan) return answerSan;
  const stm = (fen.split(" ")[1] || "w") === "w" ? "w" : "b";
  return stm === "w" ? "e4" : "e5";
}
function sanToFromTo(san) {
  // only used for the simul mirror; crude e4/e5 mapping is enough for a demo
  const map = { e4: { from: "e2", to: "e4" }, e5: { from: "e7", to: "e5" }, Nf3: { from: "g1", to: "f3" } };
  return map[san] ?? { from: "e2", to: "e4" };
}

let simulFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
let simulClockMs = 0;
let simulResult = null;
const answered = new Set();

const channel = sb.channel(`class:${classroomId}`, {
  config: { broadcast: { self: false }, presence: { key: me.userId }, private: true },
});

function answerQuiz(quizId, fen) {
  if (answered.has(quizId)) return;
  answered.add(quizId);
  const san = pickAnswer(fen);
  const ms = 1500 + Math.floor(Math.random() * 4000);
  setTimeout(async () => {
    channel.send({ type: "broadcast", event: "quiz_answer", payload: { quizId, userId: me.userId, name: me.name, san, ms } });
    log(`→ quiz_answer  quizId=${quizId}  san=${san}  ms=${ms}`);
    // same persistence path as the real student client (submitQuizAnswer → 0043)
    if (academyId) {
      const { error } = await sb.from("classroom_responses").upsert({
        classroom_id: classroomId, quiz_id: quizId, user_id: me.userId,
        academy_id: academyId, san, ms, tries: 1,
      }, { onConflict: "classroom_id,quiz_id,user_id" });
      log(error ? `  classroom_responses upsert FAILED: ${error.message}` : `  classroom_responses upsert ok`);
    }
  }, 800 + Math.random() * 1200);
}

channel
  .on("broadcast", { event: "board" }, ({ payload }) => vlog("board  fen=" + payload.fen))
  .on("broadcast", { event: "annotation" }, ({ payload }) =>
    vlog(`annotation  arrows=${payload.arrows?.length ?? 0} highlights=${payload.highlights?.length ?? 0}`))
  .on("broadcast", { event: "chat" }, ({ payload }) => log(`chat  <${payload.name}> ${payload.text}`))
  .on("broadcast", { event: "quiz" }, ({ payload }) => {
    if (payload.run) {
      log(`quiz RUN id=${payload.run.id} total=${payload.run.total}`);
      payload.run.items.forEach((it, i) => answerQuiz(`${payload.run.id}-${i}`, it.fen));
    } else if (payload.active) {
      log(`quiz  id=${payload.id} fen=${payload.fen} seconds=${payload.seconds} pts=${payload.points}/-${payload.negative}`);
      answerQuiz(payload.id, payload.fen);
    } else {
      log(`quiz ENDED id=${payload.id}`);
    }
  })
  .on("broadcast", { event: "quiz_result" }, ({ payload }) => {
    const mine = (payload.verdicts || []).find((v) => v.userId === me.userId);
    log(`quiz_result  quizId=${payload.quizId}  me=${mine ? (mine.correct ? "CORRECT" : "wrong") : "n/a"}`);
  })
  .on("broadcast", { event: "simul_move" }, ({ payload }) => {
    if (payload.studentId !== me.userId) return;
    simulFen = payload.fen;
    log(`simul_move (coach → me)  ${payload.from}${payload.to}  fen=${payload.fen}`);
    // echo my position back so the coach's grid confirms
    channel.send({
      type: "broadcast", event: "simul_game",
      payload: { studentId: me.userId, name: me.name, fen: simulFen, lastMove: { from: payload.from, to: payload.to }, result: null },
    });
  })
  .on("broadcast", { event: "simul_config" }, ({ payload }) => {
    simulClockMs = payload.clockMs > 0 ? payload.clockMs : 0;
    simulResult = null;
    log(`simul_config  clockMs=${payload.clockMs}`);
  })
  .on("broadcast", { event: "reward" }, ({ payload }) =>
    log(`reward  ${payload.icon} "${payload.label}"${payload.toUserId ? (payload.toUserId === me.userId ? " (for ME)" : "") : " (class)"}`))
  .on("broadcast", { event: "whiteboard" }, ({ payload }) => vlog(`whiteboard  ${payload.kind}`))
  .on("broadcast", { event: "request_sync" }, ({ payload }) => vlog(`request_sync from ${payload.from}`))
  .on("presence", { event: "sync" }, () => {
    const st = channel.presenceState();
    vlog("presence  " + Object.values(st).map((m) => `${m[0]?.name}(${m[0]?.role})`).join(", "));
  })
  .subscribe(async (status, err) => {
    if (status === "SUBSCRIBED") {
      log("SUBSCRIBED to class:" + classroomId);
      await channel.track({ name: me.name, role: "student", avatar: null });
      channel.send({ type: "broadcast", event: "request_sync", payload: { from: me.userId } });
      const say = opt("say", null);
      if (say) setTimeout(() => {
        channel.send({ type: "broadcast", event: "chat", payload: { from: me.userId, name: me.name, text: say, at: Date.now() } });
        log(`→ chat  "${say}"`);
      }, 1500);
      if (doSimul) {
        log("simul mode: publishing a game every 3s (+ clock tick)");
        setInterval(() => {
          if (simulClockMs > 0 && !simulResult) {
            simulClockMs = Math.max(0, simulClockMs - 3000);
            if (simulClockMs === 0) { simulResult = "1-0"; log("simul clock EXPIRED → resign"); }
          }
          channel.send({
            type: "broadcast",
            event: "simul_game",
            payload: {
              studentId: me.userId, name: me.name, fen: simulFen,
              lastMove: { from: "e2", to: "e4" }, result: simulResult,
              clockMs: simulClockMs > 0 ? simulClockMs : undefined,
            },
          });
          vlog(`→ simul_game  clock=${simulClockMs}  result=${simulResult}`);
        }, 3000);
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      console.error("channel status:", status, err?.message ?? "");
    }
  });

process.on("SIGINT", async () => { log("leaving…"); await sb.removeChannel(channel); process.exit(0); });
