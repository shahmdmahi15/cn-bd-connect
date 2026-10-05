import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return {
      publicKey: this.notificationsService.getPublicKey(),
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  async subscribe(@Request() req: any, @Body() body: any) {
    await this.notificationsService.saveSubscription(req.user.id, body);
    return { success: true, message: 'Push subscription registered successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('test')
  async sendTestPush(@Request() req: any) {
    await this.notificationsService.sendPushToUser(req.user.id, {
      title: 'CN-BD Connect 🚀',
      body: 'Background call notifications are active and ready on your device!',
      tag: 'test-push',
      data: { url: '/' },
    });
    return { success: true, message: 'Test notification dispatched' };
  }
}
