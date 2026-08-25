import { IsEnum, IsString, Matches } from 'class-validator';

export enum OtpPurpose {
  login = 'login',
  signup = 'signup',
  sensitive_action = 'sensitive_action',
}

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'must be a valid E.164 phone number, e.g. +237670000000',
  })
  phone_number!: string;

  @IsEnum(OtpPurpose)
  purpose!: OtpPurpose;
}
