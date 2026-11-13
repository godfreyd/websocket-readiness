import type { Server } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { attachDemoServer, createDemoServer } from './demoServer.ts'

// Runs the demo WebSocket server inside the Vite server,
// so `npm run dev` is the only command a reader needs.
export function demoServerPlugin(): Plugin {
  const setup = (httpServer: Server | null, middlewares: Connect.Server) => {
    // No HTTP server means middleware mode (e.g. Vitest): nothing to attach to.
    if (!httpServer) return

    const demo = createDemoServer()
    attachDemoServer(httpServer, demo)
    httpServer.on('close', () => demo.close())

    middlewares.use((request, response, next) => {
      if (!demo.handleHttp(request, response)) next()
    })
  }

  return {
    name: 'websocket-readiness-demo-server',
    configureServer(server) {
      setup(server.httpServer as Server | null, server.middlewares)
    },
    configurePreviewServer(server) {
      setup(server.httpServer as Server | null, server.middlewares)
    },
  }
}
