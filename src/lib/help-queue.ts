/** Pure sort for the Live Ops "Call Manager" priority queue: coach requests
 *  outrank student requests; ties break oldest-first. Kept out of the client
 *  component so it's testable without a browser or a live Supabase channel. */

export type HelpQueueItem = { id: string; requestedRole: string; createdAt: string };

export function sortHelpQueue<T extends HelpQueueItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.requestedRole !== b.requestedRole) return a.requestedRole === "coach" ? -1 : 1;
    return +new Date(a.createdAt) - +new Date(b.createdAt);
  });
}
