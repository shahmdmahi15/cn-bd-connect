import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly vapidPublicKey: string;
  private readonly vapidPrivateKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.vapidPublicKey = this.configService.get<string>(
      'VAPID_PUBLIC_KEY',
      'BGRdsLArZv3rVuE0Yuz0CzAxWdgxiqSbjoMwe8dM8Z0K4Nzk1C8uF4ELwyTozJYqxiNPDsDj-w7cq7ZQottBCtY',
    );
    this.vapidPrivateKey = this.configService.get<string>(
      'VAPID_PRIVATE_KEY',
      'kF_TS-I99MAFSGSU6_GiUVzjP_nW3v5uIR6SDoNg9sY',
    );
    const subject = this.configService.get<string>(
      'VAPID_SUBJECT',
      'mailto:admin@cn-bd-connect-app.shahmdmahi.dpdns.org',
    );

    try {
      webpush.setVapidDetails(subject, this.vapidPublicKey, this.vapidPrivateKey);
      this.logger.log('WebPush VAPID configured for background iOS/Android notifications');
    } catch (err) {
      this.logger.error(`Failed to initialize WebPush VAPID: ${(err as Error).message}`);
    }
  }

  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  async saveSubscription(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
  ) {
    const { endpoint, keys } = subscription;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new Error('Invalid subscription object: missing endpoint or keys');
    }

    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updatedAt: new Date(),
      },
    });
  }

  async sendPushToUser(userId: string, payload: PushPayload) {
    try {
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: { userId },
      });

      if (subscriptions.length === 0) {
        this.logger.debug(`No push subscriptions found for user: ${userId}`);
        return;
      }

      const stringifiedPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icons/icon-192x192.png',
        badge: payload.badge || '/icons/icon-72x72.png',
        tag: payload.tag || 'call-notification',
        data: payload.data || { url: '/' },
      });

      await Promise.allSettled(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              stringifiedPayload,
              {
                urgency: 'high',
                TTL: 60, // 60s time-to-live for live call alerts
              },
            );
          } catch (err: any) {
            // Prune expired or unregistered endpoints (HTTP 410 Gone / 404 Not Found)
            if (err.statusCode === 410 || err.statusCode === 404) {
              this.logger.warn(`Pruning dead push subscription: ${sub.id}`);
              await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            } else {
              this.logger.warn(`Push dispatch error on ${sub.id}: ${err.message}`);
            }
          }
        }),
      );
    } catch (err) {
      this.logger.error(`Error sending push notification to user ${userId}: ${(err as Error).message}`);
    }
  }
}
