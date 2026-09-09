"use client";

import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Button, Card, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AVATARS, AvatarArt } from "@/lib/avatars";
import { AvatarBuilder } from "@/components/dash/avatar-builder";
import { BOARD_THEMES, PREMIUM_THEMES, THEME_COST } from "@/lib/board-settings";
import { createClient as createSb } from "@/lib/supabase/client";
import { BoardSettingsModal } from "@/components/board/board-settings-modal";
import { useBoardSettings } from "@/lib/board-settings";
import type { Profile } from "@/lib/auth";
import { useProfile } from "@/lib/profile-context";

/** Staggered entrance for the avatar grid - skipped under reduced motion. */
const AVATAR_GRID: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};
const AVATAR_ITEM: Variants = {
  hidden: { opacity: 0, scale: 0.7, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 24 } },
};

export function ProfileClient({ profile, academyName }: { profile: Profile; academyName: string }) {
  const toast = useToast();
  const { patch } = useProfile();   // topbar and every other consumer follow along
  const { settings, update } = useBoardSettings();
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState<string | null>(profile.avatar);
  const [busy, setBusy] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [coins, setCoins] = useState(profile.coins);
  const [unlocks, setUnlocks] = useState(profile.unlocks ?? {});
  const [greet, setGreet] = useState(0);   // play-once nonce for the picked avatar
  const isStudent = profile.role === "student";

  /** Spend coins on a cosmetic. Staff have everything already.
   *
   *  One RPC, because charging and unlocking have to be the same transaction:
   *  the old version wrote `unlocks` first and then inserted the -cost ledger
   *  row, which points_ledger's staff-only insert policy rejected for every
   *  student. Nothing read that error, so cosmetics were free and the balance
   *  only fell in local state until the next reload. */
  async function buy(kind: "avatar_extras" | "avatar_hats" | "board_themes", item: number | string, cost: number) {
    if (coins < cost) { toast(`You need ${cost} coins, ask your coach!`, "error"); return; }
    const supabase = createSb();
    const { data, error } = await supabase.rpc("buy_unlock", {
      p_kind: kind, p_item: item,
    });
    if (error) { toast(error.message, "error"); return; }
    setUnlocks((data ?? {}) as typeof unlocks);
    setCoins((c) => c - cost);
    toast("Unlocked!", "success");
  }

  const ownsTheme = (id: string) => !isStudent || !PREMIUM_THEMES.includes(id) || ((unlocks.board_themes ?? []) as string[]).includes(id);

  const dirty = name.trim() !== profile.display_name || avatar !== profile.avatar;

  /** Trying a face on updates the navbar immediately; Save writes it down. */
  const previewAvatar = (id: string | null) => { setAvatar(id); patch({ avatar: id }); };

  async function save() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("profiles")
      .update({ display_name: name.trim(), avatar }).eq("id", profile.id);
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    patch({ display_name: name.trim(), avatar });
    toast("Profile updated", "success");
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Identity band - chess.com-style: avatar in its own frame on the left,
          name + meta beside it, stat tiles on the right. The avatar sits INSIDE
          a padded rounded frame, so nothing ever clips its ring. */}
      <Card className="rise mb-4 mt-2">
        <div className="flex flex-wrap items-center gap-5">
          <span className="inline-flex shrink-0 rounded-2xl border border-border bg-surface-2 p-2.5">
            <Avatar name={name || profile.display_name} seed={profile.id} role={profile.role} size={84} avatar={avatar} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight truncate">{name || profile.display_name}</h1>
              <span className="rounded-md bg-primary/15 text-primary-hover border border-primary/30 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                {profile.role}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {profile.username ? `@${profile.username} · ` : ""}{academyName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">Status: {profile.status}</p>
          </div>
          {profile.role === "student" && (
            <div className="flex gap-3 shrink-0">
              <div className="rounded-card border border-border bg-surface-2 px-4 py-2.5 text-center transition-transform hover:-translate-y-0.5">
                <p className="text-xl font-bold tabular-nums">{profile.points}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">Points</p>
              </div>
              <div className="rounded-card border border-border bg-surface-2 px-4 py-2.5 text-center transition-transform hover:-translate-y-0.5">
                <p className="text-xl font-bold tabular-nums">{coins}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">Coins</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="rise rise-1 transition-shadow hover:shadow-raised">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm flex-1 min-w-56">
            <span className="text-muted-foreground">Display name</span>
            <Input className="w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button onClick={save} disabled={busy || !name.trim() || !dirty}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>

      {/* Build your own DiceBear avatar - style + seed, saved as one string and
          rendered everywhere the platform shows you. */}
      <Card className="rise rise-2 mt-4 transition-shadow hover:shadow-raised">
        <p className="font-semibold mb-4">Customise your avatar</p>
        <AvatarBuilder
          value={avatar}
          fallbackSeed={profile.id}
          onChange={(next) => previewAvatar(next)}
        />
      </Card>

      <Card className="rise rise-2 mt-4 transition-shadow hover:shadow-raised">
        <p className="font-semibold mb-4">Or pick a character</p>
        <motion.div
          className="flex flex-wrap gap-3"
          initial={reduceMotion ? undefined : "hidden"}
          animate={reduceMotion ? undefined : "show"}
          variants={AVATAR_GRID}
        >
          <motion.button
            variants={AVATAR_ITEM}
            onClick={() => previewAvatar(null)}
            title="Initials"
            className={`relative rounded-full p-0.5 transition-[opacity] ${avatar === null ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
            whileHover={{ scale: 1.08, y: -3 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 400, damping: 22, mass: 0.6 }}
          >
            {avatar === null && (
              <motion.span layoutId="avatar-glow" className="absolute -inset-1.5 rounded-full bg-primary/25 blur-md"
                transition={{ type: "spring", stiffness: 300, damping: 26 }} />
            )}
            <span className={`relative block rounded-full ${avatar === null ? "ring-2 ring-primary" : ""}`}>
              <Avatar name={name || profile.display_name} seed={profile.id} role={profile.role} size={56} />
            </span>
          </motion.button>
          {AVATARS.map((a) => (
            <motion.button
              key={a.id}
              variants={AVATAR_ITEM}
              // Every click bumps the nonce, so picking a character plays its
              // greet once (then it stops), and re-picking replays it.
              onClick={() => { previewAvatar(a.id); setGreet((n) => n + 1); }}
              title={a.label}
              aria-pressed={avatar === a.id}
              className={`relative rounded-full p-0.5 transition-[opacity] ${
                avatar === a.id ? "opacity-100" : "opacity-80 hover:opacity-100"
              }`}
              whileHover={{ scale: 1.08, y: -3 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 400, damping: 22, mass: 0.6 }}
            >
              {avatar === a.id && (
                // Shared layoutId - the glow slides to whichever avatar is
                // selected instead of popping in fresh each time.
                <motion.span layoutId="avatar-glow" className="absolute -inset-1.5 rounded-full bg-primary/25 blur-md"
                  transition={{ type: "spring", stiffness: 300, damping: 26 }} />
              )}
              <span className={`relative block rounded-full ${avatar === a.id ? "ring-2 ring-primary shadow-raised" : ""}`}>
                <AvatarArt id={a.id} size={56} play={avatar === a.id ? greet : 0} />
              </span>
            </motion.button>
          ))}
        </motion.div>
        {dirty && (
          <div className="mt-4 flex justify-end">
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save avatar"}
            </Button>
          </div>
        )}
      </Card>

      {/* Board settings - pick your theme, pieces and board behaviour */}
      <Card className="rise rise-3 mt-4 transition-shadow hover:shadow-raised">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold flex items-center gap-2"><Settings2 size={18} /> Board settings</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              <span className="capitalize">{settings.boardTheme.replace(/-/g, " ")}</span> · {settings.pieceSet} pieces
            </p>
          </div>
          <Button variant="secondary" onClick={() => setShowBoard(true)}>Customize</Button>
        </div>
      </Card>

      {/* Coin shop - board themes. Earn coins from your coach, spend them here. */}
      {isStudent && (
        <Card className="rise rise-3 mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold">Coin shop: board themes</p>
            <span className="text-sm text-muted-foreground tabular-nums">{coins} coins</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PREMIUM_THEMES.map((id) => {
              const t = BOARD_THEMES.find((x) => x.id === id)!;
              const owned = ownsTheme(id);
              return (
                <div key={id} className={`rounded-btn border p-2 text-center transition-all ${owned ? "border-success/50" : "border-border"}`}>
                  <span className="inline-grid grid-cols-4 rounded overflow-hidden w-12 aspect-square border border-border/50 mb-1">
                    {Array.from({ length: 16 }, (_, i) => (
                      <span key={i} style={{ background: (Math.floor(i / 4) + i) % 2 ? t.dark : t.light, aspectRatio: "1" }} />
                    ))}
                  </span>
                  <p className="text-xs font-medium truncate">{t.label}</p>
                  {owned ? (
                    <p className="text-[11px] text-success mt-1">Owned</p>
                  ) : (
                    <Button variant="secondary" className="!py-0.5 !px-2 text-xs mt-1" onClick={() => void buy("board_themes", id, THEME_COST)}>
                      {THEME_COST} coins
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <BoardSettingsModal open={showBoard} onClose={() => setShowBoard(false)} settings={settings} onChange={update}
        lockedThemes={isStudent ? PREMIUM_THEMES.filter((id) => !ownsTheme(id)) : undefined} />
    </div>
  );
}
