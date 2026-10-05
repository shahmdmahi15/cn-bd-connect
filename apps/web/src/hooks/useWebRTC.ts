'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import { ringtone } from '@/lib/ringtone';

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
  relayType: string; // 'relay' (Coturn HK) | 'direct' | 'srflx'
  frameRate?: number;
  resolution?: string;
}

export function useWebRTC(currentUser: any) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<
    'idle' | 'calling' | 'incoming' | 'connected' | 'ended'
  >('idle');
  const [activePeer, setActivePeer] = useState<PeerUser | null>(null);
  const [isVideoCall, setIsVideoCall] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isPeerMuted, setIsPeerMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isPeerVideoOff, setIsPeerVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<any>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const statsIntervalRef = useRef<any>(null);
  const prevBytesReceivedRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);

  // Send control message via P2P DataChannel with WebSocket signaling fallback
  const sendControlMessage = useCallback(
    (msg: { type: string; isMuted?: boolean; isVideoOff?: boolean }) => {
      // 1. Primary: Direct P2P RTCDataChannel (zero latency)
      if (
        dataChannelRef.current &&
        dataChannelRef.current.readyState === 'open'
      ) {
        try {
          dataChannelRef.current.send(JSON.stringify(msg));
        } catch (err) {
          console.warn('[WebRTC DataChannel] Send failed:', err);
        }
      }

      // 2. Fallback: WebSocket signaling server
      if (activePeer) {
        try {
          const socket = getSocket();
          socket.emit('call:control', {
            toUserId: activePeer.id,
            payload: msg,
          });
        } catch (err) {
          console.warn('[WebRTC Socket] Send control failed:', err);
        }
      }
    },
    [activePeer],
  );

  // Stop ringtones and reset all call resources
  const resetCall = useCallback(() => {
    ringtone.stop();
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (e) {
        console.warn('Error closing data channel:', e);
      }
      dataChannelRef.current = null;
    }

    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.ondatachannel = null;
        pcRef.current.close();
      } catch (e) {
        console.warn('Error closing peer connection:', e);
      }
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }

    pendingCandidates.current = [];
    incomingOfferRef.current = null;
    prevBytesReceivedRef.current = 0;
    prevTimestampRef.current = 0;

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

  // Fetch ICE configuration (Dedicated Coturn STUN/TURN)
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

  // Acquire local camera and microphone stream
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
        },
        video: video
          ? {
              facingMode: facingModeRef.current,
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 30, max: 30 },
            }
          : false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalStream(stream);
        return stream;
      } catch (err) {
        console.warn('Initial getUserMedia failed, retrying with basic constraints:', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: video,
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

      // Cumulative remote media stream to guarantee both audio & video tracks are bound
      const accumulatedStream = new MediaStream();
      remoteStreamRef.current = accumulatedStream;

      // Setup negotiated DataChannel for P2P control messages
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
        console.warn('[WebRTC] Negotiated DataChannel error:', dcErr);
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

      // Handle remote incoming audio & video tracks
      pc.ontrack = (event) => {
        console.log('[WebRTC ontrack] Track received:', event.track.kind, event.track.id);

        const currentStream = remoteStreamRef.current || new MediaStream();
        remoteStreamRef.current = currentStream;

        // Replace any existing track of same kind
        const existingTracks = currentStream
          .getTracks()
          .filter((t) => t.kind === event.track.kind);
        existingTracks.forEach((t) => currentStream.removeTrack(t));

        currentStream.addTrack(event.track);

        const updateState = () => {
          if (remoteStreamRef.current) {
            setRemoteStream(new MediaStream(remoteStreamRef.current.getTracks()));
          }
        };

        event.track.onunmute = () => {
          console.log(`[WebRTC track] ${event.track.kind} unmuted and active`);
          updateState();
        };

        event.track.onended = () => {
          console.log(`[WebRTC track] ${event.track.kind} ended`);
          updateState();
        };

        updateState();
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
    [fetchIceServers, resetCall, startStatsMonitoring],
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

        // Create SDP Offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
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
      const answer = await pc.createAnswer();
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
    } catch (err: any) {
      console.error('Failed to answer call:', err);
      alert('Could not answer call: ' + (err.message || 'Media error'));
      resetCall();
    }
  }, [activePeer, isVideoCall, getMediaStream, createPeerConnection, resetCall]);

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
          width: { ideal: 1280 },
          height: { ideal: 720 },
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

    // 6. Callee is offline or busy
    const handleCallOffline = (data: { message: string }) => {
      alert(data.message || 'User is currently offline');
      resetCall();
    };

    const handleCallBusy = (data: { message: string }) => {
      alert(data.message || 'User is on another call');
      resetCall();
    };

    // 7. Signaling Fallback for Remote Peer Control Messages
    const handleControlMessage = (data: {
      fromUserId: string;
      payload: { type: string; isMuted?: boolean; isVideoOff?: boolean };
    }) => {
      if (!data?.payload) return;
      if (data.payload.type === 'mute') {
        setIsPeerMuted(Boolean(data.payload.isMuted));
      } else if (data.payload.type === 'video_off') {
        setIsPeerVideoOff(Boolean(data.payload.isVideoOff));
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
  }, [currentUser, resetCall]);

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
