import { Button } from "@/components/ui/Button";

/** `export default function Named()`, with a direct call in the component. */
export default function HomePage() {
  const boot = async () => {
    await fetch("/api/home");
  };
  return (
    <main onLoad={boot}>
      <Button label="go" />
    </main>
  );
}
