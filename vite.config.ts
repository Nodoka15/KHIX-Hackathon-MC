import { defineConfig, type Plugin } from 'vite';
import { createHash, randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

interface WSClient {
  id: string;
  socket: Socket;
  roomId: string | null;
  partnerId: string | null;
  lastPartnerId: string | null;
  isAlive: boolean;
  send: (data: Record<string, unknown>) => void;
}

function createMultiplayerSignalingPlugin(): Plugin {
  const clients = new Map<string, WSClient>();
  const waitingQueue: WSClient[] = [];

  function encodeFrame(text: string): Buffer {
    const payload = Buffer.from(text, 'utf8');
    const len = payload.length;
    let header: Buffer;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81; // FIN + text frame
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    return Buffer.concat([header, payload]);
  }

  function removeFromQueue(client: WSClient): void {
    const idx = waitingQueue.indexOf(client);
    if (idx !== -1) {
      waitingQueue.splice(idx, 1);
    }
  }

  function leaveCurrentRoom(client: WSClient, notifyPartner = true): void {
    removeFromQueue(client);
    if (client.partnerId) {
      const partner = clients.get(client.partnerId);
      client.lastPartnerId = client.partnerId;
      client.partnerId = null;
      client.roomId = null;

      if (partner) {
        partner.lastPartnerId = client.id;
        partner.partnerId = null;
        partner.roomId = null;
        if (notifyPartner && partner.isAlive) {
          partner.send({ type: 'peer_left' });
        }
      }
    }
  }

  function matchmake(client: WSClient): void {
    leaveCurrentRoom(client, true);

    // Clean any dead sockets from queue
    for (let i = waitingQueue.length - 1; i >= 0; i--) {
      if (!waitingQueue[i].isAlive || waitingQueue[i].id === client.id) {
        waitingQueue.splice(i, 1);
      }
    }

    if (waitingQueue.length > 0) {
      // Prefer someone other than the immediate last partner if multiple people are waiting
      let candidateIdx = waitingQueue.findIndex(c => c.id !== client.lastPartnerId);
      if (candidateIdx === -1) {
        candidateIdx = 0;
      }

      const opponent = waitingQueue.splice(candidateIdx, 1)[0];
      const roomId = randomUUID();

      opponent.roomId = roomId;
      opponent.partnerId = client.id;
      client.roomId = roomId;
      client.partnerId = opponent.id;

      const matchStartTime = Date.now() + 3200; // 3-second synchronized countdown

      opponent.send({
        type: 'match_found',
        roomId,
        role: 'host',
        peerId: client.id,
        matchStartTime
      });

      client.send({
        type: 'match_found',
        roomId,
        role: 'guest',
        peerId: opponent.id,
        matchStartTime
      });
    } else {
      waitingQueue.push(client);
      client.send({ type: 'searching' });
    }
  }

  function handleMessage(client: WSClient, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'find_match':
      case 'next_match': {
        matchmake(client);
        break;
      }

      case 'leave_match': {
        leaveCurrentRoom(client, true);
        break;
      }

      case 'rematch_ready': {
        if (client.partnerId) {
          const partner = clients.get(client.partnerId);
          if (partner && partner.isAlive) {
            partner.send({
              type: 'rematch_ready',
              matchStartTime: Date.now() + 3200
            });
          }
        }
        break;
      }

      default: {
        // Relay WebRTC signaling & real-time game packets directly to room partner
        if (client.partnerId) {
          const partner = clients.get(client.partnerId);
          if (partner && partner.isAlive) {
            partner.send(msg);
          }
        }
        break;
      }
    }
  }

  function attachUpgradeHandler(httpServer: { on: (event: string, cb: (req: IncomingMessage, socket: Socket, head: Buffer) => void) => void } | null): void {
    if (!httpServer) return;

    httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if (!req.url || !req.url.startsWith('/ws-multiplayer')) {
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key || Array.isArray(key)) {
        socket.destroy();
        return;
      }

      const acceptKey = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
          '\r\n'
      );

      socket.setNoDelay(true);

      const clientId = randomUUID();
      const client: WSClient = {
        id: clientId,
        socket,
        roomId: null,
        partnerId: null,
        lastPartnerId: null,
        isAlive: true,
        send: (data: Record<string, unknown>) => {
          if (!client.isAlive || socket.destroyed || !socket.writable) return;
          try {
            socket.write(encodeFrame(JSON.stringify(data)));
          } catch {
            // Ignore write errors on closing sockets
          }
        }
      };

      clients.set(clientId, client);
      client.send({ type: 'connected', clientId });

      let buffer: Buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);

      const processBuffer = () => {
        while (buffer.length >= 2) {
          const firstByte = buffer[0];
          const opcode = firstByte & 0x0f;
          const secondByte = buffer[1];
          const isMasked = (secondByte & 0x80) !== 0;
          let payloadLen = secondByte & 0x7f;
          let offset = 2;

          if (payloadLen === 126) {
            if (buffer.length < 4) return;
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (buffer.length < 10) return;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }

          const maskOffset = offset;
          if (isMasked) {
            offset += 4;
          }

          if (buffer.length < offset + payloadLen) {
            return; // Wait for full frame
          }

          const payload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
          if (isMasked) {
            const mask = buffer.subarray(maskOffset, maskOffset + 4);
            for (let i = 0; i < payload.length; i++) {
              payload[i] ^= mask[i & 3];
            }
          }

          buffer = buffer.subarray(offset + payloadLen);

          if (opcode === 0x08) {
            // Close frame
            cleanup();
            socket.end();
            return;
          } else if (opcode === 0x09) {
            // Ping -> Pong
            if (socket.writable) {
              const pong = Buffer.alloc(2 + payload.length);
              pong[0] = 0x8a;
              pong[1] = payload.length;
              payload.copy(pong, 2);
              socket.write(pong);
            }
          } else if (opcode === 0x01) {
            // Text frame
            const text = payload.toString('utf8');
            handleMessage(client, text);
          }
        }
      };

      if (buffer.length > 0) {
        processBuffer();
      }

      socket.on('data', (chunk: Buffer) => {
        buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
        processBuffer();
      });

      const cleanup = () => {
        if (!client.isAlive) return;
        client.isAlive = false;
        leaveCurrentRoom(client, true);
        clients.delete(clientId);
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);
      socket.on('end', cleanup);
    });
  }

  return {
    name: 'vegi-knights-multiplayer-signaling',
    configureServer(server) {
      attachUpgradeHandler(server.httpServer);
    },
    configurePreviewServer(server) {
      attachUpgradeHandler(server.httpServer);
    }
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: true
  },
  plugins: [createMultiplayerSignalingPlugin()]
});
