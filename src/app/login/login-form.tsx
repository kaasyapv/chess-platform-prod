"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input } from "@/components/ui";
import type { Branding } from "@/lib/branding";

export function LoginForm({ branding }: { branding: Branding | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  }

  // A tenant's brand colour overrides --primary (and its hover) on this
  // subtree, so the sign-in button and links pick it up without a theme rebuild.
  const brandStyle = branding?.primary
    ? ({ "--primary": branding.primary, "--primary-hover": branding.primary } as React.CSSProperties)
    : undefined;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form
        onSubmit={handleSubmit}
        style={brandStyle}
        className="w-full max-w-sm flex flex-col gap-4 bg-surface-2 border border-border rounded-card p-8"
      >
        {branding?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logoUrl} alt={branding.name} className="h-12 self-center object-contain" />
        ) : (
          <h1 className="text-xl font-semibold tracking-tight text-center">
            {branding?.name ?? "ChessAcademy"}
          </h1>
        )}
        <p className="text-sm text-muted-foreground text-center -mt-1">Sign in to continue</p>
        <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <Button type="button" variant="secondary" onClick={handleGoogle}>Continue with Google</Button>
        <p className="text-sm text-muted-foreground text-center">
          No account? <Link href="/signup" className="text-primary-hover hover:underline">Sign up</Link>
        </p>
      </form>
    </main>
  );
}
