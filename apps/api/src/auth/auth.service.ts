import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        password: hashedPassword,
        country: dto.country.toUpperCase(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    const token = this.generateToken(user);

    return {
      user,
      token,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      country: user.country,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };

    const token = this.generateToken(safeUser);

    return {
      user: safeUser,
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        avatarUrl: true,
        isOnline: true,
        lastSeen: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  generateToken(user: { id: string; email: string; name: string; country: string }) {
    const secret = this.configService.get<string>(
      'JWT_SECRET',
      'cn-bd-connect-fallback-secret-key-321',
    );
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '30d');

    return this.jwtService.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        country: user.country,
      },
      {
        secret,
        expiresIn: expiresIn as any,
      },
    );
  }
}
