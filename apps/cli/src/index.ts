#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extract } from "@psq/extract";
import { invariants, mermaid, degrees, orphans } from "@psq/graph";
import {
  buildBank as composeBank,
  grade, referenceAnswer, selectQuiz, selftest, materialize,
  type SeededDb,
} from "@psq/quiz";
import { hashSeed } from "@psq/quiz";
import { Section } from "@psq/schema";
import type { EntityGraph, Question } from "@psq/schema";

/** argv parsing, hand-rolled — the same shape as an earlier internal CLI's runner. */
const argv = process.argv.slice(2);
const cmd = argv[0] ?? "help";

function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) return argv[i + 1];
  return fallback;
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const OFF = "\x1b[0m";

function repoArg(): string {
  const r = flag("repo");
  if (!r) {
    console.error("psq: --repo <path> is required");
    process.exit(2);
  }
  return resolve(r);
}

function buildGraph(repo: string): EntityGraph {
  const g = extract(repo);
  const problems = invariants(g);
  if (problems.length > 0) {
    console.error(`${RED}psq: the extracted graph failed its invariants:${OFF}`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Refusing to generate questions from a graph that does not hold together.");
    process.exit(1);
  }
  return g;
}

function writeOut(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${path}`);
}

/**
 * `--section entity,ds`. Filtering happens while the bank is composed rather
 * than while a quiz is picked, because selection round-robins by generator and
 * a named section should not have to win a lottery against the others.
 */
function sectionArg(): Section[] | undefined {
  const raw = flag("section");
  if (!raw) return undefined;
  const names = raw.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
  const parsed: Section[] = [];
  for (const name of names) {
    const hit = Section.safeParse(name);
    if (!hit.success) {
      console.error(`psq: unknown section "${name}". Known: ${Section.options.join(", ")}`);
      process.exit(2);
    }
    parsed.push(hit.data);
  }
  return parsed;
}

function seedArg(): number | undefined {
  const s = flag("seed");
  return s === undefined ? undefined : Number(s);
}

/**
 * The full bank: multiple choice and fill-in-the-blank from the graph alone,
 * plus SQL questions that need a seeded database. The database is returned so
 * the caller can grade against it and then close it.
 */
function buildBank(g: EntityGraph, seed: number | undefined): {
  questions: Question[];
  seeded: SeededDb;
} {
  const seeded = materialize(g, { seed: seed ?? 1337, rows: Number(flag("rows", "40")) });
  return { questions: composeBank(g, seeded, seed, sectionArg()), seeded };
}

async function main(): Promise<void> {
  switch (cmd) {
    case "graph": {
      const g = buildGraph(repoArg());
      console.log(
        `${BOLD}${g.contextName ?? "(no context)"}${OFF}  ` +
          `${g.entities.length} entities, ${g.relations.length} relations`,
      );
      if (g.warnings.length > 0) {
        console.log(`${YELLOW}${g.warnings.length} warning(s):${OFF}`);
        for (const w of g.warnings) console.log(`  - ${w}`);
      }
      const orph = orphans(g);
      if (orph.length > 0) console.log(`${DIM}unconnected: ${orph.join(", ")}${OFF}`);
      console.log(`\n${BOLD}most connected${OFF}`);
      for (const d of degrees(g).slice(0, 5)) {
        console.log(`  ${d.entity.padEnd(26)} ${d.degree}`);
      }
      const out = flag("out");
      if (out) {
        writeOut(`${out}/entity.graph.json`, JSON.stringify(g, null, 2));
        writeOut(`${out}/entity.mmd`, mermaid(g));
      }
      return;
    }

    case "questions": {
      const g = buildGraph(repoArg());
      const { questions: qs, seeded } = buildBank(g, seedArg());
      if (seeded.warnings.length > 0) {
        console.log(`${YELLOW}seeding warnings:${OFF}`);
        for (const w of seeded.warnings) console.log(`  - ${w}`);
      }
      const byKind = new Map<string, number>();
      for (const q of qs) byKind.set(q.kind, (byKind.get(q.kind) ?? 0) + 1);
      console.log(
        `${DIM}seeded ${[...seeded.rowCounts.values()].reduce((a, b) => a + b, 0)} rows ` +
        `across ${seeded.rowCounts.size} tables${OFF}`,
      );
      console.log(`${DIM}by kind: ${[...byKind].map(([k, n]) => `${k}=${n}`).join("  ")}${OFF}`);
      const byGen = new Map<string, number>();
      for (const q of qs) byGen.set(q.generator, (byGen.get(q.generator) ?? 0) + 1);
      console.log(`${BOLD}${qs.length} questions${OFF} across ${byGen.size} generators`);
      for (const [gen, n] of [...byGen].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${gen.padEnd(24)} ${n}`);
      }
      const out = flag("out");
      if (out) {
        writeOut(`${out}/questions/entity.json`, JSON.stringify(qs, null, 2));
        writeOut(`${out}/schema.sql`, seeded.ddl);
      }
      seeded.close();
      return;
    }

    case "selftest": {
      const g = buildGraph(repoArg());
      const { questions: qs, seeded } = buildBank(g, seedArg());
      const findings = selftest(qs, { db: seeded.db });
      seeded.close();
      if (findings.length === 0) {
        console.log(
          `${GREEN}selftest ok${OFF} — ${qs.length} questions, ` +
            "each answerable with its reference answer and each failable with a mutation",
        );
        return;
      }
      console.error(
        `${RED}selftest failed${OFF} — ${findings.length} finding(s) across ${qs.length} questions`,
      );
      for (const f of findings.slice(0, 40)) {
        console.error(`  ${f.generator}/${f.questionId}: ${f.problem}`);
      }
      if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
      process.exit(1);
      return;
    }

    case "quiz": {
      const g = buildGraph(repoArg());
      const seed = seedArg();
      const { questions: all, seeded } = buildBank(g, seed);
      const n = Number(flag("n", "10"));
      try {
        await runQuiz(selectQuiz(all, n, seed ?? hashSeed(g.repo)), { db: seeded.db });
      } finally {
        seeded.close();
      }
      return;
    }

    case "help":
    default:
      console.log(`psq — read a codebase, then prove you know it

  psq graph      --repo <path> [--out <dir>]   extract the entity graph
  psq questions  --repo <path> [--out <dir>]   generate the question bank
  psq selftest   --repo <path>                 prove every question can pass AND fail
  psq quiz       --repo <path> [--n 10]        take a quiz in the terminal

Options
  --seed <n>      fix the generator seed (default: derived from the repo path)
  --rows <n>      rows to seed per table (default: 40)
  --section <s>   limit the bank to one or more sections, comma separated
                  (entity, ds)

psq reads a .NET project with an EF Core DbContext, or a Node backend whose
schema is written as CREATE TABLE. It works out which by what is on disk.

SQL questions are graded by running your query against a database psq builds
from the schema and seeds deterministically. Nothing touches the real one.
`);
      if (cmd !== "help") process.exit(2);
  }
}

async function runQuiz(qs: Question[], ctx: { db?: import("node:sqlite").DatabaseSync } = {}): Promise<void> {
  if (qs.length === 0) {
    console.log("no questions were generated for this repo");
    return;
  }
  // An async line iterator, not rl.question(): with piped stdin, question()
  // only resolves for lines that arrive after it is called, so any line
  // already buffered is dropped and a scripted run stalls part-way through.
  // Iterating works identically for a terminal and a pipe, which keeps the
  // quiz end-to-end testable.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  let correct = 0;
  const missed: Question[] = [];

  for (const [i, q] of qs.entries()) {
    console.log(`\n${BOLD}Q${i + 1}/${qs.length}${OFF} ${DIM}[${q.generator}]${OFF}`);
    console.log(q.prompt);
    for (const [j, c] of (q.choices ?? []).entries()) {
      console.log(`  ${String.fromCharCode(97 + j)}) ${c}`);
    }
    if (q.kind === "sql" && !q.sqlTemplate) {
      console.log(`${DIM}(write the whole query)${OFF}`);
    }
    process.stdout.write("> ");
    const line = await lines.next();
    if (line.done === true) {
      console.log("\n(input ended)");
      break;
    }
    const given = line.value;
    console.log(given);
    const result = grade(q, given, ctx);
    if (result.correct) {
      correct++;
      console.log(`${GREEN}correct${OFF}`);
    } else {
      missed.push(q);
      const model = q.gradeMode === "exec" && !q.sqlTemplate
        ? (q.referenceSql ?? "")
        : referenceAnswer(q);
      console.log(`${RED}wrong${OFF} — ${model}`);
      console.log(`${DIM}${result.detail}${OFF}`);
      console.log(`${DIM}${q.rationale}${OFF}`);
    }
  }
  rl.close();

  const answered = correct + missed.length;
  const pct = answered === 0 ? 0 : Math.round((correct / answered) * 100);
  console.log(`\n${BOLD}${correct}/${answered} (${pct}%)${OFF}`);
  if (missed.length > 0) {
    const subjects = new Map<string, number>();
    for (const q of missed) {
      for (const s of q.subjects) subjects.set(s, (subjects.get(s) ?? 0) + 1);
    }
    const weak = [...subjects].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`${DIM}weakest: ${weak.map(([s, c]) => `${s} (${c})`).join(", ")}${OFF}`);
  }
}

main().catch((err: unknown) => {
  console.error(`psq: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
