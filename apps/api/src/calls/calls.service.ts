import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallStatus } from '@prisma/client';

export interface CreateCallSessionInput {
  id?: string;
  callerId: string;
  calleeId: string;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Create a new CallSession record on call initiation.
   * Status defaults to INITIATED.
   */
  async createCallSession(input: CreateCallSessionInput) {
    try {
      const session = await this.prisma.callSession.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          callerId: input.callerId,
          calleeId: input.calleeId,
          status: CallStatus.INITIATED,
        },
        include: {
          caller: {
            select: {
              id: true,
              name: true,
              email: true,
              country: true,
              avatarUrl: true,
            },
          },
          callee: {
            select: {
              id: true,
              name: true,
              email: true,
              country: true,
              avatarUrl: true,
            },
          },
        },
      });

      this.logger.log(
        `Call session created: ${session.id} (${session.callerId} -> ${session.calleeId})`,
      );
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create call session for caller ${input.callerId} -> callee ${input.calleeId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Helper: Update CallSession status to CONNECTED on call accept.
   * Records startedAt timestamp.
   */
  async markCallConnected(callId: string) {
    try {
      const existing = await this.prisma.callSession.findUnique({
        where: { id: callId },
      });

      if (!existing) {
        this.logger.warn(`markCallConnected: Call session ${callId} not found`);
        return null;
      }

      const updated = await this.prisma.callSession.update({
        where: { id: callId },
        data: {
          status: CallStatus.CONNECTED,
          startedAt: existing.startedAt ?? new Date(),
        },
      });

      this.logger.log(`Call session connected: ${callId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to mark call session ${callId} as connected: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Helper: Update CallSession status to ENDED on call end.
   * Calculates and saves exact durationSeconds based on startedAt and endedAt.
   */
  async markCallEnded(callId: string) {
    try {
      const existing = await this.prisma.callSession.findUnique({
        where: { id: callId },
      });

      if (!existing) {
        this.logger.warn(`markCallEnded: Call session ${callId} not found`);
        return null;
      }

      // Avoid double-processing if already finalized
      if (existing.status === CallStatus.ENDED) {
        return existing;
      }

      const endedAt = new Date();
      let durationSeconds = existing.durationSeconds;

      if (existing.startedAt) {
        durationSeconds = Math.max(
          0,
          Math.floor((endedAt.getTime() - existing.startedAt.getTime()) / 1000),
        );
      }

      const updated = await this.prisma.callSession.update({
        where: { id: callId },
        data: {
          status: CallStatus.ENDED,
          endedAt,
          durationSeconds,
        },
      });

      this.logger.log(
        `Call session ended: ${callId} (Duration: ${durationSeconds}s)`,
      );
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to mark call session ${callId} as ended: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Helper: Update CallSession status to MISSED on timeout or unanswered cancellation.
   */
  async markCallMissed(callId: string) {
    try {
      const existing = await this.prisma.callSession.findUnique({
        where: { id: callId },
      });

      if (!existing) {
        this.logger.warn(`markCallMissed: Call session ${callId} not found`);
        return null;
      }

      // Do not overwrite calls that were already connected or ended
      if (
        existing.status === CallStatus.CONNECTED ||
        existing.status === CallStatus.ENDED
      ) {
        return existing;
      }

      const updated = await this.prisma.callSession.update({
        where: { id: callId },
        data: {
          status: CallStatus.MISSED,
          endedAt: new Date(),
        },
      });

      this.logger.log(`Call session marked missed: ${callId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to mark call session ${callId} as missed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Helper: Update CallSession status to DECLINED on call reject.
   */
  async markCallDeclined(callId: string) {
    try {
      const existing = await this.prisma.callSession.findUnique({
        where: { id: callId },
      });

      if (!existing) {
        this.logger.warn(`markCallDeclined: Call session ${callId} not found`);
        return null;
      }

      // Do not overwrite calls that were already connected or ended
      if (
        existing.status === CallStatus.CONNECTED ||
        existing.status === CallStatus.ENDED
      ) {
        return existing;
      }

      const updated = await this.prisma.callSession.update({
        where: { id: callId },
        data: {
          status: CallStatus.DECLINED,
          endedAt: new Date(),
        },
      });

      this.logger.log(`Call session marked declined: ${callId}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to mark call session ${callId} as declined: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Return call history for a specific user (both initiated and received calls).
   * Sorted by createdAt descending.
   */
  async getCallHistory(userId: string, limit = 50, offset = 0) {
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const safeOffset = Math.max(0, offset ?? 0);

    return this.prisma.callSession.findMany({
      where: {
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            email: true,
            country: true,
            avatarUrl: true,
          },
        },
        callee: {
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
      take: safeLimit,
      skip: safeOffset,
    });
  }

  /**
   * Retrieve a single CallSession by ID with authorization verification.
   */
  async getCallSessionById(userId: string, callId: string) {
    const session = await this.prisma.callSession.findUnique({
      where: { id: callId },
      include: {
        caller: {
          select: {
            id: true,
            name: true,
            email: true,
            country: true,
            avatarUrl: true,
          },
        },
        callee: {
          select: {
            id: true,
            name: true,
            email: true,
            country: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Call session ${callId} not found`);
    }

    if (session.callerId !== userId && session.calleeId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to view this call session',
      );
    }

    return session;
  }
}
