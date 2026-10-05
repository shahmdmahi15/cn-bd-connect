import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [AuthModule, NotificationsModule],
  providers: [SignalingGateway],
  exports: [SignalingGateway],
})
export class SignalingModule {}
