import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { FriendsService } from './friends.service.js';
import { SendFriendRequestDto } from './dto/send-request.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { UserPayload } from '../auth/decorators/current-user.decorator.js';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('request')
  async sendRequest(
    @CurrentUser() user: UserPayload,
    @Body(new ValidationPipe({ whitelist: true })) dto: SendFriendRequestDto,
  ) {
    return this.friendsService.sendRequest(user.id, dto.email);
  }

  @Get('requests')
  async getRequests(@CurrentUser() user: UserPayload) {
    return this.friendsService.getRequests(user.id);
  }

  @Post('requests/:id/accept')
  async acceptRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendsService.acceptRequest(user.id, requestId);
  }

  @Post('requests/:id/reject')
  async rejectRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendsService.rejectRequest(user.id, requestId);
  }

  @Get()
  async getFriends(@CurrentUser() user: UserPayload) {
    return this.friendsService.getFriends(user.id);
  }
}
