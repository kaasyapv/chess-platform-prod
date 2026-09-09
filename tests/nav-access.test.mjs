// Self-check for dashboard section access. Run: npm test
//
// These rules are load-bearing twice over: they build the sidebar AND they are
// what src/proxy.ts enforces on the URL, so a role that lost a section can't
// reach it by typing the address. A regression here silently re-opens a
// section to a role that shouldn't have it, which no page-level test would catch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canAccessSlug, NAV_ITEMS } from "../src/lib/nav.ts";

// Teaching/practice surfaces the CEO and Manager dashboards were cleaned of.
// Homework used to be on this list and is deliberately no longer: the owner
// requires admin oversight of every assignment in the academy and its
// completion state, and is_staff() already granted them the rows - hiding the
// section only meant the route guard bounced them out of data they could read
// anyway. Practice tools (boards, puzzles, drills) stay closed to admins.
const REMOVED_FROM_ADMINS = [
  "coordinates", "puzzles", "play-area", "analysis-board", "insights", "folders",
];

test("CEO and Manager cannot reach the teaching/practice sections", () => {
  for (const slug of REMOVED_FROM_ADMINS) {
    assert.equal(canAccessSlug("ceo", slug), false, `ceo should not reach ${slug}`);
    assert.equal(canAccessSlug("manager", slug), false, `manager should not reach ${slug}`);
  }
});

test("admins oversee homework across the academy", () => {
  for (const role of ["ceo", "manager"]) {
    assert.equal(canAccessSlug(role, "homeworks"), true, `${role} lost homework oversight`);
  }
});

test("the Full Report on a person is admin-only at the route guard too", () => {
  assert.equal(canAccessSlug("ceo", "people"), true);
  assert.equal(canAccessSlug("manager", "people"), true);
  assert.equal(canAccessSlug("coach", "people"), false);
  assert.equal(canAccessSlug("student", "people"), false);
});

test("removing them from admins did not delete the features for everyone", () => {
  // PGN library and game insights stay with the coach; practice tools stay with
  // both coach and student. The spec is explicit that the PGN system survives.
  assert.equal(canAccessSlug("coach", "folders"), true);
  assert.equal(canAccessSlug("coach", "insights"), true);
  for (const slug of ["puzzles", "play-area", "analysis-board", "coordinates", "homeworks"]) {
    assert.equal(canAccessSlug("coach", slug), true, `coach lost ${slug}`);
    assert.equal(canAccessSlug("student", slug), true, `student lost ${slug}`);
  }
});

test("admins keep their operational sections", () => {
  for (const slug of ["organization", "live-ops", "leads", "penalties", "attendance", "billing", "report", "classrooms"]) {
    assert.equal(canAccessSlug("ceo", slug), true, `ceo lost ${slug}`);
  }
  // Penalties is deliberately absent here: it is CEO-only since 0025, and has
  // its own test below.
  for (const slug of ["live-ops", "attendance", "classrooms"]) {
    assert.equal(canAccessSlug("manager", slug), true, `manager lost ${slug}`);
  }
  // Organization is the CEO's own command centre.
  assert.equal(canAccessSlug("manager", "organization"), false);
});

test("students cannot reach staff sections", () => {
  for (const slug of ["academy", "live-ops", "leads", "penalties", "organization", "report", "attendance"]) {
    assert.equal(canAccessSlug("student", slug), false, `student could reach ${slug}`);
  }
});

test("Leads is off for managers until the CEO grants it", () => {
  // The requirement is explicit: managers must NOT have Leads by default, and
  // the CEO turns it on per person. The CEO themselves always has it.
  assert.equal(canAccessSlug("manager", "leads"), false, "manager should not have Leads by default");
  assert.equal(canAccessSlug("manager", "leads", {}), false, "absent flag is not permission");
  assert.equal(canAccessSlug("manager", "leads", { can_manage_leads: false }), false);
  assert.equal(canAccessSlug("manager", "leads", { can_manage_leads: true }), true, "granted manager should reach Leads");
  assert.equal(canAccessSlug("ceo", "leads"), true, "CEO always has Leads");
  // The grant must not leak into anything else.
  assert.equal(canAccessSlug("manager", "organization", { can_manage_leads: true }), false);
});

test("Payment History belongs to the people the academy pays, never students", () => {
  // Coaches and managers reach it for their OWN statement (sessions taught,
  // penalties withheld), so it carries no permission gate; the page itself
  // decides whether a manager sees the academy's books or their own lines.
  // Students have no payment section at all.
  for (const role of ["ceo", "manager", "coach"]) {
    assert.equal(canAccessSlug(role, "billing"), true, `${role} lost Payment History`);
  }
  assert.equal(canAccessSlug("student", "billing"), false, "students must not reach Payment History");
});

test("Penalties are the CEO's alone", () => {
  // Managers must not see other people's penalties (0025). A penalised coach
  // or manager reads and appeals their own from Payment History instead, so
  // losing this section costs them nothing.
  assert.equal(canAccessSlug("ceo", "penalties"), true);
  for (const role of ["manager", "coach", "student"]) {
    assert.equal(canAccessSlug(role, "penalties"), false, `${role} should not reach Penalties`);
  }
  // A billing grant is not a penalties grant.
  assert.equal(canAccessSlug("manager", "penalties", { can_view_billing: true }), false);
});

test("every nav slug is spelled the same in NAV_ITEMS and the access check", () => {
  // Guards the failure mode where a slug is renamed in one place only, which
  // would make canAccessSlug fall through to its permissive unknown-slug branch.
  // Permission-gated items are checked with the flag granted.
  for (const item of NAV_ITEMS) {
    const perms = item.perm ? { [item.perm]: true } : undefined;
    for (const role of item.roles) {
      assert.equal(canAccessSlug(role, item.slug, perms), true, `${role} should reach ${item.slug}`);
    }
  }
});
