// Crystal-clear Web Audio Ringtone & Ringback Engine with AudioContext auto-unlock
class RingtoneService {
  private audioCtx: AudioContext | null = null;
  private isPlaying = false;
  private ringInterval: NodeJS.Timeout | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private unlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        if (!this.unlocked) {
          this.initCtx();
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
          }
          this.unlocked = true;
        }
        window.removeEventListener('click', unlock);
        window.removeEventListener('touchstart', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('click', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  private initCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  // --- 1. Play Incoming Ringtone (Modern melodic chime + HTMLAudio fallback + vibration) ---
  playIncomingRing(volume: number = 0.8) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    const ctx = this.initCtx();

    // Also trigger HTML5 audio element
    try {
      if (!this.audioElement && typeof Audio !== 'undefined') {
        this.audioElement = new Audio('/ringtone.mp3');
        this.audioElement.loop = true;
      }
      if (this.audioElement) {
        this.audioElement.volume = volume;
        this.audioElement.play().catch(() => {
          // Autoplay blocked fallback will rely on WebAudio below
        });
      }
    } catch {}

    const playChimeSequence = () => {
      if (!this.isPlaying) return;
      const currentCtx = this.initCtx();
      if (!currentCtx) return;

      try {
        const now = currentCtx.currentTime;
        // Chime frequencies (C5, E5, G5, C6)
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, index) => {
          const osc = currentCtx.createOscillator();
          const gain = currentCtx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + index * 0.15);

          gain.gain.setValueAtTime(0, now + index * 0.15);
          gain.gain.linearRampToValueAtTime(0.25 * volume, now + index * 0.15 + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.15 + 0.6);

          osc.connect(gain);
          gain.connect(currentCtx.destination);

          osc.start(now + index * 0.15);
          osc.stop(now + index * 0.15 + 0.6);
        });

        // Vibrate mobile device
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([500, 250, 500, 250, 500]);
        }
      } catch (err) {
        console.warn('Incoming ringtone playback error:', err);
      }
    };

    playChimeSequence();
    this.ringInterval = setInterval(playChimeSequence, 2400);
  }

  // --- 2. Play Outgoing Ringback Tone (Classic international telephone pulse) ---
  playOutgoingRing(volume: number = 0.5) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.initCtx();

    const playPulse = () => {
      if (!this.isPlaying) return;
      const ctx = this.initCtx();
      if (!ctx) return;

      try {
        const now = ctx.currentTime;
        // Dual standard 440Hz + 480Hz telecommunication ringback frequencies
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.12 * volume, now + 0.05);
        gain.gain.setValueAtTime(0.12 * volume, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.3);
        osc2.stop(now + 1.3);
      } catch (err) {
        console.warn('Ringback tone playback error:', err);
      }
    };

    playPulse();
    this.ringInterval = setInterval(playPulse, 3500);
  }

  // --- 3. Stop All Tones ---
  stop() {
    this.isPlaying = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      } catch {}
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(0);
      } catch {}
    }
  }

  // --- 4. Test Ringtone for Settings Panel (Plays 2.4s preview) ---
  testRingtone(volume: number = 0.8): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      this.playIncomingRing(volume);
      setTimeout(() => {
        this.stop();
        resolve();
      }, 2500);
    });
  }
}

export const ringtoneService = new RingtoneService();
