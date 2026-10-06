'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '@/lib/socket';

export interface PeerUser {
  id: string;
  name: string;
  email: string;
  country: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  file?: {
    fileId: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    url?: string;
  };
}

export interface FileTransferProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  progress: number; // 0 - 100
  status: 'uploading' | 'downloading' | 'completed' | 'error';
  url?: string;
}

export interface NetworkStats {
  rttMs: number;
  bitrateKbps: number;
  packetLossPercent: number;
  relayType: string;
  frameRate?: number;
  resolution?: string;
  jitterMs?: number;
  adaptiveQuality?: string;
  qualityTier?: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export interface WebRTCOptions {
  qualityPreference?: 'auto' | '1080p' | '720p' | '480p';
}

export interface QualityTierConfig {
  name: string;
  qualityTier: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  maxBitrate: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

export const QUALITY_TIERS: QualityTierConfig[] = [
  // Tier 0: Critical (Audio Priority, severe loss/congestion)
  {
    name: 'Auto (Audio Priority)',
    qualityTier: 'critical',
    maxBitrate: 180000,
    scaleResolutionDownBy: 3.5,
    maxFramerate: 15,
  },
  // Tier 1: Poor (360p Data Saver)
  {
    name: 'Auto (360p SD)',
    qualityTier: 'poor',
    maxBitrate: 380000,
    scaleResolutionDownBy: 2.2,
    maxFramerate: 20,
  },
  // Tier 2: Fair (480p Standard)
  {
    name: 'Auto (480p SD)',
    qualityTier: 'fair',
    maxBitrate: 850000,
    scaleResolutionDownBy: 1.6,
    maxFramerate: 24,
  },
  // Tier 3: Good (720p HD)
  {
    name: 'Auto (720p HD)',
    qualityTier: 'good',
    maxBitrate: 1800000,
    scaleResolutionDownBy: 1.0,
    maxFramerate: 30,
  },
  // Tier 4: Excellent (1080p Full HD)
  {
    name: 'Auto (1080p Full HD)',
    qualityTier: 'excellent',
    maxBitrate: 3200000,
    scaleResolutionDownBy: 1.0,
    maxFramerate: 30,
  },
];

import { ringtoneService } from '@/lib/ringtone';
const ringtone = ringtoneService;

// Studio-grade Opus audio + Dynamic Adaptive Bitrate video with H.264 prioritization
function enhanceSdp(sdp: string): string {
  // 1. Opus voice engine with in-band FEC, VBR, and dynamic packet loss handling
  let enhanced = sdp.replace(
    /(a=fmtp:\d+ .*)/g,
    (match) => {
      if (match.includes('opus')) {
        return `${match};minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=64000;cbr=0;dtx=1`;
      }
      return match;
    },
  );

  // If no fmtp line for opus yet, add it
  const opusRtpMapRegex = /a=rtpmap:(\d+)\s+opus\/48000\/2/i;
  const match = enhanced.match(opusRtpMapRegex);
  if (match) {
    const pt = match[1];
    const fmtpLine = `a=fmtp:${pt} minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=64000;cbr=0;dtx=1`;
    if (!enhanced.includes(`a=fmtp:${pt}`)) {
      enhanced = enhanced.replace(
        opusRtpMapRegex,
        `a=rtpmap:${pt} opus/48000/2\r\n${fmtpLine}`,
      );
    }
  }

  // 2. Set maximum video bitrate ceiling in SDP (3.5 Mbps for smooth HD with automatic congestion control)
  enhanced = enhanced.replace(/(m=video [^\r\n]+)/, (mLine) => {
    return `${mLine}\r\nb=AS:3500\r\nb=TIAS:3500000`;
  });

  // 3. Reorder video codecs in SDP so H.264 payload types are prioritized for hardware acceleration
  const h264Payloads: string[] = [];
  const rtpmapRegex = /a=rtpmap:(\d+)\s+H264\/90000/gi;
  let rtpMatch;
  while ((rtpMatch = rtpmapRegex.exec(enhanced)) !== null) {
    h264Payloads.push(rtpMatch[1]);
  }

  if (h264Payloads.length > 0) {
    enhanced = enhanced.replace(
      /(m=video \d+ [A-Z\/]+ )([0-9 ]+)/,
      (_line, prefix, payloadStr) => {
        const payloads = payloadStr.trim().split(/\s+/);
        const nonH264 = payloads.filter((p: string) => !h264Payloads.includes(p));
        const reordered = [...h264Payloads, ...nonH264].join(' ');
        return `${prefix}${reordered}`;
      },
    );
  }

  return enhanced;
}

// Hardware acceleration helper: Prioritize H.264 video codec on RTCPeerConnection transceivers
function preferH264Codecs(pc: RTCPeerConnection) {
  try {
    if (typeof RTCRtpReceiver === 'undefined' || !('getCapabilities' in RTCRtpReceiver)) return;
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (!capabilities || !capabilities.codecs) return;

    const h264Codecs = capabilities.codecs.filter(
      (c) => c.mimeType.toLowerCase() === 'video/h264',
    );
    const otherCodecs = capabilities.codecs.filter(
      (c) => c.mimeType.toLowerCase() !== 'video/h264',
    );
    const sortedCodecs = [...h264Codecs, ...otherCodecs];

    pc.getTransceivers().forEach((transceiver) => {
      if (
        (transceiver.receiver.track.kind === 'video' || transceiver.sender.track?.kind === 'video') &&
        transceiver.setCodecPreferences
      ) {
        try {
          transceiver.setCodecPreferences(sortedCodecs);
        } catch {}
      }
    });
  } catch (err) {
    console.warn('[WebRTC] setCodecPreferences notice:', err);
  }
}

export function useWebRTC(
  currentUser: { id: string; name: string } | null,
  options?: WebRTCOptions,
) {
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

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [fileTransfers, setFileTransfers] = useState<Record<string, FileTransferProgress>>({});
  const [isVoiceClarityEnabled, setIsVoiceClarityEnabled] = useState<boolean>(true);
  const [isBackgroundBlurEnabled, setIsBackgroundBlurEnabled] = useState<boolean>(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const incomingOfferRef = useRef<any>(null);
  const pendingCandidates = useRef<any[]>([]);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevBytesReceivedRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);
  const prevPacketsLostRef = useRef<number>(0);
  const prevPacketsReceivedRef = useRef<number>(0);
  const facingModeRef = useRef<'user' | 'environment'>('user');

  // Buffer for incoming file chunks: fileId -> { fileName, fileSize, fileType, totalChunks, chunks: string[] }
  const incomingFilesRef = useRef<
    Map<
      string,
      {
        fileName: string;
        fileSize: number;
        fileType: string;
        totalChunks: number;
        chunks: string[];
      }
    >
  >(new Map());

  // Web Audio Voice Clarity DSP Equalizer Chain
  const audioCtxRef = useRef<AudioContext | null>(null);
  const voiceClaritySourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceClarityHighpassRef = useRef<BiquadFilterNode | null>(null);
  const voiceClarityPeakingRef = useRef<BiquadFilterNode | null>(null);
  const voiceClarityCompressorRef = useRef<DynamicsCompressorNode | null>(null);

  // Background Voice Call Keep-Alive Node (Prevents iOS/Android audio suspension)
  const keepAliveOscRef = useRef<OscillatorNode | null>(null);
  const keepAliveGainRef = useRef<GainNode | null>(null);

  const qualityPreference = options?.qualityPreference || 'auto';
  const qualityPreferenceRef = useRef(qualityPreference);
  qualityPreferenceRef.current = qualityPreference;

  const initialTier =
    qualityPreference === '480p' ? 2 :
    qualityPreference === '720p' ? 3 :
    qualityPreference === '1080p' ? 4 : 3;

  const activeTierRef = useRef<number>(initialTier);
  const stableCyclesRef = useRef<number>(0);

  // Helper to dynamically adapt video encoding parameters via RTCRtpSender.setParameters
  const applyQualityTier = useCallback(async (pc: RTCPeerConnection, tierIndex: number) => {
    try {
      const tier = QUALITY_TIERS[tierIndex];
      if (!tier) return;

      const senders = pc.getSenders();
      for (const sender of senders) {
        if (!sender.track || sender.track.kind !== 'video') continue;

        try {
          if ('degradationPreference' in sender) {
            (sender as any).degradationPreference = 'balanced';
          }
        } catch {}

        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }

        const enc = params.encodings[0];
        const isChanged =
          enc.maxBitrate !== tier.maxBitrate ||
          enc.scaleResolutionDownBy !== tier.scaleResolutionDownBy ||
          enc.maxFramerate !== tier.maxFramerate;

        if (isChanged) {
          enc.maxBitrate = tier.maxBitrate;
          enc.scaleResolutionDownBy = tier.scaleResolutionDownBy;
          enc.maxFramerate = tier.maxFramerate;
          enc.networkPriority = 'high';
          await sender.setParameters(params).catch(() => {});
          console.log(
            `[WebRTC Dynamic ABR] Adjusted video to ${tier.name} (Bitrate: ${tier.maxBitrate / 1000}kbps, Scale: ${tier.scaleResolutionDownBy}, FPS: ${tier.maxFramerate})`,
          );
        }
      }
    } catch (err) {
      console.warn('[WebRTC Dynamic ABR notice]:', err);
    }
  }, []);

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

  const wakeLockRef = useRef<any>(null);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current = lock;
        lock.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch (e) {
        console.warn('[WebRTC] WakeLock request notice:', e);
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
  }, []);

  // 1. Voice Call Keep-Alive: Web Audio Sub-Bass Oscillator + WakeLock keepalive
  const startKeepAlive = useCallback(() => {
    try {
      acquireWakeLock();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (!keepAliveOscRef.current) {
        // Continuous inaudible 1Hz sub-bass sine tone at 0.00001 gain
        // Keeps iOS/Android WebKit media session alive during screen sleep & backgrounding
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1, ctx.currentTime);
        gain.gain.setValueAtTime(0.00001, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        keepAliveOscRef.current = osc;
        keepAliveGainRef.current = gain;
      }
    } catch (err) {
      console.warn('[WebRTC Keep-Alive] Notice:', err);
    }
  }, [acquireWakeLock]);

  const stopKeepAlive = useCallback(() => {
    releaseWakeLock();
    if (keepAliveOscRef.current) {
      try {
        keepAliveOscRef.current.stop();
        keepAliveOscRef.current.disconnect();
      } catch {}
      keepAliveOscRef.current = null;
    }
    if (keepAliveGainRef.current) {
      try {
        keepAliveGainRef.current.disconnect();
      } catch {}
      keepAliveGainRef.current = null;
    }
  }, [releaseWakeLock]);

  // 2. Web Audio Voice Clarity DSP Filter: 80Hz Butterworth High-Pass + 2.5kHz Voice Boost + Compressor
  const initVoiceClarityFilter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;

      if (voiceClaritySourceRef.current) {
        try {
          voiceClaritySourceRef.current.disconnect();
        } catch {}
      }

      const source = ctx.createMediaStreamSource(stream);
      voiceClaritySourceRef.current = source;

      // 80Hz High-Pass Filter: Eliminates rumble, AC fan noise, desk vibrations
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(80, ctx.currentTime);
      highpass.Q.setValueAtTime(0.707, ctx.currentTime);
      voiceClarityHighpassRef.current = highpass;

      // 2.5kHz Peaking Filter: Boosts speech intelligibility and voice presence (+4.5 dB)
      const peaking = ctx.createBiquadFilter();
      peaking.type = 'peaking';
      peaking.frequency.setValueAtTime(2500, ctx.currentTime);
      peaking.Q.setValueAtTime(1.2, ctx.currentTime);
      peaking.gain.setValueAtTime(4.5, ctx.currentTime);
      voiceClarityPeakingRef.current = peaking;

      // Dynamics Compressor: Balances soft whispers and loud laughter
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, ctx.currentTime);
      compressor.knee.setValueAtTime(30, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);
      voiceClarityCompressorRef.current = compressor;

      // Chain: Source -> Highpass -> Peaking Boost -> Compressor -> Speakers (Destination)
      source.connect(highpass);
      highpass.connect(peaking);
      peaking.connect(compressor);
      compressor.connect(ctx.destination);
    } catch (err) {
      console.warn('[WebRTC Voice Clarity] Setup notice:', err);
    }
  }, []);

  const toggleVoiceClarity = useCallback(() => {
    setIsVoiceClarityEnabled((prev) => {
      const next = !prev;
      if (audioCtxRef.current && voiceClarityHighpassRef.current && voiceClarityPeakingRef.current) {
        const ctx = audioCtxRef.current;
        if (next) {
          // Studio Vocal Clarity active
          voiceClarityHighpassRef.current.frequency.setValueAtTime(80, ctx.currentTime);
          voiceClarityPeakingRef.current.gain.setValueAtTime(4.5, ctx.currentTime);
        } else {
          // Flat bypass
          voiceClarityHighpassRef.current.frequency.setValueAtTime(10, ctx.currentTime);
          voiceClarityPeakingRef.current.gain.setValueAtTime(0, ctx.currentTime);
        }
      }
      return next;
    });
  }, []);

  const toggleBackgroundBlur = useCallback(() => {
    setIsBackgroundBlurEnabled((prev) => !prev);
  }, []);

  // 3. In-Call P2P DataChannel Chat: Send text message
  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !currentUser) return;
      const id = 'msg-' + Math.random().toString(36).substring(2, 9);
      const msgObj = {
        type: 'chat',
        id,
        senderId: currentUser.id,
        senderName: currentUser.name,
        text: text.trim(),
        timestamp: Date.now(),
      };

      setChatMessages((prev) => [...prev, { ...msgObj, isSelf: true }]);

      if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
        try {
          dataChannelRef.current.send(JSON.stringify(msgObj));
        } catch (e) {
          console.warn('[WebRTC DataChannel send chat error]:', e);
        }
      }
    },
    [currentUser],
  );

  // 4. In-Call P2P DataChannel Chunked File Sharing (16KB binary chunks with backpressure)
  const sendFile = useCallback(
    async (file: File) => {
      if (!file || !currentUser) return;
      const dc = dataChannelRef.current;
      if (!dc || dc.readyState !== 'open') {
        alert('Data connection is not ready yet. Please wait 2-3 seconds for connection to stabilize.');
        return;
      }

      const fileId = 'file-' + Math.random().toString(36).substring(2, 9);
      const chunkSize = 16384; // 16KB per chunk
      const arrayBuffer = await file.arrayBuffer();
      const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

      setFileTransfers((prev) => ({
        ...prev,
        [fileId]: {
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          progress: 0,
          status: 'uploading',
        },
      }));

      // 1. Send file start
      dc.send(
        JSON.stringify({
          type: 'file_start',
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          totalChunks,
        }),
      );

      // 2. Send 16KB chunks with backpressure
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
        const slice = arrayBuffer.slice(start, end);

        const uint8 = new Uint8Array(slice);
        let binary = '';
        for (let b = 0; b < uint8.byteLength; b++) {
          binary += String.fromCharCode(uint8[b]);
        }
        const base64Chunk = btoa(binary);

        // Backpressure check
        while (dc.bufferedAmount > 65536) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        dc.send(
          JSON.stringify({
            type: 'file_chunk',
            fileId,
            chunkIndex: i,
            chunk: base64Chunk,
          }),
        );

        const progress = Math.min(100, Math.round(((i + 1) / totalChunks) * 100));
        setFileTransfers((prev) => {
          const cur = prev[fileId];
          if (!cur) return prev;
          return {
            ...prev,
            [fileId]: { ...cur, progress },
          };
        });
      }

      // 3. Send file end
      dc.send(JSON.stringify({ type: 'file_end', fileId }));

      const localBlobUrl = URL.createObjectURL(file);
      setFileTransfers((prev) => {
        const cur = prev[fileId];
        if (!cur) return prev;
        return {
          ...prev,
          [fileId]: { ...cur, progress: 100, status: 'completed', url: localBlobUrl },
        };
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: 'msg-' + fileId,
          senderId: currentUser.id,
          senderName: currentUser.name,
          text: `Shared file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
          timestamp: Date.now(),
          isSelf: true,
          file: {
            fileId,
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            url: localBlobUrl,
          },
        },
      ]);
    },
    [currentUser],
  );

  // Acquire local camera and microphone stream with studio quality (1080p30 -> 720p30 -> Basic fallback cascade)
  const getMediaStream = useCallback(
    async (video = true): Promise<MediaStream> => {
      if (localStreamRef.current) {
        const hasVideo = localStreamRef.current.getVideoTracks().length > 0;
        if (!video || hasVideo) {
          return localStreamRef.current;
        }
      }

      const audioConfig = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 2,
        sampleRate: 48000,
      };

      // Cascade Tier 1: 1080p Full HD @ 30fps (Standard communication rate)
      if (video) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConfig,
            video: {
              facingMode: facingModeRef.current,
              width: { ideal: 1920, min: 1280 },
              height: { ideal: 1080, min: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
          localStreamRef.current = stream;
          setLocalStream(stream);
          return stream;
        } catch (tier1Err) {
          console.warn('[WebRTC] 1080p unavailable, cascading to 720p HD:', tier1Err);
        }

        // Cascade Tier 2: 720p HD @ 30fps
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConfig,
            video: {
              facingMode: facingModeRef.current,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
          localStreamRef.current = stream;
          setLocalStream(stream);
          return stream;
        } catch (tier2Err) {
          console.warn('[WebRTC] 720p unavailable, cascading to flexible video:', tier2Err);
        }

        // Cascade Tier 3: Flexible video
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConfig,
            video: {
              facingMode: facingModeRef.current,
              frameRate: { ideal: 30, max: 30 },
            },
          });
          localStreamRef.current = stream;
          setLocalStream(stream);
          return stream;
        } catch (tier3Err) {
          console.error('[WebRTC] Flexible video failed, trying audio-only:', tier3Err);
        }
      }

      // Audio-only fallback or voice call
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConfig,
          video: false,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        return stream;
      } catch (audioErr) {
        console.error('getUserMedia failed completely:', audioErr);
        throw audioErr;
      }
    },
    [],
  );

  // Apply initial transmission parameters and dynamic degradation preference
  const tuneSenderParameters = useCallback(
    async (pc: RTCPeerConnection) => {
      try {
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (!sender.track) continue;

          try {
            if ('degradationPreference' in sender) {
              (sender as any).degradationPreference = 'balanced';
            }
          } catch {}

          if (sender.track.kind === 'audio') {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = 64000; // 64 kbps adaptive Opus
            params.encodings[0].networkPriority = 'high';
            await sender.setParameters(params).catch(() => {});
          }
        }

        // Apply initial active video quality tier
        await applyQualityTier(pc, activeTierRef.current);
      } catch (err) {
        console.warn('Tune sender parameters notice:', err);
      }
    },
    [applyQualityTier],
  );

  // Setup live connection statistics polling & dynamic ABR engine
  const startStatsMonitoring = useCallback(
    (pc: RTCPeerConnection) => {
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
          let jitterMs: number | undefined = undefined;

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
              if (typeof report.jitter === 'number') {
                jitterMs = Math.round(report.jitter * 1000);
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

          const deltaPacketsLost = Math.max(0, packetsLost - prevPacketsLostRef.current);
          const deltaPacketsReceived = Math.max(0, packetsReceived - prevPacketsReceivedRef.current);
          const deltaTotal = deltaPacketsLost + deltaPacketsReceived;
          const lossPercent =
            deltaTotal > 0
              ? Math.round((deltaPacketsLost / deltaTotal) * 1000) / 10
              : 0;

          prevPacketsLostRef.current = packetsLost;
          prevPacketsReceivedRef.current = packetsReceived;

          // --- AUTOMATIC ADAPTIVE QUALITY ENGINE (Dynamic ABR) ---
          // Evaluates network health (loss, RTT, jitter) just like WhatsApp, Zoom & FaceTime
          let recommendedTier = 4;
          const effectiveJitter = jitterMs || 0;
          if (lossPercent >= 12 || rtt >= 550 || effectiveJitter >= 120) {
            recommendedTier = 0; // Critical: Audio priority, video ultra-low
          } else if (lossPercent >= 6 || rtt >= 380 || effectiveJitter >= 75) {
            recommendedTier = 1; // Poor: 360p Data Saver
          } else if (lossPercent >= 2.5 || rtt >= 240 || effectiveJitter >= 45) {
            recommendedTier = 2; // Fair: 480p SD
          } else if (lossPercent >= 1.0 || rtt >= 135) {
            recommendedTier = 3; // Good: 720p HD
          } else {
            recommendedTier = 4; // Excellent: 1080p Full HD
          }

          // Apply user ceiling preference
          const pref = qualityPreferenceRef.current;
          const maxAllowedTier =
            pref === '480p' ? 2 :
            pref === '720p' ? 3 :
            pref === '1080p' ? 4 : 4;

          const targetTier = Math.min(recommendedTier, maxAllowedTier);

          // Adaptation logic: Fast step-down on degradation, cautious step-up on recovery
          if (targetTier < activeTierRef.current) {
            // Rapid downgrade to prevent packet queues and frozen video
            activeTierRef.current = targetTier;
            stableCyclesRef.current = 0;
            await applyQualityTier(pc, targetTier);
          } else if (targetTier > activeTierRef.current) {
            // Conservative upgrade: require network to stay stable for 3 consecutive intervals (~4.5s)
            stableCyclesRef.current += 1;
            if (stableCyclesRef.current >= 3) {
              activeTierRef.current = activeTierRef.current + 1;
              stableCyclesRef.current = 0;
              await applyQualityTier(pc, activeTierRef.current);
            }
          } else {
            stableCyclesRef.current = 0;
          }

          const currentTierConfig = QUALITY_TIERS[activeTierRef.current] || QUALITY_TIERS[3];

          setNetworkStats({
            rttMs: rtt,
            bitrateKbps: Math.max(0, bitrate),
            packetLossPercent: lossPercent,
            relayType,
            frameRate,
            resolution,
            jitterMs,
            adaptiveQuality: currentTierConfig.name,
            qualityTier: currentTierConfig.qualityTier,
          });
        } catch (err) {
          console.warn('Error reading WebRTC stats:', err);
        }
      }, 1500);
    },
    [applyQualityTier],
  );

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
    stopKeepAlive();

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

    if (voiceClaritySourceRef.current) {
      try {
        voiceClaritySourceRef.current.disconnect();
      } catch {}
      voiceClaritySourceRef.current = null;
    }

    remoteStreamRef.current = null;
    incomingOfferRef.current = null;
    pendingCandidates.current = [];
    incomingFilesRef.current.clear();
    setChatMessages([]);
    setFileTransfers({});

    prevPacketsLostRef.current = 0;
    prevPacketsReceivedRef.current = 0;
    prevBytesReceivedRef.current = 0;
    prevTimestampRef.current = 0;

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
    activeTierRef.current = initialTier;
    stableCyclesRef.current = 0;
  }, [stopKeepAlive, initialTier]);

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

      const setupDataChannelEvents = (dc: RTCDataChannel) => {
        dc.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'mute') {
              setIsPeerMuted(Boolean(data.isMuted));
            } else if (data.type === 'video_off') {
              setIsPeerVideoOff(Boolean(data.isVideoOff));
            } else if (data.type === 'chat') {
              const msg: ChatMessage = {
                id: data.id || Math.random().toString(),
                senderId: data.senderId,
                senderName: data.senderName || peer.name || 'Peer',
                text: data.text,
                timestamp: data.timestamp || Date.now(),
                isSelf: false,
              };
              setChatMessages((prev) => [...prev, msg]);
            } else if (data.type === 'file_start') {
              const { fileId, fileName, fileSize, fileType, totalChunks } = data;
              incomingFilesRef.current.set(fileId, {
                fileName,
                fileSize,
                fileType,
                totalChunks,
                chunks: [],
              });
              setFileTransfers((prev) => ({
                ...prev,
                [fileId]: {
                  fileId,
                  fileName,
                  fileSize,
                  fileType,
                  progress: 0,
                  status: 'downloading',
                },
              }));
            } else if (data.type === 'file_chunk') {
              const { fileId, chunkIndex, chunk } = data;
              const fileData = incomingFilesRef.current.get(fileId);
              if (fileData) {
                fileData.chunks[chunkIndex] = chunk;
                const receivedCount = fileData.chunks.filter(Boolean).length;
                const progress = Math.min(100, Math.round((receivedCount / fileData.totalChunks) * 100));
                setFileTransfers((prev) => {
                  const cur = prev[fileId];
                  if (!cur) return prev;
                  return {
                    ...prev,
                    [fileId]: { ...cur, progress },
                  };
                });
              }
            } else if (data.type === 'file_end') {
              const { fileId } = data;
              const fileData = incomingFilesRef.current.get(fileId);
              if (fileData) {
                try {
                  const binaryChunks: Uint8Array[] = fileData.chunks.map((b64) => {
                    const binaryStr = atob(b64);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                      bytes[i] = binaryStr.charCodeAt(i);
                    }
                    return bytes;
                  });
                  const blob = new Blob(binaryChunks as any, {
                    type: fileData.fileType || 'application/octet-stream',
                  });
                  const url = URL.createObjectURL(blob);

                  setFileTransfers((prev) => {
                    const cur = prev[fileId];
                    if (!cur) return prev;
                    return {
                      ...prev,
                      [fileId]: { ...cur, progress: 100, status: 'completed', url },
                    };
                  });

                  setChatMessages((prev) => [
                    ...prev,
                    {
                      id: 'file-' + fileId,
                      senderId: peer.id,
                      senderName: peer.name || 'Peer',
                      text: `Shared file: ${fileData.fileName} (${(fileData.fileSize / 1024).toFixed(1)} KB)`,
                      timestamp: Date.now(),
                      isSelf: false,
                      file: {
                        fileId,
                        fileName: fileData.fileName,
                        fileSize: fileData.fileSize,
                        fileType: fileData.fileType,
                        url,
                      },
                    },
                  ]);
                } catch (err) {
                  console.error('[WebRTC DataChannel] File assembly error:', err);
                } finally {
                  incomingFilesRef.current.delete(fileId);
                }
              }
            } else if (data.type === 'file_cancel') {
              const { fileId } = data;
              incomingFilesRef.current.delete(fileId);
              setFileTransfers((prev) => {
                const cur = prev[fileId];
                if (!cur) return prev;
                return {
                  ...prev,
                  [fileId]: { ...cur, status: 'error' },
                };
              });
            }
          } catch (e) {
            console.warn('[WebRTC DataChannel parse error]:', e);
          }
        };
      };

      // Setup negotiated DataChannel for ultra-low latency P2P control & chat/file messages
      try {
        const dc = pc.createDataChannel('cn-bd-control', {
          negotiated: true,
          id: 0,
        });

        setupDataChannelEvents(dc);
        dataChannelRef.current = dc;
      } catch (dcErr) {
        console.warn('[WebRTC] Negotiated DataChannel notice:', dcErr);
      }

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dataChannelRef.current = dc;
        setupDataChannelEvents(dc);
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

        if (event.track.kind === 'audio') {
          initVoiceClarityFilter(streamToUse);
        }

        event.track.onunmute = () => {
          console.log(`[WebRTC track onunmute] ${event.track.kind} unmuted and actively rendering`);
          setRemoteStream(streamToUse);
          if (event.track.kind === 'audio') {
            initVoiceClarityFilter(streamToUse);
          }
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
        } else if (pc.iceConnectionState === 'disconnected') {
          console.warn('[WebRTC] ICE disconnected, checking if recovery needed...');
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected') {
              console.warn('[WebRTC] Still disconnected after 3s, executing ICE restart...');
              pc.restartIce();
            }
          }, 3000);
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC State] ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
          setCallState('connected');
          ringtone.stop();
          startKeepAlive();
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
    [fetchIceServers, resetCall, startKeepAlive, startStatsMonitoring, tuneSenderParameters, initVoiceClarityFilter],
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
        preferH264Codecs(pc);

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
      preferH264Codecs(pc);

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
      let newStream: MediaStream;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingModeRef.current,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
      } catch {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facingModeRef.current },
          audio: false,
        });
      }

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
    const handleCallBusy = (data?: { message?: string }) => {
      alert(data?.message || 'Peer is currently busy on another call');
      resetCall();
    };

    // 7. User Offline Event
    const handleCallOffline = (data?: { message?: string }) => {
      alert(data?.message || 'Peer is currently unreachable');
      resetCall();
    };

    // 8. Call Ringing Event (Caller plays ringback tone)
    const handleCallRinging = () => {
      ringtone.playOutgoingRing();
      setCallState('calling');
    };

    // 9. Call Cancelled Event (Caller hung up before answer)
    const handleCallCancelled = () => {
      ringtone.stop();
      resetCall();
    };

    // 10. Call Timeout Event (Unanswered after 45s)
    const handleCallTimeout = () => {
      ringtone.stop();
      alert('No answer. Call timed out.');
      resetCall();
    };

    // 11. Call Control event (mute/video toggle sync via WebSocket fallback)
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
    socket.on('call:ringing', handleCallRinging);
    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:cancelled', handleCallCancelled);
    socket.on('call:timeout', handleCallTimeout);
    socket.on('call:ice_candidate', handleIceCandidate);
    socket.on('call:offline', handleCallOffline);
    socket.on('call:busy', handleCallBusy);
    socket.on('call:control', handleControlMessage);

    // Auto-probe pending calls on connection
    socket.emit('call:check_pending', (res: any) => {
      if (res && res.hasPending && res.caller && res.offer) {
        handleIncomingCall(res);
      }
    });

    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:ringing', handleCallRinging);
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:cancelled', handleCallCancelled);
      socket.off('call:timeout', handleCallTimeout);
      socket.off('call:ice_candidate', handleIceCandidate);
      socket.off('call:offline', handleCallOffline);
      socket.off('call:busy', handleCallBusy);
      socket.off('call:control', handleControlMessage);
    };
  }, [currentUser, resetCall, tuneSenderParameters]);

  const checkPendingCall = useCallback(() => {
    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit('call:check_pending', (res: any) => {
        if (res && res.hasPending && res.caller && res.offer) {
          setActivePeer(res.caller);
          setIsVideoCall(res.isVideo);
          incomingOfferRef.current = res.offer;
          setCallState('incoming');
          ringtone.playIncomingRing();
        }
      });
    }
  }, []);

  // Cancel outgoing call during dialing
  const cancelCall = useCallback(() => {
    if (activePeer) {
      const socket = getSocket();
      socket.emit('call:cancel', { toUserId: activePeer.id });
      socket.emit('call:end', { toUserId: activePeer.id });
    }
    resetCall();
  }, [activePeer, resetCall]);

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
    chatMessages,
    fileTransfers,
    isVoiceClarityEnabled,
    isBackgroundBlurEnabled,
    startCall,
    answerCall,
    rejectCall,
    cancelCall,
    endCall,
    checkPendingCall,
    toggleMute,
    toggleVideo,
    switchCamera,
    toggleScreenShare,
    sendChatMessage,
    sendFile,
    toggleVoiceClarity,
    toggleBackgroundBlur,
  };
}
