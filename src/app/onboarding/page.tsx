"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, SegmentedTabs } from "@/components/ui";

/** Authenticated user without a profile (e.g. first Google sign-in):
 *  claim an invite code or bootstrap a new academy. */
export default function OnboardingPage() {
  const router = useRouter();
  const [mode, setMode] = useState("Join academy");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [academyName, setAcademyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace("/login"); return; }

    if (mode === "New academy") {
      const { error: rpcErr } = await supabase.rpc("bootstrap_academy", {
        academy_name: academyName.trim(),
        ceo_name: name.trim(),
      });
      if (rpcErr) { setError(rpcErr.message); setBusy(false); return; }
    } else {
      const { data: invite } = await supabase
        .from("invites")
        .select("academy_id, role, display_name, username")
        .eq("code", code.trim())
        .is("claimed_by", null)
        .single();
      if (!invite) { setError("Invalid or already-claimed invite code"); setBusy(false); return; }
      const { error: profErr } = await supabase.from("profiles").insert({
        id: user.id,
        academy_id: invite.academy_id,
        role: invite.role,
        display_name: name.trim() || invite.display_name,
        username: invite.username,
        invite_code: code.trim(),
      });
      if (profErr) { setError(profErr.message); setBusy(false); return; }
    }
    router.replace("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-4 bg-surface-2 border border-border rounded-card p-8">
        <h1 className="text-xl font-semibold text-center">Finish setting up</h1>
        <div className="self-center">
          <SegmentedTabs tabs={["Join academy", "New academy"]} active={mode} onChange={setMode} />
        </div>
        <Input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        {mode === "Join academy" ? (
          <Input required placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
        ) : (
          <Input required placeholder="Academy name" value={academyName} onChange={(e) => setAcademyName(e.target.value)} />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Continue"}</Button>
      </form>
    </main>
  );
}
