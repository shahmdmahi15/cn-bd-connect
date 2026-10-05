import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userPayload?: {
    id: string;
    email: string;
    name: string;
    country: string;
  };
}

interface PendingCallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  caller: {
    id: string;
    name: string;
    email: string;
    country: string;
  };
  isVideo: boolean;
  offer: any;
  createdAt: number;
  timer: NodeJS.Timeout;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SignalingGateway.name);

  // In-memory mapping of userId -> Set of socket IDs for multi-device/multi-tab support
  private userSockets = new Map<string, Set<string>>();
  // Active call map: userId -> currentCallWithUserId
  private activeCalls = new Map<string, string>();
  // Pending calls waiting for answer (calleeId -> session)
  private pendingCalls = new Map<string, PendingCallSession>();
  // Reverse index (callerId -> calleeId)
  private callerToPending = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Real-time ping probe for live latency measurement (Dhaka <-> HK <-> China)
  @SubscribeMessage('ping')
  handlePing(
    @ConnectedSocket() _client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    const clientTime = typeof data === 'number' ? data : data?.clientTime || Date.now();
    return {
      clientTime,
      serverTime: Date.now(),
      region: 'Hong Kong Hub (ap-east-1)',
    };
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization?.replace('Bearer ', '') as string) ||
        (client.handshake.query?.token as string);

      if (!token) {
        this.logger.warn(`Client connected without token: ${client.id}`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>(
        'JWT_SECRET',
        'cn-bd-connect-fallback-secret-key-321',
      );
      const payload = await this.jwtService.verifyAsync(token, { secret });

      client.userId = payload.id;
      client.userPayload = payload;

      // Register socket in user's room and mapping
      if (!this.userSockets.has(payload.id)) {
        this.userSockets.set(payload.id, new Set());
      }
      this.userSockets.get(payload.id)!.add(client.id);
      client.join(`user:${payload.id}`);

      // Update database online status
      await this.prisma.user.update({
        where: { id: payload.id },
        data: { isOnline: true, lastSeen: new Date() },
      });

      this.logger.log(`User connected: ${payload.name} (${payload.id}) - Socket: ${client.id}`);

      // Check if user has an active pending incoming call waiting for them!
      const pending = this.pendingCalls.get(payload.id);
      if (pending) {
        this.logger.log(`Delivering pending call ${pending.callId} to reconnected user ${payload.id}`);
        client.emit('call:incoming', {
          callId: pending.callId,
          caller: pending.caller,
          isVideo: pending.isVideo,
          offer: pending.offer,
        });
      }

      // Broadcast online status to friends
      await this.notifyFriendsPresence(payload.id, true);
    } catch (err) {
      this.logger.error(`Socket connection authentication failed: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.userId;
    if (!userId) return;

    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);

        // If user was in an active call, end it automatically
        const peerId = this.activeCalls.get(userId);
        if (peerId) {
          this.activeCalls.delete(userId);
          this.activeCalls.delete(peerId);
          this.server.to(`user:${peerId}`).emit('call:ended', { fromUserId: userId });
        }

        // If user was a caller waiting for a pending call, clean up and notify callee
        const pendingCalleeId = this.callerToPending.get(userId);
        if (pendingCalleeId) {
          const pending = this.pendingCalls.get(pendingCalleeId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingCalls.delete(pendingCalleeId);
            this.callerToPending.delete(userId);
            this.server.to(`user:${pendingCalleeId}`).emit('call:cancelled', { fromUserId: userId });
          }
        }

        // Update database offline status
        await this.prisma.user.update({
          where: { id: userId },
          data: { isOnline: false, lastSeen: new Date() },
        });

        // Broadcast offline status to friends
        await this.notifyFriendsPresence(userId, false);
        this.logger.log(`User fully disconnected: ${userId}`);
      }
    }
  }

  // --- WebRTC 1-on-1 Calling Events ---

  @SubscribeMessage('call:check_pending')
  handleCheckPending(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.userId;
    if (!userId) return { hasPending: false };
    const pending = this.pendingCalls.get(userId);
    if (pending) {
      return {
        hasPending: true,
        callId: pending.callId,
        caller: pending.caller,
        isVideo: pending.isVideo,
        offer: pending.offer,
      };
    }
    return { hasPending: false };
  }

  @SubscribeMessage('call:initiate')
  async handleCallInitiate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      toUserId: string;
      isVideo: boolean;
      offer: any;
    },
  ) {
    const callerId = client.userId;
    if (!callerId || !client.userPayload) return;

    const { toUserId, isVideo, offer } = data;

    // Check if callee is currently in another active call
    if (this.activeCalls.has(toUserId)) {
      client.emit('call:busy', { toUserId, message: 'User is currently on another call' });
      return;
    }

    // Check if callee already has a pending incoming call
    if (this.pendingCalls.has(toUserId)) {
      client.emit('call:busy', { toUserId, message: 'User is currently receiving another call' });
      return;
    }

    // Clear any previous pending call initiated by this caller
    const existingPendingCallee = this.callerToPending.get(callerId);
    if (existingPendingCallee) {
      const oldPending = this.pendingCalls.get(existingPendingCallee);
      if (oldPending) {
        clearTimeout(oldPending.timer);
        this.pendingCalls.delete(existingPendingCallee);
      }
      this.callerToPending.delete(callerId);
    }

    const callId = randomUUID();
    const callerInfo = {
      id: callerId,
      name: client.userPayload.name,
      email: client.userPayload.email,
      country: client.userPayload.country,
    };

    // 45-second timeout for unanswered calls
    const timer = setTimeout(() => {
      this.logger.log(`Call ${callId} timed out after 45s (Caller: ${callerId}, Callee: ${toUserId})`);
      this.pendingCalls.delete(toUserId);
      this.callerToPending.delete(callerId);
      this.server.to(`user:${callerId}`).emit('call:timeout', { toUserId, callId });
      this.server.to(`user:${toUserId}`).emit('call:timeout', { fromUserId: callerId, callId });
    }, 45000);

    const pendingSession: PendingCallSession = {
      callId,
      callerId,
      calleeId: toUserId,
      caller: callerInfo,
      isVideo,
      offer,
      createdAt: Date.now(),
      timer,
    };

    this.pendingCalls.set(toUserId, pendingSession);
    this.callerToPending.set(callerId, toUserId);

    this.logger.log(`Call initiated (${callId}) from ${callerId} to ${toUserId} (Video: ${isVideo})`);

    const calleeSockets = this.userSockets.get(toUserId);
    const isCalleeOnline = !!(calleeSockets && calleeSockets.size > 0);

    // 1. Notify caller that callee is ringing (caller plays ringback tone)
    client.emit('call:ringing', {
      toUserId,
      callId,
      isCalleeOnline,
    });

    // 2. If callee has active socket connection, emit call:incoming immediately
    if (isCalleeOnline) {
      this.server.to(`user:${toUserId}`).emit('call:incoming', {
        callId,
        caller: callerInfo,
        isVideo,
        offer,
      });
    }

    // 3. Dispatch high-priority background Web Push Notification to callee's device (iOS APNs / Android / Desktop)
    const callUrl = `/?incomingCall=1&callId=${callId}&callerId=${callerId}&callerName=${encodeURIComponent(client.userPayload.name)}&isVideo=${isVideo ? '1' : '0'}&country=${client.userPayload.country || 'BD'}`;
    this.notificationsService
      .sendPushToUser(toUserId, {
        title: `📞 Incoming ${isVideo ? 'Video' : 'Voice'} Call`,
        body: `${client.userPayload.name} is calling you on CN-BD Connect. Tap to answer!`,
        tag: `call-${callId}`,
        data: {
          url: callUrl,
          callId,
          callerId,
          callerName: client.userPayload.name,
          isVideo,
          country: client.userPayload.country,
        },
      })
      .catch((err) => this.logger.warn(`Push dispatch notice: ${err.message}`));
  }

  @SubscribeMessage('call:cancel')
  handleCallCancel(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { toUserId: string },
  ) {
    const callerId = client.userId;
    if (!callerId) return;

    const { toUserId } = data;
    const pending = this.pendingCalls.get(toUserId);
    if (pending && pending.callerId === callerId) {
      clearTimeout(pending.timer);
      this.pendingCalls.delete(toUserId);
      this.callerToPending.delete(callerId);
      this.logger.log(`Call cancelled by caller ${callerId} for callee ${toUserId}`);
      this.server.to(`user:${toUserId}`).emit('call:cancelled', { fromUserId: callerId });
    }
  }

  @SubscribeMessage('call:accept')
  handleCallAccept(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      toUserId: string;
      answer: any;
    },
  ) {
    const calleeId = client.userId;
    if (!calleeId) return;

    const { toUserId, answer } = data;

    // Clear pending call timer & entries
    const pending = this.pendingCalls.get(calleeId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingCalls.delete(calleeId);
      this.callerToPending.delete(pending.callerId);
    }

    // Mark both users as active in call
    this.activeCalls.set(calleeId, toUserId);
    this.activeCalls.set(toUserId, calleeId);

    this.logger.log(`Call accepted by ${calleeId} with ${toUserId}`);

    // Send answer back to caller
    this.server.to(`user:${toUserId}`).emit('call:accepted', {
      fromUserId: calleeId,
      answer,
    });
  }

  @SubscribeMessage('call:reject')
  handleCallReject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      toUserId: string;
      reason?: string;
    },
  ) {
    const calleeId = client.userId;
    if (!calleeId) return;

    const { toUserId, reason } = data;

    // Clear pending call timer & entries
    const pending = this.pendingCalls.get(calleeId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingCalls.delete(calleeId);
      this.callerToPending.delete(pending.callerId);
    }

    this.logger.log(`Call rejected by ${calleeId} for ${toUserId}`);

    this.server.to(`user:${toUserId}`).emit('call:rejected', {
      fromUserId: calleeId,
      reason: reason || 'Call declined',
    });
  }

  @SubscribeMessage('call:end')
  handleCallEnd(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { toUserId: string },
  ) {
    const userId = client.userId;
    if (!userId) return;

    const { toUserId } = data;

    // Clear any pending call if caller hangs up before answer
    const pendingAsCallee = this.pendingCalls.get(userId);
    if (pendingAsCallee) {
      clearTimeout(pendingAsCallee.timer);
      this.pendingCalls.delete(userId);
      this.callerToPending.delete(pendingAsCallee.callerId);
    }
    const pendingAsCaller = this.pendingCalls.get(toUserId);
    if (pendingAsCaller && pendingAsCaller.callerId === userId) {
      clearTimeout(pendingAsCaller.timer);
      this.pendingCalls.delete(toUserId);
      this.callerToPending.delete(userId);
      this.server.to(`user:${toUserId}`).emit('call:cancelled', { fromUserId: userId });
    }

    this.activeCalls.delete(userId);
    this.activeCalls.delete(toUserId);

    this.logger.log(`Call ended between ${userId} and ${toUserId}`);

    this.server.to(`user:${toUserId}`).emit('call:ended', {
      fromUserId: userId,
    });
  }

  @SubscribeMessage('call:ice_candidate')
  handleIceCandidate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      toUserId: string;
      candidate: any;
    },
  ) {
    const fromUserId = client.userId;
    if (!fromUserId) return;

    const { toUserId, candidate } = data;

    this.server.to(`user:${toUserId}`).emit('call:ice_candidate', {
      fromUserId,
      candidate,
    });
  }

  @SubscribeMessage('call:control')
  handleControl(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      toUserId: string;
      payload: any;
    },
  ) {
    const fromUserId = client.userId;
    if (!fromUserId) return;

    const { toUserId, payload } = data;
    this.server.to(`user:${toUserId}`).emit('call:control', {
      fromUserId,
      payload,
    });
  }

  // --- Real-time Notifications for Friend Requests ---

  sendFriendRequestNotification(receiverId: string, request: any) {
    this.server.to(`user:${receiverId}`).emit('friend:request', request);
    this.server.to(`user:${receiverId}`).emit('friend:request_received', request);
  }

  sendFriendAcceptedNotification(targetUserId: string, friend: any) {
    this.server.to(`user:${targetUserId}`).emit('friend:accepted', friend);
    this.server.to(`user:${targetUserId}`).emit('friend:request_accepted', friend);
  }

  sendFriendCanceledNotification(targetUserId: string, requestId: string) {
    this.server.to(`user:${targetUserId}`).emit('friend:canceled', { requestId });
  }

  sendFriendRejectedNotification(targetUserId: string, requestId: string) {
    this.server.to(`user:${targetUserId}`).emit('friend:rejected', { requestId });
  }

  private async notifyFriendsPresence(userId: string, isOnline: boolean) {
    try {
      const friendships = await this.prisma.friendRequest.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
      });

      for (const f of friendships) {
        const friendId = f.senderId === userId ? f.receiverId : f.senderId;
        this.server.to(`user:${friendId}`).emit('friend:presence', {
          userId,
          isOnline,
        });
      }
    } catch (err) {
      this.logger.error(`Error notifying friends presence: ${(err as Error).message}`);
    }
  }
}
