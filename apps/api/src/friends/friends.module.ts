import { Module } from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { FriendsController } from './friends.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { SignalingModule } from '../signaling/signaling.module.js';

@Module({
  imports: [AuthModule, SignalingModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
