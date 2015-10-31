/*
Base error class used by this package. Allows to differentiate errors generated
by test utils from errors generated by functions being tested.
*/
export class AssertError extends Error {
  get name() {return this.constructor.name}
  get [Symbol.toStringTag]() {return this.constructor.name}
}

/*
Note: this INTENTIONALLY shadows built-in `TypeError` without subclassing.
This package should avoid using or subclassing any specialized built-in error
classes such as `TypeError` or `SyntaxError`, to prevent accidental overlaps
with user code. It must be possible to reliably differentiate errors created
by this package from errors created by other code.
*/
export class TypeError extends AssertError {}

// See the comment on `TypeError`.
export class SyntaxError extends AssertError {}

export class InternalError extends AssertError {}

/*
Describes a single test or benchmark run. All runs must have names. We recommend
using unique names but don't enforce uniqueness. Tests receive `Run` as an
input, and may use it for introspection, for example to test timing.

Leaves generation of timestamps and calculation of averages up to runners.
This makes it possible to implement runners that use different performance
APIs such as standard `performance.now` vs Node `process.hrtime`, or fudge
the averages.
*/
export class Run {
  constructor(name, parent) {
    if (!req(name, isStr)) throw new SyntaxError(`missing run name`)
    this.name = name
    this.parent = optInst(parent, Run)
  }

  #runs = 0
  get runs() {return this.#runs}
  set runs(val) {this.#runs = req(val, isNatPos)}

  #start = NaN
  get start() {return this.#start}
  set start(val) {this.#start = req(val, isFinPos)}

  #end = NaN
  get end() {return this.#end}
  set end(val) {this.#end = req(val, isFinPos)}

  #avg = NaN
  get avg() {return this.#avg}
  set avg(val) {this.#avg = req(val, isFin)}

  level() {return (this.parent?.level() + 1) | 0}
  time() {return this.end - this.start}
  elapsed() {return (onlyFin(this.end) ?? now()) - this.start}

  done(end, runs) {
    this.end = end
    this.runs = runs
    this.avg = this.time() / this.runs
  }

  reset() {
    this.#runs = 0
    this.#start = NaN
    this.#end = NaN
    this.#avg = NaN
  }

  reqDone() {
    const {name, runs, end, avg} = this
    if (!isNatPos(runs)) {
      throw new InternalError(`internal error: expected run ${show(name)} to have at least 1 run, got ${show(runs)} runs`)
    }
    if (!isFinPos(end)) {
      throw new InternalError(`internal error: expected run ${show(name)} to have an end time, found ${show(end)}`)
    }
    if (!isFin(avg)) {
      throw new InternalError(`internal error: expected run ${show(name)} to have an average time, found ${show(avg)}`)
    }
  }

  nameFull() {
    const {name, parent} = this
    return parent ? `${parent.nameFull()}/${name}` : name
  }

  get [Symbol.toStringTag]() {return this.constructor.name}
}

export class FinRunner extends Number {
  constructor(val) {super(req(val, isFin))}
  run() {throw new AssertError(`must be implemented in subclass`)}

  static default() {return new this(this.defaultSize)}
  static defaultSize = 0

  static defaultWarmup() {return new this(this.defaultWarmupSize)}
  static defaultWarmupSize = 1

  static warmup() {
    /*
    Note: subclasses require their own warmup and thus their own property. A
    regular static property would be automatically shared between super- and
    sub-classes. We must get and set it on each class separately.

    Reentrant calls are allowed, as nops, because this method is called by
    runner instances DURING the warmup.
    */
    if (hasOwn(this, `warm`)) return
    this.warm = false

    // Must pass different functions for deoptimization.
    this.defaultWarmup().run(function warmup0() {}, new Run(`warmup_${this.name}_0`))
    this.defaultWarmup().run(function warmup1() {}, new Run(`warmup_${this.name}_1`))
    this.defaultWarmup().run(function warmup2() {}, new Run(`warmup_${this.name}_2`))
    this.defaultWarmup().run(function warmup3() {}, new Run(`warmup_${this.name}_3`))

    this.nowAvg = req(nowAvg(), isFinPos)

    const run = new Run(`overhead_${this.name}`)
    this.defaultWarmup().run(function overhead() {}, run)
    this.overhead = req(run.avg, isFinPos)

    this.warm = true
    conf.verbLog(`[warmup] warmed up ${this.name}`)
  }

  static getOverhead() {return hasOwn(this, `overhead`) ? this.overhead : 0}
  static getNowAvg() {return hasOwn(this, `nowAvg`) ? this.nowAvg : nowAvg(1024)}

  get [Symbol.toStringTag]() {return this.constructor.name}
}

/*
Runs a benchmark for N amount of runs, recording the timing. Passes the current
run to the given benchmark function.
*/
export class CountRunner extends FinRunner {
  constructor(runs) {super(req(runs, isNatPos))}

  run(fun, run) {
    this.constructor.warmup()
    const nowAvg = this.constructor.getNowAvg()
    let runs = 0
    const thresh = this.valueOf()

    const start = run.start = now()
    do {fun()} while (++runs < thresh)
    const end = run.end = now()

    run.runs = runs
    run.avg = ((end - start - nowAvg) / runs) - this.constructor.getOverhead()

    conf.verbLog(`[${run.name}] runs: ${runs}, runtime: ${tsMilli(end - start)}, nowAvg: ${tsNano(nowAvg)} avg: ${tsNano(run.avg)}`)
  }

  static defaultSize = 1024
  static defaultWarmupSize = 2 << 24
}

/*
Runs a benchmark for approximately N amount of milliseconds (no more than twice
that amount), recording the number of runs and the timing. Passes the current
run to the given benchmark function.
*/
export class TimeRunner extends FinRunner {
  constructor(ms) {super(req(ms, isFinPos))}

  /*
  Performance cost distribution should be:

    * Calls to the function we're benchmarking: dominant.
    * Calls to `now`: amortized through batching.
    * Everything else: excluded from timing.

  Despite the optimization and amortization, this machinery has measurable
  overhead. To improve precision, we measure the overhead of measurement and
  subtract it from measurements. An empty benchmark should clock at ±0.
  */
  run(fun, run) {
    this.constructor.warmup()

    const nowAvg = this.constructor.getNowAvg()
    let runs = 0
    let nows = 0
    let end = undefined
    let batch = 1
    const start = run.start = now()
    const timeThresh = start + this.valueOf()

    do {
      let rem = batch
      do {runs++, fun()} while (rem-- > 0)

      batch *= 2
      nows++
      end = now()
    }
    while (end < timeThresh)

    run.end = now()
    run.runs = runs
    run.avg = ((end - start - (nowAvg * nows)) / runs) - this.constructor.getOverhead()

    conf.verbLog(`[${run.name}] runs: ${runs}, nows: ${nows}, runtime: ${tsMilli(end - start)}, nowAvg: ${tsNano(nowAvg)} avg: ${tsNano(run.avg)}`)
  }

  static defaultSize = 128
  static defaultWarmupSize = 128
}

export class DeoptRunner extends CountRunner {
  constructor() {super(1)}
  static getNowAvg() {return 0}
  static warmup() {}
}

/*
Base class for reporters that use strings, as opposed to reporters that render
DOM nodes or ring bells. Has no side effects. Reporting methods are nops.
*/
export class StringReporter {
  constructor(pad) {this.pad = req(pad, isStr)}

  // Nop implementation of `isReporter`.
  reportStart(run) {reqInst(run, Run)}
  reportEnd(run) {reqInst(run, Run)}

  cols() {return 0}

  str(pref, suff) {
    req(pref, isStr)
    req(suff, isStr)

    if (!suff) return pref
    if (!pref) return suff

    const space = ` `

    const infix = repad(
      this.pad,
      // Semi-placeholder. See comments on `test_string_length`.
      this.cols() - pref.length - (space.length * 2) - suff.length,
    )

    return pref + space + infix + (infix && space) + suff
  }

  runPref(run) {
    reqInst(run, Run)
    return `${repad(this.pad, run.level()*2)}[${run.name}]`
  }

  static default() {return new this(`·`)}

  get [Symbol.toStringTag]() {return this.constructor.name}
}

/*
Base class used by specialized console reporters such as `ConsoleOkReporter`.
Has utility methods for console printing, but its `isReporter` methods are
still nops.
*/
export class ConsoleReporter extends StringReporter {
  cols() {return consoleCols()}
  report(pref, suff) {this.log(this.str(pref, suff))}
  log() {console.log(...arguments)}
  err() {console.error(...arguments)}
}

/*
Reports runs by printing name and success message.
TODO implement an alternative DOM reporter that renders a table.
*/
export class ConsoleOkReporter extends ConsoleReporter {
  reportEnd(run) {
    reqInst(run, Run)
    this.report(this.runPref(run), `ok`)
  }
}

// Reports runs by printing name and average time.
export class ConsoleAvgReporter extends ConsoleReporter {
  constructor(pad, fun) {
    super(pad)
    this.fun = req(fun, isFun)
  }

  reportEnd(run) {
    reqInst(run, Run)
    const {fun} = this
    this.report(this.runPref(run), req(fun(run.avg), isStr))
  }

  /*
  Milliseconds are default because various other tools, including the JS
  performance API, report timing in milliseconds. Principle of least surprise.
  */
  static default() {return this.with(tsMilli)}

  static with(fun) {return new this(`·`, fun)}
}

// Reports runs by printing name and amount of runs.
export class ConsoleRunsReporter extends ConsoleReporter {
  reportEnd(run) {
    reqInst(run, Run)
    this.report(this.runPref(run), String(run.runs))
  }
}

/*
Reports benchmark runs by printing name, amount of runs, average timing.
TODO accumulate results, printing a table on `.flush`.
TODO variant that re-prints a table on the fly, clearing the terminal each time.
TODO alternative DOM reporter that renders a table.
*/
export class ConsoleBenchReporter extends ConsoleAvgReporter {
  reportEnd(run) {
    reqInst(run, Run)
    const {fun} = this
    this.report(this.runPref(run), `x${run.runs} ${req(fun(run.avg), isStr)}`)
  }
}

export function tsMilli(val) {
  return `${(req(val, isFin)).toFixed(6).toString()} ms`
}

export function tsMicro(val) {
  return `${(req(val, isFin) * 1000).toFixed(3).toString()} μs`
}

export function tsNano(val) {
  return `${(req(val, isFin) * 1_000_000).toFixed(0).toString()} ns`
}

export function tsPico(val) {
  return `${(req(val, isFin) * 1_000_000_000).toFixed(0).toString()} ps`
}

// Global config and global state.
export const conf = new class Conf {
  #testFilter = /(?:)/
  get testFilter() {return this.#testFilter}
  set testFilter(val) {this.#testFilter = req(val, isReg)}

  #benchFilter = /(?:)/
  get benchFilter() {return this.#benchFilter}
  set benchFilter(val) {this.#benchFilter = req(val, isReg)}

  #benchRunner = TimeRunner.default()
  get benchRunner() {return this.#benchRunner}
  set benchRunner(val) {this.#benchRunner = req(val, isRunner)}

  #testRep = undefined
  get testRep() {return this.#testRep}
  set testRep(val) {this.#testRep = opt(val, isReporter)}

  #benchRep = ConsoleAvgReporter.default()
  get benchRep() {return this.#benchRep}
  set benchRep(val) {this.#benchRep = opt(val, isReporter)}

  #run = undefined
  get run() {return this.#run}
  set run(val) {this.#run = optInst(val, Run)}

  #benches = new Set()
  get benches() {return this.#benches}
  set benches(val) {this.#benches = req(val, isSet)}

  #verb = false
  get verb() {return this.#verb}
  set verb(val) {this.#verb = req(val, isBool)}

  testAllow(run) {
    return this.testFilter.test(run.nameFull())
  }

  benchAllow(name) {
    return this.benchFilter.test(req(name, isStr))
  }

  testFilterFrom(val) {
    this.testFilter = toReg(val)
    return this
  }

  benchFilterFrom(val) {
    this.benchFilter = toReg(val)
    return this
  }

  isTop() {return !this.run}
  verbLog(...args) {if (this.verb) console.log(...args)}
  verbErr(...args) {if (this.verb) console.error(...args)}

  get [Symbol.toStringTag]() {return this.constructor.name}
}()

/*
Runs a named test function. May skip depending on `conf.testFilter`. Uses
optional `conf.testRep` to report start and end of the test. Records test
timing, which may be used by the reporter. Passes the current `Run` to the test
function.
*/
export function test(fun) {
  reqNamedFun(fun, `test`)

  const run = new Run(fun.name, conf.run)
  if (!conf.testAllow(run)) return run

  conf.testRep?.reportStart(run)
  run.start = now()

  conf.run = run
  try {fun(run)}
  finally {conf.run = run.parent}

  run.done(now(), 1)
  conf.testRep?.reportEnd(run)
  return run
}

/*
Registers a function for benchmarking, returning the resulting `Bench`.
Registered benchmarks can be run by calling `benches`.
*/
export function bench(fun, runner) {
  const bench = new Bench(fun, runner)
  conf.benches.add(bench)
  return bench
}

/*
Named benchmark. Accepts an optional runner, falling back on default
`conf.benchRunner`. Expects the runner to run the given function multiple
times, recording the amount of runs and the timing. Uses `conf.benchRep` to
report start and end of the benchmark.
*/
export class Bench {
  constructor(fun, runner) {
    this.fun = reqNamedFun(fun, `bench`)
    this.runner = optRunner(runner)
  }

  get name() {return this.fun.name}

  run(runner = this.runner ?? conf.benchRunner) {
    const run = new Run(this.name)
    conf.benchRep?.reportStart(run)

    conf.run = run
    try {runner.run(this.fun, run)}
    finally {conf.run = run.parent}

    run.reqDone()
    conf.benchRep?.reportEnd(run)
    return run
  }

  get [Symbol.toStringTag]() {return this.constructor.name}
}

/*
Runs all registered benchmarks, using a single-pass runner, without filtering.
May cause deoptimization of polymorphic code. Leads to more predictable
benchmark results. Run this before `benches`.
*/
export function deopt() {
  const runner = new DeoptRunner()
  const rep = conf.benchRep
  conf.benchRep = conf.verb ? rep : undefined

  try {for (const bench of conf.benches) bench.run(runner)}
  finally {conf.benchRep = rep}
}

// Runs registered benchmarks, filtering them via `conf.benchFilter`.
export function benches() {
  for (const bench of conf.benches) {
    if (conf.benchAllow(bench.name)) bench.run()
  }
}

function reqNamedFun(fun, type) {
  const {name} = req(fun, isFun)
  if (!name) {
    throw new SyntaxError(`${type} functions must have names for clearer stacktraces and easier search; missing name on ${fun}`)
  }
  if (!name.startsWith(type)) {
    throw new SyntaxError(`names of ${type} functions must begin with ${show(type)} for clearer stacktraces and easier search; invalid name on ${fun}`)
  }
  return fun
}

// Asserts that the given value is exactly `true`. Otherwise throws `AssertError`.
export function ok(val) {
  if (val === true) return
  throw new AssertError(`expected true, got ${show(val)}`)
}

// Asserts that the given value is exactly `false`. Otherwise throws `AssertError`.
export function no(val) {
  if (val === false) return
  throw new AssertError(`expected false, got ${show(val)}`)
}

/*
Asserts that the inputs are identical, using `Object.is`.
Otherwise throws `AssertError`.
*/
export function is(act, exp) {
  if (Object.is(act, exp)) return

  throw new AssertError(`
actual:   ${show(act)}
expected: ${show(exp)}
${equal(act, exp) ? `
note:     equivalent structure, different reference
`.trim() : ``}`)
}

/*
Asserts that the inputs are NOT identical, using `Object.is`.
Otherwise throws `AssertError`.
*/
export function isnt(act, exp) {
  if (!Object.is(act, exp)) return
  throw new AssertError(`expected distinct values, but both inputs were ${show(act)}`)
}

/*
Asserts that the inputs have equivalent structure, using `equal`.
Otherwise throws `AssertError`.
*/
export function eq(act, exp) {
  if (equal(act, exp)) return
  throw new AssertError(`
actual:   ${show(act)}
expected: ${show(exp)}
`)
}

/*
Asserts that the inputs DO NOT have equivalent structure, using `equal`.
Otherwise throws `AssertError`.
*/
export function notEq(act, exp) {
  if (!equal(act, exp)) return
  throw new AssertError(`expected distinct values, but both inputs were ${show(act)}`)
}

/*
Asserts that the given value is an instance of the given class.
Otherwise throws `AssertError`.
The argument order matches `instanceof` and `isInst`.
*/
export function inst(val, cls) {
  if (isInst(val, cls)) return
  throw new AssertError(`expected an instance of ${cls}, got ${show(val)}`)
}

/*
Asserts that the given function throws an instance of the given error class,
with a given non-empty error message.
*/
export function throws(fun, cls, msg) {
  if (!isFun(fun)) {
    throw new TypeError(`expected a function, got ${show(fun)}`)
  }
  if (!isCls(cls) || !isClass(cls, Error)) {
    throw new TypeError(`expected an error class, got ${show(cls)}`)
  }
  if (!isStr(msg) || !msg) {
    throw new TypeError(`expected an error message, got ${show(msg)}`)
  }

  let val
  try {val = fun()}
  catch (err) {
    if (!isInst(err, cls)) {
      throw new AssertError(`expected function ${show(fun)} to throw instance of ${show(cls)}, got ${show(err)}`)
    }
    if (!err.message.includes(msg)) {
      throw new AssertError(`expected error to contain ${show(msg)}, got ${show(err)}`)
    }
    return
  }

  throw new AssertError(`expected function ${show(fun)} to throw, got ${show(val)}`)
}

/*
Returns true if the inputs have an equivalent structure. Supports plain dicts,
arrays, maps, sets, and arbitrary objects with enumerable properties.
*/
export function equal(one, two) {
  return Object.is(one, two) || (
    isObj(one) && isObj(two) && equalObj(one, two)
  )
}

function equalObj(one, two) {
  if (isList(one)) return equalCons(one, two) && equalList(one, two)
  if (isSet(one)) return equalCons(one, two) && equalSet(one, two)
  if (isMap(one)) return equalCons(one, two) && equalMap(one, two)
  if (isDict(one)) return isDict(two) && equalStruct(one, two)
  return equalCons(one, two) && equalStruct(one, two)
}

function equalCons(one, two) {
  return isComp(one) && isComp(two) && equal(one.constructor, two.constructor)
}

function equalList(one, two) {
  if (one.length !== two.length) return false
  for (let i = 0; i < one.length; i++) if (!equal(one[i], two[i])) return false
  return true
}

function equalStruct(one, two) {
  const keysOne = Object.keys(one)
  const keysTwo = Object.keys(two)

  for (const key of keysOne) {
    if (!hasOwnEnum(two, key) || !equal(one[key], two[key])) return false
  }

  for (const key of keysTwo) {
    if (!hasOwnEnum(one, key) || !equal(two[key], one[key])) return false
  }

  return true
}

function equalSet(one, two) {
  if (one.size !== two.size) return false
  for (const val of one) if (!two.has(val)) return false
  return true
}

function equalMap(one, two) {
  if (one.size !== two.size) return false
  for (const [key, val] of one.entries()) {
    if (!equal(val, two.get(key))) return false
  }
  return true
}

function repad(pad, len) {
  req(pad, isStr)
  req(len, isInt)
  return len > 0 ? Array(len).fill(pad).join(``) : ``
}

// Returns the OS arg at the given index, or undefined. Uses `args`.
export function arg(ind) {return args()[req(ind, isNat)]}

// Returns OS args in Deno and Node. Returns `[]` in other environemnts.
export function args() {return globalThis.Deno?.args ?? globalThis.process?.args ?? []}

export const dec = new TextDecoder()
export const enc = new TextEncoder()

// Copied from `https://github.com/mitranim/emptty`.
export const esc = `\x1b`
export const clearSoft = esc + `c`
export const clearScroll = esc + `[3J`
export const clearHard = clearSoft + clearScroll
export const clearSoftArr = enc.encode(clearSoft)
export const clearScrollArr = enc.encode(clearScroll)
export const clearHardArr = enc.encode(clearHard)

/*
Clears the console, returning true if cleared and false otherwise. If the
environment doesn't appear to be a browser or a TTY, for example if the
program's output is piped to a file, this should be a nop. Note that
`console.clear` doesn't always perform this detection, and may print garbage to
stdout, so we avoid calling it unless we're sure. For example, `console.clear`
has TTY detection in Node 16 but not in Deno 1.17. We also don't want to rely
on Node's detection, because various polyfills/shims for Node globals may not
implement that.
*/
export function emptty() {
  const {Deno} = globalThis

  if (Deno?.isatty) {
    if (Deno.isatty()) {
      Deno.stdout.writeSync(clearHardArr)
      return true
    }
    return false
  }

  const {process} = globalThis

  if (process?.stdout) {
    if (process.stdout.isTTY) {
      process.stdout.write(clearHardArr)
      return true
    }
    return false
  }

  if (isObj(globalThis.document)) {
    console.clear()
    return true
  }

  return false
}

export function consoleCols() {
  return (
    globalThis.Deno?.consoleSize?.()?.columns ??
    globalThis.process?.stdout?.columns
  ) | 0
}

/*
Parser for CLI args. Features:

  * Supports flags prefixed with `-`, `--`.
  * Supports `=` pairs.
  * Separates flags from unflagged args.
  * Parses flags into `URLSearchParams`.
  * Stores remaining args as an array.
  * On-demand parsing of booleans and numbers.
*/
export class Args extends Array {
  constructor() {
    super(...arguments)
    this.flags = new URLSearchParams()
  }

  has(key) {return this.flags.has(req(key, isKey))}
  get(key) {return this.flags.get(req(key, isKey)) ?? undefined}
  getAll(key) {return this.flags.getAll(req(key, isKey))}
  bool(key) {return this.has(key) && parseBool(this.get(key))}
  int(key) {return onlyInt(Number.parseInt(this.get(key)))}
  fin(key) {return onlyFin(Number.parseFloat(this.get(key)))}

  parse(src) {
    let flag

    for (const val of req(src, isIter)) {
      req(val, isStr)

      if (!isFlag(val)) {
        if (flag) {
          this.flags.append(flag, val)
          flag = undefined
          continue
        }

        this.push(val)
        continue
      }

      if (flag) {
        this.flags.set(flag, ``)
        flag = undefined
      }

      const ind = val.indexOf(`=`)
      if (ind >= 0) {
        this.flags.append(unFlag(val.slice(0, ind)), val.slice(ind+1))
        continue
      }

      flag = unFlag(val)
    }

    if (flag) this.flags.set(flag, ``)
    return this
  }

  static os() {return this.from(args())}
  static from(src) {return new this().parse(src)}

  get [Symbol.toStringTag]() {return this.constructor.name}
}

function isFlag(str) {return str.startsWith(`-`)}
function unFlag(str) {return trimStart(str, `-`)}

function trimStart(str, pref) {
  req(str, isStr)
  req(pref, isStr)
  while (pref && str.startsWith(pref)) str = str.slice(pref.length)
  return str
}

function parseBool(val) {
  if (val === `` || val === `true`) return true
  if (val === `false`) return false
  throw TypeError(`can't parse ${show(val)} as bool`)
}

function toReg(val) {
  if (isNil(val)) return /(?:)/
  if (isStr(val)) return val ? new RegExp(val) : /(?:)/
  if (isReg(val)) return val
  throw new TypeError(`can't convert ${show(val)} to RegExp`)
}

/*
Used for all measurements. Semi-placeholder. In the future we may decide to
auto-detect the best available timing API depending on the environment. For
example, in Node we might use `process.hrtime`.
*/
export function now() {return performance.now()}

/*
Average overhead of the timing API. VERY approximate. The overhead varies,
possibly due to factors such as JIT tiers, CPU boost state, and possibly more.
Observed variance in Deno: 200ns, 600ns, 2μs.
*/
export function nowAvg(runs = 65536) {
  req(runs, isNatPos)
  const start = now()
  let rem = runs
  while (rem-- > 0) now()
  const end = now()
  return (end - start) / runs
}

export function req(val, fun) {
  reqValidator(fun)
  if (!fun(val)) {
    throw new TypeError(`expected ${show(val)} to satisfy test ${show(fun)}`)
  }
  return val
}

export function opt(val, fun) {
  reqValidator(fun)
  return isNil(val) ? val : req(val, fun)
}

function reqValidator(val) {
  if (!isFun(val)) {
    throw new TypeError(`expected validator function, got ${show(val)}`)
  }
  return val
}

function reqRunner(val) {
  if (!isRunner(val)) {
    throw new TypeError(`benchmarks require a valid runner, got ${show(val)}`)
  }
  return val
}

function optRunner(val) {return isNil(val) ? undefined : reqRunner(val)}

export function reqInst(val, cls) {
  if (!isInst(val, cls)) {
    const cons = isComp(val) ? val.constructor : undefined
    throw new TypeError(`expected ${show(val)}${cons ? ` (instance of ${show(cons)})` : ``} to be an instance of ${show(cls)}`)
  }
  return val
}

export function optInst(val, cls) {
  req(cls, isCls)
  return isNil(val) ? val : reqInst(val, cls)
}

export function hasOwn(val, key) {
  req(key, isKey)
  return isComp(val) && Object.prototype.hasOwnProperty.call(val, key)
}

export function hasOwnEnum(val, key) {
  req(key, isKey)
  return isComp(val) && Object.prototype.propertyIsEnumerable.call(val, key)
}

export function onlyInt(val) {return isInt(val) ? val : undefined}
export function onlyFin(val) {return isFin(val) ? val : undefined}

export function truthy(val) {return !!val}
export function falsy(val) {return !val}
export function isNil(val) {return val == null}
export function isSome(val) {return !isNil(val)}
export function isBool(val) {return typeof val === `boolean`}
export function isNum(val) {return typeof val === `number`}
export function isFin(val) {return isNum(val) && !isNaN(val) && !isInf(val)}
export function isFinNeg(val) {return isFin(val) && val < 0}
export function isFinPos(val) {return isFin(val) && val > 0}
export function isFinNonNeg(val) {return isFin(val) && val >= 0}
export function isFinNonPos(val) {return isFin(val) && val <= 0}
export function isInt(val) {return isNum(val) && ((val % 1) === 0)}
export function isNat(val) {return isInt(val) && val >= 0}
export function isNatNeg(val) {return isInt(val) && val < 0}
export function isNatPos(val) {return isInt(val) && val > 0}
export function isNaN(val) {return val !== val} // eslint-disable-line no-self-compare
export function isInf(val) {return val === Infinity || val === -Infinity}
export function isStr(val) {return typeof val === `string`}
export function isSym(val) {return typeof val === `symbol`}
export function isKey(val) {return isStr(val) || isSym(val) || isBool(val) || isFin(val)}
export function isPrim(val) {return !isComp(val)}
export function isComp(val) {return isObj(val) || isFun(val)}
export function isFun(val) {return typeof val === `function`}
export function isObj(val) {return val !== null && typeof val === `object`}
export function isStruct(val) {return isObj(val) && !isIter(val) && !isIterAsync(val)}
export function isArr(val) {return isInst(val, Array)}
export function isReg(val) {return isInst(val, RegExp)}
export function isDate(val) {return isInst(val, Date)}
export function isValidDate(val) {return isDate(val) && isFin(val.valueOf())}
export function isInvalidDate(val) {return isDate(val) && !isValidDate(val)}
export function isPromise(val) {return isComp(val) && hasMeth(val, `then`)}
export function isIter(val) {return isObj(val) && hasMeth(val, Symbol.iterator)}
export function isIterAsync(val) {return isObj(val) && hasMeth(val, Symbol.asyncIterator)}
export function isIterator(val) {return isIter(val) && hasMeth(val, `next`)}
export function isGen(val) {return isIterator(val) && hasMeth(val, `return`) && hasMeth(val, `throw`)}
export function isCls(val) {return isFun(val) && typeof val.prototype === `object`}
export function isDict(val) {return isObj(val) && isDictProto(Object.getPrototypeOf(val))}
export function isDictProto(val) {return val === null || val === Object.prototype}
export function isList(val) {return isArr(val) || (isIter(val) && isNat(val.length))}
export function isClass(sub, sup) {return isCls(sub) && (sub === sup || isSubCls(sub, sup))}
export function isSubCls(sub, sup) {return isCls(sub) && isInst(sub.prototype, sup)}
export function isRunner(val) {return isComp(val) && hasMeth(val, `run`)}
export function hasMeth(val, key) {return isComp(val) && key in val && isFun(val[key])}
export function hasSize(val) {return isComp(val) && `size` in val && isNat(val.size)}

export function isInst(val, cls) {
  req(cls, isCls)
  return isObj(val) && val instanceof cls
}

export function isReporter(val) {
  return isComp(val) && hasMeth(val, `reportStart`) && hasMeth(val, `reportEnd`)
}

export function isMap(val) {
  return (
    isIter(val) &&
    hasSize(val) &&
    hasMeth(val, `has`) &&
    hasMeth(val, `get`) &&
    hasMeth(val, `set`) &&
    hasMeth(val, `delete`) &&
    hasMeth(val, `clear`) &&
    hasMeth(val, `entries`)
  )
}

export function isSet(val) {
  return (
    isIter(val) &&
    hasSize(val) &&
    hasMeth(val, `has`) &&
    hasMeth(val, `add`) &&
    hasMeth(val, `delete`) &&
    hasMeth(val, `clear`)
  )
}

export function show(val) {
  if (isStr(val) || isArr(val) || isDict(val) || (isComp(val) && !hasMeth(val, `toString`))) {
    try {return JSON.stringify(val)} catch {}
  }
  return (isFun(val) && val.name) || String(val)
}
