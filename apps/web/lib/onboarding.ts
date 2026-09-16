/**
 * Whether the Overview should show setup instructions instead of the dashboard.
 *
 * Host metrics are deliberately ignored: the bundled collector reports this
 * machine within seconds of the first start, so counting hosts would hide the
 * instructions before anyone could read them. What matters is whether the user
 * has connected anything of their own — an app sending traces, or a URL check.
 *
 * Both counts must have loaded; the screens load independently, and deciding
 * from a half-loaded page makes the instructions flash on every visit.
 */
export function needsSetup(services: number | undefined, checks: number | undefined): boolean {
  if (services === undefined || checks === undefined) return false;
  return services === 0 && checks === 0;
}
