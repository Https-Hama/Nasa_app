// A missing pose is common during arm gestures. Only sustained loss interrupts play.
export class TrackingRecovery {
  constructor({ graceMs = 1800, onInterrupt = () => {}, onRecover = () => {} } = {}) {
    this.graceMs = graceMs;
    this.onInterrupt = onInterrupt;
    this.onRecover = onRecover;
    this.lostAt = null;
    this.interrupted = false;
    this.suppressed = false;
  }

  observe(state, now) {
    if (state === 'tracking') {
      const recover = this.interrupted;
      this.lostAt = null;
      this.interrupted = false;
      this.suppressed = false;
      if (recover) this.onRecover();
    } else if (state === 'lost') {
      if (this.lostAt === null && !this.suppressed) this.lostAt = now;
    } else {
      this.cancel();
    }
  }

  tick(now) {
    if (this.suppressed || this.interrupted || this.lostAt === null || now - this.lostAt < this.graceMs) return;
    this.interrupted = true;
    this.onInterrupt();
  }

  // Manual pauses, navigation and hidden tabs must never be resumed by a camera callback.
  cancel() {
    this.lostAt = null;
    this.interrupted = false;
    this.suppressed = true;
  }
}
