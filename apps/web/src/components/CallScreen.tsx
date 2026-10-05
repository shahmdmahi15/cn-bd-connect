'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  Globe2,
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
  const [callDuration, setCallDuration] = useState(0);

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Bind remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

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

  if (callState === 'idle') return null;

  // --- 1. INCOMING CALL MODAL ---
  if (callState === 'incoming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
        <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/90 p-8 text-center shadow-2xl animate-in fade-in zoom-in-95">
          <div className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-blue-500/10 text-4xl shadow-inner">
            <span className="animate-pulse">
              {activePeer?.country === 'BD' ? '🇧🇩' : '🇨🇳'}
            </span>
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/40 animate-ping pointer-events-none" />
          </div>

          <h3 className="text-xl font-bold text-white mb-1">{activePeer?.name}</h3>
          <p className="text-sm text-slate-400 mb-2">{activePeer?.email}</p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="default">
              {activePeer?.country === 'BD' ? 'Bangladesh' : 'China'}
            </Badge>
            <Badge variant="outline">
              {isVideoCall ? '📹 Video Call' : '📞 Voice Call'}
            </Badge>
          </div>

          <div className="flex items-center justify-center gap-6">
            <Button
              variant="destructive"
              size="icon"
              className="h-16 w-16 shadow-lg shadow-red-600/30"
              onClick={onReject}
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
            <Button
              variant="success"
              size="icon"
              className="h-16 w-16 shadow-lg shadow-emerald-600/30 animate-bounce"
              onClick={onAnswer}
            >
              <Phone className="h-7 w-7" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- 2. OUTGOING CALLING OVERLAY ---
  if (callState === 'calling') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-4">
        <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center shadow-2xl">
          <div className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-blue-600/20 text-4xl">
            <span className="animate-pulse">
              {activePeer?.country === 'BD' ? '🇧🇩' : '🇨🇳'}
            </span>
          </div>

          <h3 className="text-xl font-bold text-white mb-1">Calling {activePeer?.name}...</h3>
          <p className="text-sm text-slate-400 mb-6">Connecting via Hong Kong Relay</p>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Badge variant="default">
              {activePeer?.country === 'BD' ? 'Bangladesh' : 'China'}
            </Badge>
            <Badge variant="outline">
              {isVideoCall ? 'Video Call' : 'Voice Call'}
            </Badge>
          </div>

          <div className="flex justify-center">
            <Button
              variant="destructive"
              size="icon"
              className="h-16 w-16 shadow-lg shadow-red-600/30"
              onClick={onEnd}
            >
              <PhoneOff className="h-7 w-7" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. ACTIVE CONNECTED CALL ---
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      {/* Top HUD: Real-time Telemetry & Call Info */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between p-4 bg-gradient-to-b from-slate-950/90 to-transparent">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-lg">
            {activePeer?.country === 'BD' ? '🇧🇩' : '🇨🇳'}
          </div>
          <div>
            <h4 className="font-semibold text-sm leading-tight">{activePeer?.name}</h4>
            <span className="text-xs text-emerald-400 font-mono">
              ● {formatDuration(callDuration)}
            </span>
          </div>
        </div>

        {/* Live Network Health (RTT, Bitrate, Loss) */}
        {networkStats && (
          <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-full px-3 py-1 text-xs font-mono backdrop-blur-md">
            <span
              className={`flex items-center gap-1 ${
                networkStats.rttMs < 150 ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <Activity className="h-3 w-3" />
              {networkStats.rttMs}ms
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">
              {networkStats.bitrateKbps > 1000
                ? `${(networkStats.bitrateKbps / 1000).toFixed(1)} Mbps`
                : `${networkStats.bitrateKbps} kbps`}
            </span>
            <span className="text-slate-600">|</span>
            <span
              className={
                networkStats.packetLossPercent > 2
                  ? 'text-red-400'
                  : 'text-slate-300'
              }
            >
              {networkStats.packetLossPercent}% loss
            </span>
            <span className="text-slate-600">|</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1 border-slate-700">
              {networkStats.relayType === 'relay' ? 'HK TURNS' : 'P2P'}
            </Badge>
          </div>
        )}
      </div>

      {/* Main Video Area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        {isVideoCall ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="h-32 w-32 rounded-full bg-slate-800 flex items-center justify-center text-5xl shadow-2xl border-2 border-slate-700">
              {activePeer?.country === 'BD' ? '🇧🇩' : '🇨🇳'}
            </div>
            <h2 className="text-2xl font-bold">{activePeer?.name}</h2>
            <p className="text-sm text-slate-400">Audio call connected via Hong Kong</p>
          </div>
        )}

        {/* Local Picture-in-Picture Preview */}
        {isVideoCall && (
          <div className="absolute bottom-24 right-4 z-20 h-40 w-28 sm:h-48 sm:w-36 rounded-2xl overflow-hidden border-2 border-slate-700 shadow-2xl bg-slate-900">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-xs text-slate-400">
                Camera Off
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="absolute bottom-0 inset-x-0 z-30 flex items-center justify-center gap-4 p-6 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
        {/* Mute Mic */}
        <Button
          variant={isMuted ? 'destructive' : 'secondary'}
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
          onClick={onToggleMute}
        >
          {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </Button>

        {/* Camera Toggle */}
        {isVideoCall && (
          <Button
            variant={isVideoOff ? 'destructive' : 'secondary'}
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
            onClick={onToggleVideo}
          >
            {isVideoOff ? (
              <VideoOff className="h-6 w-6" />
            ) : (
              <Video className="h-6 w-6" />
            )}
          </Button>
        )}

        {/* Switch Front/Rear Camera (Mobile) */}
        {isVideoCall && !isVideoOff && (
          <Button
            variant="secondary"
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
            onClick={onSwitchCamera}
          >
            <SwitchCamera className="h-6 w-6" />
          </Button>
        )}

        {/* Screen Share */}
        {isVideoCall && (
          <Button
            variant={isScreenSharing ? 'default' : 'secondary'}
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg hidden sm:inline-flex"
            onClick={onToggleScreenShare}
          >
            <Monitor className="h-6 w-6" />
          </Button>
        )}

        {/* End Call Button */}
        <Button
          variant="destructive"
          size="icon"
          className="h-16 w-16 rounded-full shadow-xl shadow-red-600/40"
          onClick={onEnd}
        >
          <PhoneOff className="h-7 w-7" />
        </Button>
      </div>
    </div>
  );
}
