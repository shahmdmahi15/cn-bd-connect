import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { CallHistoryQueryDto } from './dto/call-history-query.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { UserPayload } from '../auth/decorators/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  /**
   * GET /api/calls/history
   * Returns the authenticated user's call history.
   */
  @Get('history')
  async getHistory(
    @CurrentUser() user: UserPayload,
    @Query() query: CallHistoryQueryDto,
  ) {
    return this.callsService.getCallHistory(user.id, query.limit, query.offset);
  }

  /**
   * GET /api/calls/:id
   * Returns a specific call session by ID.
   */
  @Get(':id')
  async getCallById(
    @CurrentUser() user: UserPayload,
    @Param('id') callId: string,
  ) {
    return this.callsService.getCallSessionById(user.id, callId);
  }
}
