'use strict'

const { WebSocketServer } = require('ws')
const url = require('url')
const { handleProctoringConnection } = require('./proctoring.socket')

/**
 * Initializes the WebSocket server and binds it to the Express HTTP server.
 *
 * @param {import('http').Server} httpServer - Express HTTP server
 */
function initWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true })

  // Handle upgrade requests
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = url.parse(request.url)

    // Match path pattern /ws/proctoring/:sessionId
    const proctoringMatch = pathname.match(/^\/ws\/proctoring\/([a-fA-F0-9-]+)/)

    if (proctoringMatch) {
      const sessionId = proctoringMatch[1]

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, sessionId)
      })
    } else {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
    }
  })

  // Handle new connections
  wss.on('connection', (ws, request, sessionId) => {
    handleProctoringConnection(ws, request, sessionId).catch((err) => {
      console.error('[ws-upgrade] error handling connection:', err)
      ws.close(1011, 'Internal connection handler error')
    })
  })

  console.log('[ws] WebSocket server initialized.')
  return wss
}

module.exports = {
  initWebSocket
}
