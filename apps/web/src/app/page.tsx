'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

  // Dashboard State
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [targetEmail, setTargetEmail] = useState('');
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
        const user = await res.json();
        setCurrentUser(user);
        getSocket(authToken);
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
    try {
      const res = await fetch('/api/proxy/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      getSocket(data.token);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed');

      localStorage.setItem('token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      getSocket(data.token);
    } catch (err: any) {
      setAuthError(err.message);
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
        const friendsList = await friendsRes.json();
        setFriends(friendsList);
      }
      if (requestsRes.ok) {
        const requestsData = await requestsRes.json();
        setRequests(requestsData.incoming || []);
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send request');

      setActionMessage({
        type: 'success',
        text: `Friend request sent to ${targetEmail}!`,
      });
      setTargetEmail('');
      loadDashboardData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
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

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading CN-BD Connect...</p>
        </div>
      </div>
    );
  }

  // --- AUTH SCREEN ---
  if (!currentUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl backdrop-blur-xl">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600/20 text-3xl shadow-inner">
              🇧🇩 🇨🇳
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CN-BD Connect</h1>
            <p className="mt-1 text-sm text-slate-400">
              Low-latency calling connecting China & Bangladesh via Hong Kong
            </p>
          </div>

          {authError && (
            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center text-xs text-red-400">
              {authError}
            </div>
          )}

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Display Name
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="Your Full Name"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Your Location / Region
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setAuthCountry('BD')}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-all ${
                        authCountry === 'BD'
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-800 bg-slate-900 text-slate-400'
                      }`}
                    >
                      <span>🇧🇩</span> Bangladesh
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthCountry('CN')}
                      className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-all ${
                        authCountry === 'CN'
                          ? 'border-red-500 bg-red-500/20 text-red-300'
                          : 'border-slate-800 bg-slate-900 text-slate-400'
                      }`}
                    >
                      <span>🇨🇳</span> China
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Email Address
              </label>
              <Input
                type="email"
                required
                placeholder="name@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Password
              </label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            <Button type="submit" className="w-full h-12 text-sm mt-2">
              {isRegister ? 'Create Account' : 'Sign In'}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setAuthError('');
              }}
              className="font-medium text-blue-400 hover:underline ml-1"
            >
              {isRegister ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- DASHBOARD SCREEN ---
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Active Call Overlay */}
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

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-lg shadow-inner">
              🇧🇩 🇨🇳
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">CN-BD Connect</h2>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Hong Kong Dedicated Relay</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1">
              <span className="text-sm">
                {currentUser.country === 'BD' ? '🇧🇩' : '🇨🇳'}
              </span>
              <span className="text-xs font-medium text-slate-200">
                {currentUser.name}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={loadDashboardData}
              disabled={isRefreshing}
              className="h-9 w-9 p-0 text-slate-400"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="h-9 gap-1.5 text-xs text-slate-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6 space-y-6">
        {/* Feedback Message */}
        {actionMessage && (
          <div
            className={`flex items-center justify-between rounded-2xl border p-4 text-xs font-medium transition-all ${
              actionMessage.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/20 bg-red-500/10 text-red-300'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 1. Add Friend Card */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="h-5 w-5 text-blue-400" />
            <h3 className="text-base font-semibold text-white">
              Connect With Friend By Email
            </h3>
          </div>
          <form onSubmit={handleSendRequest} className="flex gap-2">
            <Input
              type="email"
              required
              placeholder="Enter friend's email address (e.g. friend@example.com)"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" className="gap-2 px-5">
              <UserPlus className="h-4 w-4" />
              <span>Send Request</span>
            </Button>
          </form>
        </section>

        {/* 2. Pending Friend Requests */}
        {requests.length > 0 && (
          <section className="rounded-3xl border border-blue-500/30 bg-blue-500/5 p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-blue-400 animate-pulse" />
                <h3 className="text-base font-semibold text-white">
                  Incoming Friend Requests ({requests.length})
                </h3>
              </div>
            </div>

            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-xl">
                      {req.sender.country === 'BD' ? '🇧🇩' : '🇨🇳'}
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-slate-100">
                        {req.sender.name}
                      </h4>
                      <p className="text-xs text-slate-400">{req.sender.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleAcceptRequest(req.id)}
                      className="gap-1 px-3"
                    >
                      <Check className="h-4 w-4" />
                      <span>Accept</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRejectRequest(req.id)}
                      className="h-9 w-9 p-0 text-slate-400 hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 3. Friends List */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-400" />
              <h3 className="text-base font-semibold text-white">
                Friends List ({friends.length})
              </h3>
            </div>
            <Badge variant="outline" className="border-slate-800 text-xs">
              Direct Calling Enabled
            </Badge>
          </div>

          {friends.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-500">
              <p className="text-sm">No friends added yet.</p>
              <p className="text-xs mt-1">
                Enter your friend&apos;s email above to send an invitation.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 transition-all hover:border-slate-700"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-2xl">
                      <span>{friend.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-slate-900 ${
                          friend.isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-semibold text-sm text-slate-100">
                          {friend.name}
                        </h4>
                        <span className="text-[10px] text-slate-400">
                          ({friend.country === 'BD' ? 'BD' : 'CN'})
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-[150px]">
                        {friend.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Voice Call */}
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 text-slate-200 hover:text-blue-400"
                      onClick={() => webrtc.startCall(friend, false)}
                      title="Audio Call"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>

                    {/* Video Call */}
                    <Button
                      variant="default"
                      size="icon"
                      className="h-10 w-10 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30"
                      onClick={() => webrtc.startCall(friend, true)}
                      title="Video Call"
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
