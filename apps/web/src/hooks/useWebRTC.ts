'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '@/lib/socket';

export interface PeerUser {
  id: string;
  name: string;
  email: string;
  country: string;
}

export interface NetworkStats {
  rttMs: number;
  bitrateKbps: number;
  packetLossPercent: number;
  relayType: string;
  frameRate?: number;
  resolution?: string;
}

// Sophisticated dual-tone audio synthesizer for incoming ringtone and outgoing ringback tone
class RingtoneController {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private ringInterval: NodeJS.Timeout | null = null;

  private initCtx() {
    if (!this.audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  playIncomingRing() {
    if (this.isPlaying) return;
    this.initCtx();
    this.isPlaying = true;

    const playTone = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      try {
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Dual European/Asian ringtone frequencies (440Hz + 480Hz)
        osc1.frequency.setValueAtTime(440, this.audioCtx.currentTime);
        osc2.frequency.setValueAtTime(480, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, this.audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc1.start(this.audioCtx.currentTime);
        osc2.start(this.audioCtx.currentTime);
        osc1.stop(this.audioCtx.currentTime + 1.8);
        osc2.stop(this.audioCtx.currentTime + 1.8);

        // Vibrate mobile device if supported
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([400, 200, 400]);
        }
      } catch (err) {
        console.warn('Ringtone playback error:', err);
      }
    };

    playTone();
    this.ringInterval = setInterval(playTone, 3000);
  }

  playOutgoingRing() {
    if (this.isPlaying) return;
    this.initCtx();
    this.isPlaying = true;

    const playTone = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      try {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // 425Hz standard international ringback tone
        osc.frequency.setValueAtTime(425, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, this.audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 1.2);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(this.audioCtx.currentTime);
        osc.stop(this.audioCtx.currentTime + 1.2);
      } catch (err) {
        console.warn('Ringback playback error:', err);
      }
    };

    playTone();
    this.ringInterval = setInterval(playTone, 3500);
  }

  stop() {
    this.isPlaying = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }
}

const ringtone = new RingtoneController();

// Munge SDP for studio-grade Opus 128kbps with Forward Error Correction (FEC)
function enhanceSdp(sdp: string): string {
  // 1. Boost Opus audio parameters: 128kbps, stereo, in-band FEC for packet loss resilience
  let enhanced = sdp.replace(
    /(a=fmtp:\d+ .*)/g,
    (match) => {
      if (match.includes('opus')) {
        return `${match};minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=1`;
      }
      return match;
    },
  );

  // If no fmtp line for opus yet, add it
  const opusRtpMapRegex = /a=rtpmap:(\d+)\s+opus\/48000\/2/i;
  const match = enhanced.match(opusRtpMapRegex);
  if (match) {
    const pt = match[1];
    const fmtpLine = `a=fmtp:${pt} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=1`;
    if (!enhanced.includes(`a=fmtp:${pt}`)) {
      enhanced = enhanced.replace(
        opusRtpMapRegex,
        `a=rtpmap:${pt} opus/48000/2\r\n${fmtpLine}`,
      );
    }
  }

  return enhanced;
}

export function useWebRTC(currentUser: { id: string; name: string } | null) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<
    'idle' | 'calling' | 'incoming' | 'connected' | 'ended'
  >('idle');
  const [activePeer, setActivePeer] = useState<PeerUser | null>(null);
  const [isVideoCall, setIsVideoCall] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPeerMuted, setIsPeerMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isPeerVideoOff, setIsPeerVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<any>(null);
  const pendingCandidates = useRef<any[]>([]);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevBytesReceivedRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);
  const facingModeRef = useRef<'user' | 'environment'>('user');

  // Fetch optimal ICE configuration (Self-Hosted Coturn + Cloudflare Anycast fallback)
  const fetchIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/proxy/turn/credentials', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.iceServers && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          return data.iceServers;
        }
      }
    } catch (err) {
      console.warn('Failed to fetch turn credentials, using default STUN/TURN fallback:', err);
    }

    return [
      {
        urls: [
          'stun:cn-bd-connect-turn.shahmdmahi.dpdns.org:3478',
          'stun:18.166.1.216:3478',
          'stun:stun.cloudflare.com:3478',
        ],
      },
      {
        urls: [
          'turn:cn-bd-connect-turn.shahmdmahi.dpdns.org:3478?transport=udp',
          'turn:18.166.1.216:3478?transport=udp',
        ],
        username: 'cn-bd-guest',
        credential: 'guest-password',
      },
    ];
  }, []);

  // Acquire local camera and microphone stream with studio quality
  const getMediaStream = useCallback(
    async (video = true): Promise<MediaStream> => {
      if (localStreamRef.current) {
        const hasVideo = localStreamRef.current.getVideoTracks().length > 0;
        if (!video || hasVideo) {
          return localStreamRef.current;
        }
      }

      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 2,
          sampleRate: 48000,
        },
        video: video
          ? {
              facingMode: facingModeRef.current,
              width: { ideal: 1920, max: 1920 },
              height: { ideal: 1080, max: 1080 },
              frameRate: { ideal: 60, max: 60 },
            }
          : false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalStream(stream);
        return stream;
      } catch (err) {
        console.warn('Initial getUserMedia failed, retrying with flexible constraints:', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: video
              ? {
                  facingMode: facingModeRef.current,
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : false,
          });
          localStreamRef.current = fallbackStream;
          setLocalStream(fallbackStream);
          return fallbackStream;
        } catch (fallbackErr) {
          console.error('getUserMedia failed completely:', fallbackErr);
          throw fallbackErr;
        }
      }
    },
    [],
  );

  // Apply maximum bitrates on senders for ultra-crisp video and studio audio
  const tuneSenderParameters = useCallback(async (pc: RTCPeerConnection) => {
    try {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (!sender.track) continue;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate = 3500000; // 3.5 Mbps HD 1080p
          params.encodings[0].networkPriority = 'high';
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = 128000; // 128 kbps CD audio
          params.encodings[0].networkPriority = 'high';
        }
        await sender.setParameters(params).catch(() => {});
      }
    } catch (err) {
      console.warn('Tune sender parameters notice:', err);
    }
  }, []);

  // Setup live connection statistics polling
  const startStatsMonitoring = useCallback((pc: RTCPeerConnection) => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);

    statsIntervalRef.current = setInterval(async () => {
      if (!pc || pc.connectionState !== 'connected') return;

      try {
        const stats = await pc.getStats();
        let rtt = 0;
        let relayType = 'direct';
        let bytesReceived = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let currentTimestamp = 0;
        let frameRate = 0;
        let resolution = '';

        stats.forEach((report) => {
          if (
            report.type === 'candidate-pair' &&
            report.state === 'succeeded' &&
            report.nominated
          ) {
            rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
            const remoteCandidate = stats.get(report.remoteCandidateId);
            const localCandidate = stats.get(report.localCandidateId);
            if (
              remoteCandidate?.candidateType === 'relay' ||
              localCandidate?.candidateType === 'relay'
            ) {
              relayType = 'relay';
            } else if (
              remoteCandidate?.candidateType === 'srflx' ||
              localCandidate?.candidateType === 'srflx'
            ) {
              relayType = 'srflx';
            } else {
              relayType = 'direct';
            }
          }

          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            bytesReceived += report.bytesReceived || 0;
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
            currentTimestamp = report.timestamp;
            if (report.framesPerSecond) frameRate = Math.round(report.framesPerSecond);
            if (report.frameWidth && report.frameHeight) {
              resolution = `${report.frameWidth}x${report.frameHeight}`;
            }
          }
        });

        let bitrate = 0;
        if (prevTimestampRef.current && currentTimestamp > prevTimestampRef.current) {
          const deltaBytes = bytesReceived - prevBytesReceivedRef.current;
          const deltaTime = (currentTimestamp - prevTimestampRef.current) / 1000;
          bitrate = Math.round((deltaBytes * 8) / (deltaTime * 1000));
        }

        prevBytesReceivedRef.current = bytesReceived;
        prevTimestampRef.current = currentTimestamp;

        const totalPackets = packetsLost + packetsReceived;
        const lossPercent =
          totalPackets > 0
            ? Math.round((packetsLost / totalPackets) * 1000) / 10
            : 0;

        setNetworkStats({
          rttMs: rtt,
          bitrateKbps: Math.max(0, bitrate),
          packetLossPercent: lossPercent,
          relayType,
          frameRate,
          resolution,
        });
      } catch (err) {
        console.warn('Error reading WebRTC stats:', err);
      }
    }, 1500);
  }, []);

  // Broadcast control message to peer via DataChannel & WebSocket signaling fallback
  const sendControlMessage = useCallback(
    (msg: { type: 'mute' | 'video_off'; [key: string]: any }) => {
      // 1. Try DataChannel
      if (
        dataChannelRef.current &&
        dataChannelRef.current.readyState === 'open'
      ) {
        try {
          dataChannelRef.current.send(JSON.stringify(msg));
        } catch (e) {
          console.warn('[WebRTC DataChannel send failed]:', e);
        }
      }

      // 2. WebSocket signaling fallback
      if (activePeer) {
        try {
          const socket = getSocket();
          socket.emit('call:control', {
            toUserId: activePeer.id,
            ...msg,
          });
        } catch (e) {
          console.warn('[WebRTC WebSocket sendControlMessage error]:', e);
        }
      }
    },
    [activePeer],
  );

  // Reset all call states and hardware channels
  const resetCall = useCallback(() => {
    ringtone.stop();

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch {}
      dataChannelRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    incomingOfferRef.current = null;
    pendingCandidates.current = [];

    setLocalStream(null);
    setRemoteStream(null);
    setCallState('idle');
    setActivePeer(null);
    setIsMuted(false);
    setIsPeerMuted(false);
    setIsVideoOff(false);
    setIsPeerVideoOff(false);
    setIsScreenSharing(false);
    setNetworkStats(null);
  }, []);

  // Initialize RTCPeerConnection with optimal ICE parameters and DataChannel
  const createPeerConnection = useCallback(
    async (peer: PeerUser): Promise<RTCPeerConnection> => {
      const iceServers = await fetchIceServers();
      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      pcRef.current = pc;

      // Setup negotiated DataChannel for ultra-low latency P2P control messages
      try {
        const dc = pc.createDataChannel('cn-bd-control', {
          negotiated: true,
          id: 0,
        });

        dc.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'mute') {
              setIsPeerMuted(Boolean(data.isMuted));
            } else if (data.type === 'video_off') {
              setIsPeerVideoOff(Boolean(data.isVideoOff));
            }
          } catch (e) {
            console.warn('[WebRTC DataChannel parse error]:', e);
          }
        };

        dataChannelRef.current = dc;
      } catch (dcErr) {
        console.warn('[WebRTC] Negotiated DataChannel notice:', dcErr);
      }

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dataChannelRef.current = dc;
        dc.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'mute') {
              setIsPeerMuted(Boolean(data.isMuted));
            } else if (data.type === 'video_off') {
              setIsPeerVideoOff(Boolean(data.isVideoOff));
            }
          } catch (err) {
            console.warn('[WebRTC DataChannel ondatachannel error]:', err);
          }
        };
      };

      // Handle remote incoming audio & video tracks (Using event.streams[0] to prevent iOS WebKit frame drop)
      pc.ontrack = (event) => {
        console.log(
          `[WebRTC ontrack] Track received: kind=${event.track.kind}, id=${event.track.id}, streams=${event.streams.length}`,
        );

        let streamToUse: MediaStream;
        if (event.streams && event.streams[0]) {
          // Native stream from WebRTC engine (preserves iOS Safari hardware decoding bindings)
          streamToUse = event.streams[0];
        } else {
          // Fallback track aggregation
          const currentStream = remoteStreamRef.current || new MediaStream();
          const existing = currentStream
            .getTracks()
            .filter((t) => t.kind === event.track.kind);
          existing.forEach((t) => currentStream.removeTrack(t));
          currentStream.addTrack(event.track);
          streamToUse = currentStream;
        }

        remoteStreamRef.current = streamToUse;
        setRemoteStream(streamToUse);

        event.track.onunmute = () => {
          console.log(`[WebRTC track onunmute] ${event.track.kind} unmuted and actively rendering`);
          setRemoteStream(streamToUse);
        };

        event.track.onended = () => {
          console.log(`[WebRTC track onended] ${event.track.kind} ended`);
          setRemoteStream(streamToUse);
        };
      };

      // Emit discovered ICE candidates to signaling server
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const socket = getSocket();
          socket.emit('call:ice_candidate', {
            toUserId: peer.id,
            candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC ICE State] ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
          console.warn('[WebRTC] ICE connection failed, restarting ICE...');
          pc.restartIce();
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC State] ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
          setCallState('connected');
          ringtone.stop();
          startStatsMonitoring(pc);
          tuneSenderParameters(pc);
        } else if (pc.connectionState === 'failed') {
          console.warn('[WebRTC] Peer connection failed, attempting ICE restart...');
          pc.restartIce();
        } else if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'closed'
        ) {
          resetCall();
        }
      };

      return pc;
    },
    [fetchIceServers, resetCall, startStatsMonitoring, tuneSenderParameters],
  );

  // 1. INITIATE CALL (Outbound)
  const startCall = useCallback(
    async (peer: PeerUser, video = true) => {
      try {
        setIsVideoCall(video);
        setActivePeer(peer);
        setCallState('calling');
        ringtone.playOutgoingRing();

        const stream = await getMediaStream(video);
        const pc = await createPeerConnection(peer);

        // Add local tracks to peer connection
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // Create SDP Offer with offerToReceive constraints
        const rawOffer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        const enhancedSdp = enhanceSdp(rawOffer.sdp || '');
        const offer = new RTCSessionDescription({
          type: rawOffer.type,
          sdp: enhancedSdp,
        });

        await pc.setLocalDescription(offer);

        const socket = getSocket();
        socket.emit('call:initiate', {
          toUserId: peer.id,
          isVideo: video,
          offer: {
            type: offer.type,
            sdp: offer.sdp,
          },
        });
      } catch (err: any) {
        console.error('Failed to initiate call:', err);
        alert(
          err.name === 'NotAllowedError'
            ? 'Camera / Microphone permission denied. Please allow access in browser settings.'
            : 'Failed to start call: ' + (err.message || 'Device error'),
        );
        resetCall();
      }
    },
    [getMediaStream, createPeerConnection, resetCall],
  );

  // 2. ANSWER INCOMING CALL
  const answerCall = useCallback(async () => {
    if (!activePeer || !incomingOfferRef.current) return;

    try {
      ringtone.stop();
      const stream = await getMediaStream(isVideoCall);
      const pc = await createPeerConnection(activePeer);

      // Add local audio and video tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Apply incoming remote SDP offer
      await pc.setRemoteDescription(
        new RTCSessionDescription(incomingOfferRef.current),
      );

      // Drain any queued ICE candidates received before answer
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift();
        if (candidate && (candidate.candidate || candidate.candidate === '')) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (candErr) {
            console.warn('Error applying queued ICE candidate:', candErr);
          }
        }
      }

      // Create and set SDP Answer
      const rawAnswer = await pc.createAnswer();
      const enhancedSdp = enhanceSdp(rawAnswer.sdp || '');
      const answer = new RTCSessionDescription({
        type: rawAnswer.type,
        sdp: enhancedSdp,
      });

      await pc.setLocalDescription(answer);

      const socket = getSocket();
      socket.emit('call:accept', {
        toUserId: activePeer.id,
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
      });

      setCallState('connected');
      tuneSenderParameters(pc);
    } catch (err: any) {
      console.error('Failed to answer call:', err);
      alert('Could not answer call: ' + (err.message || 'Media error'));
      resetCall();
    }
  }, [activePeer, isVideoCall, getMediaStream, createPeerConnection, resetCall, tuneSenderParameters]);

  // 3. REJECT INCOMING CALL
  const rejectCall = useCallback(() => {
    if (activePeer) {
      const socket = getSocket();
      socket.emit('call:reject', {
        toUserId: activePeer.id,
        reason: 'Call declined',
      });
    }
    resetCall();
  }, [activePeer, resetCall]);

  // 4. END ACTIVE CALL
  const endCall = useCallback(() => {
    if (activePeer) {
      const socket = getSocket();
      socket.emit('call:end', { toUserId: activePeer.id });
    }
    resetCall();
  }, [activePeer, resetCall]);

  // Hardware Controls: Mute Audio (reliably toggles localStreamRef + pcRef senders, updates state, notifies peer)
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const nextMuted = !prev;

      // 1. Toggle all local audio tracks
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !nextMuted;
        });
      }

      // 2. Toggle all audio senders on the RTCPeerConnection
      if (pcRef.current) {
        pcRef.current.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'audio') {
            sender.track.enabled = !nextMuted;
          }
        });
      }

      // 3. Notify peer via DataChannel & WebSocket signaling fallback
      sendControlMessage({ type: 'mute', isMuted: nextMuted });

      return nextMuted;
    });
  }, [sendControlMessage]);

  // Hardware Controls: Toggle Video (toggles localStreamRef + pcRef senders, updates state, notifies peer)
  const toggleVideo = useCallback(() => {
    setIsVideoOff((prev) => {
      const nextVideoOff = !prev;

      // 1. Toggle all local video tracks
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((track) => {
          track.enabled = !nextVideoOff;
        });
      }

      // 2. Toggle all video senders on the RTCPeerConnection
      if (pcRef.current) {
        pcRef.current.getSenders().forEach((sender) => {
          if (sender.track && sender.track.kind === 'video') {
            sender.track.enabled = !nextVideoOff;
          }
        });
      }

      // 3. Notify peer via DataChannel & WebSocket signaling fallback
      sendControlMessage({ type: 'video_off', isVideoOff: nextVideoOff });

      return nextVideoOff;
    });
  }, [sendControlMessage]);

  // Hardware Controls: Switch Camera (Front/Back)
  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || !pcRef.current) return;

    facingModeRef.current =
      facingModeRef.current === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingModeRef.current,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current
        .getSenders()
        .find((s) => s.track && s.track.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);

        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack) {
          oldTrack.stop();
          localStreamRef.current.removeTrack(oldTrack);
        }
        localStreamRef.current.addTrack(newVideoTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      }
    } catch (err) {
      console.warn('Switch camera not supported or failed:', err);
    }
  }, []);

  // Hardware Controls: Screen Sharing
  const toggleScreenShare = useCallback(async () => {
    if (!pcRef.current || !localStreamRef.current) return;

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        const screenTrack = screenStream.getVideoTracks()[0];

        const sender = pcRef.current
          .getSenders()
          .find((s) => s.track && s.track.kind === 'video');

        if (sender) {
          await sender.replaceTrack(screenTrack);
          setIsScreenSharing(true);

          screenTrack.onended = async () => {
            try {
              const cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facingModeRef.current },
              });
              const camTrack = cameraStream.getVideoTracks()[0];
              await sender.replaceTrack(camTrack);
            } catch (err) {
              console.warn('Could not restore camera track after screen share:', err);
            }
            setIsScreenSharing(false);
          };
        }
      } catch (err) {
        console.warn('Screen share cancelled or failed:', err);
      }
    }
  }, [isScreenSharing]);

  // WebSocket signaling event listeners
  useEffect(() => {
    if (!currentUser) return;

    const socket = getSocket();

    // 1. Incoming Call Event
    const handleIncomingCall = (data: {
      caller: PeerUser;
      isVideo: boolean;
      offer: any;
    }) => {
      setActivePeer(data.caller);
      setIsVideoCall(data.isVideo);
      incomingOfferRef.current = data.offer;
      setCallState('incoming');
      ringtone.playIncomingRing();
    };

    // 2. Call Accepted by Peer
    const handleCallAccepted = async (data: {
      fromUserId: string;
      answer: any;
    }) => {
      ringtone.stop();
      if (pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(data.answer),
          );

          while (pendingCandidates.current.length > 0) {
            const candidate = pendingCandidates.current.shift();
            if (candidate && (candidate.candidate || candidate.candidate === '')) {
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.warn('Error applying queued candidate on accepted:', e);
              }
            }
          }

          setCallState('connected');
          tuneSenderParameters(pcRef.current);
        } catch (err) {
          console.error('Failed to set remote description on call accepted:', err);
        }
      }
    };

    // 3. Call Rejected by Peer
    const handleCallRejected = () => {
      alert('Call was declined');
      resetCall();
    };

    // 4. Call Ended by Peer
    const handleCallEnded = () => {
      resetCall();
    };

    // 5. ICE Candidate from Peer
    const handleIceCandidate = async (data: {
      fromUserId: string;
      candidate: any;
    }) => {
      if (!data.candidate || (!data.candidate.candidate && data.candidate.candidate !== '')) return;

      if (
        pcRef.current &&
        pcRef.current.remoteDescription &&
        pcRef.current.remoteDescription.type
      ) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.warn('Error adding ICE candidate:', err);
        }
      } else {
        pendingCandidates.current.push(data.candidate);
      }
    };

    // 6. User Busy Event
    const handleCallBusy = () => {
      alert('Peer is currently busy on another call');
      resetCall();
    };

    // 7. User Offline Event
    const handleCallOffline = () => {
      alert('Peer is currently offline');
      resetCall();
    };

    // 8. Call Control event (mute/video toggle sync via WebSocket fallback)
    const handleControlMessage = (data: {
      fromUserId: string;
      type: 'mute' | 'video_off';
      isMuted?: boolean;
      isVideoOff?: boolean;
    }) => {
      if (data.type === 'mute') {
        setIsPeerMuted(Boolean(data.isMuted));
      } else if (data.type === 'video_off') {
        setIsPeerVideoOff(Boolean(data.isVideoOff));
      }
    };

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:ice_candidate', handleIceCandidate);
    socket.on('call:offline', handleCallOffline);
    socket.on('call:busy', handleCallBusy);
    socket.on('call:control', handleControlMessage);

    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:ice_candidate', handleIceCandidate);
      socket.off('call:offline', handleCallOffline);
      socket.off('call:busy', handleCallBusy);
      socket.off('call:control', handleControlMessage);
    };
  }, [currentUser, resetCall, tuneSenderParameters]);

  return {
    localStream,
    remoteStream,
    callState,
    activePeer,
    isVideoCall,
    isMuted,
    isPeerMuted,
    isVideoOff,
    isPeerVideoOff,
    isScreenSharing,
    networkStats,
    startCall,
    answerCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    switchCamera,
    toggleScreenShare,
  };
}
