import { describe, expect, it } from "vitest";
import { componentLabel, groupCallsByComponent } from "../src/lib/client-calls.js";
import type { ClientCall, UiComponent } from "../src/lib/api.js";

function comp(key: string, name: string, file: string, line = 1): UiComponent {
  return { key, name, file, line };
}

function call(over: Partial<ClientCall> & { file: string; line: number }): ClientCall {
  return {
    method: "GET",
    path: "/api/x",
    enclosing: null,
    matches: null,
    components: [],
    ...over,
  };
}

const admin = comp("src/components/admin/Card.tsx#Card", "Card", "src/components/admin/Card.tsx");
const shop = comp("src/components/shop/Card.tsx#Card", "Card", "src/components/shop/Card.tsx");
const list = comp("src/components/List.tsx#List", "List", "src/components/List.tsx");

describe("groupCallsByComponent", () => {
  it("orders groups by component key, ascending", () => {
    const calls = [
      call({ file: "b.ts", line: 1, components: [shop.key] }),
      call({ file: "a.ts", line: 1, components: [list.key] }),
      call({ file: "c.ts", line: 1, components: [admin.key] }),
    ];
    const groups = groupCallsByComponent([shop, list, admin], calls);
    expect(groups.map((g) => g.component?.key)).toEqual([
      "src/components/List.tsx#List",
      "src/components/admin/Card.tsx#Card",
      "src/components/shop/Card.tsx#Card",
    ]);
  });

  it("compares keys with < and >, not localeCompare", () => {
    // "List.tsx#List" sorts before "admin/..." on code points because uppercase
    // L is 0x4C and lowercase a is 0x61. localeCompare would put "admin" first
    // in most locales, so this ordering is the whole assertion.
    const groups = groupCallsByComponent(
      [admin, list],
      [
        call({ file: "a.ts", line: 1, components: [admin.key] }),
        call({ file: "b.ts", line: 1, components: [list.key] }),
      ],
    );
    expect(groups[0]?.component?.key).toBe(list.key);
  });

  it("puts the unattributed bucket last", () => {
    const groups = groupCallsByComponent(
      [admin],
      [
        call({ file: "z.ts", line: 1, components: [] }),
        call({ file: "a.ts", line: 1, components: [admin.key] }),
      ],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]?.component).toBe(admin);
    expect(groups[1]?.component).toBeNull();
  });

  it("omits the unattributed bucket entirely when every call is attributed", () => {
    const groups = groupCallsByComponent(
      [admin],
      [call({ file: "a.ts", line: 1, components: [admin.key] })],
    );
    expect(groups).toHaveLength(1);
    expect(groups.every((g) => g.component !== null)).toBe(true);
  });

  it("omits components that own no calls", () => {
    const groups = groupCallsByComponent(
      [admin, shop, list],
      [call({ file: "a.ts", line: 1, components: [admin.key] })],
    );
    expect(groups.map((g) => g.component?.key)).toEqual([admin.key]);
  });

  it("sorts calls within a group by file, then line", () => {
    const calls = [
      call({ file: "b.ts", line: 2, components: [admin.key] }),
      call({ file: "b.ts", line: 1, components: [admin.key] }),
      call({ file: "a.ts", line: 9, components: [admin.key] }),
    ];
    const groups = groupCallsByComponent([admin], calls);
    expect(groups[0]?.calls.map((c) => `${c.file}:${c.line}`)).toEqual([
      "a.ts:9",
      "b.ts:1",
      "b.ts:2",
    ]);
  });

  it("keeps input order for calls with the same file and line", () => {
    const first = call({ file: "a.ts", line: 1, path: "/first", components: [admin.key] });
    const second = call({ file: "a.ts", line: 1, path: "/second", components: [admin.key] });
    const groups = groupCallsByComponent([admin], [first, second]);
    expect(groups[0]?.calls.map((c) => c.path)).toEqual(["/first", "/second"]);
  });

  it("shows a call with two component keys in BOTH groups", () => {
    const shared = call({
      file: "src/lib/save-card.ts",
      line: 7,
      matches: "GET /api/cards",
      components: [admin.key, shop.key],
    });
    const groups = groupCallsByComponent([admin, shop], [shared]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.calls).toEqual([shared]);
    expect(groups[1]?.calls).toEqual([shared]);
  });

  it("drops a component key that resolves against nothing", () => {
    // A group with no header cannot be rendered, and inventing one would be a
    // fabricated fact. The call is dropped from the grouping, not relabelled.
    const groups = groupCallsByComponent([admin], [call({ file: "a.ts", line: 1, components: ["ghost#Ghost"] })]);
    expect(groups).toEqual([]);
  });

  it("returns nothing at all for no calls", () => {
    expect(groupCallsByComponent([admin, shop], [])).toEqual([]);
  });
});

describe("componentLabel", () => {
  it("uses the bare name when it is unique across the whole graph", () => {
    expect(componentLabel(list, [admin, shop, list])).toBe("List");
  });

  it("disambiguates with the file when the name recurs", () => {
    expect(componentLabel(admin, [admin, shop, list])).toBe(
      "Card (src/components/admin/Card.tsx)",
    );
    expect(componentLabel(shop, [admin, shop, list])).toBe(
      "Card (src/components/shop/Card.tsx)",
    );
  });
});
