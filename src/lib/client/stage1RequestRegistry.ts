import { ConnectionClosedError, NotReadyError, RequestTimeoutError } from './errors'
import { NaiveClient, type PendingRequest } from './stage0NaiveClient'

export const REQUEST_TIMEOUT_MS = 5000

// Stage 1. No promise may stay pending forever:
//   - every request has a timeout;
//   - when the connection dies, everything in flight is rejected right away;
//   - a request that can't be sent fails immediately with its own error type.
//
// Request ids keep growing for the client's whole life rather than restarting
// per connection, so a late response can never match a newer request.
export class RequestRegistryClient extends NaiveClient {
  override request(method: string, params: unknown = null): Promise<unknown> {
    if (!this.isReady()) return Promise.reject(new NotReadyError(`Not ready to send ${method}`))
    return super.request(method, params)
  }

  protected override registerRequest(id: number, request: PendingRequest): void {
    const timer = setTimeout(() => {
      this.pending.delete(id)
      request.reject(new RequestTimeoutError(`${request.method} got no response in ${REQUEST_TIMEOUT_MS} ms`))
    }, REQUEST_TIMEOUT_MS)

    super.registerRequest(id, {
      method: request.method,
      resolve: (value) => {
        clearTimeout(timer)
        request.resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        request.reject(error)
      },
    })
  }

  protected override handleClose(code: number, reason: string): void {
    this.rejectInFlight(new ConnectionClosedError(`Connection closed with ${code}`))
    super.handleClose(code, reason)
  }

  private rejectInFlight(error: Error): void {
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const request of requests) request.reject(error)
  }
}
