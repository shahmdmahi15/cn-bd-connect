import { Module } from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { CallsController } from './calls.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
