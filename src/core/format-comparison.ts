import type { ComparisonGroup, PracticalResult } from "./practical-types";
import { distribution } from "./measurements";
export function formatComparison(
  a: PracticalResult,
  aId: string,
  b: PracticalResult,
  bId: string,
  group: ComparisonGroup | undefined = a.comparisonGroup,
) {
  const issues: string[] = [];
  const av = a.variants.find((v) => v.id === aId),
    bv = b.variants.find((v) => v.id === bId);
  if (!av || !bv)
    return {
      issues: ["Missing comparison variant"],
      deltaPercent: null,
      evidence: "unavailable",
    };
  if (a.id === b.id && aId === bId) issues.push("Same result and variant");
  if (
    !group ||
    group.equivalent !== "user-declared" ||
    !group.alignmentConfirmed
  )
    issues.push(
      "Declare source-scene equivalence and coordinate alignment locally",
    );
  if (
    a.id !== b.id &&
    (!b.comparisonGroup || b.comparisonGroup.id !== group?.id)
  )
    issues.push("Different comparison groups");
  if (a.schema !== b.schema) issues.push("Different measurement methods");
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings))
    issues.push(
      "Different workload, cameras, transforms, resolution, delivery or instrumentation settings",
    );
  if (JSON.stringify(a.device) !== JSON.stringify(b.device))
    issues.push("Different browser/GPU/device environment");
  for (const key of ["renderer", "api", "format"] as const) {
    const different =
      key === "format" ? av.format !== bv.format : a[key] !== b[key];
    if (different && !group?.intendedVariables.includes(key))
      issues.push(`Undeclared comparison variable: ${key}`);
  }
  if (a.renderer === b.renderer && a.rendererVersion !== b.rendererVersion)
    issues.push("Different renderer versions");
  const ar = a.repeats.filter((r) => r.variant === aId),
    br = b.repeats.filter((r) => r.variant === bId);
  if (
    !ar.length ||
    !br.length ||
    [...ar, ...br].some((r) => r.status !== "complete")
  )
    issues.push(
      "Incomplete, failed, cancelled or unsupported attempts; scores suppressed",
    );
  const am = ar[0]?.metadata,
    bm = br[0]?.metadata;
  if (!am || !bm || am.verifiedBy !== "decoder" || bm.verifiedBy !== "decoder")
    issues.push("Verified decoded metadata unavailable");
  else {
    if (am.splats !== bm.splats || am.shDegree !== bm.shDegree)
      issues.push("Different decoded splat counts or SH degrees");
    if (
      am.bounds.some(
        (v, i) => Math.abs(v - bm.bounds[i]) > 1e-5 * Math.max(1, Math.abs(v)),
      )
    )
      issues.push("Decoded bounds are not aligned");
    if (
      [...ar].some((r) => JSON.stringify(r.metadata) !== JSON.stringify(am)) ||
      [...br].some((r) => JSON.stringify(r.metadata) !== JSON.stringify(bm))
    )
      issues.push("Decoded metadata changed across repetitions");
  }
  if (
    av.identity !== bv.identity &&
    av.format === bv.format &&
    !group?.intendedVariables.includes("format")
  )
    issues.push("Different file identities");
  const timings = (rs: typeof ar) =>
    rs.flatMap((r) => {
      const start = r.milestones["load-requested"]?.ms,
        end = r.milestones["first-submitted-frame"]?.ms;
      return start != null && end != null && end > start ? [end - start] : [];
    });
  const at = timings(ar),
    bt = timings(br);
  if (at.length < 2 || bt.length < 2)
    issues.push("At least two complete load samples per variant required");
  const ad = distribution(at),
    bd = distribution(bt);
  return {
    issues,
    deltaPercent:
      !issues.length && ad && bd ? (bd.median / ad.median - 1) * 100 : null,
    evidence:
      "User-declared equivalent; decoded metadata checks do not verify visual or perceptual equivalence",
  };
}
