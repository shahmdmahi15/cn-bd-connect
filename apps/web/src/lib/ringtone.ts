/**
 * Web Audio API Ringtone Generator
 * Zero external audio files required. Works offline in PWA across iOS, Android, and Desktop.
 */
class RingtoneManager {
  private ctx: AudioContext | null = null;
  private isRinging = false;
  private timerId: any = null;

  private getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Play outgoing ringing tone (Standard PBX ringback: 440Hz + 480Hz)
  playOutgoingRing() {
    this.stop();
    this.isRinging = true;

    const playPulse = () => {
      if (!this.isRinging) return;
      try {
        const ctx = this.getAudioContext();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(ctx.currentTime + 1.8);
        osc2.stop(ctx.currentTime + 1.8);
      } catch (err) {
        console.warn('WebAudio play error:', err);
      }

      this.timerId = setTimeout(playPulse, 4000);
    };

    playPulse();
  }

  // Play incoming call ring (Harmonic bell tone: 750Hz + 880Hz)
  playIncomingRing() {
    this.stop();
    this.isRinging = true;

    const playBell = () => {
      if (!this.isRinging) return;
      try {
        const ctx = this.getAudioContext();
        const frequencies = [659.25, 783.99, 987.77]; // E5, G5, B5 chord

        frequencies.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.value = freq;

          const startTime = ctx.currentTime + idx * 0.12;
          gain.gain.setValueAtTime(0.15, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.8);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(startTime);
          osc.stop(startTime + 0.8);
        });
      } catch (err) {
        console.warn('WebAudio play error:', err);
      }

      this.timerId = setTimeout(playBell, 2200);
    };

    playBell();
  }

  stop() {
    this.isRinging = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

export const ringtone = new RingtoneManager();
