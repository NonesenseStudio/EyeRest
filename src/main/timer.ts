export type ActivePhase = "working" | "resting" | "snoozed";
export type Phase = ActivePhase | "paused";
export interface TimerSettings {
  workMinutes: number;
  restSeconds: number;
  startOnLogin: boolean;
  pauseOnLock: boolean;
}

export interface TimerStatus {
  phase: Phase;
  pausedFrom: ActivePhase | null;
  remainingSeconds: number;
  workSeconds: number;
  restSeconds: number;
  snoozeSeconds: number;
}

export interface DailyStatsSummary {
  date: string;
  focusedSeconds: number;
  restSeconds: number;
  completedBreaks: number;
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  workMinutes: 20,
  restSeconds: 20,
  startOnLogin: false,
  pauseOnLock: false,
};
export const MIN_WORK_MINUTES = 1;
export const MAX_WORK_MINUTES = 240;
export const MIN_REST_SECONDS = 1;
export const MAX_REST_SECONDS = 300;
const SNOOZE_SECONDS = 5 * 60;

export class RestTimer {
  private phase: Phase = "working";
  private previousPhase: ActivePhase = "working";
  private workSeconds = DEFAULT_TIMER_SETTINGS.workMinutes * 60;
  private restSeconds = DEFAULT_TIMER_SETTINGS.restSeconds;
  private remainingMs = this.workSeconds * 1000;
  private lastTick = performance.now();
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly onChange: (
      status: TimerStatus,
      transition?: "rest-start" | "rest-end" | "rest-complete",
    ) => void,
  ) {}

  start(): void {
    if (this.ticker) return;
    this.lastTick = performance.now();
    this.ticker = setInterval(() => this.tick(), 250);
    this.emit();
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    if (this.phase === "paused") return;
    this.remainingMs -= elapsed;
    if (this.remainingMs <= 0) {
      if (this.phase === "working") {
        this.phase = "resting";
        this.remainingMs = this.restSeconds * 1000;
        this.emit("rest-start");
      } else if (this.phase === "snoozed") {
        this.phase = "resting";
        this.remainingMs = this.restSeconds * 1000;
        this.emit("rest-start");
      } else {
        this.phase = "working";
        this.remainingMs = this.workSeconds * 1000;
        this.emit("rest-complete");
      }
    } else this.emit();
  }

  pause(): void {
    if (this.phase === "paused") return;
    this.previousPhase = this.phase;
    this.phase = "paused";
    this.emit();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = this.previousPhase;
    this.lastTick = performance.now();
    this.emit();
  }

  setSettings(settings: TimerSettings): void {
    this.workSeconds = settings.workMinutes * 60;
    this.restSeconds = settings.restSeconds;
    const activePhase =
      this.phase === "paused" ? this.previousPhase : this.phase;
    this.remainingMs =
      (activePhase === "working"
        ? this.workSeconds
        : activePhase === "resting"
          ? this.restSeconds
          : SNOOZE_SECONDS) * 1000;
    this.lastTick = performance.now();
    this.emit();
  }

  snooze(): void {
    if (
      this.phase !== "resting" &&
      !(this.phase === "paused" && this.previousPhase === "resting")
    )
      return;
    this.phase = "snoozed";
    this.remainingMs = SNOOZE_SECONDS * 1000;
    this.lastTick = performance.now();
    this.emit("rest-end");
  }

  skipRest(): void {
    if (
      this.phase !== "resting" &&
      !(this.phase === "paused" && this.previousPhase === "resting")
    )
      return;
    this.phase = "working";
    this.remainingMs = this.workSeconds * 1000;
    this.lastTick = performance.now();
    this.emit("rest-end");
  }

  reset(): void {
    this.phase = "paused";
    this.previousPhase = "working";
    this.remainingMs = this.workSeconds * 1000;
    this.lastTick = performance.now();
    this.emit();
  }

  resetAfterWake(): void {
    // 电脑睡眠不算作工作时间，也不一次性扣除休息时间。
    this.lastTick = performance.now();
    this.emit();
  }

  status(): TimerStatus {
    return {
      phase: this.phase,
      pausedFrom: this.phase === "paused" ? this.previousPhase : null,
      remainingSeconds: Math.max(0, Math.ceil(this.remainingMs / 1000)),
      workSeconds: this.workSeconds,
      restSeconds: this.restSeconds,
      snoozeSeconds: SNOOZE_SECONDS,
    };
  }

  private emit(transition?: "rest-start" | "rest-end" | "rest-complete"): void {
    this.onChange(this.status(), transition);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}
