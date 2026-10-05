import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FriendRequestStatus } from '@prisma/client';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async sendRequest(senderId: string, targetEmail: string) {
    const normalizedEmail = targetEmail.trim().toLowerCase();

    const sender = await this.prisma.user.findUnique({
      where: { id: senderId },
    });

    if (sender?.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot send a friend request to yourself');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!receiver) {
      throw new NotFoundException(`User with email "${targetEmail}" was not found`);
    }

    // Check if a request already exists between them
    const existing = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: receiver.id },
          { senderId: receiver.id, receiverId: senderId },
        ],
      },
    });

    if (existing) {
      if (existing.status === FriendRequestStatus.ACCEPTED) {
        throw new ConflictException('You are already friends with this user');
      }
      if (existing.status === FriendRequestStatus.PENDING) {
        if (existing.senderId === senderId) {
          throw new ConflictException('Friend request is already pending');
        } else {
          // If the other person had sent a request to you, accept it!
          return this.acceptRequest(senderId, existing.id);
        }
      }
      // If rejected earlier, reopen as pending
      return this.prisma.friendRequest.update({
        where: { id: existing.id },
        data: {
          senderId,
          receiverId: receiver.id,
          status: FriendRequestStatus.PENDING,
        },
        include: {
          receiver: {
            select: { id: true, name: true, email: true, country: true },
          },
        },
      });
    }

    return this.prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: receiver.id,
        status: FriendRequestStatus.PENDING,
      },
      include: {
        receiver: {
          select: { id: true, name: true, email: true, country: true },
        },
      },
    });
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
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId && request.senderId !== userId) {
      throw new BadRequestException('You are not authorized to modify this request');
    }

    return this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendRequestStatus.ACCEPTED },
      include: {
        sender: {
          select: { id: true, name: true, email: true, country: true, isOnline: true },
        },
        receiver: {
          select: { id: true, name: true, email: true, country: true, isOnline: true },
        },
      },
    });
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

    return this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: FriendRequestStatus.REJECTED },
    });
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
}
