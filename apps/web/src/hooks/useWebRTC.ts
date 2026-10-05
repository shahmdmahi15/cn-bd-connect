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
  relayType: string; // 'relay' (Coturn HK) | 'host' | 'srflx'
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
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<any>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const statsIntervalRef = useRef<any>(null);
  const prevBytesReceivedRef = useRef<number>(0);
  const prevTimestampRef = useRef<number>(0);

  // Stop ringtones and reset call state
  const resetCall = useCallback(() => {
    ringtone.stop();
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }

    pendingCandidates.current = [];
    incomingOfferRef.current = null;
    prevBytesReceivedRef.current = 0;
    prevTimestampRef.current = 0;

    setRemoteStream(null);
    setCallState('idle');
    setActivePeer(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setNetworkStats(null);
  }, []);

  // Fetch ICE configuration (STUN + Coturn TURNS Hong Kong)
  const fetchIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/proxy/turn/credentials', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        return data.iceServers;
      }
    } catch (err) {
      console.warn('Failed to fetch turn credentials, using default STUN:', err);
    }
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:cn-bd-connect-turn.shahmdmahi.dpdns.org:3478' },
    ];
  }, []);

  // Acquire local camera and microphone stream
  const getMediaStream = useCallback(
    async (video = true): Promise<MediaStream> => {
      if (localStreamRef.current) {
        return localStreamRef.current;
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

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
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
        let relayType = 'p2p';
        let bytesReceived = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let currentTimestamp = 0;

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
            } else {
              relayType = localCandidate?.candidateType || 'direct';
            }
          }

          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            bytesReceived += report.bytesReceived || 0;
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
            currentTimestamp = report.timestamp;
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
        });
      } catch (err) {
        console.warn('Error reading WebRTC stats:', err);
      }
    }, 1500);
  }, []);

  // Initialize RTCPeerConnection with optimal ICE parameters
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

      // Handle remote incoming audio/video tracks
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      // Send discovered ICE candidates to peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const socket = getSocket();
          socket.emit('call:ice_candidate', {
            toUserId: peer.id,
            candidate: event.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC State] ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
          setCallState('connected');
          ringtone.stop();
          startStatsMonitoring(pc);
        } else if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          if (pc.connectionState === 'failed') {
            console.log('ICE connection failed, triggering ICE restart...');
            pc.restartIce();
          } else {
            resetCall();
          }
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
          offerToReceiveVideo: video,
        });

        await pc.setLocalDescription(offer);

        const socket = getSocket();
        socket.emit('call:initiate', {
          toUserId: peer.id,
          isVideo: video,
          offer,
        });
      } catch (err) {
        console.error('Failed to initiate call:', err);
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

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(
        new RTCSessionDescription(incomingOfferRef.current),
      );

      // Drain queued ICE candidates
      while (pendingCandidates.current.length > 0) {
        const candidate = pendingCandidates.current.shift();
        if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Create and send SDP Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const socket = getSocket();
      socket.emit('call:accept', {
        toUserId: activePeer.id,
        answer,
      });

      setCallState('connected');
    } catch (err) {
      console.error('Failed to answer call:', err);
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

  // Hardware Controls: Mute Audio
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // Hardware Controls: Toggle Video
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  }, []);

  // Hardware Controls: Switch Camera (Front/Back)
  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || !pcRef.current) return;

    facingModeRef.current =
      facingModeRef.current === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingModeRef.current },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current
        .getSenders()
        .find((s) => s.track && s.track.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);

        // Replace track in local stream
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
            // Restore camera when user stops sharing screen
            const cameraStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facingModeRef.current },
            });
            const camTrack = cameraStream.getVideoTracks()[0];
            await sender.replaceTrack(camTrack);
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
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );

        // Drain any ICE candidates received early
        while (pendingCandidates.current.length > 0) {
          const candidate = pendingCandidates.current.shift();
          if (candidate)
            await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }

        setCallState('connected');
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
      if (pcRef.current && pcRef.current.remoteDescription) {
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

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:ice_candidate', handleIceCandidate);
    socket.on('call:offline', handleCallOffline);
    socket.on('call:busy', handleCallBusy);

    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:ice_candidate', handleIceCandidate);
      socket.off('call:offline', handleCallOffline);
      socket.off('call:busy', handleCallBusy);
    };
  }, [currentUser, resetCall]);

  return {
    localStream,
    remoteStream,
    callState,
    activePeer,
    isVideoCall,
    isMuted,
    isVideoOff,
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
