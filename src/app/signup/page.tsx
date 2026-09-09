"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, SegmentedTabs } from "@/components/ui";

/** Two entry paths:
 *  - "Join academy": user has an invite code created by staff → profile is
 *    created against the invite (role/academy inherited, claim_invite trigger).
 *  - "New academy": bootstrap_academy() RPC creates the tenant + CEO profile. */
export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState("Join academy");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [academyName, setAcademyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const { data: signup, error: authErr } = await supabase.auth.signUp({ email, password });
    if (authErr || !signup.user) {
      setError(authErr?.message ?? "Sign-up failed");
      setBusy(false);
      return;
    }

    if (mode === "New academy") {
      const { error: rpcErr } = await supabase.rpc("bootstrap_academy", {
        academy_name: academyName.trim(),
        ceo_name: name.trim(),
      });
      if (rpcErr) { setError(rpcErr.message); setBusy(false); return; }
    } else {
      // Atomic claim (0008): validates the code, creates the profile, and
      // marks the invite claimed in one security-definer call - invites stay
      // unreadable to non-staff.
      const { error: rpcErr } = await supabase.rpc("claim_invite_code", {
        p_code: code.trim(),
        p_display_name: name.trim() || null,
      });
      if (rpcErr) { setError(rpcErr.message); setBusy(false); return; }
    }
    router.replace("/");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4 bg-surface-2 border border-border rounded-card p-8"
      >
        <h1 className="text-xl font-semibold tracking-tight text-center">Create your account</h1>
        <div className="self-center">
          <SegmentedTabs tabs={["Join academy", "New academy"]} active={mode} onChange={setMode} />
        </div>
        <Input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" required minLength={8} placeholder="Password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === "Join academy" ? (
          <Input required placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
        ) : (
          <Input required placeholder="Academy name" value={academyName} onChange={(e) => setAcademyName(e.target.value)} />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
        <p className="text-sm text-muted-foreground text-center">
          Have an account? <Link href="/login" className="text-primary-hover hover:underline">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
