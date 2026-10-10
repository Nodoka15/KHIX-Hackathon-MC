import { Target } from './game';

export type PlayerRole = 'host' | 'guest';

export interface SwordPose {
  x: number;
  y: number;
  angle: number;
}

export interface InterpolatedSword extends SwordPose {
  targetX: number;
  targetY: number;
  targetAngle: number;
  vx: number;
  vy: number;
  lastUpdate: number;
}

export interface SliceEventPayload {
  targetId: number;
  cutAngle: number;
  nearestX: number;
  nearestY: number;
  slicerRole: PlayerRole;
  isBomb?: boolean;
  points?: number;
  slicerScore?: number;
  slicerLives?: number;
  hostScore?: number;
  hostLives?: number;
  guestScore?: number;
  guestLives?: number;
}

export interface ScoreSyncPayload {
  hostScore: number;
  hostLives: number;
  guestScore: number;
  guestLives: number;
  timeRemainingMs: number;
  targets?: Target[];
}

export interface MatchOverPayload {
  winner: PlayerRole | 'draw';
  reason: 'timeout' | 'knockout';
  hostScore: number;
  hostLives: number;
  guestScore: number;
  guestLives: number;
}

export interface PeerSyncState {
  matchId: number;
  score: number;
  lives: number;
  matchOver: MatchOverPayload | null;
  rematchReady: boolean;
}

export interface MultiplayerCallbacks {
  onSearching: () => void;
  onMatchFound: (role: PlayerRole, countdownMs: number) => void;
  onPeerLeft: () => void;
  onSpawnTarget: (target: Target) => void;
  onSliceTarget: (payload: SliceEventPayload) => void;
  onScoreSync: (payload: ScoreSyncPayload) => void;
  onMatchOver: (payload: MatchOverPayload) => void;
  onPeerSyncState: (sync: PeerSyncState) => void;
  onRematchVote: (matchId: number) => void;
  onRematchStart: (nextMatchId: number, countdownMs: number) => void;
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

function randomId(prefix = ''): string {
  return prefix + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
}

/**
 * Single MQTT over WebSockets broker connection that always reconnects to its own URL
 * so two players never drift onto separate brokers on reconnect.
 */
class MqttSingleBroker {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private packetId = 1;
  private rxBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(
    private url: string,
    private clientId: string,
    private subscriptions: Set<string>,
    private onMessage: (topic: string, payload: string) => void
  ) {}

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.cleanupSocket();

    try {
      const ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        this.sendConnectPacket();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleBinaryChunk(new Uint8Array(event.data));
        }
      };

      ws.onerror = () => {
        // Handled in onclose
      };

      ws.onclose = () => {
        this.isConnected = false;
        this.stopPing();
        if (this.reconnectTimer === null) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 900);
        }
      };
    } catch {
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, 1200);
      }
    }
  }

  public subscribe(topic: string): void {
    if (this.isConnected) {
      this.sendSubscribePacket(topic);
    }
  }

  public publish(topic: string, text: string): boolean {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const topicBytes = this.encodeMqttString(topic);
      const payloadBytes = new TextEncoder().encode(text);
      const remLen = this.encodeVarLen(topicBytes.length + payloadBytes.length);

      const frame = new Uint8Array(1 + remLen.length + topicBytes.length + payloadBytes.length);
      frame[0] = 0x30; // PUBLISH QoS 0
      frame.set(remLen, 1);
      frame.set(topicBytes, 1 + remLen.length);
      frame.set(payloadBytes, 1 + remLen.length + topicBytes.length);

      this.ws.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  private sendConnectPacket(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const varHeader = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x2d]);
    const payload = this.encodeMqttString(this.clientId);
    const remLen = this.encodeVarLen(varHeader.length + payload.length);

    const pkt = new Uint8Array(1 + remLen.length + varHeader.length + payload.length);
    pkt[0] = 0x10; // CONNECT
    pkt.set(remLen, 1);
    pkt.set(varHeader, 1 + remLen.length);
    pkt.set(payload, 1 + remLen.length + varHeader.length);
    this.ws.send(pkt);
  }

  private sendSubscribePacket(topic: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = (this.packetId++ & 0x7fff) || 1;
    const topicBytes = this.encodeMqttString(topic);
    const remLen = this.encodeVarLen(2 + topicBytes.length + 1);

    const pkt = new Uint8Array(1 + remLen.length + 2 + topicBytes.length + 1);
    let offset = 0;
    pkt[offset++] = 0x82; // SUBSCRIBE
    pkt.set(remLen, offset);
    offset += remLen.length;
    pkt[offset++] = (id >> 8) & 0xff;
    pkt[offset++] = id & 0xff;
    pkt.set(topicBytes, offset);
    offset += topicBytes.length;
    pkt[offset] = 0x00; // QoS 0
    this.ws.send(pkt);
  }

  private handleBinaryChunk(chunk: Uint8Array): void {
    if (this.rxBuffer.length === 0) {
      this.rxBuffer = chunk;
    } else {
      const merged = new Uint8Array(this.rxBuffer.length + chunk.length);
      merged.set(this.rxBuffer, 0);
      merged.set(chunk, this.rxBuffer.length);
      this.rxBuffer = merged;
    }

    while (this.rxBuffer.length >= 2) {
      const firstByte = this.rxBuffer[0];
      const pktType = firstByte & 0xf0;

      let multiplier = 1;
      let remLength = 0;
      let offset = 1;
      let encodedByte = 0;
      do {
        if (offset >= this.rxBuffer.length) {
          return;
        }
        encodedByte = this.rxBuffer[offset++];
        remLength += (encodedByte & 127) * multiplier;
        multiplier *= 128;
      } while ((encodedByte & 128) !== 0);

      const packetEnd = offset + remLength;
      if (this.rxBuffer.length < packetEnd) {
        return;
      }

      if (pktType === 0x20) {
        this.isConnected = true;
        this.startPing();
        for (const sub of this.subscriptions) {
          this.sendSubscribePacket(sub);
        }
      } else if (pktType === 0x30) {
        const topicLen = (this.rxBuffer[offset] << 8) | this.rxBuffer[offset + 1];
        let payloadOffset = offset + 2 + topicLen;
        const qos = (firstByte >> 1) & 0x03;
        if (qos > 0) {
          payloadOffset += 2;
        }
        if (payloadOffset <= packetEnd) {
          const topic = new TextDecoder().decode(this.rxBuffer.subarray(offset + 2, offset + 2 + topicLen));
          const text = new TextDecoder().decode(this.rxBuffer.subarray(payloadOffset, packetEnd));
          this.onMessage(topic, text);
        }
      }

      this.rxBuffer = this.rxBuffer.subarray(packetEnd);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
      }
    }, 18000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanupSocket(): void {
    this.stopPing();
    this.isConnected = false;
    this.rxBuffer = new Uint8Array(0);
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private encodeVarLen(len: number): number[] {
    const out: number[] = [];
    do {
      let byte = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) byte |= 128;
      out.push(byte);
    } while (len > 0);
    return out;
  }

  private encodeMqttString(str: string): Uint8Array {
    const utf8 = new TextEncoder().encode(str);
    const out = new Uint8Array(2 + utf8.length);
    out[0] = (utf8.length >> 8) & 0xff;
    out[1] = utf8.length & 0xff;
    out.set(utf8, 2);
    return out;
  }
}

/**
 * Redundant multi-broker MQTT client that stays simultaneously connected to the
 * primary and backup brokers so players never get split across different brokers.
 */
class MqttWsClient {
  private subscriptions = new Set<string>();
  private brokers: MqttSingleBroker[];

  constructor(
    clientId: string,
    onMessage: (topic: string, payload: string) => void
  ) {
    const urls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];
    this.brokers = urls.map(
      (url, i) => new MqttSingleBroker(url, `${clientId}_${i}`, this.subscriptions, onMessage)
    );
  }

  public connect(): void {
    for (const b of this.brokers) {
      b.connect();
    }
  }

  public subscribe(topic: string): void {
    this.subscriptions.add(topic);
    for (const b of this.brokers) {
      b.subscribe(topic);
    }
  }

  public unsubscribe(topic: string): void {
    this.subscriptions.delete(topic);
  }

  public publish(topic: string, text: string): boolean {
    let anySent = false;
    for (const b of this.brokers) {
      if (b.publish(topic, text)) {
        anySent = true;
      }
    }
    return anySent;
  }
}

const TOPIC_PREFIX = 'vegi-knights-ucf-v2';
const MATCHMAKING_TOPIC = `${TOPIC_PREFIX}/matchmaking`;

export class MultiplayerClient {
  private clientId = randomId('vk_');
  private mqtt: MqttWsClient;
  private localWs: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  private pc: RTCPeerConnection | null = null;
  private fastChannel: RTCDataChannel | null = null;
  private reliableChannel: RTCDataChannel | null = null;
  private offerRetryTimer: number | null = null;
  private remoteDescSet = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  public role: PlayerRole = 'host';
  public inRoom = false;
  public isSearching = false;

  private currentRoomId: string | null = null;
  private partnerId: string | null = null;
  private lastPartnerId: string | null = null;
  private lastSkipTime = 0;

  private seekTimer: number | null = null;

  private seenMsgIds = new Set<string>();
  private seenMsgQueue: string[] = [];

  // Smoothly interpolated opponent swords (up to 4 finger cursors)
  public remoteSwords: InterpolatedSword[] = [];
  public remoteSlashTrails: { x: number; y: number; age: number }[][] = [[], [], [], []];

  private lastSwordSendTime = 0;

  constructor(private callbacks: MultiplayerCallbacks) {
    // 1. Global Cross-Network Cloud Brokers (MQTT over WSS)
    this.mqtt = new MqttWsClient(this.clientId, (topic, payload) => {
      this.onTransportPayload(topic, payload);
    });

    // 2. Same-Browser BroadcastChannel Fallback
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(TOPIC_PREFIX);
        this.broadcastChannel.onmessage = (ev: MessageEvent) => {
          if (ev.data && typeof ev.data.topic === 'string' && typeof ev.data.payload === 'string') {
            this.onTransportPayload(ev.data.topic, ev.data.payload);
          }
        };
      } catch {}
    }
  }

  private ensureTransportsConnected(): void {
    this.mqtt.connect();
    this.mqtt.subscribe(MATCHMAKING_TOPIC);
    this.mqtt.subscribe(`${TOPIC_PREFIX}/inbox/${this.clientId}`);

    if (!this.localWs || this.localWs.readyState === WebSocket.CLOSED || this.localWs.readyState === WebSocket.CLOSING) {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws-multiplayer`);
        this.localWs = ws;
        ws.onmessage = (event: MessageEvent) => {
          try {
            const parsed = JSON.parse(event.data as string);
            if (parsed.type === 'pubsub' && typeof parsed.topic === 'string' && typeof parsed.payload === 'string') {
              this.onTransportPayload(parsed.topic, parsed.payload);
            }
          } catch {}
        };
      } catch {}
    }
  }

  private markMessageSeen(msgId: string): boolean {
    if (this.seenMsgIds.has(msgId)) return false;
    this.seenMsgIds.add(msgId);
    this.seenMsgQueue.push(msgId);
    if (this.seenMsgQueue.length > 800) {
      const oldest = this.seenMsgQueue.shift();
      if (oldest) this.seenMsgIds.delete(oldest);
    }
    return true;
  }

  private publishRawToTopic(topic: string, serialized: string): void {
    this.mqtt.publish(topic, serialized);

    if (this.localWs && this.localWs.readyState === WebSocket.OPEN) {
      try {
        this.localWs.send(JSON.stringify({ type: 'pubsub', topic, payload: serialized }));
      } catch {}
    }

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ topic, payload: serialized });
      } catch {}
    }
  }

  private publishToTopic(topic: string, data: Record<string, unknown>, customMid?: string): void {
    const envelope = {
      ...data,
      _sid: this.clientId,
      _mid: customMid || randomId('m_')
    };
    const serialized = JSON.stringify(envelope);
    this.publishRawToTopic(topic, serialized);
  }

  private publishToRoom(data: Record<string, unknown>, customMid?: string): void {
    if (!this.currentRoomId && !this.partnerId) return;
    const mid = customMid || randomId('m_');
    const envelope = {
      ...data,
      _sid: this.clientId,
      _mid: mid
    };
    const serialized = JSON.stringify(envelope);

    // Send directly to partner's already-subscribed personal inbox AND room topic
    if (this.partnerId) {
      this.publishRawToTopic(`${TOPIC_PREFIX}/inbox/${this.partnerId}`, serialized);
    }
    if (this.currentRoomId) {
      this.publishRawToTopic(`${TOPIC_PREFIX}/room/${this.currentRoomId}`, serialized);
    }
  }

  private sendReliableEvent(data: Record<string, unknown>): void {
    const mid = randomId('m_');
    const envelope = {
      ...data,
      _sid: this.clientId,
      _mid: mid
    };
    const serialized = JSON.stringify(envelope);

    if (this.reliableChannel && this.reliableChannel.readyState === 'open') {
      try {
        this.reliableChannel.send(serialized);
      } catch {}
    }
    if (this.fastChannel && this.fastChannel.readyState === 'open') {
      try {
        this.fastChannel.send(serialized);
      } catch {}
    }
    this.publishToRoom(data, mid);
  }

  private onTransportPayload(topic: string, rawPayload: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawPayload);
    } catch {
      return;
    }

    const senderId = msg._sid as string | undefined;
    const msgId = msg._mid as string | undefined;

    if (!senderId || senderId === this.clientId) return;

    // Allow sword_state through without _mid dedup overhead, deduplicate all other messages
    if (msg.type !== 'sword_state' && msgId && !this.markMessageSeen(msgId)) {
      return;
    }

    const isInbox = topic === `${TOPIC_PREFIX}/inbox/${this.clientId}`;
    const isMatchmaking = topic === MATCHMAKING_TOPIC;
    const isCurrentRoom = this.currentRoomId !== null && topic === `${TOPIC_PREFIX}/room/${this.currentRoomId}`;

    if (!isInbox && !isMatchmaking && !isCurrentRoom) return;

    this.handleProtocolMessage(senderId, msg);
  }

  public connectAndFindMatch(): void {
    this.notifyLeaveIfInRoom();
    this.cleanupPeerConnection();

    this.isSearching = true;
    this.inRoom = false;
    this.currentRoomId = null;
    this.partnerId = null;
    this.remoteSwords = [];
    this.remoteSlashTrails = [[], [], [], []];

    this.ensureTransportsConnected();
    this.callbacks.onSearching();
    this.startMatchmakingBeacons();
  }

  public nextOpponent(): void {
    this.lastSkipTime = Date.now();
    this.connectAndFindMatch();
  }

  public disconnect(): void {
    this.isSearching = false;
    this.stopMatchmakingBeacons();
    this.notifyLeaveIfInRoom();
    this.inRoom = false;
    this.currentRoomId = null;
    this.partnerId = null;
    this.remoteSwords = [];
    this.remoteSlashTrails = [[], [], [], []];
    this.cleanupPeerConnection();
  }

  private notifyLeaveIfInRoom(): void {
    if (this.inRoom && (this.currentRoomId || this.partnerId)) {
      this.publishToRoom({ type: 'peer_left' });
      this.lastPartnerId = this.partnerId;
      if (this.currentRoomId) {
        this.mqtt.unsubscribe(`${TOPIC_PREFIX}/room/${this.currentRoomId}`);
      }
    }
  }

  private startMatchmakingBeacons(): void {
    this.stopMatchmakingBeacons();
    const broadcastSeek = () => {
      if (!this.isSearching || this.inRoom) return;
      this.publishToTopic(MATCHMAKING_TOPIC, {
        type: 'seek_match',
        ts: Date.now()
      });
    };
    broadcastSeek();
    this.seekTimer = window.setInterval(broadcastSeek, 600);
  }

  private stopMatchmakingBeacons(): void {
    if (this.seekTimer !== null) {
      clearInterval(this.seekTimer);
      this.seekTimer = null;
    }
  }

  private async handleProtocolMessage(senderId: string, msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'seek_match': {
        if (!this.isSearching || this.inRoom) return;

        if (senderId === this.lastPartnerId && Date.now() - this.lastSkipTime < 3500) {
          return;
        }

        if (this.clientId < senderId) {
          const roomId = randomId('room_');
          this.publishToTopic(`${TOPIC_PREFIX}/inbox/${senderId}`, {
            type: 'match_proposal',
            roomId,
            hostId: this.clientId,
            guestId: senderId
          });
        }
        break;
      }

      case 'match_proposal': {
        if (!this.isSearching || this.inRoom) return;
        const roomId = msg.roomId as string;
        const hostId = msg.hostId as string;
        if (!roomId || !hostId) return;

        const countdownMs = 3000;
        this.enterMatchedRoom(roomId, 'guest', hostId, countdownMs);

        this.publishToTopic(`${TOPIC_PREFIX}/inbox/${hostId}`, {
          type: 'match_confirm',
          roomId,
          hostId,
          guestId: this.clientId,
          countdownMs
        });
        break;
      }

      case 'match_confirm': {
        if (!this.isSearching || this.inRoom) return;
        const roomId = msg.roomId as string;
        const guestId = msg.guestId as string;
        const countdownMs = (msg.countdownMs as number) || 3000;
        if (!roomId || !guestId) return;

        this.enterMatchedRoom(roomId, 'host', guestId, countdownMs);
        break;
      }

      case 'peer_left': {
        if (!this.inRoom || senderId !== this.partnerId) return;
        this.lastPartnerId = this.partnerId;
        if (this.currentRoomId) {
          this.mqtt.unsubscribe(`${TOPIC_PREFIX}/room/${this.currentRoomId}`);
        }
        this.inRoom = false;
        this.currentRoomId = null;
        this.partnerId = null;
        this.remoteSwords = [];
        this.remoteSlashTrails = [[], [], [], []];
        this.cleanupPeerConnection();
        this.callbacks.onPeerLeft();
        break;
      }

      case 'webrtc_offer': {
        if (!this.inRoom) return;
        if (!this.pc) {
          await this.setupPeerConnection(false);
        }
        if (this.pc && msg.sdp) {
          try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
            this.remoteDescSet = true;
            await this.flushPendingIceCandidates();
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.publishToRoom({ type: 'webrtc_answer', sdp: this.pc.localDescription });
          } catch {}
        }
        break;
      }

      case 'webrtc_answer': {
        if (!this.inRoom || !this.pc || !msg.sdp) return;
        try {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          this.remoteDescSet = true;
          await this.flushPendingIceCandidates();
        } catch {}
        break;
      }

      case 'webrtc_ice': {
        if (!this.inRoom || !msg.candidate) return;
        const candidateInit = msg.candidate as RTCIceCandidateInit;
        if (this.pc && this.remoteDescSet) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
          } catch {}
        } else {
          this.pendingCandidates.push(candidateInit);
        }
        break;
      }

      case 'sword_state': {
        this.receiveRemoteSwords((msg.swords as SwordPose[]) || []);
        if (msg.sync) {
          this.callbacks.onPeerSyncState(msg.sync as PeerSyncState);
        }
        break;
      }

      case 'spawn_target': {
        if (msg.target) {
          this.callbacks.onSpawnTarget(msg.target as Target);
        }
        break;
      }

      case 'slice_target': {
        if (msg.payload) {
          this.callbacks.onSliceTarget(msg.payload as SliceEventPayload);
        }
        break;
      }

      case 'score_sync': {
        if (msg.payload) {
          this.callbacks.onScoreSync(msg.payload as ScoreSyncPayload);
        }
        break;
      }

      case 'match_over': {
        if (msg.payload) {
          this.callbacks.onMatchOver(msg.payload as MatchOverPayload);
        }
        break;
      }

      case 'rematch_vote': {
        const matchId = typeof msg.matchId === 'number' ? msg.matchId : 0;
        this.callbacks.onRematchVote(matchId);
        break;
      }

      case 'rematch_start': {
        const nextMatchId = typeof msg.nextMatchId === 'number' ? msg.nextMatchId : 0;
        const countdownMs = (msg.countdownMs as number) || 3000;
        this.callbacks.onRematchStart(nextMatchId, countdownMs);
        break;
      }
    }
  }

  private enterMatchedRoom(roomId: string, role: PlayerRole, partnerId: string, countdownMs: number): void {
    this.isSearching = false;
    this.stopMatchmakingBeacons();
    this.inRoom = true;
    this.role = role;
    this.currentRoomId = roomId;
    this.partnerId = partnerId;
    this.remoteSwords = [];
    this.remoteSlashTrails = [[], [], [], []];

    this.mqtt.subscribe(`${TOPIC_PREFIX}/room/${roomId}`);
    this.setupPeerConnection(role === 'host');
    this.callbacks.onMatchFound(role, countdownMs);
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc || !this.remoteDescSet) return;
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      if (cand) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      }
    }
  }

  private async setupPeerConnection(isInitiator: boolean): Promise<void> {
    this.cleanupPeerConnection();

    const pc = new RTCPeerConnection({
      iceCandidatePoolSize: 8,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        {
          urls: [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443',
            'turn:openrelay.metered.ca:443?transport=tcp'
          ],
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });
    this.pc = pc;
    this.remoteDescSet = false;

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.publishToRoom({ type: 'webrtc_ice', candidate: event.candidate.toJSON() });
      }
    };

    if (isInitiator) {
      const fastDc = pc.createDataChannel('vegi-fast-sync', {
        ordered: false,
        maxRetransmits: 0
      });
      this.attachDataChannel(fastDc);

      const reliableDc = pc.createDataChannel('vegi-reliable-sync', {
        ordered: true
      });
      this.attachDataChannel(reliableDc);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.publishToRoom({ type: 'webrtc_offer', sdp: pc.localDescription });

        this.offerRetryTimer = window.setTimeout(() => {
          if (this.inRoom && this.pc === pc && !this.remoteDescSet && pc.localDescription) {
            this.publishToRoom({ type: 'webrtc_offer', sdp: pc.localDescription });
          }
        }, 1400);
      } catch {}
    } else {
      pc.ondatachannel = (event: RTCDataChannelEvent) => {
        this.attachDataChannel(event.channel);
      };
    }
  }

  private attachDataChannel(dc: RTCDataChannel): void {
    if (dc.label === 'vegi-reliable-sync') {
      this.reliableChannel = dc;
    } else {
      this.fastChannel = dc;
    }
    dc.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === 'sword_state') {
          this.receiveRemoteSwords((msg.swords as SwordPose[]) || []);
          if (msg.sync) {
            this.callbacks.onPeerSyncState(msg.sync as PeerSyncState);
          }
          return;
        }
        const msgId = msg._mid as string | undefined;
        if (msgId && !this.markMessageSeen(msgId)) {
          return;
        }
        const senderId = (msg._sid as string) || this.partnerId || 'peer';
        this.handleProtocolMessage(senderId, msg);
      } catch {}
    };
  }

  private cleanupPeerConnection(): void {
    if (this.offerRetryTimer !== null) {
      clearTimeout(this.offerRetryTimer);
      this.offerRetryTimer = null;
    }
    this.remoteDescSet = false;
    this.pendingCandidates = [];
    if (this.fastChannel) {
      try {
        this.fastChannel.close();
      } catch {}
      this.fastChannel = null;
    }
    if (this.reliableChannel) {
      try {
        this.reliableChannel.close();
      } catch {}
      this.reliableChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
  }

  public sendSwordState(swords: SwordPose[], now: number, sync: PeerSyncState): void {
    if (!this.inRoom) return;

    const p2pOpen = Boolean(this.fastChannel && this.fastChannel.readyState === 'open');
    // 60Hz (16ms) over direct P2P WebRTC DataChannel; 22Hz (45ms) fallback over MQTT
    const minInterval = p2pOpen ? 16 : 45;
    if (now - this.lastSwordSendTime < minInterval) return;
    this.lastSwordSendTime = now;

    const compactSwords = swords.map(s => ({
      x: Math.round(s.x * 10) / 10,
      y: Math.round(s.y * 10) / 10,
      angle: Math.round(s.angle * 1000) / 1000
    }));

    const packet = { type: 'sword_state', swords: compactSwords, sync };
    if (p2pOpen && this.fastChannel) {
      try {
        this.fastChannel.send(JSON.stringify(packet));
        return;
      } catch {}
    }
    this.publishToRoom(packet);
  }

  public sendSpawnTarget(target: Target): void {
    if (!this.inRoom) return;
    this.sendReliableEvent({ type: 'spawn_target', target });
  }

  public sendSliceTarget(payload: SliceEventPayload): void {
    if (!this.inRoom) return;
    this.sendReliableEvent({ type: 'slice_target', payload });
  }

  public sendScoreSync(payload: ScoreSyncPayload): void {
    if (!this.inRoom) return;
    const mid = randomId('m_');
    const packet = { type: 'score_sync', payload, _sid: this.clientId, _mid: mid };
    if (this.reliableChannel && this.reliableChannel.readyState === 'open') {
      try {
        this.reliableChannel.send(JSON.stringify(packet));
        return;
      } catch {}
    }
    this.publishToRoom({ type: 'score_sync', payload }, mid);
  }

  public sendMatchOver(payload: MatchOverPayload): void {
    if (!this.inRoom) return;
    this.sendReliableEvent({ type: 'match_over', payload });
    for (const delay of [150, 400, 900]) {
      window.setTimeout(() => {
        if (this.inRoom) {
          this.sendReliableEvent({ type: 'match_over', payload });
        }
      }, delay);
    }
  }

  public sendRematchVote(matchId: number): void {
    if (!this.inRoom) return;
    this.sendReliableEvent({ type: 'rematch_vote', matchId });
    window.setTimeout(() => {
      if (this.inRoom) {
        this.sendReliableEvent({ type: 'rematch_vote', matchId });
      }
    }, 180);
  }

  public sendRematchStart(nextMatchId: number, countdownMs = 3000): void {
    if (!this.inRoom) return;
    this.sendReliableEvent({ type: 'rematch_start', nextMatchId, countdownMs });
    for (const delay of [150, 380]) {
      window.setTimeout(() => {
        if (this.inRoom) {
          this.sendReliableEvent({ type: 'rematch_start', nextMatchId, countdownMs });
        }
      }, delay);
    }
  }

  private receiveRemoteSwords(swords: SwordPose[]): void {
    const now = performance.now();

    if (swords.length === 0) {
      this.remoteSwords = [];
      return;
    }

    if (this.remoteSwords.length > swords.length) {
      this.remoteSwords.length = swords.length;
    }

    for (let i = 0; i < swords.length; i++) {
      const incoming = swords[i];
      const existing = this.remoteSwords[i];

      if (!existing) {
        this.remoteSwords[i] = {
          x: incoming.x,
          y: incoming.y,
          angle: incoming.angle,
          targetX: incoming.x,
          targetY: incoming.y,
          targetAngle: incoming.angle,
          vx: 0,
          vy: 0,
          lastUpdate: now
        };
      } else {
        const dt = Math.max(0.008, (now - existing.lastUpdate) / 1000);
        existing.vx = (incoming.x - existing.targetX) / dt;
        existing.vy = (incoming.y - existing.targetY) / dt;
        existing.targetX = incoming.x;
        existing.targetY = incoming.y;
        existing.targetAngle = incoming.angle;
        existing.lastUpdate = now;
      }
    }
  }

  public updateRemoteInterpolation(dt: number, now: number): InterpolatedSword[] {
    if (this.remoteSwords.length > 0 && now - this.remoteSwords[0].lastUpdate > 650) {
      this.remoteSwords = [];
    }

    const blend = 1 - Math.exp(-32 * Math.min(dt, 0.05));

    for (let idx = 0; idx < this.remoteSwords.length; idx++) {
      const sword = this.remoteSwords[idx];
      const ageSec = Math.min(0.028, Math.max(0, (now - sword.lastUpdate) / 1000));
      const predictedX = sword.targetX + sword.vx * ageSec * 0.35;
      const predictedY = sword.targetY + sword.vy * ageSec * 0.35;

      sword.x += (predictedX - sword.x) * blend;
      sword.y += (predictedY - sword.y) * blend;
      sword.angle = lerpAngle(sword.angle, sword.targetAngle, blend);

      if (!this.remoteSlashTrails[idx]) {
        this.remoteSlashTrails[idx] = [];
      }
      this.remoteSlashTrails[idx].push({
        x: sword.x,
        y: sword.y,
        age: 1.0
      });
    }

    for (const trail of this.remoteSlashTrails) {
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].age -= 0.08 * (dt * 60);
        if (trail[i].age <= 0) {
          trail.splice(i, 1);
        }
      }
    }

    return this.remoteSwords;
  }
}
