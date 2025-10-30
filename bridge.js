// bridge.js (v4 friendly)
// This version updates the original bridge for Socket.IO v4 compatibility
// and adds better logging, error handling, and Windows-friendly settings.

const http = require('http')
const { Server } = require('socket.io')
const osc = require('node-osc')

// Allow port override via environment variable, default to 8081
const PORT = process.env.PORT || 8081

// Create an explicit HTTP server (instead of passing the port directly to socket.io)
// This makes the setup clearer and more compatible with Socket.IO v4+
const httpServer = http.createServer()

// Create the Socket.IO server and allow any origin (useful for local testing)
const io = new Server(httpServer, {
  cors: { origin: '*' },
})

// Keep track of active OSC servers/clients
let oscServer = null
let oscClient = null
let isConnected = false

// Start the HTTP server and print a clear log message
httpServer.listen(PORT, () => {
  console.log(`✅ Socket.IO listening on http://localhost:${PORT}`)
})

// Handle web socket connections
io.on('connection', (socket) => {
  console.log('🔌 Web client connected:', socket.id)

  // Wait for the "config" message from the web client (p5.js or browser)
  socket.on('config', (obj) => {
    try {
      isConnected = true

      // Windows tip: prefer 127.0.0.1 instead of ::1 to avoid IPv6/IPv4 issues
      const serverHost = obj?.server?.host || '127.0.0.1'
      const serverPort = obj?.server?.port || 3333
      const clientHost = obj?.client?.host || '127.0.0.1'
      const clientPort = obj?.client?.port || 3334

      // Kill previous OSC servers/clients if reconfiguring or restarting
      if (oscServer)
        try {
          oscServer.kill()
        } catch {}
      if (oscClient)
        try {
          oscClient.kill()
        } catch {}

      // Create a new OSC server (receiving) and client (sending)
      oscServer = new osc.Server(serverPort, serverHost)
      oscClient = new osc.Client(clientHost, clientPort)

      console.log(`🎛️  OSC Server listening on ${serverHost}:${serverPort}`)
      console.log(`📤 OSC Client sending to   ${clientHost}:${clientPort}`)

      // In Socket.IO v4 we use socket.id instead of socket.sessionId
      oscClient.send('/status', `${socket.id} connected`)

      // Forward any incoming OSC messages to the browser
      oscServer.on('message', (msg, rinfo) => {
        socket.emit('message', msg)
        // Uncomment the line below for verbose logging during debugging:
        // console.log('OSC in:', msg, 'from', `${rinfo.address}:${rinfo.port}`);
      })

      // Confirm that connection and configuration succeeded
      socket.emit('connected', 1)
    } catch (e) {
      console.error('⚠️ error in config:', e)
      socket.emit('connected', 0)
    }
  })

  // Forward messages from the browser to the OSC client
  socket.on('message', (obj) => {
    // Expected format: ['/osc/address', arg1, arg2, ...]
    if (oscClient) {
      try {
        oscClient.send.apply(oscClient, obj)
      } catch (e) {
        console.error('⚠️ error sending OSC:', e)
      }
    }
  })

  // Web → OSC (p5 send to Processing via bridge)
  socket.on('osc-send', (arr) => {
    // arr esperado: ['/ruta', arg1, arg2, ...]
    if (oscClient && Array.isArray(arr) && arr.length) {
      try {
        oscClient.send.apply(oscClient, arr)
      } catch (e) {
        console.error('⚠️ error sending OSC:', e)
      }
    }
  })

  // Clean up on disconnect
  socket.on('disconnect', () => {
    console.log('❌ Web client disconnected:', socket.id)
    if (isConnected) {
      try {
        oscServer && oscServer.kill()
      } catch {}
      try {
        oscClient && oscClient.kill()
      } catch {}
      oscServer = null
      oscClient = null
      isConnected = false
    }
  })
})
