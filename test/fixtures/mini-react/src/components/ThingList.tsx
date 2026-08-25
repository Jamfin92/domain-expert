import { thingsService } from "@/services/things.service";

/** 2-hop: component -> service method -> fetch, importing via `@/`. */
export function ThingList() {
  const load = () => thingsService.getThings();
  return <ul onClick={load}>things</ul>;
}
