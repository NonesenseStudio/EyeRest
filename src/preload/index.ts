import { contextBridge, ipcRenderer } from "electron";
import type {
  DailyStatsSummary,
  TimerSettings,
  TimerStatus,
} from "../main/timer";

contextBridge.exposeInMainWorld("eyeRest", {
  getStatus: (): Promise<TimerStatus> => ipcRenderer.invoke("timer:get"),
  getStats: (): Promise<DailyStatsSummary> => ipcRenderer.invoke("stats:get"),
  getSettings: (): Promise<TimerSettings> =>
    ipcRenderer.invoke("timer:settings:get"),
  setSettings: (settings: TimerSettings): Promise<TimerSettings> =>
    ipcRenderer.invoke("timer:settings:set", settings),
  pause: (): Promise<void> => ipcRenderer.invoke("timer:pause"),
  resume: (): Promise<void> => ipcRenderer.invoke("timer:resume"),
  reset: (): Promise<void> => ipcRenderer.invoke("timer:reset"),
  snooze: (): Promise<void> => ipcRenderer.invoke("timer:snooze"),
  skipRest: (): Promise<void> => ipcRenderer.invoke("timer:skip"),
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  hideWindow: (): Promise<void> => ipcRenderer.invoke("window:hide"),
  minimizeReminder: (): Promise<void> =>
    ipcRenderer.invoke("window:reminder:minimize"),
  closeReminder: (): Promise<void> =>
    ipcRenderer.invoke("window:reminder:close"),
  onStatus: (callback: (status: TimerStatus) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: TimerStatus,
    ): void => callback(status);
    ipcRenderer.on("timer:status", listener);
    return () => ipcRenderer.removeListener("timer:status", listener);
  },
  onStats: (callback: (stats: DailyStatsSummary) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      stats: DailyStatsSummary,
    ): void => callback(stats);
    ipcRenderer.on("stats:update", listener);
    return () => ipcRenderer.removeListener("stats:update", listener);
  },
});
