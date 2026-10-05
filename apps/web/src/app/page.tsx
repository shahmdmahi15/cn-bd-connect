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
  Activity,
  Compass,
  ArrowUpRight,
  Clock,
  Send,
  UserCheck,
  Trash2,
  Bell,
  BellRing,
  Settings as SettingsIcon,
  User as UserIcon,
  Volume2,
  Sliders,
  KeyRound,
  Shield,
  Smartphone,
  CheckCheck,
  PhoneCall,
  UserX,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CallScreen } from '@/components/CallScreen';
import { useWebRTC } from '@/hooks/useWebRTC';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { ringtoneService } from '@/lib/ringtone';

interface User {
  id: string;
  name: string;
  email: string;
  country: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isOnline?: boolean;
}

interface FriendRequest {
  id: string;
  sender: User;
  receiver: User;
  createdAt: string;
}

type TabType = 'friends' | 'telemetry' | 'settings' | 'profile';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Live Latency Probe to Hong Kong Server (Measured in Real Time)
  const [liveRttMs, setLiveRttMs] = useState<number | null>(null);

  // Background Push Notifications (iOS 16.4+ / Android / Desktop)
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isSubscribingPush, setIsSubscribingPush] = useState(false);
  const [isSendingTestPush, setIsSendingTestPush] = useState(false);

  // Navigation State
  const [activeTab, setActiveTab] = useState<TabType>('friends');

  // Auth Form State
  const [isRegister, setIsRegister] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authCountry, setAuthCountry] = useState<'BD' | 'CN'>('BD');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard & Friend State
  const [friends, setFriends] = useState<User[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [friendsFilter, setFriendsFilter] = useState<'all' | 'online' | 'requests'>('all');
  const [targetEmail, setTargetEmail] = useState('');
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Profile Form State
  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileCountry, setProfileCountry] = useState<'BD' | 'CN'>('BD');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Password Change Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Settings State
  const [ringtoneVolume, setRingtoneVolume] = useState<number>(0.8);
  const [isTestingRingtone, setIsTestingRingtone] = useState<boolean>(false);
  const [videoQuality, setVideoQuality] = useState<'1080p' | '720p' | '480p'>('1080p');
  const [noiseSuppression, setNoiseSuppression] = useState<boolean>(true);
  const [echoCancellation, setEchoCancellation] = useState<boolean>(true);

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
          setProfileName(user.name || '');
          setProfileBio(user.bio || 'Available');
          setProfileCountry((user.country as 'BD' | 'CN') || 'BD');
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
        body: JSON.stringify({ email: authEmail.trim(), password: authPassword }),
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
      setProfileName(data.user.name || '');
      setProfileBio(data.user.bio || 'Available');
      setProfileCountry((data.user.country as 'BD' | 'CN') || 'BD');
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
          email: authEmail.trim(),
          password: authPassword,
          name: authName.trim(),
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
      setProfileName(data.user.name || '');
      setProfileBio(data.user.bio || 'Available');
      setProfileCountry((data.user.country as 'BD' | 'CN') || 'BD');
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
        const friendsData = await friendsRes.json().catch(() => []);
        setFriends(Array.isArray(friendsData) ? friendsData : []);
      }
      if (requestsRes.ok) {
        const reqData = await requestsRes.json().catch(() => null);
        const incoming = Array.isArray(reqData)
          ? reqData
          : Array.isArray(reqData?.incoming)
            ? reqData.incoming
            : [];
        const outgoing = Array.isArray(reqData?.outgoing)
          ? reqData.outgoing
          : [];
        setIncomingRequests(incoming);
        setOutgoingRequests(outgoing);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    if (currentUser && token) {
      loadDashboardData();
    }
  }, [currentUser, token, loadDashboardData]);

  // 3. Continuous Real-Time Latency Probe to Hong Kong Server (Every 3 seconds)
  useEffect(() => {
    if (!token || !currentUser) return;

    let isMounted = true;
    const probeLatency = () => {
      const socket = getSocket(token);
      const start = Date.now();
      if (socket && socket.connected) {
        socket.emit('ping', { clientTime: start }, (res: any) => {
          if (!isMounted) return;
          const rtt = Math.max(1, Date.now() - (res?.clientTime || start));
          setLiveRttMs(rtt);
        });
      } else {
        fetch('/api/proxy/health')
          .then((res) => {
            if (res.ok && isMounted) {
              setLiveRttMs(Math.max(1, Date.now() - start));
            }
          })
          .catch(() => {});
      }
    };

    probeLatency();
    const timer = setInterval(probeLatency, 3000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [token, currentUser]);

  // 4. Handle Incoming Call from Push Notification / Deep-link Click
  useEffect(() => {
    // A. Listen for Service Worker postMessage
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const handleSwMessage = (event: MessageEvent) => {
        if (event.data?.type === 'OPEN_INCOMING_CALL') {
          console.log('[App] Opened incoming call from notification:', event.data);
          webrtc.checkPendingCall();
        } else if (event.data?.type === 'INCOMING_CALL_DECLINED') {
          webrtc.rejectCall();
        }
      };
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      };
    }
  }, [webrtc]);

  useEffect(() => {
    // B. Check URL query params on mount: ?incomingCall=1
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('incomingCall') === '1') {
        console.log('[App] Deep-link with incomingCall detected, probing pending call...');
        const timer = setTimeout(() => {
          webrtc.checkPendingCall();
        }, 600);
        return () => clearTimeout(timer);
      }
    }
  }, [webrtc]);

  // 5. Check Initial Push Subscription Status
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (sub) setIsPushSubscribed(true);
        })
        .catch(() => {});
    }
  }, []);

  // 6. Enable Web Push Notifications
  const handleEnableNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert(
        'Push notifications are not supported in this browser.\n\nOn iPhone/iPad: Tap the Share button (⬆️) and select "Add to Home Screen" first!',
      );
      return;
    }

    setIsSubscribingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setActionMessage({
          type: 'error',
          text: 'Notification permission was declined. Please allow notifications in browser or iOS settings.',
        });
        return;
      }

      // Fetch server VAPID public key
      const res = await fetch('/api/proxy/notifications/vapid-public-key');
      if (!res.ok) throw new Error('Could not retrieve notification keys from server');
      const { publicKey } = await res.json();

      // Subscribe service worker
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      // Register push subscription with backend
      const subJson = sub.toJSON();
      const saveRes = await fetch('/api/proxy/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      if (!saveRes.ok) throw new Error('Failed to save subscription on server');

      setIsPushSubscribed(true);
      setActionMessage({
        type: 'success',
        text: 'Lock-screen call notifications successfully enabled!',
      });
    } catch (err: any) {
      console.error('Push notification error:', err);
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to enable notifications',
      });
    } finally {
      setIsSubscribingPush(false);
    }
  };

  // 7. Send Test Push Alert
  const handleSendTestPush = async () => {
    if (!token) return;
    setIsSendingTestPush(true);
    try {
      const res = await fetch('/api/proxy/notifications/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Failed to send test alert');

      setActionMessage({
        type: 'success',
        text: 'Test alert sent! Lock your phone or check your notification shade.',
      });
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to send test push alert',
      });
    } finally {
      setIsSendingTestPush(false);
    }
  };

  // 8. Test Ringtone Preview
  const handleTestRingtone = async () => {
    setIsTestingRingtone(true);
    await ringtoneService.testRingtone(ringtoneVolume);
    setIsTestingRingtone(false);
  };

  // 9. Friend Request Actions
  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEmail.trim() || !token) return;

    setIsSendingRequest(true);
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
        throw new Error(data?.message || 'Failed to send friend request');
      }

      setTargetEmail('');
      setActionMessage({
        type: 'success',
        text: `Friend request sent to ${data.receiver?.name || 'user'}!`,
      });
      loadDashboardData();
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Could not send friend request',
      });
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/proxy/friends/requests/${requestId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: 'Friend request accepted!' });
        loadDashboardData();
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to accept request' });
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/proxy/friends/requests/${requestId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: 'Friend request declined.' });
        loadDashboardData();
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to reject request' });
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/proxy/friends/requests/${requestId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: 'Friend request cancelled.' });
        loadDashboardData();
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to cancel request' });
    }
  };

  const handleRemoveFriend = async (friendId: string, friendName: string) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to remove ${friendName} from your friends?`)) return;
    try {
      const res = await fetch(`/api/proxy/friends/${friendId}/remove`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setFriends((prev) => prev.filter((f) => f.id !== friendId));
        setActionMessage({ type: 'success', text: `${friendName} was removed.` });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to remove friend' });
    }
  };

  // 10. Update Profile Action
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setIsUpdatingProfile(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/proxy/auth/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profileName.trim(),
          bio: profileBio.trim(),
          country: profileCountry,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Failed to update profile');
      setCurrentUser(data);
      setActionMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error updating profile' });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  // 11. Change Password Action
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (newPassword !== confirmPassword) {
      setActionMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (newPassword.length < 6) {
      setActionMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }

    setIsChangingPassword(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/proxy/auth/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Failed to change password');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setActionMessage({ type: 'success', text: 'Password changed successfully!' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error changing password' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Filtered Friends List
  const filteredFriends = useMemo(() => {
    return friends.filter((f) => {
      const matchSearch =
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (f.bio && f.bio.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchSearch) return false;
      if (friendsFilter === 'online') return Boolean(f.isOnline);
      return true;
    });
  }, [friends, searchQuery, friendsFilter]);

  const copyUserId = () => {
    if (!currentUser) return;
    navigator.clipboard.writeText(currentUser.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  // Loading Screen
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
        <div className="relative h-20 w-20 mb-4 animate-pulse rounded-2xl overflow-hidden border border-white/20">
          <Image src="/logo.png" alt="CN-BD Connect" fill className="object-cover" priority />
        </div>
        <p className="text-white/60 text-xs font-mono tracking-wider animate-pulse">
          INITIALIZING CN-BD SECURE CHANNEL...
        </p>
      </div>
    );
  }

  // --- AUTH SCREEN (OLED Black + iOS 26 Liquid Water-Morphism) ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-blue-600 selection:text-white">
        <div className="absolute top-1/4 -left-20 h-96 w-96 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 -right-20 h-96 w-96 rounded-full bg-emerald-600/15 blur-3xl pointer-events-none" />

        <div className="w-full max-w-md relative z-10 rounded-3xl border border-white/15 bg-black/60 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.2)] backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300">
          <div className="text-center mb-8">
            <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-2xl overflow-hidden border border-white/25 shadow-2xl ring-4 ring-blue-500/20">
              <Image src="/logo.png" alt="CN-BD Connect" width={96} height={96} className="h-full w-full object-cover" priority />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">
              CN-BD Connect
            </h1>
            <p className="text-xs text-white/60">
              Ultra Low-Latency Cross-Border Telecommunication
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-400 text-[10px]">
                Dhaka ⇄ Hong Kong ⇄ China
              </Badge>
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px]">
                Dedicated WebRTC Mesh
              </Badge>
            </div>
          </div>

          {authError && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
              <X className="h-4 w-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            {isRegister && (
              <>
                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Full Name</label>
                  <Input
                    type="text"
                    required
                    placeholder="Shah Md. Mahi"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Location / Hub Region</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthCountry('BD')}
                      className={`h-11 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                        authCountry === 'BD'
                          ? 'border-emerald-500 bg-emerald-500/20 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                          : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      <span>🇧🇩</span> Bangladesh
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthCountry('CN')}
                      className={`h-11 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                        authCountry === 'CN'
                          ? 'border-red-500 bg-red-500/20 text-white shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                          : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      <span>🇨🇳</span> China
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-medium text-white/70 mb-1.5 block">Email Address</label>
              <Input
                type="email"
                required
                placeholder="user@example.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-blue-500/50"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-white/70 mb-1.5 block">Password</label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-blue-500/50"
              />
            </div>

            <Button
              type="submit"
              disabled={authSubmitting}
              className="w-full h-12 text-sm mt-4 bg-blue-600/90 hover:bg-blue-500 text-white font-semibold shadow-[0_8px_25px_rgba(59,130,246,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)] border border-white/20 rounded-xl active:scale-95 transition-all"
            >
              {authSubmitting ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Connecting...
                </span>
              ) : isRegister ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center text-xs text-white/50">
            {isRegister ? 'Already registered?' : "Don't have an account?"}{' '}
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

  // --- MAIN DASHBOARD SCREEN (OLED Black + iOS 26 Liquid Water-Morphism) ---
  return (
    <div className="min-h-screen bg-black text-white flex flex-col selection:bg-blue-600 selection:text-white pb-24 md:pb-8">
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
        isPeerMuted={webrtc.isPeerMuted}
        isPeerVideoOff={webrtc.isPeerVideoOff}
        onAnswer={webrtc.answerCall}
        onReject={webrtc.rejectCall}
        onEnd={webrtc.callState === 'calling' ? webrtc.cancelCall : webrtc.endCall}
        onToggleMute={webrtc.toggleMute}
        onToggleVideo={webrtc.toggleVideo}
        onSwitchCamera={webrtc.switchCamera}
        onToggleScreenShare={webrtc.toggleScreenShare}
      />

      {/* Floating Action Banner Notification Toast */}
      {actionMessage && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border text-xs font-medium shadow-2xl backdrop-blur-2xl animate-in slide-in-from-top-4 duration-300 ${
            actionMessage.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200'
              : 'border-red-500/40 bg-red-950/80 text-red-200'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <X className="h-4 w-4 text-red-400 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="ml-2 hover:opacity-75">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Header: Brand & Live Latency Indicator */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-xl overflow-hidden border border-white/20 shadow-md">
              <Image src="/logo.png" alt="Logo" fill className="object-cover" priority />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">CN-BD Connect</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono">
                  v2.6
                </span>
              </div>
              <p className="text-[11px] text-white/50">Dedicated Telecommunication Hub</p>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <div className="hidden md:flex items-center gap-1 bg-white/5 p-1 rounded-2xl border border-white/10">
            <button
              onClick={() => setActiveTab('friends')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'friends'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Friends
              {incomingRequests.length > 0 && (
                <span className="h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {incomingRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'telemetry'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              Telemetry
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'settings'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Settings
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'profile'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-white/70 hover:text-white hover:bg-white/5'
              }`}
            >
              <UserIcon className="h-3.5 w-3.5" />
              Profile
            </button>
          </div>

          {/* User Status Card & Live Latency */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-xl bg-white/5 border border-white/10 font-mono text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white/60">HK Hub:</span>
              <span className="text-emerald-400 font-bold">
                {liveRttMs !== null ? `${liveRttMs}ms` : 'Measuring...'}
              </span>
            </div>

            <button
              onClick={() => setActiveTab('profile')}
              className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs transition-colors"
            >
              <span className="font-semibold text-white">{currentUser.name}</span>
              <span className="text-sm">{currentUser.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
            </button>
            <button
              onClick={handleLogout}
              className="h-8 w-8 rounded-xl bg-white/5 hover:bg-red-500/20 text-white/70 hover:text-red-400 border border-white/10 flex items-center justify-center transition-colors"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-6xl mx-auto px-4 py-6 flex-1 w-full space-y-6">
        {/* --- TAB 1: FRIENDS & CALLING --- */}
        {activeTab === 'friends' && (
          <div className="space-y-6">
            {/* Quick Add Friend Card */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">Add Contact / Friend</h3>
                </div>
                <span className="text-[11px] text-white/50">Cross-Border Directory</span>
              </div>
              <form onSubmit={handleSendFriendRequest} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <Input
                    type="email"
                    required
                    placeholder="Enter friend's email address..."
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    className="h-11 pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-blue-500/50"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSendingRequest || !targetEmail.trim()}
                  className="h-11 px-5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl border border-white/20 active:scale-95 transition-all shadow-md shrink-0"
                >
                  {isSendingRequest ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Send className="h-3.5 w-3.5" />
                      Add
                    </span>
                  )}
                </Button>
              </form>
            </div>

            {/* Friend Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              {/* Filter Pills */}
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-2xl border border-white/10 w-full sm:w-auto">
                <button
                  onClick={() => setFriendsFilter('all')}
                  className={`flex-1 sm:flex-none px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                    friendsFilter === 'all'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  All Friends ({friends.length})
                </button>
                <button
                  onClick={() => setFriendsFilter('online')}
                  className={`flex-1 sm:flex-none px-3 py-1 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    friendsFilter === 'online'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Online ({friends.filter((f) => f.isOnline).length})
                </button>
                <button
                  onClick={() => setFriendsFilter('requests')}
                  className={`flex-1 sm:flex-none px-3 py-1 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    friendsFilter === 'requests'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-white/60 hover:text-white'
                  }`}
                >
                  Requests
                  {incomingRequests.length > 0 && (
                    <span className="h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                      {incomingRequests.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Instant Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  type="text"
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl"
                />
              </div>
            </div>

            {/* Incoming & Outgoing Requests Section (When filter is 'requests' or requests exist) */}
            {(friendsFilter === 'requests' || incomingRequests.length > 0) && (
              <div className="space-y-4">
                {incomingRequests.length > 0 && (
                  <div className="rounded-3xl border border-blue-500/30 bg-blue-950/20 p-5 backdrop-blur-3xl">
                    <h4 className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <UserCheck className="h-4 w-4" />
                      Pending Incoming Requests ({incomingRequests.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {incomingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center justify-between p-3.5 rounded-2xl bg-black/60 border border-white/10 shadow-sm"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-blue-600/20 text-blue-400 font-bold flex items-center justify-center text-sm border border-blue-500/30">
                              {req.sender.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-white text-xs">{req.sender.name}</span>
                                <span>{req.sender.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
                              </div>
                              <p className="text-[11px] text-white/50 font-mono">{req.sender.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleAcceptRequest(req.id)}
                              className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1 transition-all"
                            >
                              <Check className="h-3.5 w-3.5" />
                              Accept
                            </button>
                            <button
                              onClick={() => handleRejectRequest(req.id)}
                              className="h-8 w-8 rounded-lg bg-red-600/30 hover:bg-red-600 text-red-200 text-xs font-medium flex items-center justify-center transition-all"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {outgoingRequests.length > 0 && friendsFilter === 'requests' && (
                  <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-3xl">
                    <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-3">
                      Outgoing Sent Requests ({outgoingRequests.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {outgoingRequests.map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center justify-between p-3.5 rounded-2xl bg-black/40 border border-white/10"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-white/10 text-white/60 font-bold flex items-center justify-center text-sm border border-white/10">
                              {req.receiver.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-white text-xs">{req.receiver.name}</span>
                                <span>{req.receiver.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
                              </div>
                              <p className="text-[11px] text-white/50 font-mono">{req.receiver.email}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCancelRequest(req.id)}
                            className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-red-500/20 text-white/60 hover:text-red-300 text-xs transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Friends Directory Grid */}
            {friendsFilter !== 'requests' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-white/60 uppercase tracking-wider">
                    {friendsFilter === 'online' ? 'Active Peers Online' : 'Contacts Directory'} (
                    {filteredFriends.length})
                  </h4>
                  <button
                    onClick={loadDashboardData}
                    disabled={isRefreshing}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {filteredFriends.length === 0 ? (
                  <div className="rounded-3xl border border-white/10 bg-black/40 p-10 text-center backdrop-blur-2xl">
                    <Users className="mx-auto h-10 w-10 text-white/20 mb-3" />
                    <p className="text-sm font-semibold text-white/70 mb-1">
                      {searchQuery
                        ? 'No friends found matching search'
                        : friendsFilter === 'online'
                          ? 'No friends currently online'
                          : 'No friends added yet'}
                    </p>
                    <p className="text-xs text-white/40 max-w-sm mx-auto">
                      Use the search box above to send a friend request to your team members in Bangladesh or China.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredFriends.map((friend) => (
                      <div
                        key={friend.id}
                        className="relative rounded-3xl border border-white/10 bg-black/60 p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl hover:border-white/25 transition-all group"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 text-white font-bold text-base flex items-center justify-center border border-white/20 shadow-md">
                                {friend.name.charAt(0).toUpperCase()}
                              </div>
                              <span
                                className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-black ${
                                  friend.isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-white/30'
                                }`}
                              />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h4 className="font-bold text-white text-sm">{friend.name}</h4>
                                <span className="text-sm">{friend.country === 'BD' ? '🇧🇩' : '🇨🇳'}</span>
                              </div>
                              <p className="text-[11px] text-white/50 font-mono truncate max-w-[150px]">
                                {friend.email}
                              </p>
                              {friend.bio && (
                                <p className="text-[10px] text-blue-300/80 italic mt-0.5">{friend.bio}</p>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={() => handleRemoveFriend(friend.id, friend.name)}
                            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 p-1 transition-opacity"
                            title="Remove Contact"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Call Action Buttons */}
                        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10">
                          <Button
                            onClick={() => webrtc.startCall(friend, true)}
                            className="h-10 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-[0_4px_15px_rgba(59,130,246,0.3)] border border-white/20 active:scale-95 transition-all"
                          >
                            <Video className="h-3.5 w-3.5" />
                            Video (HD)
                          </Button>
                          <Button
                            onClick={() => webrtc.startCall(friend, false)}
                            variant="outline"
                            className="h-10 bg-white/5 hover:bg-white/10 text-white/90 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 border-white/15 active:scale-95 transition-all"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            Voice Call
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* --- TAB 2: TELEMETRY & NETWORK PIPELINE --- */}
        {activeTab === 'telemetry' && (
          <div className="space-y-6">
            {/* Cross-Border Telemetry Banner */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-base font-bold text-white">Cross-Border Live Telemetry</h3>
                  </div>
                  <p className="text-xs text-white/50">
                    Live probe running every 3 seconds to Hong Kong Hub (ap-east-1)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-2xl font-black tracking-tight text-white flex items-center gap-2">
                    <span>{liveRttMs !== null ? `${liveRttMs} ms` : 'Measuring...'}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-sans font-semibold">
                      LIVE RTT
                    </span>
                  </div>
                </div>
              </div>

              {/* Topology Path Graphic */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                  <span className="text-2xl mb-1 block">🇧🇩</span>
                  <h4 className="font-bold text-xs text-white">Dhaka Gateway</h4>
                  <p className="text-[11px] text-white/40 font-mono mt-1">Direct peering to HK</p>
                  <div className="mt-3 text-xs text-emerald-400 font-mono font-bold">~42ms RTT</div>
                </div>

                <div className="rounded-2xl border border-blue-500/30 bg-blue-950/20 p-4 text-center">
                  <span className="text-2xl mb-1 block">🇭🇰</span>
                  <h4 className="font-bold text-xs text-white">Hong Kong Relay Hub</h4>
                  <p className="text-[11px] text-blue-300 font-mono mt-1">AWS Lightsail (18.166.1.216)</p>
                  <div className="mt-3 text-xs text-blue-400 font-mono font-bold">TURN 5349 / UDP 49152-65535</div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                  <span className="text-2xl mb-1 block">🇨🇳</span>
                  <h4 className="font-bold text-xs text-white">China Endpoints</h4>
                  <p className="text-[11px] text-white/40 font-mono mt-1">Shenzhen / Guangzhou / Beijing</p>
                  <div className="mt-3 text-xs text-emerald-400 font-mono font-bold">~25ms RTT</div>
                </div>
              </div>
            </div>

            {/* Push Notifications Card */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BellRing className="h-5 w-5 text-purple-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">Background Call Notifications</h3>
                    <p className="text-xs text-white/50">
                      Receive calls even when app is closed or screen is locked (iOS APNs / Android FCM)
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    isPushSubscribed
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                      : 'border-yellow-500/40 bg-yellow-500/15 text-yellow-300'
                  }
                >
                  {isPushSubscribed ? 'Active & Ready' : 'Permission Needed'}
                </Badge>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  onClick={handleEnableNotifications}
                  disabled={isSubscribingPush}
                  className="flex-1 h-11 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs border border-white/20 active:scale-95 transition-all shadow-md"
                >
                  {isSubscribingPush ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Bell className="h-3.5 w-3.5" />
                      {isPushSubscribed ? 'Re-sync Notifications' : 'Enable Lock-Screen Notifications'}
                    </span>
                  )}
                </Button>
                <Button
                  onClick={handleSendTestPush}
                  disabled={isSendingTestPush}
                  variant="outline"
                  className="h-11 px-6 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs border border-white/15"
                >
                  {isSendingTestPush ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5" />
                      Send Test Alert
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 3: APP SETTINGS --- */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Audio & Ringtone Settings */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center gap-2 mb-4">
                <Volume2 className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Audio & Ringtone Calibration</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-white/70">Ringtone Volume</span>
                    <span className="text-emerald-400 font-mono font-bold">{Math.round(ringtoneVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={ringtoneVolume}
                    onChange={(e) => setRingtoneVolume(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-white/60">Audible Ringtone Preview</span>
                  <Button
                    onClick={handleTestRingtone}
                    disabled={isTestingRingtone}
                    className="h-9 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl"
                  >
                    {isTestingRingtone ? (
                      <span className="flex items-center gap-1.5">
                        <Radio className="h-3.5 w-3.5 animate-pulse" />
                        Ringing...
                      </span>
                    ) : (
                      'Test Ringtone Now'
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {/* Video Quality & Hardware Settings */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center gap-2 mb-4">
                <SlidersHorizontal className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Video Quality & Codec Tuning</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-white/70 block mb-2">Resolution & Frame Rate</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setVideoQuality('1080p')}
                      className={`h-10 rounded-xl border text-xs font-semibold transition-all ${
                        videoQuality === '1080p'
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-white/10 bg-white/5 text-white/60'
                      }`}
                    >
                      1080p (60fps)
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoQuality('720p')}
                      className={`h-10 rounded-xl border text-xs font-semibold transition-all ${
                        videoQuality === '720p'
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-white/10 bg-white/5 text-white/60'
                      }`}
                    >
                      720p (30fps)
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoQuality('480p')}
                      className={`h-10 rounded-xl border text-xs font-semibold transition-all ${
                        videoQuality === '480p'
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-white/10 bg-white/5 text-white/60'
                      }`}
                    >
                      480p (Data Saver)
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <span className="text-xs text-white/70">Acoustic Echo Cancellation (AEC)</span>
                  <input
                    type="checkbox"
                    checked={echoCancellation}
                    onChange={(e) => setEchoCancellation(e.target.checked)}
                    className="accent-blue-600 h-4 w-4"
                  />
                </div>

                <div className="flex items-center justify-between border-t border-white/10 pt-2">
                  <span className="text-xs text-white/70">AI Noise Suppression (ANS)</span>
                  <input
                    type="checkbox"
                    checked={noiseSuppression}
                    onChange={(e) => setNoiseSuppression(e.target.checked)}
                    className="accent-blue-600 h-4 w-4"
                  />
                </div>
              </div>
            </div>

            {/* PWA & System Information */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white/60">PWA Client Cache</span>
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
                >
                  Reload Application
                </button>
              </div>
              <p className="text-[11px] text-white/40">
                Service worker active with offline caching and background APNs/FCM push listening.
              </p>
            </div>
          </div>
        )}

        {/* --- TAB 4: USER PROFILE & PASSWORD --- */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {/* Profile Overview Card */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white font-black text-2xl flex items-center justify-center border border-white/20 shadow-xl">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{currentUser.name}</h3>
                    <p className="text-xs text-white/50 font-mono">{currentUser.email}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="border-white/15 bg-white/5 text-white text-[10px]">
                        {currentUser.country === 'BD' ? 'Bangladesh 🇧🇩' : 'China 🇨🇳'}
                      </Badge>
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
                        {currentUser.bio || 'Available'}
                      </Badge>
                    </div>
                  </div>
                </div>

                <button
                  onClick={copyUserId}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/70"
                >
                  {copiedId ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedId ? 'Copied' : 'Copy ID'}</span>
                </button>
              </div>

              {/* Edit Profile Form */}
              <form onSubmit={handleUpdateProfile} className="space-y-4 pt-4 border-t border-white/10">
                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Display Name</label>
                  <Input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Status / Bio Message</label>
                  <Input
                    type="text"
                    placeholder="e.g. Available, In Shenzhen Factory, In Dhaka Office..."
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Location / Country</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setProfileCountry('BD')}
                      className={`h-11 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        profileCountry === 'BD'
                          ? 'border-emerald-500 bg-emerald-500/20 text-white shadow-md'
                          : 'border-white/10 bg-white/5 text-white/60'
                      }`}
                    >
                      <span>🇧🇩</span> Bangladesh
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfileCountry('CN')}
                      className={`h-11 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        profileCountry === 'CN'
                          ? 'border-red-500 bg-red-500/20 text-white shadow-md'
                          : 'border-white/10 bg-white/5 text-white/60'
                      }`}
                    >
                      <span>🇨🇳</span> China
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isUpdatingProfile}
                  className="h-11 w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-xs shadow-md border border-white/20 active:scale-95 transition-all"
                >
                  {isUpdatingProfile ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Save Profile Changes'}
                </Button>
              </form>
            </div>

            {/* Change Password Card */}
            <div className="rounded-3xl border border-white/10 bg-black/60 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-3xl">
              <div className="flex items-center gap-2 mb-4">
                <KeyRound className="h-4 w-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Security & Password</h3>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Current Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">New Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="At least 6 characters..."
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">Confirm New Password</label>
                  <Input
                    type="password"
                    required
                    placeholder="Repeat new password..."
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11 bg-white/5 border-white/10 text-white rounded-xl focus:border-blue-500/50"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isChangingPassword}
                  className="h-11 w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs shadow-md border border-white/20 active:scale-95 transition-all"
                >
                  {isChangingPassword ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Update Password'}
                </Button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* Mobile-First Bottom Floating Dock (Native PWA Experience) */}
      <nav className="md:hidden fixed bottom-3 left-4 right-4 z-40 h-16 rounded-3xl bg-black/80 border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.25)] backdrop-blur-3xl flex items-center justify-around px-2">
        <button
          onClick={() => setActiveTab('friends')}
          className={`flex flex-col items-center justify-center flex-1 h-full rounded-2xl transition-all ${
            activeTab === 'friends' ? 'text-blue-400 scale-105' : 'text-white/50 hover:text-white'
          }`}
        >
          <div className="relative">
            <Users className="h-5 w-5" />
            {incomingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-black" />
            )}
          </div>
          <span className="text-[10px] font-semibold mt-1">Friends</span>
        </button>

        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex flex-col items-center justify-center flex-1 h-full rounded-2xl transition-all ${
            activeTab === 'telemetry' ? 'text-emerald-400 scale-105' : 'text-white/50 hover:text-white'
          }`}
        >
          <Activity className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Telemetry</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center justify-center flex-1 h-full rounded-2xl transition-all ${
            activeTab === 'settings' ? 'text-purple-400 scale-105' : 'text-white/50 hover:text-white'
          }`}
        >
          <SettingsIcon className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Settings</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center justify-center flex-1 h-full rounded-2xl transition-all ${
            activeTab === 'profile' ? 'text-white scale-105' : 'text-white/50 hover:text-white'
          }`}
        >
          <UserIcon className="h-5 w-5" />
          <span className="text-[10px] font-semibold mt-1">Profile</span>
        </button>
      </nav>
    </div>
  );
}
