import { IsString, IsUUID, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsUUID()
  challenge_id!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}
