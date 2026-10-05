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
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { PeerUser, NetworkStats } from '@/hooks/useWebRTC';

interface CallScreenProps {
  callState: 'idle' | 'calling' | 'incoming' | 'connected' | 'ended';
  activePeer: PeerUser | null;
  isVideoCall: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  networkStats: NetworkStats | null;
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
  onAnswer,
  onReject,
  onEnd,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onToggleScreenShare,
}: CallScreenProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [callDuration, setCallDuration] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pipMinimized, setPipMinimized] = useState(false);
  const [hasRemoteVideoTrack, setHasRemoteVideoTrack] = useState(false);

  // Play audio/video safely across iOS Safari, Android Chrome, and Desktop
  const attemptPlayback = useCallback(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      const vPromise = remoteVideoRef.current.play();
      if (vPromise !== undefined) {
        vPromise
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            console.warn('[CallScreen] Remote video autoplay prevented:', err);
            setAutoplayBlocked(true);
          });
      }
    }

    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      const aPromise = remoteAudioRef.current.play();
      if (aPromise !== undefined) {
        aPromise
          .then(() => {
            setAutoplayBlocked(false);
          })
          .catch((err) => {
            console.warn('[CallScreen] Remote audio autoplay prevented:', err);
            setAutoplayBlocked(true);
          });
      }
    }
  }, [remoteStream]);

  // Handle local video element binding
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch((e) => console.warn('Local preview play error:', e));
    }
  }, [localStream, callState]);

  // Handle remote media binding and track inspection
  useEffect(() => {
    if (remoteStream) {
      const vTracks = remoteStream.getVideoTracks();
      const aTracks = remoteStream.getAudioTracks();
      console.log(
        `[CallScreen] Binding remote stream: ${vTracks.length} video tracks, ${aTracks.length} audio tracks`,
      );
      setHasRemoteVideoTrack(vTracks.length > 0 && vTracks.some((t) => t.enabled));
      attemptPlayback();
    } else {
      setHasRemoteVideoTrack(false);
    }
  }, [remoteStream, attemptPlayback]);

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

  const handleUnblockAutoplay = () => {
    setAutoplayBlocked(false);
    attemptPlayback();
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

  if (callState === 'idle') return null;

  // --- 1. INCOMING CALL SCREEN ---
  if (callState === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-2xl p-4">
        {/* Ambient background glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-blue-900/30 via-slate-950 to-emerald-950/20 pointer-events-none" />

        <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/80 p-8 text-center shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95">
          {/* Custom Logo Emblem with pulsing radar rings */}
          <div className="relative mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl ring-4 ring-blue-500/30">
            <Image
              src="/logo.png"
              alt="China Bangladesh Connect"
              width={128}
              height={128}
              className="h-full w-full object-cover"
              priority
            />
            <div className="absolute inset-0 rounded-3xl border-2 border-blue-400/40 animate-ping pointer-events-none" />
            <div className="absolute -inset-3 rounded-3xl border border-blue-500/20 animate-pulse pointer-events-none" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-3">
            <Zap className="h-3 w-3 animate-bounce" />
            Incoming {isVideoCall ? 'HD Video Call' : 'Ultra-Low Latency Audio Call'}
          </span>

          <h3 className="text-2xl font-bold text-white tracking-tight mb-1">
            {activePeer?.name}
          </h3>
          <p className="text-xs text-slate-400 font-mono mb-4">{activePeer?.email}</p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-slate-300">
              {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
            </Badge>
            <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-emerald-400">
              Hong Kong Relay Ready
            </Badge>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-8">
            {/* Decline */}
            <div className="flex flex-col items-center gap-2">
              <Button
                variant="destructive"
                size="icon"
                className="h-16 w-16 rounded-full shadow-lg shadow-red-600/40 hover:scale-105 transition-transform"
                onClick={onReject}
              >
                <PhoneOff className="h-7 w-7" />
              </Button>
              <span className="text-[11px] text-slate-400 font-medium">Decline</span>
            </div>

            {/* Accept */}
            <div className="flex flex-col items-center gap-2">
              <Button
                variant="success"
                size="icon"
                className="h-16 w-16 rounded-full shadow-lg shadow-emerald-500/40 bg-emerald-500 hover:bg-emerald-400 hover:scale-105 transition-transform animate-bounce"
                onClick={onAnswer}
              >
                <Phone className="h-7 w-7 text-white" />
              </Button>
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-2xl">
        <div className="absolute inset-0 bg-radial from-blue-900/20 via-slate-950 to-slate-950 pointer-events-none" />

        <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          {/* Custom Logo Emblem */}
          <div className="relative mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl ring-4 ring-blue-500/30">
            <Image
              src="/logo.png"
              alt="China Bangladesh Connect"
              width={128}
              height={128}
              className="h-full w-full object-cover"
              priority
            />
            <div className="absolute inset-0 rounded-3xl border-2 border-blue-400/30 animate-ping pointer-events-none" />
          </div>

          <h3 className="text-xl font-bold text-white mb-1">Calling {activePeer?.name}...</h3>
          <p className="text-xs text-slate-400 mb-6 flex items-center justify-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Establishing secure route via Hong Kong Coturn
          </p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="outline" className="border-slate-800 bg-slate-800/60 text-slate-300">
              {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
            </Badge>
            <Badge variant="outline" className="border-slate-800 bg-slate-800/60 text-blue-400">
              {isVideoCall ? 'Video Call' : 'Voice Call'}
            </Badge>
          </div>

          <div className="flex justify-center">
            <Button
              variant="destructive"
              size="icon"
              className="h-16 w-16 rounded-full shadow-lg shadow-red-600/40 hover:scale-105 transition-transform"
              onClick={onEnd}
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. ACTIVE CONNECTED CALL SCREEN ---
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none overflow-hidden">
      {/* Background audio element to guarantee playback independent of video rendering */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Autoplay restriction fallback banner */}
      {autoplayBlocked && (
        <div
          onClick={handleUnblockAutoplay}
          className="absolute top-16 inset-x-4 z-40 mx-auto max-w-md cursor-pointer rounded-2xl border border-amber-500/40 bg-amber-500/20 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-4"
        >
          <div className="flex items-center gap-3 text-amber-200">
            <Volume2 className="h-6 w-6 shrink-0 animate-bounce text-amber-400" />
            <div className="text-left">
              <p className="text-xs font-bold leading-tight">Sound / Video Paused by Browser</p>
              <p className="text-[11px] text-amber-300/80">Tap anywhere on this banner to enable audio & video</p>
            </div>
            <Button
              size="sm"
              className="ml-auto h-8 bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 text-xs px-3"
            >
              Tap to Play
            </Button>
          </div>
        </div>
      )}

      {/* Top Glassmorphic HUD */}
      <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between p-4 bg-gradient-to-b from-slate-950/90 via-slate-950/40 to-transparent">
        {/* Left: Mini Emblem, Peer identity and duration */}
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-2xl border border-white/20 shadow ring-2 ring-blue-500/20 shrink-0">
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
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-slate-700 bg-slate-900/60 text-slate-300">
                {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{formatDuration(callDuration)}</span>
            </div>
          </div>
        </div>

        {/* Right: Real-time Telemetry & Quality HUD */}
        <div className="flex items-center gap-2">
          {networkStats && (
            <div
              onClick={() => setShowDetailedStats(!showDetailedStats)}
              className="flex items-center gap-2 bg-slate-900/80 border border-white/10 rounded-full px-3 py-1 text-xs font-mono backdrop-blur-md cursor-pointer hover:bg-slate-800/80 transition-colors shadow-lg"
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
              <span className="text-slate-600">|</span>
              <span className="text-slate-300">
                {networkStats.bitrateKbps > 1000
                  ? `${(networkStats.bitrateKbps / 1000).toFixed(1)}M`
                  : `${networkStats.bitrateKbps}k`}
              </span>
              <span className="text-slate-600">|</span>
              <span
                className={
                  networkStats.packetLossPercent > 2 ? 'text-red-400' : 'text-slate-400'
                }
              >
                {networkStats.packetLossPercent}%
              </span>
              <Badge
                variant="outline"
                className="text-[9px] py-0 px-1 border-white/10 bg-slate-800 text-blue-400 ml-0.5"
              >
                {networkStats.relayType === 'relay' ? 'HK RELAY' : 'DIRECT P2P'}
              </Badge>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="h-8 w-8 p-0 rounded-full text-slate-300 hover:text-white hover:bg-white/10"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Detailed Telemetry Drawer Modal */}
      {showDetailedStats && networkStats && (
        <div className="absolute top-16 right-4 z-30 w-72 rounded-2xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-2xl text-xs space-y-2.5 animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Route Diagnostics</span>
            </div>
            <button
              onClick={() => setShowDetailedStats(false)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-slate-800/50 p-2 rounded-xl">
              <span className="text-slate-400 block text-[10px]">Round-Trip Time</span>
              <span className="font-mono font-bold text-emerald-400">{networkStats.rttMs} ms</span>
            </div>
            <div className="bg-slate-800/50 p-2 rounded-xl">
              <span className="text-slate-400 block text-[10px]">Ingress Bitrate</span>
              <span className="font-mono font-bold text-blue-400">{networkStats.bitrateKbps} kbps</span>
            </div>
            <div className="bg-slate-800/50 p-2 rounded-xl">
              <span className="text-slate-400 block text-[10px]">Packet Loss</span>
              <span className="font-mono font-bold text-slate-200">{networkStats.packetLossPercent}%</span>
            </div>
            <div className="bg-slate-800/50 p-2 rounded-xl">
              <span className="text-slate-400 block text-[10px]">Transport Mode</span>
              <span className="font-mono font-bold text-indigo-400 uppercase">{networkStats.relayType}</span>
            </div>
            {networkStats.resolution && (
              <div className="bg-slate-800/50 p-2 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Resolution</span>
                <span className="font-mono font-bold text-slate-200">{networkStats.resolution}</span>
              </div>
            )}
            {networkStats.frameRate !== undefined && networkStats.frameRate > 0 && (
              <div className="bg-slate-800/50 p-2 rounded-xl">
                <span className="text-slate-400 block text-[10px]">Frame Rate</span>
                <span className="font-mono font-bold text-emerald-400">{networkStats.frameRate} fps</span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-slate-400 bg-slate-950/60 p-2 rounded-xl border border-slate-800">
            Route: BD ⇄ AWS Lightsail (Hong Kong ap-east-1) ⇄ CN
          </div>
        </div>
      )}

      {/* Main Remote View Container */}
      <div className="relative flex-1 bg-slate-950 flex items-center justify-center overflow-hidden">
        {/* Remote Video Element */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isVideoCall && hasRemoteVideoTrack ? 'opacity-100' : 'opacity-0 absolute pointer-events-none'
          }`}
        />

        {/* Audio-only or Camera Off: Grand Emblem Display */}
        {(!isVideoCall || !hasRemoteVideoTrack) && (
          <div className="flex flex-col items-center justify-center gap-5 text-center p-6 animate-in fade-in">
            {/* High-res Emblem with pulsing ring */}
            <div className="relative flex h-48 w-48 sm:h-56 sm:w-56 items-center justify-center rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl ring-8 ring-blue-500/20">
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
                <Badge variant="outline" className="text-xs border-slate-700 bg-slate-900/60 text-slate-300">
                  {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
                </Badge>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-1">{activePeer?.email}</p>
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Connected via Dedicated Hong Kong Bridge</span>
              </div>
            </div>
          </div>
        )}

        {/* Local Picture-in-Picture Floating Window */}
        {isVideoCall && (
          <div
            className={`absolute bottom-24 right-4 z-20 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-slate-900 transition-all duration-300 ${
              pipMinimized ? 'h-14 w-14' : 'h-44 w-32 sm:h-52 sm:w-36'
            }`}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${pipMinimized ? 'hidden' : 'block'}`}
            />
            {isVideoOff && !pipMinimized && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-xs text-slate-400 p-2 text-center">
                <VideoOff className="h-5 w-5 mb-1 text-slate-500" />
                <span>Camera Off</span>
              </div>
            )}
            <button
              onClick={() => setPipMinimized(!pipMinimized)}
              className="absolute top-1.5 right-1.5 z-10 rounded-full bg-slate-950/70 p-1 text-slate-300 hover:text-white"
            >
              {pipMinimized ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
            </button>
            <span className="absolute bottom-1.5 left-2 text-[10px] font-medium text-white/80 drop-shadow">
              You
            </span>
          </div>
        )}
      </div>

      {/* Floating Control Island at Bottom */}
      <div className="absolute bottom-4 inset-x-0 z-30 flex items-center justify-center p-3 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 sm:gap-4 rounded-full border border-white/10 bg-slate-900/80 px-6 py-3 shadow-2xl backdrop-blur-2xl">
          {/* Mute Mic */}
          <Button
            variant={isMuted ? 'destructive' : 'secondary'}
            size="icon"
            className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg transition-transform hover:scale-105 ${
              isMuted ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30' : 'bg-slate-800 hover:bg-slate-700'
            }`}
            onClick={onToggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <MicOff className="h-5 w-5 sm:h-6 sm:w-6" /> : <Mic className="h-5 w-5 sm:h-6 sm:w-6" />}
          </Button>

          {/* Camera Toggle */}
          {isVideoCall && (
            <Button
              variant={isVideoOff ? 'destructive' : 'secondary'}
              size="icon"
              className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg transition-transform hover:scale-105 ${
                isVideoOff ? 'bg-red-600 hover:bg-red-500 shadow-red-600/30' : 'bg-slate-800 hover:bg-slate-700'
              }`}
              onClick={onToggleVideo}
              title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {isVideoOff ? <VideoOff className="h-5 w-5 sm:h-6 sm:w-6" /> : <Video className="h-5 w-5 sm:h-6 sm:w-6" />}
            </Button>
          )}

          {/* Switch Front/Rear Camera (Mobile) */}
          {isVideoCall && !isVideoOff && (
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-slate-800 hover:bg-slate-700 shadow-lg transition-transform hover:scale-105"
              onClick={onSwitchCamera}
              title="Switch Camera (Front/Rear)"
            >
              <SwitchCamera className="h-5 w-5 sm:h-6 sm:w-6" />
            </Button>
          )}

          {/* Screen Share (Desktop) */}
          {isVideoCall && (
            <Button
              variant={isScreenSharing ? 'default' : 'secondary'}
              size="icon"
              className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg hidden sm:inline-flex transition-transform hover:scale-105 ${
                isScreenSharing ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800 hover:bg-slate-700'
              }`}
              onClick={onToggleScreenShare}
              title="Share Screen"
            >
              <Monitor className="h-5 w-5 sm:h-6 sm:w-6" />
            </Button>
          )}

          {/* End Call Button */}
          <Button
            variant="destructive"
            size="icon"
            className="h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-red-600 hover:bg-red-500 shadow-xl shadow-red-600/50 hover:scale-105 transition-transform"
            onClick={onEnd}
            title="End Call"
          >
            <PhoneOff className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
          </Button>
        </div>
      </div>
    </div>
  );
}
