import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { ClientCall, EntityGraph, Route, UiComponent } from "@/lib/api";
import {
  buildReverseIndex,
  callsOfComponent,
  componentAreas,
  entitiesOfHandlers,
  handlersOfRoutes,
  reachOfRoute,
  routeAreas,
  routeKey,
  routesForKey,
} from "@/lib/flow";
import { componentLabel } from "@/lib/client-calls";
import { desktop, isDesktop } from "@/lib/desktop";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Flow: area -> client call -> route -> handler -> entities.
 *
 * Every hop is a join the extractor or `lib/flow.ts` makes on exact strings;
 * this file only renders them. A hop psq cannot make is said out loud.
 */

type Selection =
  | { kind: "component"; key: string }
  | { kind: "route"; key: string };

interface Props {
  graph: EntityGraph;
  repoPath: string;
  selectedEntity: string | null;
  onSelectEntity: (name: string) => void;
}

function Loc({ file, line, repoPath }: { file: string; line: number; repoPath: string }): React.ReactElement {
  const text = `${file}:${line}`;
  if (isDesktop()) {
    return (
      <button
        type="button"
        data-psq="open-in-editor"
        className="truncate font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => {
          void desktop()?.openInEditor(`${repoPath}/${file}`, line);
        }}
      >
        {text}
      </button>
    );
  }
  return <span className="truncate font-mono text-[10px] text-muted-foreground">{text}</span>;
}

function ListButton({
  active,
  onClick,
  children,
  psq,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  psq: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-psq={psq}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-baseline gap-1.5 rounded px-1.5 py-0.5 text-left text-xs",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}

export function Flow({ graph, repoPath, selectedEntity, onSelectEntity }: Props): React.ReactElement {
  const routes = graph.routes ?? [];
  const calls = graph.clientCalls ?? [];
  const components = graph.components ?? [];
  const refs = graph.entityRefs ?? [];
  const [sel, setSel] = useState<Selection | null>(null);

  const cAreas = useMemo(() => componentAreas(components), [components]);
  const rAreas = useMemo(() => routeAreas(routes), [routes]);
  const index = useMemo(() => buildReverseIndex(calls, components), [calls, components]);

  const selComponent = sel?.kind === "component" ? components.find((c) => c.key === sel.key) : undefined;
  const selRoutes = sel?.kind === "route" ? routesForKey(routes, sel.key) : [];
  const selRoute = selRoutes[0];

  const goRoute = (r: Route): void => setSel({ kind: "route", key: routeKey(r) });
  const goComponent = (c: UiComponent): void => setSel({ kind: "component", key: c.key });

  if (routes.length === 0 && components.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          psq found no UI components and no HTTP routes in this repo, so there is no flow to walk.
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-psq="flow" className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <Card className="gap-2 py-3">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Areas</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[36rem] space-y-3 overflow-y-auto px-3">
          {cAreas.length > 0 ? (
            <div className="space-y-2">
              <div className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Components
              </div>
              {cAreas.map((area) => (
                <div key={area.dir} data-psq="component-area">
                  <div className="truncate px-1.5 font-mono text-[10px] text-muted-foreground" title={area.dir}>
                    {area.dir}
                  </div>
                  {area.components.map((c) => (
                    <ListButton
                      key={c.key}
                      psq="flow-component"
                      active={sel?.kind === "component" && sel.key === c.key}
                      onClick={() => goComponent(c)}
                    >
                      <span className="truncate">{componentLabel(c, components)}</span>
                    </ListButton>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {rAreas.length > 0 ? (
            <div className="space-y-2">
              <div className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Routes
              </div>
              {rAreas.map((area) => (
                <div key={area.segment} data-psq="route-area">
                  <div className="px-1.5 font-mono text-[10px] text-muted-foreground">{area.segment}</div>
                  {area.routes.map((r) => (
                    <ListButton
                      key={`${routeKey(r)}@${r.file}:${r.line}`}
                      psq="flow-route"
                      active={sel?.kind === "route" && sel.key === routeKey(r)}
                      onClick={() => goRoute(r)}
                    >
                      <span className="w-10 shrink-0 font-mono text-[10px] text-muted-foreground">{r.method}</span>
                      <span className="truncate font-mono">{r.path}</span>
                    </ListButton>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="gap-3 py-4">
        <CardContent className="space-y-4 px-4 text-sm">
          {selComponent ? (
            <ComponentFlow
              component={selComponent}
              graph={graph}
              repoPath={repoPath}
              onRoute={goRoute}
            />
          ) : selRoute ? (
            <RouteFlow
              routes={selRoutes}
              graph={graph}
              reach={reachOfRoute(selRoute, index)}
              refs={refs}
              repoPath={repoPath}
              selectedEntity={selectedEntity}
              onComponent={goComponent}
              onEntity={onSelectEntity}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Pick a component to see the calls it makes and the routes they reach, or a route to
              see who calls it, which method serves it, and which entities that method mentions.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ComponentFlow({
  component,
  graph,
  repoPath,
  onRoute,
}: {
  component: UiComponent;
  graph: EntityGraph;
  repoPath: string;
  onRoute: (r: Route) => void;
}): React.ReactElement {
  const hops = callsOfComponent(component, graph.clientCalls ?? [], graph.routes ?? []);
  return (
    <div className="space-y-3">
      <div>
        <div className="font-semibold">{component.name}</div>
        <Loc file={component.file} line={component.line} repoPath={repoPath} />
      </div>
      {hops.length === 0 ? (
        <p className="text-xs text-muted-foreground">No client call is attributed to this component.</p>
      ) : (
        <ul className="space-y-2">
          {hops.map(({ call, routes }) => (
            <li key={`${call.file}:${call.line}:${call.method} ${call.path}`} data-psq="flow-call" className="space-y-1">
              <CallLine call={call} repoPath={repoPath} />
              <div className="flex flex-wrap items-baseline gap-1.5 pl-4 text-xs">
                <ArrowRight className="size-3 shrink-0 self-center text-muted-foreground" />
                {routes.length > 0 ? (
                  routes.map((r) => (
                    <button
                      key={`${r.file}:${r.line}`}
                      type="button"
                      data-psq="flow-to-route"
                      className="font-mono underline-offset-2 hover:underline"
                      onClick={() => onRoute(r)}
                    >
                      {routeKey(r)}
                    </button>
                  ))
                ) : call.matches !== null ? (
                  <span className="font-mono text-muted-foreground">
                    {call.matches} (no route in the graph carries this key)
                  </span>
                ) : (
                  <span className="text-muted-foreground">no matching route</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CallLine({ call, repoPath }: { call: ClientCall; repoPath: string }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <Badge variant="outline" className="shrink-0 text-[10px]">{call.method}</Badge>
        <span className="truncate font-mono">{call.path}</span>
      </span>
      <Loc file={call.file} line={call.line} repoPath={repoPath} />
    </div>
  );
}

function RouteFlow({
  routes,
  graph,
  reach,
  refs,
  repoPath,
  selectedEntity,
  onComponent,
  onEntity,
}: {
  routes: Route[];
  graph: EntityGraph;
  reach: { calls: ClientCall[]; components: UiComponent[] };
  refs: NonNullable<EntityGraph["entityRefs"]>;
  repoPath: string;
  selectedEntity: string | null;
  onComponent: (c: UiComponent) => void;
  onEntity: (name: string) => void;
}): React.ReactElement {
  const route = routes[0] as Route;
  const handlers = handlersOfRoutes(routes);
  const handlerless = routes.filter((r) => !r.handler).length;
  const touched = entitiesOfHandlers(handlers, refs);
  const allComponents = graph.components ?? [];
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-1.5">
          <Badge variant="outline" className="text-[10px]">{route.method}</Badge>
          <span className="font-mono font-semibold">{route.path}</span>
        </div>
        {routes.map((r) => (
          <div key={`${r.file}:${r.line}`}>
            <Loc file={r.file} line={r.line} repoPath={repoPath} />
          </div>
        ))}
      </div>

      <section data-psq="flow-callers" className="space-y-1">
        <h3 className="text-xs font-semibold">Reached from</h3>
        {reach.calls.length === 0 ? (
          <p className="text-xs text-muted-foreground">No client call in this repo matches this route.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {reach.components.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-psq="flow-to-component"
                  className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent/50"
                  onClick={() => onComponent(c)}
                >
                  {componentLabel(c, allComponents)}
                </button>
              ))}
            </div>
            <ul className="space-y-1">
              {reach.calls.map((call) => (
                <li key={`${call.file}:${call.line}:${call.method} ${call.path}`}>
                  <CallLine call={call} repoPath={repoPath} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section data-psq="flow-handler" className="space-y-1">
        <h3 className="text-xs font-semibold">Handler</h3>
        {handlers.length > 0 ? (
          <div className="space-y-1 text-xs">
            {handlers.map((h) => (
              <div key={`${h.file}:${h.line}`} className="space-y-0.5">
                <div className="font-mono">{h.type}.{h.method}</div>
                <Loc file={h.file} line={h.line} repoPath={repoPath} />
              </div>
            ))}
            {handlerless > 0 ? (
              <p className="text-muted-foreground">
                {handlerless} more route{handlerless === 1 ? "" : "s"} with this key
                {handlerless === 1 ? " has" : " have"} no handler psq can see.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            handler unknown (psq cannot see this route&apos;s handler)
          </p>
        )}
      </section>

      {touched !== null ? (
        <section data-psq="flow-entities" className="space-y-1">
          <h3 className="text-xs font-semibold">Entities this method mentions</h3>
          {touched.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The handler is known, and no entity is mentioned in its body.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {touched.map((t) => (
                <li key={t.entity} className="space-y-0.5">
                  <button
                    type="button"
                    data-psq="flow-entity"
                    aria-pressed={selectedEntity === t.entity}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent/50",
                      selectedEntity === t.entity && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => onEntity(t.entity)}
                  >
                    {t.entity}
                  </button>
                  <div className="flex flex-wrap gap-x-3 pl-1">
                    {t.refs.map((r) => (
                      <Loc key={`${r.file}:${r.line}`} file={r.file} line={r.line} repoPath={repoPath} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
