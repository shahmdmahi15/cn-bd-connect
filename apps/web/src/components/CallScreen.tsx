'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  Monitor,
  Activity,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  ShieldCheck,
  Zap,
  Layers,
  Crop,
  Radio,
  ArrowUpDown,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { PeerUser, NetworkStats } from '@/hooks/useWebRTC';

export interface CallScreenProps {
  callState: 'idle' | 'calling' | 'incoming' | 'connected' | 'ended';
  activePeer: PeerUser | null;
  isVideoCall: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  networkStats: NetworkStats | null;
  isPeerMuted?: boolean;
  isPeerVideoOff?: boolean;
  onAnswer: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onToggleScreenShare: () => void;
}

export function CallScreen({
  callState,
  activePeer,
  isVideoCall,
  localStream,
  remoteStream,
  isMuted,
  isVideoOff,
  isScreenSharing,
  networkStats,
  isPeerMuted = false,
  isPeerVideoOff = false,
  onAnswer,
  onReject,
  onEnd,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onToggleScreenShare,
}: CallScreenProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio Context fallback to guarantee audio output
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const [callDuration, setCallDuration] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pipMinimized, setPipMinimized] = useState(false);
  const [isSwappedView, setIsSwappedView] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  // 'contain' keeps mobile 9:16 stream uncropped on desktop 16:9, with ambient blurred glow.
  // 'cover' zooms to fill screen.
  const [videoFitMode, setVideoFitMode] = useState<'contain' | 'cover'>('contain');

  // Initialize or resume Web Audio API pipeline
  const initWebAudioPipeline = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.disconnect();
        } catch {}
      }

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioSourceRef.current = ctx.createMediaStreamSource(stream);
        audioSourceRef.current.connect(ctx.destination);
      }
    } catch (err) {
      console.warn('[CallScreen] Web Audio pipeline notice:', err);
    }
  }, []);

  // Unblock all audio playback safely across iOS Safari, Android Chrome, and Desktop
  const unblockAllAudio = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }

    if (remoteStream) {
      initWebAudioPipeline(remoteStream);
    }

    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.muted = false;
      remoteAudioRef.current.play().catch(() => {});
    }

    if (remoteVideoRef.current && remoteStream) {
      // In video call, attempt to play unmuted through video element
      remoteVideoRef.current.volume = 1.0;
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.play().catch(() => {
        // If unmuted rejected, keep muted video and rely on remoteAudioRef
        if (remoteVideoRef.current) {
          remoteVideoRef.current.muted = true;
          remoteVideoRef.current.play().catch(() => {});
        }
      });
    }

    setAutoplayBlocked(false);
  }, [remoteStream, initWebAudioPipeline]);

  // Synchronous Callback Ref for Remote Video
  const setRemoteVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteVideoRef.current = el;
      if (el && remoteStream) {
        if (el.srcObject !== remoteStream) {
          el.srcObject = remoteStream;
        }
        el.play().catch((err) => {
          console.warn('[CallScreen] Video play deferred:', err);
          el.muted = true;
          el.play().catch(() => {});
        });
      }
    },
    [remoteStream],
  );

  // Synchronous Callback Ref for Remote Audio
  const setRemoteAudioEl = useCallback(
    (el: HTMLAudioElement | null) => {
      remoteAudioRef.current = el;
      if (el && remoteStream) {
        if (el.srcObject !== remoteStream) {
          el.srcObject = remoteStream;
        }
        el.volume = 1.0;
        el.muted = false;
        el.play().catch((err) => {
          console.warn('[CallScreen] Remote audio autoplay blocked:', err);
          setAutoplayBlocked(true);
          initWebAudioPipeline(remoteStream);
        });
      }
    },
    [remoteStream, initWebAudioPipeline],
  );

  // Synchronous Callback Ref for Ambient Blurred Video
  const setAmbientVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      ambientVideoRef.current = el;
      if (el && remoteStream) {
        if (el.srcObject !== remoteStream) {
          el.srcObject = remoteStream;
        }
        el.play().catch(() => {});
      }
    },
    [remoteStream],
  );

  // Synchronous Callback Ref for Local Video Preview
  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && localStream) {
        if (el.srcObject !== localStream) {
          el.srcObject = localStream;
        }
        el.play().catch((e) => console.warn('Local preview play error:', e));
      }
    },
    [localStream],
  );

  // Continuous synchronization effect whenever remoteStream or callState updates
  useEffect(() => {
    if (callState === 'connected' && remoteStream) {
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.muted = true;
            remoteVideoRef.current.play().catch(() => {});
          }
        });
      }

      if (ambientVideoRef.current && ambientVideoRef.current.srcObject !== remoteStream) {
        ambientVideoRef.current.srcObject = remoteStream;
        ambientVideoRef.current.play().catch(() => {});
      }

      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.play().catch(() => {
          setAutoplayBlocked(true);
          initWebAudioPipeline(remoteStream);
        });
      }
    }
  }, [remoteStream, callState, initWebAudioPipeline]);

  // Global user interaction listener to unblock audio on first gesture
  useEffect(() => {
    const handleUserGesture = () => {
      if (autoplayBlocked) {
        unblockAllAudio();
      }
    };

    window.addEventListener('click', handleUserGesture, { passive: true });
    window.addEventListener('touchstart', handleUserGesture, { passive: true });
    window.addEventListener('keydown', handleUserGesture, { passive: true });

    return () => {
      window.removeEventListener('click', handleUserGesture);
      window.removeEventListener('touchstart', handleUserGesture);
      window.removeEventListener('keydown', handleUserGesture);
    };
  }, [autoplayBlocked, unblockAllAudio]);

  // Clean up Web Audio Context on unmount or call end
  useEffect(() => {
    return () => {
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.disconnect();
        } catch {}
      }
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close().catch(() => {});
        } catch {}
      }
    };
  }, []);

  // Call duration counter
  useEffect(() => {
    if (callState === 'connected') {
      const timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
      return () => {
        clearInterval(timer);
        setCallDuration(0);
      };
    }
  }, [callState]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Toggle speaker mute
  const toggleSpeakerMute = () => {
    const nextMuted = !isSpeakerMuted;
    setIsSpeakerMuted(nextMuted);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = nextMuted;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = nextMuted;
    }
  };

  if (callState === 'idle') return null;

  // --- 1. INCOMING CALL SCREEN (iOS 26 Liquid Water-Morphism) ---
  if (callState === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-3xl animate-in fade-in duration-300">
        <div className="absolute top-1/4 -left-20 h-96 w-96 rounded-full bg-blue-600/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-20 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-sm rounded-3xl border border-white/20 bg-black/70 p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.25)] backdrop-blur-3xl animate-in zoom-in-95 duration-300">
          {/* Custom Logo Emblem with pulsing radar rings */}
          <div className="relative mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-3xl overflow-hidden border border-white/25 shadow-2xl ring-4 ring-blue-500/20">
            <Image
              src="/logo.png"
              alt="China Bangladesh Connect"
              width={128}
              height={128}
              className="h-full w-full object-cover"
              priority
            />
            <div className="absolute inset-0 rounded-3xl border-2 border-blue-400/40 animate-ping pointer-events-none" />
            <div className="absolute -inset-2 rounded-3xl border border-blue-500/20 animate-pulse pointer-events-none" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 mb-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            <Radio className="h-3 w-3 animate-pulse text-blue-400" />
            Incoming {isVideoCall ? '1080p HD Video Call' : 'Ultra-Low Latency Voice Call'}
          </span>

          <h3 className="text-2xl font-bold text-white tracking-tight mb-1">
            {activePeer?.name}
          </h3>
          <p className="text-xs text-white/50 font-mono mb-4">{activePeer?.email}</p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="outline" className="border-white/15 bg-white/5 text-white/80">
              {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
            </Badge>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              Hong Kong Relay Active
            </Badge>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-10">
            {/* Decline */}
            <div className="flex flex-col items-center gap-2">
              <button
                className="h-16 w-16 rounded-full flex items-center justify-center bg-red-600/90 hover:bg-red-500 text-white shadow-[0_8px_25px_rgba(239,68,68,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] border border-white/20 active:scale-95 transition-all"
                onClick={onReject}
                title="Decline Call"
              >
                <PhoneOff className="h-7 w-7" />
              </button>
              <span className="text-[11px] text-white/60 font-medium">Decline</span>
            </div>

            {/* Accept */}
            <div className="flex flex-col items-center gap-2">
              <button
                className="h-16 w-16 rounded-full flex items-center justify-center bg-emerald-600/90 hover:bg-emerald-500 text-white shadow-[0_8px_25px_rgba(16,185,129,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] border border-white/20 active:scale-95 transition-all animate-bounce"
                onClick={() => {
                  unblockAllAudio();
                  onAnswer();
                }}
                title="Accept Call"
              >
                <Phone className="h-7 w-7" />
              </button>
              <span className="text-[11px] text-emerald-400 font-medium">Accept</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- 2. OUTGOING CALLING SCREEN ---
  if (callState === 'calling') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 backdrop-blur-3xl animate-in fade-in duration-300">
        <div className="absolute top-1/4 -right-20 h-96 w-96 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-sm rounded-3xl border border-white/20 bg-black/70 p-8 text-center shadow-[0_20px_50px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.25)] backdrop-blur-3xl animate-in zoom-in-95 duration-300">
          {/* Custom Logo Emblem */}
          <div className="relative mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-3xl overflow-hidden border border-white/25 shadow-2xl ring-4 ring-blue-500/20">
            <Image
              src="/logo.png"
              alt="China Bangladesh Connect"
              width={128}
              height={128}
              className="h-full w-full object-cover"
              priority
            />
            <div className="absolute inset-0 rounded-3xl border-2 border-blue-400/40 animate-ping pointer-events-none" />
          </div>

          <h3 className="text-xl font-bold text-white mb-1">Calling {activePeer?.name}...</h3>
          <p className="text-xs text-white/60 mb-6 flex items-center justify-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Connecting route via Hong Kong Coturn
          </p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="outline" className="border-white/15 bg-white/5 text-white/80">
              {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
            </Badge>
            <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">
              {isVideoCall ? 'HD Video Call' : 'Voice Call'}
            </Badge>
          </div>

          <div className="flex justify-center">
            <button
              className="h-16 w-16 rounded-full flex items-center justify-center bg-red-600/90 hover:bg-red-500 text-white shadow-[0_8px_25px_rgba(239,68,68,0.5),inset_0_1px_1px_rgba(255,255,255,0.4)] border border-white/20 active:scale-95 transition-all"
              onClick={onEnd}
              title="Cancel Call"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. ACTIVE CONNECTED CALL SCREEN (Full Ultra-HD Audio & Video) ---
  const showRemoteVideo = isVideoCall && !isPeerVideoOff;
  const primaryStream = isSwappedView ? localStream : remoteStream;
  const secondaryStream = isSwappedView ? remoteStream : localStream;

  return (
    <div
      onClick={unblockAllAudio}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none overflow-hidden"
    >
      {/* Offscreen dedicated audio element with unmuted configuration */}
      <audio
        ref={setRemoteAudioEl}
        autoPlay
        playsInline
      />

      {/* Autoplay restriction warning banner */}
      {autoplayBlocked && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            unblockAllAudio();
          }}
          className="absolute top-20 inset-x-4 z-40 mx-auto max-w-md cursor-pointer rounded-2xl border border-amber-500/50 bg-black/90 p-4 shadow-[0_8px_32px_rgba(245,158,11,0.3),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-4"
        >
          <div className="flex items-center gap-3 text-amber-200">
            <Volume2 className="h-6 w-6 shrink-0 animate-bounce text-amber-400" />
            <div className="text-left">
              <p className="text-xs font-bold leading-tight">Browser Audio Muted</p>
              <p className="text-[11px] text-amber-300/80">Tap anywhere on the screen to unmute sound & microphone</p>
            </div>
            <Button
              size="sm"
              className="ml-auto h-8 bg-amber-500 text-black font-bold hover:bg-amber-400 text-xs px-3 rounded-full"
            >
              Tap to Unmute
            </Button>
          </div>
        </div>
      )}

      {/* Top Glassmorphic Liquid HUD (Dynamic Island / Notch protected) */}
      <div
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}
        className="absolute top-0 inset-x-0 z-30 flex items-center justify-between p-4 bg-gradient-to-b from-black/90 via-black/40 to-transparent"
      >
        {/* Left: Mini Emblem, Peer identity and duration */}
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-2xl border border-white/20 shadow-lg ring-2 ring-blue-500/20 shrink-0">
            <Image
              src="/logo.png"
              alt="CN-BD Connect"
              width={44}
              height={44}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm leading-tight text-white">{activePeer?.name}</h4>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-white/15 bg-white/5 text-white/80">
                {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{formatDuration(callDuration)}</span>
            </div>
          </div>
        </div>

        {/* Right: Telemetry & Display Controls */}
        <div className="flex items-center gap-2">
          {/* Fit vs Fill Zoom Toggle for Desktop Screen */}
          {isVideoCall && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setVideoFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'));
              }}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-xs font-mono backdrop-blur-xl hover:bg-white/10 transition-colors shadow-lg"
              title={videoFitMode === 'contain' ? 'Switch to Fill (Cropped)' : 'Switch to Fit (No Zoom)'}
            >
              {videoFitMode === 'contain' ? (
                <>
                  <Layers className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-[10px] text-white/80 hidden sm:inline">Fit (9:16)</span>
                </>
              ) : (
                <>
                  <Crop className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] text-white/80 hidden sm:inline">Fill (Zoom)</span>
                </>
              )}
            </button>
          )}

          {/* Network Stats Chip */}
          {networkStats && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setShowDetailedStats(!showDetailedStats);
              }}
              className="flex items-center gap-2 bg-black/60 border border-white/15 rounded-full px-3 py-1 text-xs font-mono backdrop-blur-xl cursor-pointer hover:bg-white/10 transition-colors shadow-lg"
            >
              <span
                className={`flex items-center gap-1 font-semibold ${
                  networkStats.rttMs < 120
                    ? 'text-emerald-400'
                    : networkStats.rttMs < 220
                      ? 'text-amber-400'
                      : 'text-red-400'
                }`}
              >
                <Activity className="h-3 w-3" />
                {networkStats.rttMs}ms
              </span>
              <span className="text-white/20">|</span>
              <span className="text-white/80">
                {networkStats.bitrateKbps > 1000
                  ? `${(networkStats.bitrateKbps / 1000).toFixed(1)}M`
                  : `${networkStats.bitrateKbps}k`}
              </span>
              <Badge
                variant="outline"
                className="text-[9px] py-0 px-1 border-white/15 bg-white/5 text-blue-400 ml-0.5"
              >
                {networkStats.relayType === 'relay' ? 'HK RELAY' : 'DIRECT P2P'}
              </Badge>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="h-8 w-8 p-0 rounded-full text-white/80 hover:text-white hover:bg-white/10"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Detailed Telemetry Modal */}
      {showDetailedStats && networkStats && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-20 right-4 z-30 w-72 rounded-2xl border border-white/20 bg-black/85 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-3xl text-xs space-y-2.5 animate-in fade-in zoom-in-95"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Route Diagnostics</span>
            </div>
            <button
              onClick={() => setShowDetailedStats(false)}
              className="text-white/50 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Round-Trip Time</span>
              <span className="font-mono font-bold text-emerald-400">{networkStats.rttMs} ms</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Ingress Bitrate</span>
              <span className="font-mono font-bold text-blue-400">{networkStats.bitrateKbps} kbps</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Packet Loss</span>
              <span className="font-mono font-bold text-white/80">{networkStats.packetLossPercent}%</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Transport Mode</span>
              <span className="font-mono font-bold text-indigo-400 uppercase">{networkStats.relayType}</span>
            </div>
            {networkStats.resolution && (
              <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                <span className="text-white/40 block text-[10px]">Resolution</span>
                <span className="font-mono font-bold text-white/80">{networkStats.resolution}</span>
              </div>
            )}
            {networkStats.frameRate !== undefined && networkStats.frameRate > 0 && (
              <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                <span className="text-white/40 block text-[10px]">Frame Rate</span>
                <span className="font-mono font-bold text-emerald-400">{networkStats.frameRate} fps</span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-white/50 bg-black/60 p-2 rounded-xl border border-white/10">
            Route: BD ⇄ AWS Lightsail (Hong Kong ap-east-1) ⇄ CN
          </div>
        </div>
      )}

      {/* Main Remote View Container */}
      <div
        onDoubleClick={() => setVideoFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
      >
        {/* Desktop-only ambient blurred reflection backdrop */}
        {showRemoteVideo && (
          <video
            ref={setAmbientVideoEl}
            autoPlay
            playsInline
            muted
            className="hidden md:block absolute inset-0 w-full h-full object-cover blur-3xl opacity-35 scale-125 pointer-events-none select-none transition-opacity duration-500"
          />
        )}

        {/* Remote Video Element: bound via setRemoteVideoEl and continuous effect */}
        <video
          ref={setRemoteVideoEl}
          autoPlay
          playsInline
          muted={isSpeakerMuted}
          className={`relative z-10 transition-all duration-300 max-h-screen ${
            videoFitMode === 'contain'
              ? 'w-full h-full object-contain'
              : 'w-full h-full object-cover'
          } ${showRemoteVideo ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'}`}
        />

        {/* Peer Status Overlay (Muted or Camera Off badge) */}
        <div className="absolute top-24 left-4 z-20 flex flex-col gap-2 pointer-events-none">
          {isPeerMuted && (
            <div className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-black/70 px-3 py-1 text-xs text-red-400 backdrop-blur-xl shadow-lg animate-in fade-in">
              <MicOff className="h-3.5 w-3.5" />
              <span>Peer is muted</span>
            </div>
          )}
          {isPeerVideoOff && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-black/70 px-3 py-1 text-xs text-amber-400 backdrop-blur-xl shadow-lg animate-in fade-in">
              <VideoOff className="h-3.5 w-3.5" />
              <span>Peer turned camera off</span>
            </div>
          )}
        </div>

        {/* Audio-only or Camera Off: Grand Emblem Display */}
        {(!isVideoCall || isPeerVideoOff || !showRemoteVideo) && (
          <div className="relative z-10 flex flex-col items-center justify-center gap-5 text-center p-6 animate-in fade-in">
            {/* High-res Emblem with pulsing ring */}
            <div className="relative flex h-48 w-48 sm:h-56 sm:w-56 items-center justify-center rounded-3xl overflow-hidden border border-white/20 shadow-2xl ring-8 ring-blue-500/20">
              <Image
                src="/logo.png"
                alt="China Bangladesh Connect Emblem"
                width={224}
                height={224}
                className="h-full w-full object-cover"
                priority
              />
              <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/40 animate-pulse pointer-events-none" />
            </div>

            <div>
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">{activePeer?.name}</h2>
                <Badge variant="outline" className="text-xs border-white/15 bg-white/5 text-white/80">
                  {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
                </Badge>
              </div>
              <p className="text-xs text-white/50 font-mono mt-1">{activePeer?.email}</p>
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Connected via Dedicated Hong Kong Bridge</span>
              </div>
            </div>
          </div>
        )}

        {/* Local Picture-in-Picture Floating Window (Supports Tap to Swap) */}
        {isVideoCall && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsSwappedView(!isSwappedView);
            }}
            className={`absolute bottom-28 right-4 z-20 rounded-2xl overflow-hidden border border-white/25 shadow-2xl bg-black/80 backdrop-blur-xl transition-all duration-300 cursor-pointer group ${
              pipMinimized ? 'h-14 w-14' : 'h-44 w-32 sm:h-52 sm:w-36'
            }`}
            title="Tap to swap main and preview screen"
          >
            <video
              ref={setLocalVideoEl}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${pipMinimized ? 'hidden' : 'block'}`}
            />
            {isVideoOff && !pipMinimized && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-xs text-white/60 p-2 text-center">
                <VideoOff className="h-5 w-5 mb-1 text-white/40" />
                <span>Camera Off</span>
              </div>
            )}
            <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSwappedView(!isSwappedView);
                }}
                className="rounded-full bg-black/70 p-1 text-white/80 hover:text-white"
                title="Swap preview"
              >
                <ArrowUpDown className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPipMinimized(!pipMinimized);
                }}
                className="rounded-full bg-black/70 p-1 text-white/80 hover:text-white"
              >
                {pipMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
              </button>
            </div>
            <span className="absolute bottom-1.5 left-2 text-[10px] font-medium text-white/80 drop-shadow">
              {isSwappedView ? activePeer?.name || 'Peer' : 'You'}
            </span>
          </div>
        )}
      </div>

      {/* Floating Control Dock at Bottom (iOS 26 Liquid Water-Morphism) */}
      <div
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
        className="absolute bottom-3 inset-x-0 z-30 flex items-center justify-center p-3 pointer-events-none"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto flex items-center gap-3 sm:gap-4 rounded-full border border-white/20 bg-black/70 px-5 sm:px-6 py-2.5 sm:py-3 shadow-[0_12px_40px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.25)] backdrop-blur-3xl"
        >
          {/* Mute Mic */}
          <button
            className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center transition-all active:scale-95 border ${
              isMuted
                ? 'bg-red-600/90 text-white border-white/20 shadow-[0_0_20px_rgba(239,68,68,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)]'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
            }`}
            onClick={onToggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="h-5 w-5 sm:h-6 sm:w-6" /> : <Mic className="h-5 w-5 sm:h-6 sm:w-6" />}
          </button>

          {/* Camera Toggle */}
          {isVideoCall && (
            <button
              className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center transition-all active:scale-95 border ${
                isVideoOff
                  ? 'bg-red-600/90 text-white border-white/20 shadow-[0_0_20px_rgba(239,68,68,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)]'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
              }`}
              onClick={onToggleVideo}
              title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {isVideoOff ? <VideoOff className="h-5 w-5 sm:h-6 sm:w-6" /> : <Video className="h-5 w-5 sm:h-6 sm:w-6" />}
            </button>
          )}

          {/* Switch Front/Rear Camera (Mobile) */}
          {isVideoCall && !isVideoOff && (
            <button
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white border border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] transition-all active:scale-95"
              onClick={onSwitchCamera}
              title="Switch Camera (Front/Rear)"
            >
              <SwitchCamera className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          )}

          {/* Speaker Mute/Unmute Toggle */}
          <button
            className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center transition-all active:scale-95 border ${
              isSpeakerMuted
                ? 'bg-red-600/90 text-white border-white/20 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
            }`}
            onClick={toggleSpeakerMute}
            title={isSpeakerMuted ? 'Unmute Speaker' : 'Mute Speaker'}
          >
            {isSpeakerMuted ? <VolumeX className="h-5 w-5 sm:h-6 sm:w-6" /> : <Volume2 className="h-5 w-5 sm:h-6 sm:w-6" />}
          </button>

          {/* Screen Share (Desktop) */}
          {isVideoCall && (
            <button
              className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full hidden sm:flex items-center justify-center transition-all active:scale-95 border ${
                isScreenSharing
                  ? 'bg-blue-600/90 text-white border-white/20 shadow-[0_0_20px_rgba(59,130,246,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)]'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
              }`}
              onClick={onToggleScreenShare}
              title="Share Screen"
            >
              <Monitor className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>
          )}

          {/* End Call Button */}
          <button
            className="h-14 w-14 sm:h-16 sm:w-16 rounded-full flex items-center justify-center bg-red-600/90 hover:bg-red-500 text-white shadow-[0_8px_30px_rgba(239,68,68,0.6),inset_0_1px_1px_rgba(255,255,255,0.4)] border border-white/20 active:scale-95 transition-all"
            onClick={onEnd}
            title="End Call"
          >
            <PhoneOff className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        </div>
      </div>
    </div>
  );
}
