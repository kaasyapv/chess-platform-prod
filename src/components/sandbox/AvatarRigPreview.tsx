"use client";

/* Sandbox: the PRODUCTION avatar set (lib/avatars AvatarArt) - the curated
 * line-art cast. Click any character to replay its greet gesture. */

import { useState } from "react";
import { AVATARS, AvatarArt } from "@/lib/avatars";

export function AvatarRigPreview() {
  const [picked, setPicked] = useState(AVATARS[0].id);
  const [greet, setGreet] = useState(1);
  return (
    <div className="flex flex-wrap items-end gap-6 p-6 rounded-card bg-surface-2 border border-border">
      {AVATARS.map((a) => (
        <button key={a.id} title={a.label} className="flex flex-col items-center gap-1"
          onClick={() => { setPicked(a.id); setGreet((n) => n + 1); }}>
          <AvatarArt id={a.id} size={a.id === picked ? 160 : 88} play={a.id === picked ? greet : 0} />
          <span className="text-xs text-muted-foreground">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
