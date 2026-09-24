import { IsString, MaxLength, MinLength } from 'class-validator';

// A reason is required to flag or remove a listing — this is what shows up
// in the audit log and (for removal) is the thing an admin would need to
// justify later, per the PRD's "auditability" non-functional requirement.
export class FlagListingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
