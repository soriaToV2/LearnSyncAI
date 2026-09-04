/**
 * The label on content a student did not produce.
 *
 * ⚠️ EVERY PIECE OF EXAMPLE CONTENT MUST CARRY ONE. It is the difference between
 * a demonstration and a fabrication, and it is the reason the `DEMO_*` values in
 * `src/lib/onboarding.ts` are allowed to exist at all in a codebase that deleted
 * `mockStudents.ts` and a made-up staff email for showing invented data as real.
 *
 * Amber rather than the theme accent, deliberately: the accent means "this is
 * yours" everywhere else in the portal, which is the exact opposite of what this
 * says. It is also the only amber on the dashboard, so it cannot be mistaken for
 * a status the app uses elsewhere.
 */
export default function ExampleChip() {
  return (
    <span className="inline-flex items-center rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-sans text-[10px] font-bold uppercase tracking-widest text-amber-400">
      Example
    </span>
  );
}
