import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, GitBranch, Play, Table2 } from "lucide-react";
import { api, type EntityGraph, type Layout, type RepoSummary } from "@/lib/api";
import { EntityDiagram } from "@/components/EntityDiagram";
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
  onStartQuiz: (n: number, subject?: string) => void;
}

interface Bank {
  total: number;
  byKind: Record<string, number>;
  byGenerator: Record<string, number>;
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
  const [graph, setGraph] = useState<EntityGraph | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [selftestOk, setSelftestOk] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    setSelected(null);
    setError(null);
    void (async () => {
      try {
        const [l, g, q, st] = await Promise.all([
          api.layout(repo.id),
          api.graph(repo.id),
          api.questions(repo.id),
          api.selftest(repo.id),
        ]);
        if (cancelled) return;
        setLayout(l.layout);
        setGraph(g.graph);
        setBank(q);
        setSelftestOk(st.ok);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.id]);

  const entity = graph?.entities.find((e) => e.name === selected) ?? null;
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
            {selected ? (
              <Badge variant="secondary" className="font-mono text-[11px]">{selected}</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Click an entity to focus it</span>
            )}
          </div>
          <CardContent className="h-[32rem] p-0 xl:h-[40rem]">
            {layout ? (
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
            <div className="grid grid-cols-3 gap-2">
              {[5, 10, 20].map((n) => (
                <Button key={n} variant="secondary" size="sm" onClick={() => onStartQuiz(n)}>
                  {n}
                </Button>
              ))}
            </div>
            <Button className="w-full" onClick={() => onStartQuiz(10, selected ?? undefined)}>
              <Play className="size-3.5" />
              Start 10 questions
            </Button>
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
      </aside>
    </div>
  );
}
