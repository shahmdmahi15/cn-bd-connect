import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(token?: string): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  const socketUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname.replace('cn-bd-connect-app', 'cn-bd-connect-api')}:3001`
      : 'http://localhost:3001');

  // Fallback to relative or current host if same origin
  const finalUrl =
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (typeof window !== 'undefined' && window.location.hostname.includes('shahmdmahi.dpdns.org')
      ? 'https://cn-bd-connect-api.shahmdmahi.dpdns.org'
      : 'http://localhost:3001');

  socket = io(finalUrl, {
    auth: { token: token || (typeof window !== 'undefined' ? localStorage.getItem('token') : '') },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
