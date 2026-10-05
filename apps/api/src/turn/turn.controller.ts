import { Controller, Get, UseGuards } from '@nestjs/common';
import { TurnService } from './turn.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { UserPayload } from '../auth/decorators/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('turn')
export class TurnController {
  constructor(private readonly turnService: TurnService) {}

  @Get('credentials')
  getCredentials(@CurrentUser() user: UserPayload) {
    const iceServers = this.turnService.getIceServers(user.id);
    return {
      iceServers,
    };
  }
}
