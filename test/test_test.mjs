import '../emptty.mjs'
import * as t from '../test.mjs'

const cli = t.Args.os()
t.conf.testFilterFrom(cli.get(`run`))
if (cli.bool(`v`)) t.conf.testRep = t.conf.benchRep

// For faster testing. We're not concerned with nanosecond precision here.
t.TimeRunner.defaultWarmupSize = 16
t.CountRunner.defaultWarmupSize = 2 << 20

class ErrUnreachable extends Error {get name() {return this.constructor.name}}

// Tool for tracking call levels.
class Track {
  constructor() {this.lvl = 0}
  inc() {return this.lvl += 1, this}
  dec() {return this.lvl -= 1, this}
  req(exp) {return t.is(this.lvl, exp), this}
}

const track = new Track()

track.inc().req(1)
t.test(function test_test() {
  track.inc().req(2)
  t.test(function test_reject_invalid() {
    t.throws(() => t.test(), t.TypeError, `expected undefined to satisfy test isFun`)
    t.throws(() => t.test(`str`), t.TypeError, `expected "str" to satisfy test isFun`)
    t.throws(() => t.test(nop), t.SyntaxError, `names of test functions must begin with "test"`)

    track.dec().req(1)
  })
  track.req(1)

  track.inc().req(2)
  t.test(function test_test_run() {
    let run
    t.test(function test() {run = arguments[0]})

    t.reqInst(run, t.Run)
    run.reqDone()

    track.dec().req(1)
  })
  track.req(1)

  track.inc().req(2)
  t.test(function test_filtering() {
    t.conf.testFilterFrom(`---`)
    t.test(function test_failing() {throw new ErrUnreachable(`unreachable`)})
    t.conf.testFilterFrom()

    t.conf.testFilterFrom(`test_test/test_filtering`)
    track.inc().req(3)
    t.test(function test_normal() {track.dec().req(2)})
    track.req(2)
    t.conf.testFilterFrom()

    t.conf.testFilterFrom(`test_test/test_filtering/test_normal`)
    track.inc().req(3)
    t.test(function test_normal() {track.dec().req(2)})
    track.req(2)
    t.conf.testFilterFrom()

    track.dec().req(1)
  })
  track.req(1)

  track.dec().req(0)
})
track.req(0)

t.test(function test_now() {advanceTime()})

t.test(function test_Run() {
  t.test(function test_reject_invalid() {
    t.throws(() => new t.Run(), t.TypeError, `satisfy test isStr`)
    t.throws(() => new t.Run(`name`, `str`), t.TypeError, `expected "str" to be an instance of Run`)
  })

  t.test(function test_level() {
    const top = new t.Run(`top`)
    t.is(top.parent, undefined)
    t.is(top.name, `top`)
    t.is(top.level(), 0)

    const mid = new t.Run(`mid`, top)
    t.is(mid.parent, top)
    t.is(mid.name, `mid`)
    t.is(mid.level(), 1)

    const low = new t.Run(`low`, mid)
    t.is(low.parent, mid)
    t.is(low.name, `low`)
    t.is(low.level(), 2)
  })

  t.test(function test_nameFull() {
    const top = new t.Run(`top`)
    const mid = new t.Run(`mid`, top)
    const low = new t.Run(`low`, mid)

    t.is(top.nameFull(), `top`)
    t.is(mid.nameFull(), `top/mid`)
    t.is(low.nameFull(), `top/mid/low`)
  })

  t.test(function test_normal() {
    const run = new t.Run(`name`)

    t.is(run.parent, undefined)
    t.is(run.name, `name`)
    t.is(run.start, NaN)
    t.is(run.end, NaN)
    t.is(run.runs, 0)
    t.is(run.level(), 0)
    t.is(run.time(), NaN)
    t.is(run.avg, NaN)
    t.is(run.elapsed(), NaN)

    run.start = t.now()
    advanceTime()
    t.req(run.elapsed(), t.isFinPos)
    t.is(run.time(), NaN)

    t.throws(() => run.done(`str`), t.TypeError, `expected "str" to satisfy test isFinPos`)
    t.throws(() => run.done(1, `str`), t.TypeError, `expected "str" to satisfy test isNatPos`)
    run.done(t.now(), 17)

    t.req(run.start, t.isFinPos)
    t.req(run.end, t.isFinPos)
    t.ok(run.end >= run.start)
    t.is(run.runs, 17)
    t.req(run.elapsed(), t.isFinPos)
    t.req(run.time(), t.isFinPos)
    t.is(run.time(), run.elapsed())
    t.req(run.avg, t.isFinPos)
    t.is(run.avg, run.time() / run.runs)
  })
})

t.test(function test_TimeRunner() {
  t.throws(() => new t.TimeRunner(`str`), t.TypeError, `expected "str" to satisfy test isFinPos`)
  t.is(new t.TimeRunner(123).valueOf(), 123)

  const runner = new t.TimeRunner(1)
  t.is(runner.valueOf(), 1)

  const run = new t.Run(`name`)
  runner.run(advanceTime, run)

  t.req(run.end, t.isFinPos)
  t.req(run.runs, t.isFinPos)
  t.req(run.time(), t.isFinPos)

  t.ok(run.time() > runner.valueOf())
  t.ok(run.time() < (runner.valueOf() * 2))

  t.ok(run.avg > 0)
  t.ok(run.avg < (run.time() / run.runs))
})

t.test(function test_CountRunner() {
  t.throws(() => new t.CountRunner(`str`), t.TypeError, `expected "str" to satisfy test isNatPos`)
  t.throws(() => new t.CountRunner(0), t.TypeError, `expected 0 to satisfy test isNatPos`)

  const runner = new t.CountRunner(17)
  t.is(runner.valueOf(), 17)

  const run = new t.Run(`name`)
  runner.run(advanceTime, run)

  t.req(run.start, t.isFinPos)
  t.req(run.end, t.isFinPos)
  t.req(run.runs, t.isFinPos)
  t.req(run.time(), t.isFinPos)
  t.is(run.runs, runner.valueOf())

  t.ok(run.avg > 0)
  t.ok(run.avg < (run.time() / run.runs))
})

t.test(function test_string_length() {
  /*
  These character sets tend to have consistent 1-1 relation between UTF-16 code
  points, Unicode code points, and rendering width. When using a monospace
  font, we can predict and allocate precisely the right width.
  */
  t.test(function test_normal() {
    t.is(`abcdef`.length, 6)
    t.is(`αβγδεζ`.length, 6)
    t.is(`äḅĉḏèḟ`.length, 6)
    t.is(`абвгде`.length, 6)
    t.is(`абвгде`.length, 6)
  })

  /*
  These character sets require more pixels per character on display. Unclear if
  the width is consistent between environments such as different terminals on
  different operating systems, and whether we can predict and allocate the
  required width.
  */
  t.test(function test_wide() {
    t.is(`䶵龞龘`.length, 3)
    t.is(`あいう`.length, 3)
  })

  /*
  These character sets don't have a 1-1 relation between UTF-16 and Unicode.
  We COULD count Unicode code points, but these characters may also be wide.
  See the comment on `test_wide`.
  */
  t.test(function test_surrogate() {
    t.is(`🙂😁😛`.length, 6)
  })
})

t.test(function test_StringReporter() {
  t.test(function test_without_cols() {
    const rep = t.StringReporter.default()

    t.is(rep.str(``, ``), ``)
    t.is(rep.str(`one`, ``), `one`)
    t.is(rep.str(``, `two`), `two`)
    t.is(rep.str(`one`, `two`), `one two`)

    t.is(rep.runPref(new t.Run(`top`)), `[top]`)
    t.is(rep.runPref(new t.Run(`mid`, new t.Run(`top`))), `··[mid]`)
    t.is(rep.runPref(new t.Run(`low`, new t.Run(`mid`, new t.Run(`top`)))), `····[low]`)
  })

  t.test(function test_with_cols() {
    const rep = class Rep extends t.StringReporter {cols() {return 12}}.default()

    t.is(rep.str(``, ``), ``)
    t.is(rep.str(`one`, ``), `one`)
    t.is(rep.str(``, `two`), `two`)

    t.is(rep.str(`one`, `two`), `one ···· two`)
    t.is(`one ···· two`.length, rep.cols())

    t.is(rep.str(`three`, `four`), `three · four`)
    t.is(`three · four`.length, rep.cols())

    t.is(rep.str(`seven`, `eight`), `seven eight`)
    t.is(`seven eight`.length, 11)
  })
})

t.test(function test_Args() {
  function test(src, expFlags, expArgs) {
    const cli = t.Args.from(src)
    t.eq(cli.flags.toString(), expFlags)
    t.eq([...cli], expArgs)
  }

  test([],                         ``,          [])
  test([`-a`],                     `a=`,        [])
  test([`-one`],                   `one=`,      [])
  test([`--a`],                    `a=`,        [])
  test([`--one`],                  `one=`,      [])
  test([`-one`, `two`],            `one=two`,   [])
  test([`-one=two`],               `one=two`,   [])
  test([`--one`, `two`],           `one=two`,   [])
  test([`--one=two`],              `one=two`,   [])
  test([`-=`],                     `=`,         [])
  test([`--=`],                    `=`,         [])
  test([`-=two`],                  `=two`,      [])
  test([`--=two`],                 `=two`,      [])
  test([`-one`, `two`, `three`],   `one=two`,   [`three`])
  test([`-one=two`, `three`],      `one=two`,   [`three`])
  test([`three`, `-one=two`],      `one=two`,   [`three`])
  test([`three`, `-one`, `two`],   `one=two`,   [`three`])
  test([`two`, `-one`],            `one=`,      [`two`])
  test([`three`, `-one`, `--two`], `one=&two=`, [`three`])

  test(
    [`-one`, `two`, `--three=four`, `-f`, `-s`, `seven`, `-e`, `nine`, `eleven`, `-e`, `ten`, `twelve`],
    `one=two&three=four&f=&s=seven&e=nine&e=ten`,
    [`eleven`, `twelve`],
  )
})

function advanceTime() {
  const start = t.now()

  // Not required in Deno. Required in Chrome.
  let i = 0
  while (++i < 1024) t.now()

  const end = t.now()

  if (!(start < end)) throw Error(`failed to advance time`)
}

function nop() {}

console.log(`[test] ok!`)
