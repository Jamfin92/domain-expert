const useFakeMutation = (opts: { mutationFn: () => Promise<unknown>; retries: number }) => opts;

/**
 * The regression guard for the sibling-bearing rule: the options object has
 * two named members, but the owner is the COMPONENT itself, so the call is
 * the component's own and the rule must not refuse it.
 */
export function MutatingPanel() {
  const submit = useFakeMutation({
    mutationFn: async () => {
      const res = await fetch("/api/mutate");
      return res.json();
    },
    retries: 2,
  });
  return <button onClick={() => void submit.mutationFn()}>go</button>;
}
