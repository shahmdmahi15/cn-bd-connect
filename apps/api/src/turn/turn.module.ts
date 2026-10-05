import { Module } from '@nestjs/common';
import { TurnService } from './turn.service.js';
import { TurnController } from './turn.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [TurnController],
  providers: [TurnService],
  exports: [TurnService],
})
export class TurnModule {}
