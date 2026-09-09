"use client";

/* Internal meeting room: the classroom's video mesh with none of the chess.
 * MeshVideoRoom keys its signalling channel off the id it is handed, so a
 * meeting id makes a room of its own with nothing to set up. */

import Link from "next/link";
import { MeshVideoRoom } from "@/components/class/mesh-video-room";
import { Card, PageHeader } from "@/components/ui";
import type { Profile } from "@/lib/auth";

export function MeetingRoomClient({
  me, meeting,
}: {
  me: Profile;
  meeting: {
    id: string; title: string; agenda: string | null; starts_at: string;
    duration_minutes: number; status: string;
    organizer: { display_name: string } | null;
  };
}) {
  const base = `/${me.role}/dashboard/${me.academy_id}`;

  if (meeting.status === "cancelled") {
    return (
      <div>
        <PageHeader title={meeting.title} />
        <Card>
          <p className="text-sm">This meeting was cancelled.</p>
          <Link href={`${base}/calendar`} className="text-primary-hover hover:underline text-sm">
            Back to the calendar
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={meeting.title}
        action={
          <Link href={`${base}/calendar`} className="text-sm text-primary-hover hover:underline">
            Back to calendar
          </Link>
        }
      />

      <p className="text-sm text-muted-foreground mb-4">
        {new Date(meeting.starts_at).toLocaleString(undefined, {
          weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        })}
        {" · "}{meeting.duration_minutes} min
        {meeting.organizer ? ` · called by ${meeting.organizer.display_name}` : ""}
      </p>

      {meeting.agenda && (
        <Card className="mb-4">
          <p className="text-sm font-medium mb-1">Agenda</p>
          <p className="text-sm text-muted-foreground">{meeting.agenda}</p>
        </Card>
      )}

      <div className="h-[70vh] rounded-card overflow-hidden border border-border">
        <MeshVideoRoom
          classroomId={meeting.id}
          me={{ userId: me.id, name: me.display_name, role: me.role }}
        />
      </div>
    </div>
  );
}
