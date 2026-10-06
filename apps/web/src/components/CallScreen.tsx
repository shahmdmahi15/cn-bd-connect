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
  PictureInPicture2,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  Download,
  File,
  Sliders,
  X as CloseIcon,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { PeerUser, NetworkStats, ChatMessage, FileTransferProgress } from '@/hooks/useWebRTC';

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
  chatMessages?: ChatMessage[];
  fileTransfers?: Record<string, FileTransferProgress>;
  isVoiceClarityEnabled?: boolean;
  isBackgroundBlurEnabled?: boolean;
  onAnswer: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onToggleScreenShare: () => void;
  onSendChatMessage?: (text: string) => void;
  onSendFile?: (file: File) => void;
  onToggleVoiceClarity?: () => void;
  onToggleBackgroundBlur?: () => void;
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
  chatMessages = [],
  fileTransfers = {},
  isVoiceClarityEnabled = true,
  isBackgroundBlurEnabled = false,
  onAnswer,
  onReject,
  onEnd,
  onToggleMute,
  onToggleVideo,
  onSwitchCamera,
  onToggleScreenShare,
  onSendChatMessage,
  onSendFile,
  onToggleVoiceClarity,
  onToggleBackgroundBlur,
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

  // In-Call Chat & Instant File Sharing State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInputText, setChatInputText] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessagesLengthRef = useRef(0);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const total = chatMessages?.length || 0;
    if (total > prevMessagesLengthRef.current) {
      if (!isChatOpen) {
        setUnreadCount((c) => c + (total - prevMessagesLengthRef.current));
      }
      prevMessagesLengthRef.current = total;
    }
  }, [chatMessages, isChatOpen]);

  const openChat = () => {
    setIsChatOpen(true);
    setUnreadCount(0);
  };

  useEffect(() => {
    if (isChatOpen) {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatOpen]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInputText.trim() || !onSendChatMessage) return;
    onSendChatMessage(chatInputText.trim());
    setChatInputText('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
      e.target.value = '';
    }
  };

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
      remoteVideoRef.current.volume = 1.0;
      remoteVideoRef.current.muted = false;
      remoteVideoRef.current.play().catch(() => {
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

  // Cross-browser safe fullscreen (handles iOS WebKit / Safari and standard Fullscreen API)
  const toggleFullscreen = () => {
    const doc: any = document;
    const docEl: any = document.documentElement;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  // Native Picture-in-Picture API for PC, Mac, and Android multitasking
  const [isNativePiPActive, setIsNativePiPActive] = useState(false);
  const toggleNativePiP = async () => {
    try {
      const doc: any = document;
      if (doc.pictureInPictureElement) {
        await doc.exitPictureInPicture();
        setIsNativePiPActive(false);
      } else if (remoteVideoRef.current && (doc.pictureInPictureEnabled || (remoteVideoRef.current as any).webkitSupportsPresentationMode)) {
        if (remoteVideoRef.current.requestPictureInPicture) {
          await remoteVideoRef.current.requestPictureInPicture();
        } else if ((remoteVideoRef.current as any).webkitSetPresentationMode) {
          (remoteVideoRef.current as any).webkitSetPresentationMode('picture-in-picture');
        }
        setIsNativePiPActive(true);
      }
    } catch (err) {
      console.warn('[CallScreen] Picture-in-Picture toggle notice:', err);
    }
  };

  // Auto Picture-in-Picture on multitasking / tab backgrounding / home gesture
  useEffect(() => {
    if (callState !== 'connected' || !isVideoCall) return;

    const handleVisibilityChange = async () => {
      try {
        const doc: any = document;
        if (doc.hidden) {
          if (!doc.pictureInPictureElement && remoteVideoRef.current) {
            if (remoteVideoRef.current.requestPictureInPicture) {
              await remoteVideoRef.current.requestPictureInPicture();
              setIsNativePiPActive(true);
            } else if ((remoteVideoRef.current as any).webkitSetPresentationMode) {
              (remoteVideoRef.current as any).webkitSetPresentationMode('picture-in-picture');
              setIsNativePiPActive(true);
            }
          }
        }
      } catch (err) {
        console.warn('[CallScreen] Auto-PiP notice:', err);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [callState, isVideoCall]);

  // Keep PiP active state accurate with browser native PiP window events
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    const handleEnter = () => setIsNativePiPActive(true);
    const handleLeave = () => setIsNativePiPActive(false);
    video.addEventListener('enterpictureinpicture', handleEnter);
    video.addEventListener('leavepictureinpicture', handleLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnter);
      video.removeEventListener('leavepictureinpicture', handleLeave);
    };
  }, [callState]);

  // Desktop & Laptop Keyboard Shortcuts (Space/M to Mute, V for Video, F for Fullscreen, P for PiP)
  useEffect(() => {
    if (callState !== 'connected') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'KeyM' || (e.code === 'Space' && !e.repeat)) {
        e.preventDefault();
        onToggleMute();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        onToggleVideo();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        toggleNativePiP();
      } else if (e.code === 'Escape') {
        setShowDetailedStats(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [callState, onToggleMute, onToggleVideo]);

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
          className="absolute top-24 inset-x-4 z-40 mx-auto max-w-md cursor-pointer rounded-2xl border border-amber-500/50 bg-black/90 p-4 shadow-[0_8px_32px_rgba(245,158,11,0.3),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-4"
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
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 20px)' }}
        className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-3 sm:px-5 py-3 bg-gradient-to-b from-black/90 via-black/40 to-transparent"
      >
        {/* Left: Mini Emblem, Peer identity and duration (No text wrapping on mobile!) */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
          <div className="relative h-10 w-10 sm:h-11 sm:w-11 overflow-hidden rounded-2xl border border-white/20 shadow-lg ring-2 ring-blue-500/20 shrink-0">
            <Image
              src="/logo.png"
              alt="CN-BD Connect"
              width={44}
              height={44}
              className="h-full w-full object-cover"
              priority
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-semibold text-sm leading-tight text-white truncate max-w-[110px] sm:max-w-[180px]">
                {activePeer?.name}
              </h4>
              <span className="text-xs shrink-0">
                {activePeer?.country === 'BD' ? '🇧🇩' : '🇨🇳'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{formatDuration(callDuration)}</span>
            </div>
          </div>
        </div>

        {/* Right: Telemetry & Display Controls (Compact on mobile) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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

          {/* Studio Voice Clarity Equalizer Toggle */}
          {onToggleVoiceClarity && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleVoiceClarity();
              }}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono backdrop-blur-xl transition-all shadow-lg ${
                isVoiceClarityEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-black/60 border-white/15 text-white/50 hover:text-white'
              }`}
              title={
                isVoiceClarityEnabled
                  ? 'Voice Clarity Active: 80Hz Cut + 2.5kHz Vocal Boost + Compression'
                  : 'Voice Clarity Off (Flat Bypass)'
              }
            >
              <Sparkles className={`h-3.5 w-3.5 ${isVoiceClarityEnabled ? 'text-emerald-400' : 'text-white/40'}`} />
              <span className="text-[10px] hidden sm:inline">Clarity</span>
            </button>
          )}

          {/* AI / Canvas Background Blur Toggle */}
          {isVideoCall && onToggleBackgroundBlur && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleBackgroundBlur();
              }}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono backdrop-blur-xl transition-all shadow-lg ${
                isBackgroundBlurEnabled
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'bg-black/60 border-white/15 text-white/50 hover:text-white'
              }`}
              title={isBackgroundBlurEnabled ? 'Background Blur Active' : 'Background Blur Off'}
            >
              <Sliders className={`h-3.5 w-3.5 ${isBackgroundBlurEnabled ? 'text-blue-400' : 'text-white/40'}`} />
              <span className="text-[10px] hidden sm:inline">Blur</span>
            </button>
          )}

          {/* Network Stats Chip (Compact on mobile) */}
          {networkStats && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setShowDetailedStats(!showDetailedStats);
              }}
              className="flex items-center gap-1.5 sm:gap-2 bg-black/60 border border-white/15 rounded-full px-2.5 sm:px-3 py-1 text-xs font-mono backdrop-blur-xl cursor-pointer hover:bg-white/10 transition-colors shadow-lg"
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
              <span className="text-white/20 hidden sm:inline">|</span>
              <span className="text-white/80 hidden sm:inline">
                {networkStats.bitrateKbps > 1000
                  ? `${(networkStats.bitrateKbps / 1000).toFixed(1)}M`
                  : `${networkStats.bitrateKbps}k`}
              </span>
              {networkStats.adaptiveQuality && (
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-sans font-bold flex items-center gap-1 ${
                    networkStats.qualityTier === 'excellent'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : networkStats.qualityTier === 'good'
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : networkStats.qualityTier === 'fair'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  {networkStats.adaptiveQuality.replace('Auto ', '')}
                </span>
              )}
              <Badge
                variant="outline"
                className="text-[9px] py-0 px-1 border-white/15 bg-white/5 text-blue-400 ml-0.5"
              >
                {networkStats.relayType === 'relay' ? 'HK RELAY' : 'DIRECT P2P'}
              </Badge>
            </div>
          )}

          {/* Native Picture-in-Picture Button (multitasking on PC/Android) */}
          {isVideoCall && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNativePiP();
              }}
              className="flex items-center justify-center h-8 w-8 rounded-full border border-white/15 bg-black/60 text-white/80 hover:text-white hover:bg-white/10 transition-colors shadow-lg"
              title="Picture in Picture (P)"
            >
              <PictureInPicture2 className={`h-4 w-4 ${isNativePiPActive ? 'text-blue-400' : 'text-white/80'}`} />
            </button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            className="h-8 w-8 p-0 rounded-full text-white/80 hover:text-white hover:bg-white/10"
            title="Fullscreen (F)"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Detailed Telemetry Modal */}
      {showDetailedStats && networkStats && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-24 right-4 z-30 w-72 rounded-2xl border border-white/20 bg-black/85 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-3xl text-xs space-y-2.5 animate-in fade-in zoom-in-95"
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
            {networkStats.adaptiveQuality && (
              <div className="bg-white/5 p-2 rounded-xl border border-white/5 col-span-2 flex items-center justify-between">
                <div>
                  <span className="text-white/40 block text-[10px]">Adaptive Video Quality</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {networkStats.adaptiveQuality}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="text-[9px] bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                >
                  Dynamic ABR
                </Badge>
              </div>
            )}
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Round-Trip Time</span>
              <span className="font-mono font-bold text-emerald-400">{networkStats.rttMs} ms</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Ingress Bitrate</span>
              <span className="font-mono font-bold text-blue-400">{networkStats.bitrateKbps} kbps</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Video Codec</span>
              <span className="font-mono font-bold text-amber-300">H.264 HW-Acc</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/5">
              <span className="text-white/40 block text-[10px]">Audio Engine</span>
              <span className="font-mono font-bold text-emerald-300">Opus 48k FEC</span>
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
            {networkStats.jitterMs !== undefined && (
              <div className="bg-white/5 p-2 rounded-xl border border-white/5 col-span-2 flex items-center justify-between">
                <span className="text-white/40 text-[10px]">Network Jitter</span>
                <span className="font-mono font-bold text-white/80">{networkStats.jitterMs} ms</span>
              </div>
            )}
          </div>
          <div className="text-[10px] text-white/50 bg-black/60 p-2 rounded-xl border border-white/10">
            Route: BD ⇄ AWS Lightsail (Hong Kong ap-east-1) ⇄ CN
          </div>
        </div>
      )}

      {/* Main Remote View Container (Strict Vertical Flex Column, perfectly centered) */}
      <div
        onDoubleClick={() => setVideoFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
        className="relative flex-1 w-full h-full bg-black flex flex-col items-center justify-center overflow-hidden"
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

        {/* Remote Video Element: absolute inset-0 so it NEVER disturbs flex positioning */}
        {isVideoCall && (
          <video
            ref={setRemoteVideoEl}
            autoPlay
            playsInline
            muted={isSpeakerMuted}
            className={`absolute inset-0 w-full h-full transition-all duration-300 ${
              videoFitMode === 'contain' ? 'object-contain' : 'object-cover'
            } ${showRemoteVideo ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none -z-10'}`}
          />
        )}

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

        {/* Audio-only or Camera Off: Grand Emblem Display (Guaranteed perfectly centered!) */}
        {(!isVideoCall || isPeerVideoOff || !showRemoteVideo) && (
          <div className="relative z-20 w-full max-w-sm px-4 flex flex-col items-center justify-center gap-4 sm:gap-5 text-center animate-in fade-in">
            {/* High-res Emblem with pulsing ring */}
            <div className="relative flex h-36 w-36 sm:h-48 sm:w-48 items-center justify-center rounded-3xl overflow-hidden border border-white/20 shadow-2xl ring-4 sm:ring-8 ring-blue-500/20 mx-auto">
              <Image
                src="/logo.png"
                alt="China Bangladesh Connect Emblem"
                width={192}
                height={192}
                className="h-full w-full object-cover"
                priority
              />
              <div className="absolute inset-0 rounded-3xl border-2 border-emerald-500/40 animate-pulse pointer-events-none" />
            </div>

            <div className="w-full">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{activePeer?.name}</h2>
                <Badge variant="outline" className="text-xs border-white/15 bg-white/5 text-white/80">
                  {activePeer?.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
                </Badge>
              </div>
              <p className="text-xs text-white/50 font-mono mt-1 truncate">{activePeer?.email}</p>
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Connected via Dedicated Hong Kong Bridge</span>
              </div>
            </div>
          </div>
        )}

        {/* Local Picture-in-Picture Floating Window (Supports Tap to Swap, Video calls only) */}
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

      {/* Floating Control Dock at Bottom (iOS 26 Liquid Water-Morphism with Home Bar clearance) */}
      <div
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)' }}
        className="absolute bottom-3 sm:bottom-5 inset-x-0 z-30 flex items-center justify-center p-3 pointer-events-none"
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

          {/* In-Call P2P Chat & File Sharing Toggle Button */}
          {onSendChatMessage && (
            <button
              className={`relative h-12 w-12 sm:h-14 sm:w-14 rounded-full flex items-center justify-center transition-all active:scale-95 border ${
                isChatOpen
                  ? 'bg-blue-600/90 text-white border-white/20 shadow-[0_0_20px_rgba(59,130,246,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)]'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]'
              }`}
              onClick={() => (isChatOpen ? setIsChatOpen(false) : openChat())}
              title="In-Call P2P Chat & File Sharing"
            >
              <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6" />
              {unreadCount > 0 && !isChatOpen && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white border-2 border-black animate-pulse">
                  {unreadCount}
                </span>
              )}
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

      {/* In-Call P2P Chat & Instant File Sharing Drawer (Liquid Water-Morphism) */}
      {isChatOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 z-40 w-full sm:w-96 flex flex-col bg-black/95 border-l border-white/20 backdrop-blur-3xl shadow-[0_0_60px_rgba(0,0,0,0.95)] animate-in slide-in-from-right duration-300"
        >
          {/* Chat Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-400" />
              <span className="font-semibold text-sm text-white">In-Call Chat & Files</span>
              <Badge variant="outline" className="text-[10px] bg-blue-500/10 border-blue-500/30 text-blue-300">
                P2P Encrypted
              </Badge>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Active File Transfers Progress Bar */}
          {Object.values(fileTransfers).length > 0 && (
            <div className="p-3 border-b border-white/10 bg-white/[0.03] space-y-2 max-h-36 overflow-y-auto">
              <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">File Transfers</span>
              {Object.values(fileTransfers).map((ft) => (
                <div key={ft.fileId} className="bg-black/60 border border-white/10 rounded-xl p-2 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white/80 font-medium truncate max-w-[180px]">{ft.fileName}</span>
                    <span className="text-white/50 text-[10px]">
                      {ft.status === 'completed' ? 'Done' : `${ft.progress}%`}
                    </span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        ft.status === 'completed' ? 'bg-emerald-400' : 'bg-blue-500'
                      }`}
                      style={{ width: `${ft.progress}%` }}
                    />
                  </div>
                  {ft.url && (
                    <a
                      href={ft.url}
                      download={ft.fileName}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                    >
                      <Download className="h-3 w-3" /> Download {ft.fileName}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Message List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-white/40 p-4">
                <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-xs">No messages yet in this call.</p>
                <p className="text-[10px] text-white/30 mt-1">
                  Send instant text messages or share files peer-to-peer without server storage.
                </p>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.isSelf ? 'items-end' : 'items-start'}`}
                >
                  <span className="text-[10px] text-white/40 px-1 mb-0.5">
                    {msg.isSelf ? 'You' : msg.senderName}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs break-words shadow-lg border ${
                      msg.isSelf
                        ? 'bg-blue-600/80 text-white border-blue-400/30'
                        : 'bg-white/10 text-white/90 border-white/15'
                    }`}
                  >
                    {msg.file ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <File className="h-4 w-4 shrink-0 text-blue-300" />
                          <div className="truncate">
                            <span className="font-semibold block truncate">{msg.file.fileName}</span>
                            <span className="text-[10px] opacity-75 font-mono">
                              {(msg.file.fileSize / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>
                        {msg.file.url && (
                          <a
                            href={msg.file.url}
                            download={msg.file.fileName}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 hover:bg-black/60 text-[11px] font-medium border border-white/20 transition-colors"
                          >
                            <Download className="h-3 w-3" /> Download
                          </a>
                        )}
                      </div>
                    ) : (
                      <span>{msg.text}</span>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Chat Input Row */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/10 transition-colors"
              title="Attach File (P2P Transfer)"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={chatInputText}
              onChange={(e) => setChatInputText(e.target.value)}
              placeholder="Type message..."
              className="flex-1 bg-black/50 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={!chatInputText.trim()}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium border border-white/20 transition-all active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
