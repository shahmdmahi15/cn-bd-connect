'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import {
  Video,
  Phone,
  UserPlus,
  Users,
  Check,
  X,
  LogOut,
  Sparkles,
  ShieldCheck,
  Radio,
  RefreshCw,
  Search,
  Copy,
  CheckCircle2,
  Globe2,
  Server,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CallScreen } from '@/components/CallScreen';
import { useWebRTC } from '@/hooks/useWebRTC';
import { getSocket, disconnectSocket } from '@/lib/socket';

interface User {
  id: string;
  name: string;
  email: string;
  country: string;
  isOnline?: boolean;
}

interface FriendRequest {
  id: string;
  sender: User;
  createdAt: string;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Auth Form State
  const [isRegister, setIsRegister] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authCountry, setAuthCountry] = useState<'BD' | 'CN'>('BD');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard State
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [targetEmail, setTargetEmail] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // WebRTC Hook
  const webrtc = useWebRTC(currentUser);

  // 1. Initial Auth Check
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      fetchProfile(savedToken);
    } else {
      setIsAuthLoading(false);
    }
  }, []);

  const fetchProfile = async (authToken: string) => {
    try {
      const res = await fetch('/api/proxy/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const user = await res.json().catch(() => null);
        if (user) {
          setCurrentUser(user);
          getSocket(authToken);
        } else {
          handleLogout();
        }
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/proxy/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMsg = data
          ? Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message || data.error
          : `Server error (${res.status})`;
        throw new Error(errorMsg || 'Login failed');
      }

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      getSocket(data.token);
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/proxy/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          name: authName,
          country: authCountry,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMsg = data
          ? Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message || data.error
          : `Server error (${res.status})`;
        throw new Error(errorMsg || 'Registration failed');
      }

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      getSocket(data.token);
    } catch (err: any) {
      setAuthError(err.message || 'Registration failed');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setCurrentUser(null);
    disconnectSocket();
  };

  // 2. Fetch Friends and Requests
  const loadDashboardData = useCallback(async () => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        fetch('/api/proxy/friends', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/proxy/friends/requests', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (friendsRes.ok) {
        const friendsList = await friendsRes.json().catch(() => []);
        setFriends(friendsList || []);
      }
      if (requestsRes.ok) {
        const requestsData = await requestsRes.json().catch(() => ({}));
        setRequests(requestsData?.incoming || []);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (currentUser) {
      loadDashboardData();
    }
  }, [currentUser, loadDashboardData]);

  // 3. Real-Time WebSocket Listeners for Friends & Presence
  useEffect(() => {
    if (!currentUser) return;
    const socket = getSocket();

    const handlePresence = (data: { userId: string; isOnline: boolean }) => {
      setFriends((prev) =>
        prev.map((friend) =>
          friend.id === data.userId
            ? { ...friend, isOnline: data.isOnline }
            : friend,
        ),
      );
    };

    const handleRequestReceived = () => {
      loadDashboardData();
      setActionMessage({
        type: 'success',
        text: 'New incoming friend request received!',
      });
    };

    const handleRequestAccepted = () => {
      loadDashboardData();
    };

    socket.on('friend:presence', handlePresence);
    socket.on('friend:request_received', handleRequestReceived);
    socket.on('friend:request_accepted', handleRequestAccepted);

    return () => {
      socket.off('friend:presence', handlePresence);
      socket.off('friend:request_received', handleRequestReceived);
      socket.off('friend:request_accepted', handleRequestAccepted);
    };
  }, [currentUser, loadDashboardData]);

  // 4. Send Friend Request by Email
  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEmail.trim()) return;

    setActionMessage(null);
    try {
      const res = await fetch('/api/proxy/friends/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: targetEmail.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errorMsg = data
          ? Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message || data.error
          : `Server error (${res.status})`;
        throw new Error(errorMsg || 'Failed to send request');
      }

      setActionMessage({
        type: 'success',
        text: `Friend request sent to ${targetEmail}!`,
      });
      setTargetEmail('');
      loadDashboardData();
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to send request',
      });
    }
  };

  // 5. Accept Friend Request
  const handleAcceptRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/proxy/friends/requests/${requestId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setActionMessage({
          type: 'success',
          text: 'Friend request accepted! You can now call each other anytime.',
        });
        loadDashboardData();
      }
    } catch (err) {
      console.error('Accept request error:', err);
    }
  };

  // 6. Reject Friend Request
  const handleRejectRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/proxy/friends/requests/${requestId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadDashboardData();
      }
    } catch (err) {
      console.error('Reject request error:', err);
    }
  };

  const copyMyEmail = () => {
    if (currentUser?.email) {
      navigator.clipboard.writeText(currentUser.email).catch(() => {});
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const filteredFriends = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) || f.email.toLowerCase().includes(q),
    );
  }, [friends, searchQuery]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl overflow-hidden border border-white/20 shadow-2xl ring-4 ring-blue-500/20">
            <Image
              src="/logo.png"
              alt="China Bangladesh Connect"
              width={80}
              height={80}
              className="h-full w-full object-cover"
              priority
            />
            <div className="absolute inset-0 rounded-2xl border-2 border-blue-500 border-t-transparent animate-spin pointer-events-none" />
          </div>
          <p className="text-sm font-medium text-slate-400 font-mono animate-pulse">
            Connecting to Hong Kong Hub...
          </p>
        </div>
      </div>
    );
  }

  // --- AUTH SCREEN ---
  if (!currentUser) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white overflow-hidden">
        {/* Ambient lighting glows */}
        <div className="absolute top-1/4 -left-20 h-96 w-96 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-20 h-96 w-96 rounded-full bg-emerald-600/15 blur-3xl pointer-events-none" />

        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-2xl">
          {/* Header with High-Resolution Logo */}
          <div className="mb-6 text-center">
            <div className="relative mx-auto mb-4 h-28 w-28 overflow-hidden rounded-3xl border border-white/20 shadow-2xl ring-4 ring-blue-500/20 group">
              <Image
                src="/logo.png"
                alt="China Bangladesh Connect Logo"
                width={112}
                height={112}
                className="h-full w-full object-cover transition-transform group-hover:scale-105 duration-300"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              China Bangladesh Connect
            </h1>
            <p className="mt-1 text-xs text-blue-400 font-medium">
              Communication App · Made by Shah Md. Mahi
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Dedicated ultra-low latency calling between China & Bangladesh via Hong Kong
            </p>
          </div>

          {authError && (
            <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-3.5 text-center text-xs text-red-400 animate-in fade-in">
              {authError}
            </div>
          )}

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Full Name
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="e.g. Li Wei or Shah Mahi"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="h-11 bg-slate-950/50 border-white/10 text-white rounded-xl"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-300">
                    Your Location / Gateway Region
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setAuthCountry('BD')}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-all ${
                        authCountry === 'BD'
                          ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300 shadow-lg shadow-emerald-500/10'
                          : 'border-white/10 bg-slate-950/40 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      <span className="text-base">🇧🇩</span> Bangladesh
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthCountry('CN')}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-all ${
                        authCountry === 'CN'
                          ? 'border-red-500/60 bg-red-500/20 text-red-300 shadow-lg shadow-red-500/10'
                          : 'border-white/10 bg-slate-950/40 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      <span className="text-base">🇨🇳</span> China
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Email Address
              </label>
              <Input
                type="email"
                required
                placeholder="name@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="h-11 bg-slate-950/50 border-white/10 text-white rounded-xl"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-300">
                Password
              </label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-11 bg-slate-950/50 border-white/10 text-white rounded-xl"
              />
            </div>

            <Button
              type="submit"
              disabled={authSubmitting}
              className="w-full h-12 text-sm mt-4 bg-blue-600 hover:bg-blue-500 font-semibold shadow-lg shadow-blue-600/30 rounded-xl"
            >
              {authSubmitting ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Processing...
                </span>
              ) : isRegister ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError('');
              }}
              className="font-semibold text-blue-400 hover:text-blue-300 ml-1 transition-colors"
            >
              {isRegister ? 'Sign In' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- DASHBOARD SCREEN ---
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Active Call Fullscreen Overlay */}
      <CallScreen
        callState={webrtc.callState}
        activePeer={webrtc.activePeer}
        isVideoCall={webrtc.isVideoCall}
        localStream={webrtc.localStream}
        remoteStream={webrtc.remoteStream}
        isMuted={webrtc.isMuted}
        isVideoOff={webrtc.isVideoOff}
        isScreenSharing={webrtc.isScreenSharing}
        networkStats={webrtc.networkStats}
        onAnswer={webrtc.answerCall}
        onReject={webrtc.rejectCall}
        onEnd={webrtc.endCall}
        onToggleMute={webrtc.toggleMute}
        onToggleVideo={webrtc.toggleVideo}
        onSwitchCamera={webrtc.switchCamera}
        onToggleScreenShare={webrtc.toggleScreenShare}
      />

      {/* Sticky Header with Logo */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          {/* Logo & Hub status */}
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-white/20 shadow-lg ring-2 ring-blue-500/20 shrink-0">
              <Image
                src="/logo.png"
                alt="China Bangladesh Connect"
                width={48}
                height={48}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold leading-tight tracking-tight text-white">
                  CN-BD Connect
                </h1>
                <Badge variant="outline" className="hidden sm:inline-flex text-[10px] py-0 px-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                  PWA Ready
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[11px]">Hong Kong Hub: 18.166.1.216</span>
              </div>
            </div>
          </div>

          {/* User Profile Info & Actions */}
          <div className="flex items-center gap-2.5">
            {/* User chip with quick copy */}
            <div
              onClick={copyMyEmail}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/80 px-3 py-1.5 cursor-pointer hover:bg-slate-800 transition-colors shadow"
              title="Click to copy your email to share with friends"
            >
              <span className="text-base">
                {currentUser.country === 'BD' ? '🇧🇩' : '🇨🇳'}
              </span>
              <div className="text-left hidden md:block">
                <span className="text-xs font-semibold text-white block leading-tight">
                  {currentUser.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 block leading-tight">
                  {currentUser.email}
                </span>
              </div>
              <span className="text-slate-400 hover:text-white">
                {copiedEmail ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </span>
            </div>

            {/* Refresh */}
            <Button
              variant="ghost"
              size="sm"
              onClick={loadDashboardData}
              disabled={isRefreshing}
              className="h-9 w-9 p-0 rounded-full text-slate-400 hover:text-white hover:bg-white/10"
              title="Refresh friends and requests"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Logout */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="h-9 px-3 rounded-full border-white/10 text-slate-300 hover:text-red-400 hover:border-red-500/30 text-xs gap-1.5"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6 space-y-6">
        {/* Feedback Alert Toast */}
        {actionMessage && (
          <div
            className={`flex items-center justify-between rounded-2xl border p-4 text-xs font-semibold shadow-lg backdrop-blur-xl animate-in fade-in slide-in-from-top-2 ${
              actionMessage.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{actionMessage.type === 'success' ? '✓' : '⚠'}</span>
              <span>{actionMessage.text}</span>
            </div>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Latency Route Visualizer Hero Card with Logo Emblem */}
        <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-blue-900/20 via-slate-900/60 to-emerald-900/20 p-5 sm:p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-white/20 shadow shrink-0">
                <Image
                  src="/logo.png"
                  alt="CN-BD Connect Emblem"
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Globe2 className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white tracking-wide uppercase">
                    Cross-Border Telemetry Pipeline
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Optimized route bypassing the Great Firewall via self-hosted Hong Kong Coturn relay
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px] bg-slate-950/60 border border-white/10 px-3.5 py-1.5 rounded-full">
              <span className="text-emerald-400">🇧🇩 Dhaka (~45ms)</span>
              <span className="text-slate-600">⇄</span>
              <span className="text-blue-400 font-bold">🇭🇰 HK Hub</span>
              <span className="text-slate-600">⇄</span>
              <span className="text-red-400">🇨🇳 China (~25ms)</span>
            </div>
          </div>
        </div>

        {/* 1. Add Friend Card */}
        <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-400" />
              <h3 className="text-base font-bold text-white">
                Connect With Friend by Email
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              Share your email: <span className="text-blue-400 font-mono font-semibold">{currentUser.email}</span>
            </span>
          </div>

          <form onSubmit={handleSendRequest} className="flex flex-col sm:flex-row gap-2.5">
            <Input
              type="email"
              required
              placeholder="Enter friend's registered email (e.g. friend@example.com)"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              className="flex-1 h-12 bg-slate-950/50 border-white/10 text-white rounded-2xl px-4"
            />
            <Button
              type="submit"
              className="h-12 px-6 bg-blue-600 hover:bg-blue-500 font-semibold rounded-2xl shadow-lg shadow-blue-600/30 gap-2 shrink-0"
            >
              <UserPlus className="h-4 w-4" />
              <span>Send Friend Request</span>
            </Button>
          </form>
        </section>

        {/* 2. Incoming Friend Requests Notification Section */}
        {requests.length > 0 && (
          <section className="rounded-3xl border border-blue-500/30 bg-blue-500/5 p-5 sm:p-6 shadow-xl backdrop-blur-xl animate-in fade-in">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-blue-400 animate-pulse" />
                <h3 className="text-base font-bold text-white">
                  Incoming Friend Requests ({requests.length})
                </h3>
              </div>
              <Badge variant="outline" className="border-blue-500/30 bg-blue-500/20 text-blue-300 text-xs">
                Pending Actions
              </Badge>
            </div>

            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 p-4 shadow"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-2xl border border-white/10 shadow">
                      {req.sender.country === 'BD' ? '🇧🇩' : '🇨🇳'}
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-white">
                        {req.sender.name}
                      </h4>
                      <p className="text-xs text-slate-400 font-mono">{req.sender.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleAcceptRequest(req.id)}
                      className="gap-1.5 px-4 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold shadow-lg shadow-emerald-600/30"
                    >
                      <Check className="h-4 w-4" />
                      <span>Accept</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRejectRequest(req.id)}
                      className="h-10 w-10 p-0 rounded-xl border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/30"
                      title="Decline"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Contacts / Friends List */}
        <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6 shadow-xl backdrop-blur-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2.5">
              <Users className="h-5 w-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">
                Friends & Contacts ({friends.length})
              </h3>
            </div>

            {/* Contact search */}
            {friends.length > 0 && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Filter friends..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 pl-9 bg-slate-950/50 border-white/10 text-xs rounded-xl text-white"
                />
              </div>
            )}
          </div>

          {friends.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-slate-400">
              <div className="relative mx-auto mb-4 h-24 w-24 overflow-hidden rounded-2xl border border-white/10 shadow-lg opacity-80">
                <Image
                  src="/logo.png"
                  alt="CN-BD Connect Logo"
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                />
              </div>
              <h4 className="text-sm font-semibold text-white">No friends connected yet</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Send a friend request by typing your friend&apos;s email address above. Once accepted, one-click HD video and voice calling will be enabled immediately.
              </p>
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-slate-400 text-xs">
              No contacts match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredFriends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition-all hover:border-slate-700 hover:bg-slate-900/60 shadow-lg group"
                >
                  {/* Friend Info */}
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-2xl border border-white/10 shadow">
                      <span>{friend.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-slate-950 ${
                          friend.isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-slate-600'
                        }`}
                        title={friend.isOnline ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-semibold text-sm text-white leading-tight">
                          {friend.name}
                        </h4>
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 border-slate-800 bg-slate-800/60 text-slate-400"
                        >
                          {friend.country === 'BD' ? 'Bangladesh' : 'China'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 font-mono truncate max-w-[150px] sm:max-w-[180px] mt-0.5">
                        {friend.email}
                      </p>
                    </div>
                  </div>

                  {/* Calling Actions */}
                  <div className="flex items-center gap-2">
                    {/* Audio Call */}
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-11 w-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white border border-white/10 shadow hover:scale-105 transition-transform"
                      onClick={() => webrtc.startCall(friend, false)}
                      title="Start Voice Call"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>

                    {/* Video Call */}
                    <Button
                      variant="default"
                      size="icon"
                      className="h-11 w-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 hover:scale-105 transition-transform"
                      onClick={() => webrtc.startCall(friend, true)}
                      title="Start HD Video Call"
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
