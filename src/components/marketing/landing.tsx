import Link from "next/link";
import { pieceUrl, type PieceKind } from "@/components/board/piece-sets";
import { ScanLine, Swords, Video, Building2, Target, Check, type LucideIcon } from "lucide-react";

/* Public marketing landing - server-rendered, zero client JS.
 * Same design system as the app: Playmate tokens (design-tokens.md), the
 * WorldChess Club Green board palette, and the in-repo Loco piece art.
 * FAQ uses native <details>; animations are the CSS `.rise` keyframes. */

// ── Static hero board (Italian Game middlegame - no board lib needed) ───────
const HERO_FEN = "r1bq1rk1/2pp1ppp/p1n2n2/1pb1p3/4P3/1B1P1N2/PPP2PPP/RNBQR1K1";

function heroBoardCells() {
  const cells: { key: number; dark: boolean; piece?: { kind: string; color: "w" | "b" } }[] = [];
  let i = 0;
  for (const row of HERO_FEN.split("/")) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let n = 0; n < Number(ch); n++, i++)
          cells.push({ key: i, dark: (Math.floor(i / 8) + i) % 2 === 1 });
      } else {
        cells.push({
          key: i,
          dark: (Math.floor(i / 8) + i) % 2 === 1,
          piece: { kind: ch.toLowerCase(), color: ch === ch.toUpperCase() ? "w" : "b" },
        });
        i++;
      }
    }
  }
  return cells;
}

function HeroBoard() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-8 rounded-card overflow-hidden border border-border shadow-pop aspect-square w-full max-w-md mx-auto"
    >
      {heroBoardCells().map((c) => (
        <div
          key={c.key}
          className="relative aspect-square"
          style={{ background: c.dark ? "var(--board-dark)" : "var(--board-light)" }}
        >
          {c.piece && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pieceUrl("cburnett", c.piece.kind as PieceKind, c.piece.color)}
              alt=""
              className="absolute inset-0 w-full h-full p-[4%]"
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
const cta = "inline-flex items-center justify-center rounded-btn px-6 py-3 text-base font-medium transition-colors";
const ctaPrimary = `${cta} bg-primary hover:bg-primary-hover text-primary-foreground`;
const ctaSecondary = `${cta} border border-border bg-transparent hover:bg-surface-3`;

function SectionHeading({ id, eyebrow, title, blurb }: { id?: string; eyebrow: string; title: string; blurb?: string }) {
  return (
    <div className="max-w-2xl mx-auto text-center mb-12">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary-hover mb-3">{eyebrow}</p>
      <h2 id={id} className="text-3xl sm:text-4xl font-bold tracking-tight">{title}</h2>
      {blurb && <p className="text-muted-foreground mt-4 text-base">{blurb}</p>}
    </div>
  );
}

// ── Content data ─────────────────────────────────────────────────────────────
const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ScanLine, title: "Snap a diagram to the board", body: "Photograph a page from a chess book or a scanned diagram mid-class: vision AI reconstructs the position and loads it straight onto the shared board." },
  { icon: Swords, title: "Premium Interactive Board", body: "A tournament-grade board with premoves, drawn arrows, legal-move hints, synthesized sounds, and increment clocks: the same board across play, analysis, lessons, and live classes." },
  { icon: Video, title: "Live Classes", body: "One-click classrooms with built-in video, real-time board sync, chat, and a full coach tool palette: lock the board, flip, annotate, snapshot positions to notes." },
  { icon: Building2, title: "Academy Management", body: "Students, batches, attendance, homework with review queues, tournaments, simuls, self-booking, calendars, leaderboards, and billing: one place for the whole academy." },
  { icon: Target, title: "Interactive Learning", body: "Students solve homework on the board, play Stockfish across 12 levels, review annotated games, and climb the leaderboard with points and coins." },
];

const AUDIENCES = [
  { title: "Chess Academies", body: "Run every batch, coach, and student under one roof with role-based access, audit logs, and billing built in.", points: ["Multi-coach roles: CEO, Manager, Coach", "Attendance, reports & payment history", "Invite-based onboarding in minutes"] },
  { title: "Coaches", body: "Teach more, prep less. Turn your existing material into interactive lessons and run live classes without juggling apps.", points: ["AI lesson generation from PDFs & PGNs", "Live classroom with board sync + video", "Homework review queue with scoring"] },
  { title: "Students", body: "Learn by doing: every lesson, puzzle, and game happens on a real board, not a worksheet.", points: ["Play the engine at your level (12 tiers)", "Solve homework right on the board", "Points, coins & leaderboards"] },
];

const STEPS = [
  { n: "01", title: "Upload", body: "Drop in PDFs, scanned books, or PGN files, the material you already teach from." },
  { n: "02", title: "AI extracts", body: "Diagrams become positions; positions become lessons, quizzes, and flashcards. You approve every one." },
  { n: "03", title: "Interactive lessons", body: "Students study on the live board: moves, hints, and annotations, not static pages." },
  { n: "04", title: "Live coaching", body: "Bring it all into a live classroom with video, synced boards, and your coach toolkit." },
];

const PLANS = [
  {
    name: "Free", price: "₹0", period: "forever", highlight: false,
    blurb: "For solo coaches trying the platform.",
    features: ["1 coach, up to 10 students", "Full interactive board", "Play vs engine & analysis", "PGN library & viewer"],
    ctaLabel: "Start Free", ctaHref: "/signup?plan=free",
  },
  {
    name: "Pro Coach", price: "₹1,999", period: "/month", highlight: true,
    blurb: "For professional coaches who teach daily.",
    features: ["Unlimited students & batches", "Snap diagrams to the board", "Live classrooms with video", "Homework, attendance & booking"],
    ctaLabel: "Start Free Trial", ctaHref: "/signup?plan=pro",
  },
  {
    name: "Academy", price: "₹4,999", period: "/month", highlight: false,
    blurb: "For academies with multiple coaches.",
    features: ["Everything in Pro Coach", "CEO / Manager / Coach roles", "Billing & subscriptions", "Audit logs & reports"],
    ctaLabel: "Start Free Trial", ctaHref: "/signup?plan=academy",
  },
];

/* Use-case cards, not testimonials: nobody has said these yet, so nobody is
 * quoted. Swap in real quotes with real names when customers provide them. */
const USE_CASES = [
  { title: "Bring a physical board into class", text: "A coach photographs a position from a book or a physical board mid-lesson; it lands on every student's screen in seconds, no manual setup.", who: "For academy directors" },
  { title: "Homework students actually do", text: "Assignments are solved on the board, not on worksheets. Attempts, streaks, and points land on the leaderboard automatically.", who: "For trainers" },
  { title: "One tab for the whole class", text: "A synced board, camera grid, chat, and quizzes in a single classroom view replaces three separate tools.", who: "For head coaches" },
];

const FAQS = [
  { q: "How does the diagram snap feature work?", a: "During a live class, a coach photographs a diagram from a book or a physical board. Vision AI detects the position and reconstructs it as a FEN, which loads straight onto the shared board, with a confidence score shown alongside it." },
  { q: "Do I need to install anything?", a: "No. The platform runs entirely in the browser, including the chess engine (Stockfish compiled to WebAssembly) and live class video. It works on desktop and tablets out of the box." },
  { q: "How do students join my academy?", a: "You add students from the Academy page, which generates invite codes. Students sign up with their code and land in the right academy with the right role automatically." },
  { q: "Can I import my existing material?", a: "Yes: PGN files import instantly with no AI required. Your PGN library supports folders, search, and drag-to-reorder." },
  { q: "What happens after the free trial?", a: "Your data stays yours. If you don't upgrade, you keep the Free plan limits: nothing is deleted, and you can export PGNs at any time." },
  { q: "Is my academy's data isolated?", a: "Yes. Every academy is a separate tenant enforced by database row-level security, with role-based permissions and an audit log of sensitive actions." },
];

// ── Page ─────────────────────────────────────────────────────────────────────
export function Landing() {
  return (
    <div className="flex-1">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <nav aria-label="Main" className="max-w-6xl mx-auto flex items-center gap-6 px-5 h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <span aria-hidden>♞</span> ChessAcademy
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground ml-4">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#audiences" className="hover:text-foreground transition-colors">Who it&apos;s for</a>
            <a href="#workflow" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
            <Link href="/signup" className={`${cta} bg-primary hover:bg-primary-hover text-primary-foreground !px-4 !py-2 text-sm`}>
              Start Free Trial
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section aria-labelledby="hero-title" className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(60% 50% at 50% 0%, rgb(55 47 195 / 0.25), transparent 70%)" }} />
        <div className="relative max-w-6xl mx-auto px-5 pt-20 pb-16 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="rise inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary-hover border border-primary/40 bg-primary/10 rounded-full px-3 py-1 mb-6">
              AI-powered chess coaching
            </p>
            <h1 id="hero-title" className="rise rise-1 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08]">
              Turn chess books into living lessons.
            </h1>
            <p className="rise rise-2 text-muted-foreground text-lg mt-6 max-w-xl">
              ChessAcademy is the all-in-one platform for chess academies: AI that digitizes your
              material, a tournament-grade board, live classes, and complete academy management -
              in one tab.
            </p>
            <div className="rise rise-3 flex flex-wrap gap-3 mt-8">
              <Link href="/signup" className={ctaPrimary}>Start Free Trial</Link>
              <a href="mailto:demo@chessacademy.example?subject=Demo%20request" className={ctaSecondary}>Book a Demo</a>
            </div>
            <p className="rise rise-3 text-xs text-muted-foreground mt-4">
              Free forever for small academies · No credit card required
            </p>
          </div>
          <div className="rise rise-2"><HeroBoard /></div>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features" className="max-w-6xl mx-auto px-5 py-20">
        <SectionHeading id="features" eyebrow="Features" title="Everything a modern academy runs on"
          blurb="Five pillars, one platform, no more juggling video calls, PDFs, spreadsheets, and analysis tools." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <article key={f.title} className="bg-surface-2 border border-border rounded-card p-6 hover:border-primary/50 transition-colors">
              <f.icon aria-hidden className="mb-3 text-primary-hover" size={26} />
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Audiences */}
      <section aria-labelledby="audiences" className="border-y border-border bg-surface-1/50">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <SectionHeading id="audiences" eyebrow="Who it's for" title="Built for every seat in the academy" />
          <div className="grid md:grid-cols-3 gap-5">
            {AUDIENCES.map((a) => (
              <article key={a.title} className="bg-surface-2 border border-border rounded-card p-6">
                <h3 className="font-semibold text-lg mb-2">{a.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">{a.body}</p>
                <ul className="space-y-2">
                  {a.points.map((p) => (
                    <li key={p} className="text-sm flex gap-2">
                      <Check aria-hidden size={16} className="text-success shrink-0 mt-0.5" />{p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section aria-labelledby="workflow" className="max-w-6xl mx-auto px-5 py-20">
        <SectionHeading id="workflow" eyebrow="How it works" title="From bookshelf to live class in four steps" />
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-surface-2 border border-border rounded-card p-6">
              <p aria-hidden className="text-primary-hover font-bold text-sm mb-3">{s.n}</p>
              <h3 className="font-semibold mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing */}
      <section aria-labelledby="pricing" className="border-y border-border bg-surface-1/50">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <SectionHeading id="pricing" eyebrow="Pricing" title="Simple plans that grow with you"
            blurb="Start free. Upgrade when your academy does. Billing is handled inside the platform." />
          <div className="grid md:grid-cols-3 gap-5 items-stretch">
            {PLANS.map((p) => (
              <article key={p.name}
                className={`rounded-card p-6 flex flex-col border ${p.highlight ? "border-primary bg-surface-2 shadow-lg shadow-primary/20" : "border-border bg-surface-2"}`}>
                {p.highlight && (
                  <p className="self-start text-xs font-semibold uppercase tracking-wider bg-primary text-primary-foreground rounded-full px-3 py-1 mb-4">
                    Most popular
                  </p>
                )}
                <h3 className="font-semibold text-lg">{p.name}</h3>
                <p className="mt-2"><span className="text-3xl font-bold">{p.price}</span>
                  <span className="text-muted-foreground text-sm"> {p.period}</span></p>
                <p className="text-sm text-muted-foreground mt-2 mb-5">{p.blurb}</p>
                <ul className="space-y-2 mb-6">
                  {p.features.map((f) => (
                    <li key={f} className="text-sm flex gap-2">
                      <Check aria-hidden size={16} className="text-success shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
                <Link href={p.ctaHref} className={`${p.highlight ? ctaPrimary : ctaSecondary} mt-auto w-full`}>
                  {p.ctaLabel}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section aria-labelledby="use-cases" className="max-w-6xl mx-auto px-5 py-20">
        <SectionHeading id="use-cases" eyebrow="Use cases" title="Built for coaches who teach for a living" />
        <div className="grid md:grid-cols-3 gap-5">
          {USE_CASES.map((t) => (
            <div key={t.title} className="bg-surface-2 border border-border rounded-card p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary-hover">{t.who}</p>
              <p className="font-semibold mt-2">{t.title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground mt-2">{t.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq" className="border-t border-border bg-surface-1/50">
        <div className="max-w-3xl mx-auto px-5 py-20">
          <SectionHeading id="faq" eyebrow="FAQ" title="Questions, answered" />
          <div className="space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group bg-surface-2 border border-border rounded-card px-5 py-4">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">＋</span>
                </summary>
                <p className="text-sm text-muted-foreground leading-relaxed mt-3">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section aria-labelledby="final-cta" className="max-w-6xl mx-auto px-5 py-24 text-center">
        <h2 id="final-cta" className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
          Ready to run your academy on one platform?
        </h2>
        <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
          Set up your academy in minutes. Invite your coaches and students today.
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link href="/signup" className={ctaPrimary}>Start Free Trial</Link>
          <a href="mailto:demo@chessacademy.example?subject=Demo%20request" className={ctaSecondary}>Book a Demo</a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-4 gap-8 text-sm">
          <div className="sm:col-span-2">
            <p className="font-bold text-base mb-2"><span aria-hidden>♞</span> ChessAcademy</p>
            <p className="text-muted-foreground max-w-xs">
              The all-in-one platform for chess academies: AI lessons, a premium board,
              live classes, and academy management.
            </p>
          </div>
          <nav aria-label="Product">
            <p className="font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
              <li><a href="#faq" className="hover:text-foreground transition-colors">FAQ</a></li>
            </ul>
          </nav>
          <nav aria-label="Account">
            <p className="font-semibold mb-3">Account</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link href="/login" className="hover:text-foreground transition-colors">Sign in</Link></li>
              <li><Link href="/signup" className="hover:text-foreground transition-colors">Create academy</Link></li>
              <li><a href="mailto:demo@chessacademy.example" className="hover:text-foreground transition-colors">Contact</a></li>
            </ul>
          </nav>
        </div>
        <div className="border-t border-border">
          <p className="max-w-6xl mx-auto px-5 py-5 text-xs text-muted-foreground">
            © {new Date().getFullYear()} ChessAcademy. Original piece art & sounds, no proprietary assets.
          </p>
        </div>
      </footer>
    </div>
  );
}
