import { Poller, RefreshScheduler } from "@/lib/refresh";

/**
 * References the class holding the collision LOSER and the property arrow,
 * and the class expression. None of the fetches inside them may attribute
 * here through those holders.
 */
export function SchedulerPanel() {
  const run = () => new RefreshScheduler().Refresh();
  const tick = () => new Poller().tick();
  return <div onClick={run} onLoad={tick}>run</div>;
}
