import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray,
} from "electron/main";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import iconSvg from "../assets/icon.svg?raw";
import {
  DEFAULT_TIMER_SETTINGS,
  MAX_REST_SECONDS,
  MAX_WORK_MINUTES,
  MIN_REST_SECONDS,
  MIN_WORK_MINUTES,
  RestTimer,
  type DailyStatsSummary,
  type TimerSettings,
  type TimerStatus,
} from "./timer";

let mainWindow: BrowserWindow | null = null;
let reminderWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let quitAfterStatsSaved = false;
let screenLocked = false;
let pausedByLock = false;
let timerSettings: TimerSettings = { ...DEFAULT_TIMER_SETTINGS };
interface DailyStatsRecord {
  date: string;
  focusedMilliseconds: number;
  restMilliseconds: number;
  completedBreaks: number;
}
function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function emptyDailyStats(date = localDateKey()): DailyStatsRecord {
  return {
    date,
    focusedMilliseconds: 0,
    restMilliseconds: 0,
    completedBreaks: 0,
  };
}
let dailyStats = emptyDailyStats();
let lastStatsTick = performance.now();
let lastStatsPersistedAt = performance.now();
let lastPublishedStats = "";
let statsFlushTimer: ReturnType<typeof setInterval> | undefined;
let currentStatus: TimerStatus = {
  phase: "working",
  pausedFrom: null,
  remainingSeconds: DEFAULT_TIMER_SETTINGS.workMinutes * 60,
  workSeconds: DEFAULT_TIMER_SETTINGS.workMinutes * 60,
  restSeconds: DEFAULT_TIMER_SETTINGS.restSeconds,
  snoozeSeconds: 5 * 60,
};

const svgIcon = nativeImage.createFromDataURL(
  `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}`,
);
const iconPath = app.isPackaged
  ? join(process.resourcesPath, "app-icon.ico")
  : join(app.getAppPath(), "src", "assets", "icon.ico");
const packagedIcon = nativeImage.createFromPath(iconPath);
const icon = packagedIcon.isEmpty() ? svgIcon : packagedIcon;

if (process.platform === "win32") app.setAppUserModelId("local.eye.rest");

function loadPage(win: BrowserWindow, page: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#/${page}`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), {
      hash: `/${page}`,
    });
  }
}

function createMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const workArea = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const availableWidth = Math.max(1, workArea.width - 32);
  const availableHeight = Math.max(1, workArea.height - 32);
  const width = Math.min(
    availableWidth,
    440,
    Math.max(320, Math.round(workArea.width * 0.3)),
  );
  const height = Math.min(
    availableHeight,
    560,
    Math.max(360, Math.round(workArea.height * 0.68)),
  );
  const horizontalMargin = Math.min(
    16,
    Math.max(0, Math.floor((workArea.width - width) / 2)),
  );
  const verticalMargin = Math.min(
    16,
    Math.max(0, Math.floor((workArea.height - height) / 2)),
  );
  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - horizontalMargin,
    y: workArea.y + workArea.height - height - verticalMargin,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: "#111722",
    title: "护眼提醒",
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  loadPage(mainWindow, "home");
}

function showReminder(): void {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.show();
    reminderWindow.focus();
    return;
  }
  const bounds = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  const width = Math.min(
    Math.max(1, bounds.width - 24),
    380,
    Math.max(280, Math.round(bounds.width * 0.28)),
  );
  const height = Math.min(
    Math.max(1, bounds.height - 24),
    340,
    Math.max(280, Math.round(bounds.height * 0.38)),
  );
  reminderWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: Math.round(bounds.y + (bounds.height - height) / 2),
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: "#111722",
    show: false,
    icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  reminderWindow.on("closed", () => {
    reminderWindow = null;
  });
  reminderWindow.once("ready-to-show", () => reminderWindow?.show());
  loadPage(reminderWindow, "reminder");
}

function hideReminder(): void {
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.destroy();
  reminderWindow = null;
}

function broadcast(
  status: TimerStatus,
  transition?: "rest-start" | "rest-end" | "rest-complete",
): void {
  recordStats(status, transition);
  for (const win of [mainWindow, reminderWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("timer:status", status);
    }
  }
  if (tray) {
    const phase =
      status.phase === "paused"
        ? "已暂停"
        : status.phase === "resting"
          ? "休息中"
          : status.phase === "snoozed"
            ? "稍后提醒中"
            : "工作中";
    const minutes = String(Math.floor(status.remainingSeconds / 60)).padStart(
      2,
      "0",
    );
    const seconds = String(status.remainingSeconds % 60).padStart(2, "0");
    tray.setToolTip(`护眼提醒 · ${phase} · ${minutes}:${seconds}`);
  }
}

const timer = new RestTimer((status, transition) => {
  broadcast(status, transition);
  if (transition === "rest-start") showReminder();
  if (transition === "rest-end" || transition === "rest-complete")
    hideReminder();
});

function settingsPath(): string {
  return join(app.getPath("userData"), "timer-settings.json");
}

function statsPath(): string {
  return join(app.getPath("userData"), "daily-stats.json");
}

function rotateDailyStats(): void {
  const today = localDateKey();
  if (dailyStats.date !== today) {
    dailyStats = emptyDailyStats(today);
    lastStatsPersistedAt = performance.now();
  }
}

function getStatsSummary(): DailyStatsSummary {
  rotateDailyStats();
  return {
    date: dailyStats.date,
    focusedSeconds: Math.floor(dailyStats.focusedMilliseconds / 1000),
    restSeconds: Math.floor(dailyStats.restMilliseconds / 1000),
    completedBreaks: dailyStats.completedBreaks,
  };
}

function publishStats(): void {
  const summary = getStatsSummary();
  const signature = JSON.stringify(summary);
  if (signature === lastPublishedStats) return;
  lastPublishedStats = signature;
  for (const win of [mainWindow, reminderWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("stats:update", summary);
    }
  }
}

async function persistStats(): Promise<void> {
  const filePath = statsPath();
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(dailyStats, null, 2)}\n`, "utf8");
  lastStatsPersistedAt = performance.now();
}

async function loadStats(): Promise<DailyStatsRecord> {
  try {
    const contents = await readFile(statsPath(), "utf8");
    const candidate = JSON.parse(contents) as Partial<DailyStatsRecord>;
    if (
      candidate.date === localDateKey() &&
      Number.isFinite(candidate.focusedMilliseconds) &&
      candidate.focusedMilliseconds! >= 0 &&
      Number.isFinite(candidate.restMilliseconds) &&
      candidate.restMilliseconds! >= 0 &&
      Number.isInteger(candidate.completedBreaks) &&
      candidate.completedBreaks! >= 0
    ) {
      return {
        date: candidate.date,
        focusedMilliseconds: candidate.focusedMilliseconds!,
        restMilliseconds: candidate.restMilliseconds!,
        completedBreaks: candidate.completedBreaks!,
      };
    }
  } catch {
    // A missing or unreadable file starts today's statistics at zero.
  }
  return emptyDailyStats();
}

function recordStats(
  status: TimerStatus,
  transition?: "rest-start" | "rest-end" | "rest-complete",
): void {
  const now = performance.now();
  const elapsed = Math.min(1000, Math.max(0, now - lastStatsTick));
  rotateDailyStats();
  if (currentStatus.phase === "working")
    dailyStats.focusedMilliseconds += elapsed;
  if (currentStatus.phase === "resting") dailyStats.restMilliseconds += elapsed;
  if (transition === "rest-complete") dailyStats.completedBreaks += 1;
  currentStatus = status;
  lastStatsTick = now;
  publishStats();
  if (transition || now - lastStatsPersistedAt >= 30_000)
    void persistStats().catch(() => undefined);
}

function parseSettings(value: unknown): TimerSettings {
  if (!value || typeof value !== "object")
    throw new Error("Invalid timer settings");
  const candidate = value as Partial<TimerSettings>;
  if (
    !Number.isInteger(candidate.workMinutes) ||
    candidate.workMinutes! < MIN_WORK_MINUTES ||
    candidate.workMinutes! > MAX_WORK_MINUTES ||
    !Number.isInteger(candidate.restSeconds) ||
    candidate.restSeconds! < MIN_REST_SECONDS ||
    candidate.restSeconds! > MAX_REST_SECONDS ||
    (candidate.startOnLogin !== undefined &&
      typeof candidate.startOnLogin !== "boolean") ||
    (candidate.pauseOnLock !== undefined &&
      typeof candidate.pauseOnLock !== "boolean")
  ) {
    throw new Error("Invalid timer settings");
  }
  return {
    workMinutes: candidate.workMinutes!,
    restSeconds: candidate.restSeconds!,
    startOnLogin: candidate.startOnLogin ?? DEFAULT_TIMER_SETTINGS.startOnLogin,
    pauseOnLock: candidate.pauseOnLock ?? DEFAULT_TIMER_SETTINGS.pauseOnLock,
  };
}

async function loadSettings(): Promise<TimerSettings> {
  try {
    const contents = await readFile(settingsPath(), "utf8");
    return parseSettings(JSON.parse(contents) as unknown);
  } catch {
    return { ...DEFAULT_TIMER_SETTINGS };
  }
}

function applyStartupSetting(settings: TimerSettings): void {
  if (process.platform === "win32")
    app.setLoginItemSettings({ openAtLogin: settings.startOnLogin });
}

async function saveSettings(settings: TimerSettings): Promise<void> {
  const filePath = settingsPath();
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function createTray(): void {
  tray = new Tray(icon);
  tray.setToolTip("护眼提醒");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开护眼提醒", click: () => createMainWindow() },
      {
        label: "暂停 / 继续计时",
        click: () => {
          if (currentStatus.phase === "paused") {
            if (!screenLocked || !timerSettings.pauseOnLock) timer.resume();
          } else if (!screenLocked || !timerSettings.pauseOnLock) timer.pause();
        },
      },
      { type: "separator" },
      {
        label: "退出护眼提醒",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => createMainWindow());
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on("second-instance", () => createMainWindow());
  app.whenReady().then(async () => {
    timerSettings = await loadSettings();
    dailyStats = await loadStats();
    lastStatsTick = performance.now();
    lastStatsPersistedAt = performance.now();
    timer.setSettings(timerSettings);
    applyStartupSetting(timerSettings);

    ipcMain.handle("timer:get", () => timer.status());
    ipcMain.handle("timer:settings:get", () => timerSettings);
    ipcMain.handle("stats:get", () => getStatsSummary());
    ipcMain.handle("timer:settings:set", async (_event, value: unknown) => {
      const nextSettings = parseSettings(value);
      const intervalsChanged =
        nextSettings.workMinutes !== timerSettings.workMinutes ||
        nextSettings.restSeconds !== timerSettings.restSeconds;
      await saveSettings(nextSettings);
      timerSettings = nextSettings;
      applyStartupSetting(timerSettings);
      if (intervalsChanged) timer.setSettings(timerSettings);
      if (
        screenLocked &&
        timerSettings.pauseOnLock &&
        currentStatus.phase !== "paused"
      ) {
        pausedByLock = true;
        timer.pause();
      } else if (screenLocked && !timerSettings.pauseOnLock && pausedByLock) {
        pausedByLock = false;
        timer.resume();
      }
      return timerSettings;
    });
    ipcMain.handle("timer:pause", () => timer.pause());
    ipcMain.handle("timer:resume", () => {
      if (!screenLocked || !timerSettings.pauseOnLock) timer.resume();
    });
    ipcMain.handle("timer:reset", () => timer.reset());
    ipcMain.handle("timer:snooze", () => timer.snooze());
    ipcMain.handle("timer:skip", () => timer.skipRest());
    ipcMain.handle("window:minimize", () => mainWindow?.minimize());
    ipcMain.handle("window:hide", () => mainWindow?.hide());
    ipcMain.handle("window:reminder:minimize", () =>
      reminderWindow?.minimize(),
    );
    ipcMain.handle("window:reminder:close", () => hideReminder());
    createTray();
    createMainWindow();
    timer.start();
    statsFlushTimer = setInterval(() => {
      void persistStats().catch(() => undefined);
    }, 30_000);
    powerMonitor.on("lock-screen", () => {
      screenLocked = true;
      if (timerSettings.pauseOnLock && currentStatus.phase !== "paused") {
        pausedByLock = true;
        timer.pause();
      }
    });
    powerMonitor.on("unlock-screen", () => {
      screenLocked = false;
      if (pausedByLock) {
        pausedByLock = false;
        timer.resume();
      }
    });
    powerMonitor.on("resume", () => timer.resetAfterWake());
    app.on("activate", () => createMainWindow());
  });
  app.on("before-quit", (event) => {
    quitting = true;
    timer.stop();
    if (!quitAfterStatsSaved) {
      event.preventDefault();
      quitAfterStatsSaved = true;
      if (statsFlushTimer) clearInterval(statsFlushTimer);
      void persistStats().then(
        () => app.quit(),
        () => app.quit(),
      );
    }
  });
  app.on("window-all-closed", () => {
    /* 继续在托盘运行 */
  });
}
