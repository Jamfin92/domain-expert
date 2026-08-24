import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, Database, GitBranch, Play, Route as RouteIcon, Table2,
} from "lucide-react";
import {
  api,
  type EntityGraph,
  type Layout,
  type Layout3D,
  type RepoSummary,
  type Route,
  type Section,
  type Shape,
} from "@/lib/api";
import { EntityDiagram } from "@/components/EntityDiagram";
import { EntityCity } from "@/components/EntityCity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * Bento dashboard: an asymmetric grid where the diagram earns the largest
 * tile because it is the thing you actually came to look at. The stat tiles
 * are small and quiet; nothing competes with the graph.
 */

interface Props {
  repo: RepoSummary;
  onStartQuiz: (n: number, sections?: Section[]) => void;
}

interface Bank {
  total: number;
  byKind: Record<string, number>;
  byGenerator: Record<string, number>;
  bySection: Record<string, number>;
}

/** What each section is, in the words the reader would use. */
const SECTION_LABEL: Record<string, string> = {
  entity: "Entities",
  ds: "Data structures",
  client: "Clients",
};

/**
 * A shape beside the table it mirrors, with the gaps marked.
 *
 * Shown side by side because that is the comparison — a list of "missing
 * fields" makes the reader hold the other side in their head, which is the
 * work psq exists to remove.
 */
function DriftView({ shape }: { shape: Shape }): React.ReactElement | null {
  if (!shape.drift) return null;
  const { entityOnly, shapeOnly, shared } = shape.drift;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="font-mono font-semibold">{shape.mirrors}</span>
        <ArrowLeftRight className="size-3 text-muted-foreground" />
        <span className="font-mono font-semibold">{shape.name}</span>
        <Badge variant="outline" className="ml-auto text-[10px]">{shape.kind}</Badge>
      </div>
      <ul className="space-y-0.5 text-xs">
        {entityOnly.map((f) => (
          <li key={`e-${f}`} className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[var(--warning)]">{f}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">table only</span>
          </li>
        ))}
        {shapeOnly.map((f) => (
          <li key={`s-${f}`} className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[var(--warning)]">{f}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">shape only</span>
          </li>
        ))}
        {entityOnly.length === 0 && shapeOnly.length === 0 ? (
          <li className="text-muted-foreground">
            All {shared.length} fields line up by name.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function RouteList({ routes }: { routes: Route[] }): React.ReactElement {
  return (
    <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1 text-xs">
      {routes.map((r) => (
        <li key={`${r.method} ${r.path}`} className="flex items-baseline gap-2">
          <span className="w-11 shrink-0 font-mono text-[10px] text-muted-foreground">{r.method}</span>
          <span className="truncate font-mono">{r.path}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Database;
  label: string;
  value: string | number;
  hint?: string;
}): React.ReactElement {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function Dashboard({ repo, onStartQuiz }: Props): React.ReactElement {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [layout3d, setLayout3d] = useState<Layout3D | null>(null);
  const [dim, setDim] = useState<"2d" | "3d">("2d");
  const [graph, setGraph] = useState<EntityGraph | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [selftestOk, setSelftestOk] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    setLayout3d(null);
    setDim("2d");
    setSelected(null);
    setSections([]);
    setError(null);
    void (async () => {
      try {
        const [l, g, q, st, sh, l3] = await Promise.all([
          api.layout(repo.id),
          api.graph(repo.id),
          api.questions(repo.id),
          api.selftest(repo.id),
          api.shapes(repo.id),
          // The loader is all-or-nothing, but the city is an extra: a 3D-only
          // failure must not blank the whole dashboard, so this leg never
          // rejects — it just leaves the 3D button disabled.
          api.layout3d(repo.id).catch((err: unknown) => {
            // Diagnosable, but still resolves null: a 3D failure must never
            // reject or it would blank the whole dashboard.
            console.warn("3D layout unavailable:", err);
            return null;
          }),
        ]);
        if (cancelled) return;
        setLayout(l.layout);
        setLayout3d(l3 ? l3.layout3d : null);
        setGraph(g.graph);
        setBank(q);
        setSelftestOk(st.ok);
        setShapes(sh.shapes);
        setRoutes(sh.routes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.id]);

  const entity = graph?.entities.find((e) => e.name === selected) ?? null;
  const paired = shapes.filter((s) => s.drift !== null);
  // When an entity is selected the panel narrows to it; otherwise it shows
  // every pair, which is the view that makes a whole repo's drift visible.
  const shownDrift = selected ? paired.filter((s) => s.mirrors === selected) : paired;
  const available = Object.keys(bank?.bySection ?? {}) as Section[];
  const entityRelations =
    graph?.relations.filter((r) => r.principal === selected || r.dependent === selected) ?? [];

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Could not load this repo</CardTitle>
        </CardHeader>
        <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }

  return (
    /* Bento: one big tile for the thing you came to look at, a narrow rail of
       small ones beside it. Laid out with flex rather than a grid row-span,
       because a row-span stretches its siblings to match and the quiz card
       ends up mostly empty space. */
    <div className="flex flex-col gap-4 lg:flex-row">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="size-4" />
              Entity graph
            </span>
            <span className="flex items-center gap-3">
              {/* Selection is a 2D affair — the city has no picking — so the
                  badge/hint would be stale or meaningless next to the city. */}
              {dim === "2d" ? (
                selected ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">{selected}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Click an entity to focus it</span>
                )
              ) : null}
              <span
                data-psq="dim-toggle"
                role="group"
                aria-label="Diagram dimension"
                className="flex gap-1"
              >
                <Button
                  variant={dim === "2d" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-psq="dim-2d"
                  aria-pressed={dim === "2d"}
                  onClick={() => setDim("2d")}
                >
                  2D
                </Button>
                {/* The title lives on a wrapper: the shadcn base class sets
                    `disabled:pointer-events-none`, so a title on the disabled
                    button itself could never show. */}
                <span title={layout3d === null ? "The 3D layout is not available for this repo" : undefined}>
                  <Button
                    variant={dim === "3d" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    data-psq="dim-3d"
                    aria-pressed={dim === "3d"}
                    disabled={layout3d === null}
                    onClick={() => setDim("3d")}
                  >
                    3D
                  </Button>
                </span>
              </span>
            </span>
          </div>
          <CardContent className="h-[32rem] p-0 xl:h-[40rem]">
            {dim === "3d" && layout3d ? (
              <EntityCity
                layout={layout3d}
                fallback={
                  <p className="py-24 text-center text-sm text-muted-foreground">
                    3D needs WebGL, which this browser is not providing. The 2D diagram still works.
                  </p>
                }
              />
            ) : layout ? (
              <EntityDiagram layout={layout} selected={selected} onSelect={setSelected} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Laying out the graph…
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat icon={Table2} label="Entities" value={repo.entities} />
          <Stat
            icon={Database}
            label="Seeded rows"
            value={repo.seededRows.toLocaleString()}
            hint="deterministic, for SQL questions"
          />
          <Stat
            icon={CheckCircle2}
            label="Questions"
            value={bank?.total ?? repo.questions}
            hint={
              bank
                ? Object.entries(bank.byKind).map(([k, n]) => `${n} ${k}`).join(" · ")
                : undefined
            }
          />
        </div>
      </section>

      <aside className="flex w-full flex-col gap-4 lg:w-[19rem] lg:shrink-0">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Take a quiz</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-4">
            {available.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {available.map((name) => {
                  const on = sections.includes(name);
                  return (
                    <Button
                      key={name}
                      variant={on ? "secondary" : "ghost"}
                      size="sm"
                      className={cn("h-7 px-2 text-xs", on && "ring-1 ring-ring")}
                      aria-pressed={on}
                      onClick={() =>
                        setSections((cur) =>
                          cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name],
                        )
                      }
                    >
                      {SECTION_LABEL[name] ?? name}
                      <span className="ml-1 tabular-nums text-muted-foreground">
                        {bank?.bySection[name]}
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              {[5, 10, 20].map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  size="sm"
                  onClick={() => onStartQuiz(n, sections.length > 0 ? sections : undefined)}
                >
                  {n}
                </Button>
              ))}
            </div>
            <Button
              className="w-full"
              onClick={() => onStartQuiz(10, sections.length > 0 ? sections : undefined)}
            >
              <Play className="size-3.5" />
              Start 10 questions
            </Button>
            {sections.length === 0 && available.length > 1 ? (
              <p className="text-xs text-muted-foreground">Every section. Pick one to narrow it.</p>
            ) : null}
            {selftestOk === false ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Selftest failed. These questions are not trustworthy.
              </p>
            ) : selftestOk === true ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
                Every question is answerable and failable.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{entity ? entity.name : "Extraction"}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            {entity ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="font-mono text-[10px]">{entity.tableName}</Badge>
                  {entity.keys.map((k) => (
                    <Badge key={k} variant="secondary" className="font-mono text-[10px]">PK {k}</Badge>
                  ))}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={entity.file}>
                  {entity.file}
                </p>
                <Separator />
                <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-1 text-xs">
                  {entity.properties
                    .filter((p) => !p.isNavigation)
                    .map((p) => (
                      <li key={p.name} className="flex items-baseline justify-between gap-2">
                        <span className={cn("font-mono", p.isPrimaryKey && "font-semibold")}>
                          {p.name}
                          {p.nullable ? "?" : ""}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{p.type}</span>
                      </li>
                    ))}
                </ul>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  {entityRelations.length} relation{entityRelations.length === 1 ? "" : "s"} ·{" "}
                  {repo.relations} in the graph
                </p>
              </div>
            ) : repo.warnings.length > 0 ? (
              <ul className="space-y-1 text-xs text-[var(--warning)]">
                {repo.warnings.slice(0, 6).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  {repo.contextName} · {repo.entities} entities · {repo.relations} relations
                </p>
                <p>Parsed with no warnings. Select an entity to inspect it.</p>
              </div>
            )}
          </CardContent>
        </Card>
        {shapes.length > 0 ? (
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <ArrowLeftRight className="size-4" />
                {selected ? `${selected} vs its shapes` : "Drift"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {shownDrift.length > 0 ? (
                <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {shownDrift.map((shape) => (
                    <DriftView key={`${shape.file}:${shape.name}`} shape={shape} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {selected
                    ? `Nothing in this repo declares a shape that mirrors ${selected}.`
                    : "No shape here pairs with a table by name and field overlap."}
                </p>
              )}
              <Separator />
              <p className="text-xs text-muted-foreground">
                {shapes.length} shape{shapes.length === 1 ? "" : "s"} read ·{" "}
                {paired.length} paired with a table
              </p>
            </CardContent>
          </Card>
        ) : null}

        {routes.length > 0 ? (
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <RouteIcon className="size-4" />
                HTTP surface
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <RouteList routes={routes} />
            </CardContent>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
