/* Mints a LiveKit room token for a classroom.
 *
 * classrooms RLS only checks tenant (academy_id = my_academy()) - it's meant
 * to let every academy member browse the schedule, not to say "you may join
 * this specific live room". So unlike most routes in this app, that read
 * being non-empty is NOT enough authorisation here: for a student we also
 * check real class membership (enrolled, or a member of the class's batch)
 * below, and roomAdmin (mute/kick/record) is scoped to the assigned coach or
 * an academy admin, not "any coach in the academy".
 *
 * The API secret never leaves the server: the browser only ever receives a
 * short-lived signed JWT scoped to one room.
 */

import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

/** LiveKit rooms are namespaced by classroom, so no two classes can collide. */
export function roomName(classroomId: string): string {
  return `classroom-${classroomId}`;
}

export async function GET(req: Request) {
  const classroomId = new URL(req.url).searchParams.get("classroom");
  if (!classroomId) {
    return NextResponse.json({ error: "classroom is required" }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "Video is not configured. Set NEXT_PUBLIC_LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET." },
      { status: 503 },
    );
  }

  const profile = await requireProfile();

  // Minting room credentials - a loop here is free SFU minutes. A real client
  // fetches one token per join and refreshes ~hourly.
  const limited = rateLimitGuard(`livekit:${profile.id}`, 30, 60_000);
  if (limited) return limited;

  const supabase = await createClient();
  const { data: classroom } = await supabase
    .from("classrooms")
    .select("id, coach_id, batch_id")
    .eq("id", classroomId)
    .single();

  if (!classroom) {
    return NextResponse.json({ error: "Classroom not found" }, { status: 404 });
  }

  const isAssignedCoach = classroom.coach_id === profile.id;
  const isAdminTier = profile.role === "ceo" || profile.role === "manager";

  // Students must actually belong to this class - either individually
  // enrolled or a member of its batch - not just any student in the academy.
  if (profile.role === "student") {
    const { data: enrolled } = await supabase
      .from("classroom_enrollments")
      .select("student_id")
      .eq("classroom_id", classroom.id)
      .eq("student_id", profile.id)
      .maybeSingle();
    let isMember = !!enrolled;
    if (!isMember && classroom.batch_id) {
      const { data: inBatch } = await supabase
        .from("batch_members")
        .select("student_id")
        .eq("batch_id", classroom.batch_id)
        .eq("student_id", profile.id)
        .maybeSingle();
      isMember = !!inBatch;
    }
    if (!isMember) {
      return NextResponse.json({ error: "You are not enrolled in this class" }, { status: 403 });
    }
  }

  // Only the assigned coach or an academy admin may mute/kick/record - a
  // different coach observing this class doesn't get control over it.
  const isCoach = isAssignedCoach || isAdminTier;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: profile.id,
    name: profile.display_name,
    // Tokens are short-lived; the client reconnects with a fresh one.
    ttl: "2h",
  });

  at.addGrant({
    room: roomName(classroom.id),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isCoach,
  });

  return NextResponse.json({
    token: await at.toJwt(),
    url,
    isCoach,
  });
}
