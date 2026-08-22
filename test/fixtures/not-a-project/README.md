# not-a-project

A directory with no source psq can read: no `.csproj`, no `.cs`, no
`package.json`, no `tsconfig.json`, no TypeScript. Pointing psq here must
produce an empty graph carrying a warning that names what was looked for —
never a throw, and never a silent empty result that reads like "this repo has
no entities".
