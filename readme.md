## Overview

Tiny utils for JS tests and benchmarks. Similar to https://deno.land/std/testing, but runs in all environments: browsers, Deno, Node, and possibly more.

Important **non-features**:

  * No CLI.
  * Doesn't require Node or Deno.
  * Doesn't require TypeScript.
  * No dependencies.
  * No slowness.

Features:

  * Tiny. Dependency-free. Single file. Native JS module. Can be imported by URL.
  * Runs in all environments: browsers, Deno, Node, possibly more.
  * Assertion shortcuts such as `is`, `eq`, `ok`, and more.
  * Filter tests by name.
  * Filter benchmarks by name.
  * Multiple benchmarking strategies.
    * `TimeRunner`: by total runtime in ms.
    * `CountRunner`: by run count.
    * Pluggable: bring your own runner.
  * Multiple reporting strategies.
    * Can report start, end, timing, number of runs, in any combination.
    * Pluggable: bring your own reporter.
  * Test and benchmark functions must be named.
    * Functions are registered and filtered by their name, not by an arbitrary string. This forces them to be indexable and searchable in editors.
  * Benchmarks support warmup for stable results.
  * Benchmark precision is tuned to 1/10th of a nanosecond.
    * Tested in Deno with `--allow-hrtime`.
  * Platform-agnostic console clearing.
  * Platform-agnostic OS args (nop in browser).
  * CLI flag parsing.
  * Non-verbose. Tests are silent by default.

## Limitations

* Undocumented, or rather documented only through comments. Read the source. Docs are planned but not written yet.
* Only synchronous. Async support is planned but not implemented.
* No support for additional messages accompanying failed tests.
* No support for timeouts. A hanged test stays hanged.

## Gotchas

Deno requires `--allow-hrtime` for better benchmark precision and `--unstable` for measuring terminal width.

Performance is variable due to factors such as JIT tiers, CPU boost, inline caching, and possibly more. Code affects other code. Order is significant. Benchmarks affect each other. Consider calling `deopt` before `benches`.

Timing precision varies by JS engine and environment.

## Usage

Simple testing example:

```js
import * as t from 'https://cdn.jsdelivr.net/npm/@mitranim/test@0.1.2/test.mjs'

t.test(function test_some_feature() {
  t.eq(someFunction(someInputs), `expected result`)
})
```

Simple benchmarking example:

```js
import * as t from 'https://cdn.jsdelivr.net/npm/@mitranim/test@0.1.2/test.mjs'

t.bench(function bench_some_feature() {
  someFunction(someInputs)
})

t.deopt()
t.benches()
```

Complex example:

```js
import * as t from 'https://cdn.jsdelivr.net/npm/@mitranim/test@0.1.2/test.mjs'

// Optional CLI flag parsing.
const cli = t.Args.os()

// Optional filtering.
t.conf.testFilterFrom(cli.get(`test`))
t.conf.benchFilterFrom(cli.get(`bench`))

// Optional bench adjustment. Can be overridden per-function.
t.conf.benchRunner = new t.TimeRunner(1024)

// Filterable tests with assertion shortcuts.
t.test(function test_some_feature() {
  t.eq(someFunction(someInputs), `expected result`)
})

// Easy and precise benchmarks.
t.bench(function bench_some_feature() {
  someFunction(someInputs)
})

t.deopt()
t.benches()
```

## License

https://unlicense.org
