import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

@Injectable()
export class TurnService {
  constructor(private readonly configService: ConfigService) {}

  getIceServers(userId: string): IceServerConfig[] {
    const turnDomain = this.configService.get<string>(
      'COTURN_DOMAIN',
      'cn-bd-connect-turn.shahmdmahi.dpdns.org',
    );
    const authSecret = this.configService.get<string>(
      'COTURN_AUTH_SECRET',
      'cn-bd-connect-coturn-shared-secret-key-999',
    );
    const ttlSeconds = parseInt(
      this.configService.get<string>('COTURN_TTL_SECONDS', '86400'),
      10,
    );

    // Ephemeral HMAC-SHA1 timestamp username
    const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const turnUsername = `${expiryTimestamp}:${userId}`;

    const hmac = crypto.createHmac('sha1', authSecret);
    hmac.update(turnUsername);
    const turnPassword = hmac.digest('base64');

    return [
      // 1. Google Public STUN as fast neutral baseline
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
      // 2. Self-hosted Dedicated Hong Kong Coturn STUN
      {
        urls: `stun:${turnDomain}:3478`,
      },
      // 3. Hong Kong Coturn UDP Relay (Lowest latency when UDP flows smoothly)
      {
        urls: `turn:${turnDomain}:3478?transport=udp`,
        username: turnUsername,
        credential: turnPassword,
      },
      // 4. Hong Kong Coturn TCP Relay (When GFW or carrier drops/throttles UDP)
      {
        urls: `turn:${turnDomain}:3478?transport=tcp`,
        username: turnUsername,
        credential: turnPassword,
      },
      // 5. Hong Kong Coturn TURNS over TLS on 5349 (Encrypted media relay)
      {
        urls: `turns:${turnDomain}:5349?transport=tcp`,
        username: turnUsername,
        credential: turnPassword,
      },
      // 6. Hong Kong Coturn TURNS over TLS on port 443 (Ultimate GFW bypass)
      {
        urls: `turns:${turnDomain}:443?transport=tcp`,
        username: turnUsername,
        credential: turnPassword,
      },
    ];
  }
}
