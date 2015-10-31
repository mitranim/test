'use strict'

// Requires Node 4.0+. Get it: https://nodejs.org

const co = require('co')

/**
 * Sync tests.
 *
 * Try changing the conditions to see the errors.
 */

const one = NaN
const other = Infinity

// Assertions in plain JavaScript!
if (one === other) throw Error("NaN shouldn't equal Infinity")

// Verbose error messages! Stacktraces!
let error
try {
  null.myProperty
} catch (err) {
  error = err
} finally {
  if (!error) throw Error("shouldn't be able to access properties on null")
}

/**
 * Async tests.
 *
 * Try changing the conditions to see the errors.
 */

co(function * () {
  // Async tests with synchronous code!
  const secretMissive = yield Promise.resolve('wait for me')
  if (!secretMissive) throw Error('correspondent went offline')

  // Waiting on a timer?
  const now = Date.now()
  const lunchTime = yield new Promise(resolve => {setTimeout(() => {resolve(Date.now())}, 50)})
  if (!(lunchTime > now)) throw Error('Too early for lunch!')

  // Whew. That was a hard day's work.
  console.info(`[${new Date().getUTCHours()}:${new Date().getUTCMinutes()}:${new Date().getUTCSeconds()}] Finished test, no errors.`)
}).catch(err => {
  console.error(err.stack)
  process.exit(1)
})
