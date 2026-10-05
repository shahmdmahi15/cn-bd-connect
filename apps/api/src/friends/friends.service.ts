import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalingGateway } from '../signaling/signaling.gateway.js';
import { FriendRequestStatus } from '@prisma/client';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signalingGateway: SignalingGateway,
  ) {}

  async sendRequest(senderId: string, targetEmail: string) {
    const normalizedEmail = targetEmail.trim().toLowerCase();

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        avatarUrl: true,
      },
    });

    if (!sender) {
      throw new NotFoundException('Current user account not found');
    }

    if (sender.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot send a friend request to yourself');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        name: true,
        email: true,
        country: true,
        avatarUrl: true,
        isOnline: true,
      },
    });

    if (!receiver) {
      throw new NotFoundException(`User with email "${targetEmail.trim()}" was not found. Please verify the email.`);
    }

    // Check if a request already exists between them
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true },
        },
        receiver: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true },
        },
      },
    });

    if (existing) {
      if (existing.status === FriendRequestStatus.ACCEPTED) {
        throw new ConflictException(`You are already friends with ${receiver.name}`);
      }
      if (existing.status === FriendRequestStatus.PENDING) {
        if (existing.senderId === senderId) {
          throw new ConflictException(`A friend request to ${receiver.name} is already pending`);
        } else {
          // If the other person had already sent a request to you, accept it automatically!
          return this.acceptRequest(senderId, existing.id);
        }
      }
      // If rejected earlier, reopen as pending
      const updated = await this.prisma.friendRequest.update({
        where: { id: existing.id },
        data: {
          senderId,
          receiverId: receiver.id,
          status: FriendRequestStatus.PENDING,
        },
        include: {
          sender: {
            select: { id: true, name: true, email: true, country: true, avatarUrl: true },
          },
          receiver: {
            select: { id: true, name: true, email: true, country: true, avatarUrl: true },
          },
        },
      });

      // Notify receiver via WebSocket
      this.signalingGateway.sendFriendRequestNotification(receiver.id, {
        id: updated.id,
        sender,
        createdAt: updated.updatedAt,
      });

      return updated;
    }

    const newRequest = await this.prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: receiver.id,
        status: FriendRequestStatus.PENDING,
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true },
        },
        receiver: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true },
        },
      },
    });

    // Notify receiver in real time via WebSocket
    this.signalingGateway.sendFriendRequestNotification(receiver.id, {
      id: newRequest.id,
      sender,
      createdAt: newRequest.createdAt,
    });

    return newRequest;
  }

  async getRequests(userId: string) {
    const [incoming, outgoing] = await Promise.all([
      this.prisma.friendRequest.findMany({
        where: {
          receiverId: userId,
          status: FriendRequestStatus.PENDING,
        },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              email: true,
              country: true,
              avatarUrl: true,
              isOnline: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.friendRequest.findMany({
        where: {
          senderId: userId,
          status: FriendRequestStatus.PENDING,
        },
        include: {
          receiver: {
            select: {
              id: true,
              name: true,
              email: true,
              country: true,
              avatarUrl: true,
              isOnline: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { incoming, outgoing };
  }

  async acceptRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: {
        sender: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true, isOnline: true },
        },
        receiver: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true, isOnline: true },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId && request.senderId !== userId) {
      throw new BadRequestException('You are not authorized to modify this request');
    }

    const updated = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendRequestStatus.ACCEPTED },
      include: {
        sender: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true, isOnline: true },
        },
        receiver: {
          select: { id: true, name: true, email: true, country: true, avatarUrl: true, isOnline: true },
        },
      },
    });

    // Notify both users in real time via WebSocket
    this.signalingGateway.sendFriendAcceptedNotification(updated.senderId, updated.receiver);
    this.signalingGateway.sendFriendAcceptedNotification(updated.receiverId, updated.sender);

    return updated;
  }

  async rejectRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId && request.senderId !== userId) {
      throw new BadRequestException('You are not authorized to modify this request');
    }

    const updated = await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendRequestStatus.REJECTED },
    });

    // Notify the other peer
    const targetUserId = request.senderId === userId ? request.receiverId : request.senderId;
    this.signalingGateway.sendFriendRejectedNotification(targetUserId, requestId);

    return updated;
  }

  async cancelRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.senderId !== userId) {
      throw new BadRequestException('You can only cancel requests you sent');
    }

    await this.prisma.friendRequest.delete({
      where: { id: requestId },
    });

    // Notify receiver that the request was withdrawn
    this.signalingGateway.sendFriendCanceledNotification(request.receiverId, requestId);

    return { success: true };
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendRequest.findMany({
      where: {
        status: FriendRequestStatus.ACCEPTED,
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            country: true,
            avatarUrl: true,
            isOnline: true,
            lastSeen: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            email: true,
            country: true,
            avatarUrl: true,
            isOnline: true,
            lastSeen: true,
          },
        },
      },
    });

    // Map to the friend object (the other user)
    return friendships.map((f) => {
      const friend = f.senderId === userId ? f.receiver : f.sender;
      return {
        ...friend,
        friendshipId: f.id,
        connectedSince: f.updatedAt,
      };
    });
  }

  async removeFriend(userId: string, friendId: string) {
    await this.prisma.friendRequest.deleteMany({
      where: {
        OR: [
          { senderId: userId, receiverId: friendId, status: FriendRequestStatus.ACCEPTED },
          { senderId: friendId, receiverId: userId, status: FriendRequestStatus.ACCEPTED },
        ],
      },
    });

    // Notify friend that relationship ended
    this.signalingGateway.sendFriendRejectedNotification(friendId, userId);

    return { success: true };
  }
}
