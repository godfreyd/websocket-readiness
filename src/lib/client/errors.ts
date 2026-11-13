// Each failure needs its own reaction, so each one gets its own type.

export class RequestTimeoutError extends Error {
  name = 'RequestTimeoutError'
}

// The connection died while the request was in flight. The server may or may
// not have processed it, so retrying is safe only for idempotent requests.
export class ConnectionClosedError extends Error {
  name = 'ConnectionClosedError'
}

// The request was never sent, so retrying is always safe.
export class NotReadyError extends Error {
  name = 'NotReadyError'
}
