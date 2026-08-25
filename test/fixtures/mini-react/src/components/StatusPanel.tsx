import { useStatus } from "@/hooks/use-status";

/** Top of the 3-hop chain: StatusPanel -> useStatus -> statusService.load. */
export function StatusPanel() {
  const status = useStatus();
  return <button onClick={status.refresh}>refresh</button>;
}
