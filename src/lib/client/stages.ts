import { NaiveClient } from './stage0NaiveClient'
import { RequestRegistryClient } from './stage1RequestRegistry'
import { HeartbeatClient } from './stage2Heartbeat'
import { StaleEventsClient } from './stage3StaleEvents'
import { ServiceReadinessClient } from './stage4ServiceReadiness'
import { ReconnectPolicyClient } from './stage5ReconnectPolicy'
import type { ClientOptions, ConnectionClient } from './types'

export type StageId = 0 | 1 | 2 | 3 | 4 | 5

export interface Stage {
  id: StageId
  title: string
  fixes: string
  create(options: ClientOptions): ConnectionClient
}

export const STAGES: Stage[] = [
  {
    id: 0,
    title: 'Naive client',
    fixes: 'onopen means online',
    create: (options) => new NaiveClient(options),
  },
  {
    id: 1,
    title: 'Request registry',
    fixes: 'no promise hangs forever',
    create: (options) => new RequestRegistryClient(options),
  },
  {
    id: 2,
    title: 'Heartbeat',
    fixes: 'detects a dead peer',
    create: (options) => new HeartbeatClient(options),
  },
  {
    id: 3,
    title: 'Stale events',
    fixes: 'old sockets change nothing',
    create: (options) => new StaleEventsClient(options),
  },
  {
    id: 4,
    title: 'Service readiness',
    fixes: 'a live peer is not a service',
    create: (options) => new ServiceReadinessClient(options),
  },
  {
    id: 5,
    title: 'Reconnect policy',
    fixes: 'jitter, backoff, cooldown',
    create: (options) => new ReconnectPolicyClient(options),
  },
]
