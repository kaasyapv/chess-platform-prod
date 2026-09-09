import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MeshVideoRoom } from "@/components/class/mesh-video-room";

/** Opt-in P2P video room (STUN + Supabase signaling, no LiveKit/VPS) - see
 *  components/class/mesh-video-room.tsx for why this is separate from the
 *  classroom's default LiveKit rail. */
export default async function ClassroomVideoPage({
  params,
}: {
  params: Promise<{ role: string; academyId: string; id: string }>;
}) {
  const { role, academyId, id } = await params;
  const profile = await requireProfile(role, academyId);

  // RLS is the gate: a classroom the caller may not access simply isn't returned.
  const supabase = await createClient();
  const { data: classroom } = await supabase
    .from("classrooms")
    .select("id")
    .eq("id", id)
    .single();

  if (!classroom) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Classroom not found</h1>
        <p className="text-muted-foreground">It may have been deleted, or you may not have access.</p>
      </div>
    );
  }

  return (
    <div className="p-4 h-[calc(100vh-4rem)]">
      <h1 className="text-lg font-semibold mb-1">Video (peer-to-peer beta)</h1>
      <p className="text-xs text-muted-foreground mb-3">
        Direct browser-to-browser video, no server relay. Works best in small groups; may not connect on strict
        corporate/mobile networks.
      </p>
      <div className="h-[calc(100%-3.5rem)]">
        <MeshVideoRoom classroomId={classroom.id} me={{ userId: profile.id, name: profile.display_name, role: profile.role }} />
      </div>
    </div>
  );
}
