import '../emptty.mjs'
import * as t from '../test.mjs'

const cli = t.Args.os()
t.conf.benchFilterFrom(cli.get(`run`))
t.conf.benchRep = t.ConsoleAvgReporter.with(t.tsNano)

/* Globals */

const args = [`-one`, `two`, `--three=four`, `-f`, `-s`, `seven`, `-e`, `nine`, `eleven`, `-e`, `ten`, `twelve`]

/* Benchmarks */

t.bench(function bench_baseline() {})
t.bench(function bench_now() {t.now()})
t.bench(function bench_Args_from() {nop(t.Args.from(args))})

t.deopt()
t.benches()

/* Utils */

function nop() {}
