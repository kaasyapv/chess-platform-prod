import type { Role } from "@/lib/auth";
import type { LucideIcon } from "lucide-react";
import {
  Building2, Radio, Magnet, GraduationCap, School, FolderOpen, PencilRuler,
  BookOpen, Trophy, Swords, CheckSquare, CalendarClock, CalendarDays, Medal,
  Puzzle, Gamepad2, SearchCode, BarChart3, Crosshair, LineChart, ShieldAlert,
  Wallet, Layers,
} from "lucide-react";

export type NavItem = {
  label: string;
  slug: string;
  icon: LucideIcon;
  roles: Role[];
  /** Draw a separator above this item - the primary four sit on top. */
  divider?: boolean;
  /** Extra manager_permissions flag required on top of the role. CEO always
   *  passes (my_perm() returns true for ceo), managers must be granted it. */
  perm?: string;
};

const ALL: Role[] = ["ceo", "manager", "coach", "student"];
const STAFF: Role[] = ["ceo", "manager", "coach"];
// Managers run operations, not teaching content - these are hidden from them.
const NO_MANAGER_ALL: Role[] = ["ceo", "coach", "student"];
// Teaching/practice tools. CEO and Manager dashboards stay focused on
// operational, financial and administrative work, so the playing surfaces
// (board, puzzles, drills, PGN library, game insights) belong to the people
// who actually teach and learn. Enforced as real access control, not just a
// hidden link - see canAccessSlug() below, applied in src/proxy.ts.
const TEACHING: Role[] = ["coach", "student"];
const COACH_ONLY: Role[] = ["coach"];

/** The four everyday destinations sit on top; everything else lives under a
 *  divider, in the order a coach reaches for it. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Academy",          slug: "academy",          icon: GraduationCap, roles: STAFF },
  { label: "Classrooms",       slug: "classrooms",       icon: School,        roles: ALL },
  { label: "PGN Library",      slug: "folders",          icon: FolderOpen,    roles: COACH_ONLY },
  { label: "Calendar",         slug: "calendar",         icon: CalendarDays,  roles: ALL },

  { label: "Organization",     slug: "organization",     icon: Building2,     roles: ["ceo"], divider: true },
  { label: "Live Ops",         slug: "live-ops",         icon: Radio,         roles: ["ceo", "manager"] },
  // Managers only see Leads when the CEO has granted can_manage_leads;
  // `perm` is checked on top of `roles` (see canAccessSlug).
  { label: "Leads",            slug: "leads",            icon: Magnet,        roles: ["ceo", "manager"], perm: "can_manage_leads" },
  // Everyone but nobody equally: coaches and students do the work, while the
  // CEO and managers need the oversight view (every assignment in the academy
  // and its submission count). is_staff() already let them read and write this
  // table at the database level, so listing it here grants no new capability -
  // it stops the route guard from bouncing them out of a section they own.
  { label: "Homework",         slug: "homeworks",        icon: PencilRuler,   roles: ALL },
  { label: "Courses",          slug: "courses",          icon: BookOpen,      roles: NO_MANAGER_ALL },
  { label: "Curriculum",       slug: "curriculum",       icon: Layers,        roles: NO_MANAGER_ALL },
  { label: "Tournaments",      slug: "tournaments",      icon: Trophy,        roles: ALL },
  { label: "Simuls",           slug: "simuls",           icon: Swords,        roles: ALL },
  { label: "Attendance",       slug: "attendance",       icon: CheckSquare,   roles: STAFF },
  { label: "Penalties",        slug: "penalties",        icon: ShieldAlert,   roles: ["ceo"] },
  { label: "Self Booking",     slug: "self-booking",     icon: CalendarClock, roles: ALL },
  // Payment History: a coach's or manager's own statement, or the academy's
  // books for the CEO (and a manager granted can_view_billing) -- the page
  // decides, so no route gate here. Students have no payment section at all.
  { label: "Payment History",  slug: "billing",          icon: Wallet,        roles: STAFF },
  { label: "Leaderboard",      slug: "leaderboard",      icon: Medal,         roles: ALL },
  { label: "Puzzles",          slug: "puzzles",          icon: Puzzle,        roles: TEACHING },
  { label: "Coordinates",      slug: "coordinates",      icon: Crosshair,     roles: TEACHING },
  { label: "Play Area",        slug: "play-area",        icon: Gamepad2,      roles: TEACHING },
  { label: "Analysis Board",   slug: "analysis-board",   icon: SearchCode,    roles: TEACHING },
  { label: "Game Insights",    slug: "insights",         icon: LineChart,     roles: COACH_ONLY },
  { label: "Report",           slug: "report",           icon: BarChart3,     roles: STAFF },
];

export const APP_VERSION = "v: 1.0.0";

/** Dashboard sections that carry no nav entry but are still legitimately
 *  reachable for the listed roles (deep links, redirects, detail pages). */
const EXTRA_ACCESS: Record<string, Role[]> = {
  profile: ALL,
  telecrm: ["ceo", "manager"],
  // Full Report on one person. The page already redirects anyone who isn't
  // CEO or manager, but an unlisted slug falls through canAccessSlug()'s
  // "let the router 404 it" branch, which means the route guard waves it
  // through - one page-level `if` away from being open to students. Listed
  // so both layers agree.
  people: ["ceo", "manager"],
  // Meeting rooms are reachable by whoever was invited; RLS decides that, not
  // the role, so the route stays open to everyone and returns nothing to
  // someone who was not on the list.
  meetings: ALL,
};

/** Does this section carry a permission gate at all? The route guard uses this
 *  to decide whether it needs to look a manager's flags up, so an ordinary
 *  page load costs no extra query. */
export function slugNeedsPerm(slug: string): boolean {
  return Boolean(NAV_ITEMS.find((i) => i.slug === slug)?.perm);
}

/** Single source of truth for "may this role open this dashboard section".
 *  NAV_ITEMS drives both the sidebar and the route guard in src/proxy.ts, so a
 *  section removed from a role's nav is genuinely unreachable for them rather
 *  than merely unlisted - typing the URL redirects instead of rendering. */
export function canAccessSlug(role: Role, slug: string, perms?: Record<string, boolean> | null): boolean {
  const item = NAV_ITEMS.find((i) => i.slug === slug);
  const allowed = item?.roles ?? EXTRA_ACCESS[slug];
  if (!allowed) return true; // unknown slug: let the router 404 it
  if (!allowed.includes(role)) return false;
  // A permission-gated section: the CEO always has it, a manager needs the flag.
  if (item?.perm && role === "manager") return Boolean(perms?.[item.perm]);
  return true;
}
