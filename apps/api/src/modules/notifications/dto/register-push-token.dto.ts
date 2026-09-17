import { IsIn, IsString, MinLength } from 'class-validator';

export const PUSH_PLATFORMS = ['android', 'ios'] as const;

export class RegisterPushTokenDto {
  @IsString()
  @MinLength(10)
  fcm_token!: string;

  @IsIn(PUSH_PLATFORMS)
  platform!: (typeof PUSH_PLATFORMS)[number];
}
