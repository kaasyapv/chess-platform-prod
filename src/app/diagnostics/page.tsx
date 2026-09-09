import { DiagnosticsClient } from "./diagnostics-client";

/** Browser compatibility self-test (§2, §3).
 *
 *  Cross-browser QA on this project is a manual pass on real devices - this
 *  page is what makes that pass produce evidence instead of impressions. Open
 *  it in Safari, Firefox, Edge, on Windows, on a phone; it runs the same
 *  checks the live classroom depends on and prints a verdict you can screenshot
 *  or copy. No login, so it works on a device that has never signed in.
 */
export const metadata = { title: "Browser diagnostics: ChessAcademy" };

export default function DiagnosticsPage() {
  return <DiagnosticsClient />;
}
