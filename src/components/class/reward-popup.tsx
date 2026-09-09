"use client";

/* Gamification rewards - the "KitKat / Trophy over the board" moment from the
 * market research (Chesslang drops a chocolate + confetti on a correct answer).
 *
 * The coach fires one from the panel, or the quiz scorer fires one on a right
 * answer; it travels as a `reward` broadcast on the classroom channel and every
 * client pops it over the board here. `toUserId` set = that one student gets
 * the big centre-screen version, everyone else gets the small corner nod.
 *
 * Pure presentation + Framer Motion. The parent owns the queue (push on
 * `onReward`, drop after the animation) exactly like the existing capture
 * burst, so there's one expiry model in the classroom, not two.
 */

import { AnimatePresence, motion } from "framer-motion";
import { GamifiedIcon } from "@/lib/gamified-icons";
import type { RewardEvent } from "@/hooks/use-classroom-channel";

/** How long a reward stays on screen. The parent should drop it from the queue
 *  at roughly this mark. */
export const REWARD_TTL_MS = 2600;

export const REWARD_KINDS: { icon: string; label: string }[] = [
  { icon: "trophy", label: "Trophy" },
  { icon: "star", label: "Gold star" },
  { icon: "medal", label: "Medal" },
  { icon: "donut", label: "Treat" },
  { icon: "thumbsup", label: "Nice!" },
  { icon: "heart", label: "Love it" },
];

function ConfettiBits() {
  const bits = Array.from({ length: 14 }, (_, i) => i);
  const colors = ["#372fc3", "#26c2a3", "#e6912c", "#5b8def", "#ca3431", "#f2c14e"];
  return (
    <>
      {bits.map((i) => {
        const angle = (i / bits.length) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-2 w-2 rounded-[2px]"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * (90 + Math.random() * 70),
              y: Math.sin(angle) * (90 + Math.random() * 70) + 40,
              opacity: 0,
              rotate: Math.random() * 360,
              scale: 0.4,
            }}
            transition={{ duration: 1.4, ease: "easeOut" }}
          />
        );
      })}
    </>
  );
}

export function RewardOverlay({
  rewards, meId,
}: {
  rewards: RewardEvent[];
  meId: string;
}) {
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence>
        {rewards.map((r) => {
          const forMe = !r.toUserId || r.toUserId === meId;
          return (
            <motion.div
              key={r.id}
              className={`absolute left-1/2 flex flex-col items-center ${forMe ? "top-1/2" : "top-4"}`}
              initial={{ x: "-50%", y: forMe ? "-50%" : 0, scale: 0.3, opacity: 0 }}
              animate={{
                scale: forMe ? [0.3, 1.15, 1] : [0.3, 1],
                opacity: 1,
                y: forMe ? ["-50%", "-58%"] : 0,
              }}
              exit={{ scale: 0.6, opacity: 0, y: forMe ? "-70%" : -12 }}
              transition={{ type: "spring", stiffness: 240, damping: 16 }}
            >
              <div className="relative">
                {forMe && <ConfettiBits />}
                <div
                  className={`relative grid place-items-center rounded-card border border-border bg-surface-1/95 shadow-pop backdrop-blur-sm ${
                    forMe ? "h-28 w-28 p-4" : "h-14 w-14 p-2"
                  }`}
                >
                  <GamifiedIcon id={r.icon} />
                </div>
              </div>
              <motion.span
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={`mt-2 rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground shadow-sm ${
                  forMe ? "text-sm" : "text-[11px]"
                }`}
              >
                {r.label}
              </motion.span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
