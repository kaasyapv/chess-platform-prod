/** Which side of a mesh pair sends the SDP offer.
 *
 *  Both peers run this against the same two ids and must reach opposite
 *  answers, because a WebRTC pair can only survive one offer.
 *
 *  The rule this replaced - "whoever was already in the room calls the
 *  newcomer" - assumed Realtime presence fires `join` on one side only. It
 *  fires on both: the peer that just subscribed gets the entire existing
 *  roster replayed as join events. So the newcomer offered to everyone
 *  already there in the same instant they were each offering to the newcomer.
 *
 *  That collision does not fail loudly. Chrome rolls the local offer back
 *  implicitly and answers the incoming one instead, so nothing throws and
 *  nothing logs. When the incoming offer came from a spectator it is worse
 *  than that: a peer that never calls addTrack produces an offer with zero
 *  m-lines, so the publisher rolls back its own video offer, answers with
 *  zero m-lines, and ends up connected with a live camera, a sender still
 *  holding the track, and not one transceiver actually sending
 *  (currentDirection null). A completed handshake carrying no media at all -
 *  which on the Live Ops wall is a black tile and no error anywhere.
 *
 *  Hence: spectators only ever answer, the publisher is the one that calls
 *  them, and between two publishers the id comparison decides.
 */
export function shouldOffer(
  meId: string,
  peerId: string,
  { meViewOnly = false, peerViewOnly = false } = {},
): boolean {
  if (meId === peerId) return false;
  if (meViewOnly) return false;        // spectators answer, never call
  if (peerViewOnly) return true;       // nobody else will call them
  return meId > peerId;                // same verdict on both machines
}
