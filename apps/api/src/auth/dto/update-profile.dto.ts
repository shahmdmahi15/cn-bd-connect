import { IsOptional, IsString, MaxLength, MinLength, IsIn } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  @MaxLength(60, { message: 'Name must not exceed 60 characters' })
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['BD', 'CN'], { message: 'Country must be BD (Bangladesh) or CN (China)' })
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Avatar URL is too long' })
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'Bio / Status must not exceed 120 characters' })
  bio?: string;
}
