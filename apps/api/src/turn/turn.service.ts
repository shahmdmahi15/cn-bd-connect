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
      // 1. Self-hosted Dedicated Hong Kong Coturn STUN (Fastest, zero blocking)
      {
        urls: [
          `stun:${turnDomain}:3478`,
          'stun:18.166.1.216:3478',
        ],
      },
      // 2. Cloudflare Global Anycast STUN (Reachable across mainland China & Bangladesh)
      {
        urls: 'stun:stun.cloudflare.com:3478',
      },
      // 3. Hong Kong Coturn UDP Relay (Lowest latency direct UDP relay via 18.166.1.216)
      {
        urls: [
          `turn:${turnDomain}:3478?transport=udp`,
          'turn:18.166.1.216:3478?transport=udp',
        ],
        username: turnUsername,
        credential: turnPassword,
      },
      // 4. Hong Kong Coturn TCP Relay (Carrier NAT & symmetric firewall traversal)
      {
        urls: [
          `turn:${turnDomain}:3478?transport=tcp`,
          'turn:18.166.1.216:3478?transport=tcp',
        ],
        username: turnUsername,
        credential: turnPassword,
      },
      // 5. Hong Kong Coturn TURNS over TLS on 5349 (Encrypted media relay)
      {
        urls: [
          `turns:${turnDomain}:5349?transport=tcp`,
          'turns:18.166.1.216:5349?transport=tcp',
        ],
        username: turnUsername,
        credential: turnPassword,
      },
      // 6. Hong Kong Coturn TURNS over TLS on Port 443 (Ultimate GFW bypass via Nginx SNI)
      {
        urls: `turns:${turnDomain}:443?transport=tcp`,
        username: turnUsername,
        credential: turnPassword,
      },
      // 7. Neutral Google STUN fallback for non-mainland peers
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
    ];
  }
}
