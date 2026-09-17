import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { OptInChannelDto } from './dto/opt-in-channel.dto';
import { OptOutChannelDto } from './dto/opt-out-channel.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'In-app notification list/badge feed.' })
  listNotifications(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsDto) {
    return this.notificationsService.listInApp(user.userId, query.unread === true, query.cursor, query.limit ?? 20);
  }

  @Patch('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark an in-app notification as read.' })
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') notificationId: string) {
    await this.notificationsService.markRead(user.userId, notificationId);
  }

  @Get('notification-channels')
  @ApiOperation({ summary: 'Current opt-in/verification status per channel.' })
  getChannelStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.getChannelStatus(user.userId);
  }

  @Post('notification-channels/:channel/opt-in')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Opt into a channel (sms, whatsapp, or email), capturing its identifier.' })
  async optIn(@CurrentUser() user: AuthenticatedUser, @Param('channel') channel: string, @Body() dto: OptInChannelDto) {
    await this.notificationsService.optIn(user.userId, channel, dto);
  }

  @Post('notification-channels/:channel/opt-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Opt out of a channel — SMS requires confirm: true given its critical-event role.' })
  async optOut(@CurrentUser() user: AuthenticatedUser, @Param('channel') channel: string, @Body() dto: OptOutChannelDto) {
    await this.notificationsService.optOut(user.userId, channel, dto);
  }

  @Patch('notification-preferences')
  @ApiOperation({ summary: 'Adjust preferred channel order for non-critical events.' })
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notificationsService.updatePreferences(user.userId, dto);
  }

  @Post('push-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register or refresh an FCM device token.' })
  async registerPushToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterPushTokenDto) {
    await this.notificationsService.registerPushToken(user.userId, dto);
  }
}
