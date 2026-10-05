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
import { Logger } from '@nestjs/common';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userPayload?: {
    id: string;
    email: string;
    name: string;
    country: string;
  };
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

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

    // Check if callee is online
    const calleeSockets = this.userSockets.get(toUserId);
    if (!calleeSockets || calleeSockets.size === 0) {
      client.emit('call:offline', { toUserId, message: 'User is currently offline' });
      return;
    }

    // Check if callee is busy
    if (this.activeCalls.has(toUserId)) {
      client.emit('call:busy', { toUserId, message: 'User is currently on another call' });
      return;
    }

    this.logger.log(`Call initiated from ${callerId} to ${toUserId} (Video: ${isVideo})`);

    // Emit incoming call to callee
    this.server.to(`user:${toUserId}`).emit('call:incoming', {
      caller: {
        id: callerId,
        name: client.userPayload.name,
        email: client.userPayload.email,
        country: client.userPayload.country,
      },
      isVideo,
      offer,
    });
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

  // --- Real-time Notifications for Friend Requests ---

  sendFriendRequestNotification(receiverId: string, sender: any) {
    this.server.to(`user:${receiverId}`).emit('friend:request_received', {
      sender,
    });
  }

  sendFriendAcceptedNotification(senderId: string, friend: any) {
    this.server.to(`user:${senderId}`).emit('friend:request_accepted', {
      friend,
    });
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
