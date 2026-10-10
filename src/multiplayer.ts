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
}

export interface MatchOverPayload {
  winner: PlayerRole | 'draw';
  reason: 'timeout' | 'knockout';
  hostScore: number;
  hostLives: number;
  guestScore: number;
  guestLives: number;
}

export interface MultiplayerCallbacks {
  onSearching: () => void;
  onMatchFound: (role: PlayerRole, matchStartTime: number) => void;
  onPeerLeft: () => void;
  onRemoteStream: (stream: MediaStream) => void;
  onSpawnTarget: (target: Target) => void;
  onSliceTarget: (payload: SliceEventPayload) => void;
  onScoreSync: (payload: ScoreSyncPayload) => void;
  onMatchOver: (payload: MatchOverPayload) => void;
  onRematchStart: (matchStartTime: number) => void;
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private fastChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  public role: PlayerRole = 'host';
  public inRoom = false;
  public isSearching = false;
  public isMicMuted = false;

  // Smoothly interpolated opponent swords (up to 2 hands)
  public remoteSwords: InterpolatedSword[] = [];
  public remoteSlashTrail: { x: number; y: number; age: number }[] = [];

  // Voice activity levels (0 to 1)
  public localVoiceLevel = 0;
  public remoteVoiceLevel = 0;

  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private voiceDataArray = new Uint8Array(64);
  private lastSwordSendTime = 0;

  constructor(private callbacks: MultiplayerCallbacks) {}

  public setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    this.setupLocalAudioAnalyser(stream);
  }

  public toggleMute(): boolean {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.isMicMuted;
      }
    }
    return this.isMicMuted;
  }

  private ensureAudioContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  private setupLocalAudioAnalyser(stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) return;
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      this.localAnalyser = analyser;
    } catch {
      // Ignore audio analyser failures
    }
  }

  private setupRemoteAudioAnalyser(stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) return;
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      this.remoteAnalyser = analyser;
    } catch {
      // Ignore audio analyser failures
    }
  }

  public updateVoiceLevels(): void {
    if (this.localAnalyser && !this.isMicMuted) {
      this.localAnalyser.getByteFrequencyData(this.voiceDataArray);
      let sum = 0;
      for (let i = 0; i < this.voiceDataArray.length; i++) {
        sum += this.voiceDataArray[i];
      }
      this.localVoiceLevel = Math.min(1, sum / (this.voiceDataArray.length * 95));
    } else {
      this.localVoiceLevel = 0;
    }

    if (this.remoteAnalyser && this.inRoom) {
      this.remoteAnalyser.getByteFrequencyData(this.voiceDataArray);
      let sum = 0;
      for (let i = 0; i < this.voiceDataArray.length; i++) {
        sum += this.voiceDataArray[i];
      }
      this.remoteVoiceLevel = Math.min(1, sum / (this.voiceDataArray.length * 95));
    } else {
      this.remoteVoiceLevel = 0;
    }
  }

  public connectAndFindMatch(): void {
    this.ensureAudioContext();
    this.isSearching = true;
    this.inRoom = false;
    this.remoteSwords = [];
    this.remoteSlashTrail = [];

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignal({ type: 'find_match' });
      return;
    }

    if (this.ws) {
      this.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws-multiplayer`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      if (this.isSearching) {
        this.sendSignal({ type: 'find_match' });
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        this.handleSignalMessage(msg);
      } catch {
        // Ignore malformed packets
      }
    };

    this.ws.onclose = () => {
      if (this.inRoom || this.isSearching) {
        this.cleanupPeerConnection();
      }
    };
  }

  public nextOpponent(): void {
    this.cleanupPeerConnection();
    this.isSearching = true;
    this.inRoom = false;
    this.remoteSwords = [];
    this.remoteSlashTrail = [];
    this.callbacks.onSearching();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignal({ type: 'next_match' });
    } else {
      this.connectAndFindMatch();
    }
  }

  public disconnect(): void {
    this.isSearching = false;
    this.inRoom = false;
    this.remoteSwords = [];
    this.remoteSlashTrail = [];
    this.cleanupPeerConnection();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSignal({ type: 'leave_match' });
    }
  }

  private sendSignal(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private async handleSignalMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'searching': {
        this.isSearching = true;
        this.inRoom = false;
        this.callbacks.onSearching();
        break;
      }

      case 'match_found': {
        this.isSearching = false;
        this.inRoom = true;
        this.role = (msg.role as PlayerRole) || 'host';
        this.remoteSwords = [];
        this.remoteSlashTrail = [];

        const matchStartTime = (msg.matchStartTime as number) || Date.now() + 3000;
        await this.setupPeerConnection(this.role === 'host');
        this.callbacks.onMatchFound(this.role, matchStartTime);
        break;
      }

      case 'peer_left': {
        this.inRoom = false;
        this.remoteSwords = [];
        this.remoteSlashTrail = [];
        this.cleanupPeerConnection();
        this.callbacks.onPeerLeft();
        break;
      }

      case 'webrtc_offer': {
        if (!this.pc) {
          await this.setupPeerConnection(false);
        }
        if (this.pc && msg.sdp) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.sendSignal({ type: 'webrtc_answer', sdp: this.pc.localDescription });
        }
        break;
      }

      case 'webrtc_answer': {
        if (this.pc && msg.sdp) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        }
        break;
      }

      case 'webrtc_ice': {
        if (this.pc && msg.candidate) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
          } catch {
            // Ignore benign ICE candidate race errors
          }
        }
        break;
      }

      case 'sword_state': {
        this.receiveRemoteSwords((msg.swords as SwordPose[]) || []);
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

      case 'rematch_ready': {
        const matchStartTime = (msg.matchStartTime as number) || Date.now() + 3000;
        this.callbacks.onRematchStart(matchStartTime);
        break;
      }
    }
  }

  private async setupPeerConnection(isInitiator: boolean): Promise<void> {
    this.cleanupPeerConnection();

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    this.pc = pc;

    // Attach local camera + microphone tracks for live video & voice call
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.ontrack = (event: RTCTrackEvent) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }
      this.setupRemoteAudioAnalyser(this.remoteStream);
      this.callbacks.onRemoteStream(this.remoteStream);
    };

    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.sendSignal({ type: 'webrtc_ice', candidate: event.candidate.toJSON() });
      }
    };

    if (isInitiator) {
      // Unordered, zero-retransmit channel for ultra-low-latency 60fps sword movement
      const dc = pc.createDataChannel('vegi-fast-sync', {
        ordered: false,
        maxRetransmits: 0
      });
      this.attachDataChannel(dc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({ type: 'webrtc_offer', sdp: pc.localDescription });
    } else {
      pc.ondatachannel = (event: RTCDataChannelEvent) => {
        this.attachDataChannel(event.channel);
      };
    }
  }

  private attachDataChannel(dc: RTCDataChannel): void {
    this.fastChannel = dc;
    dc.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'sword_state') {
          this.receiveRemoteSwords(msg.swords || []);
        }
      } catch {
        // Ignore parse error
      }
    };
  }

  private cleanupPeerConnection(): void {
    if (this.fastChannel) {
      try {
        this.fastChannel.close();
      } catch {}
      this.fastChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.remoteStream = null;
    this.remoteAnalyser = null;
  }

  public sendSwordState(swords: SwordPose[], now: number): void {
    if (!this.inRoom) return;
    // Send at ~60fps (every 15ms)
    if (now - this.lastSwordSendTime < 15) return;
    this.lastSwordSendTime = now;

    // Round numbers slightly to keep packet tiny and fast
    const compactSwords = swords.map(s => ({
      x: Math.round(s.x * 10) / 10,
      y: Math.round(s.y * 10) / 10,
      angle: Math.round(s.angle * 1000) / 1000
    }));

    const packet = { type: 'sword_state', swords: compactSwords };
    if (this.fastChannel && this.fastChannel.readyState === 'open') {
      try {
        this.fastChannel.send(JSON.stringify(packet));
        return;
      } catch {
        // Fallback to WebSocket
      }
    }
    this.sendSignal(packet);
  }

  public sendSpawnTarget(target: Target): void {
    if (!this.inRoom) return;
    this.sendSignal({ type: 'spawn_target', target });
  }

  public sendSliceTarget(payload: SliceEventPayload): void {
    if (!this.inRoom) return;
    this.sendSignal({ type: 'slice_target', payload });
  }

  public sendScoreSync(payload: ScoreSyncPayload): void {
    if (!this.inRoom) return;
    this.sendSignal({ type: 'score_sync', payload });
  }

  public sendMatchOver(payload: MatchOverPayload): void {
    if (!this.inRoom) return;
    this.sendSignal({ type: 'match_over', payload });
  }

  public sendRematchRequest(): number {
    const matchStartTime = Date.now() + 3200;
    this.sendSignal({ type: 'rematch_ready', matchStartTime });
    return matchStartTime;
  }

  private receiveRemoteSwords(swords: SwordPose[]): void {
    const now = performance.now();

    if (swords.length === 0) {
      this.remoteSwords = [];
      return;
    }

    // Resize array if hand count changed
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
    // Expire stale swords if no packet received for 450ms
    if (this.remoteSwords.length > 0 && now - this.remoteSwords[0].lastUpdate > 450) {
      this.remoteSwords = [];
    }

    // Frame-rate independent exponential smoothing factor (~28Hz responsiveness)
    const blend = 1 - Math.exp(-32 * Math.min(dt, 0.05));

    for (const sword of this.remoteSwords) {
      // Slight dead-reckoning prediction (up to 25ms) for ultra-fluid motion
      const ageSec = Math.min(0.025, Math.max(0, (now - sword.lastUpdate) / 1000));
      const predictedX = sword.targetX + sword.vx * ageSec * 0.35;
      const predictedY = sword.targetY + sword.vy * ageSec * 0.35;

      sword.x += (predictedX - sword.x) * blend;
      sword.y += (predictedY - sword.y) * blend;
      sword.angle = lerpAngle(sword.angle, sword.targetAngle, blend);

      this.remoteSlashTrail.push({
        x: sword.x,
        y: sword.y,
        age: 1.0
      });
    }

    for (let i = this.remoteSlashTrail.length - 1; i >= 0; i--) {
      this.remoteSlashTrail[i].age -= 0.08 * (dt * 60);
      if (this.remoteSlashTrail[i].age <= 0) {
        this.remoteSlashTrail.splice(i, 1);
      }
    }

    return this.remoteSwords;
  }
}

