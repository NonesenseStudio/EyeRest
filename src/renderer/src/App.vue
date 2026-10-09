<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  BarChartOutline,
  ChevronBackOutline,
  CloseOutline,
  EyeOutline,
  RemoveOutline,
  SettingsOutline,
} from "@vicons/ionicons5";
import appIcon from "../../assets/icon.svg";

type ActivePhase = "working" | "resting" | "snoozed";
type Phase = ActivePhase | "paused";
interface TimerSettings {
  workMinutes: number;
  restSeconds: number;
  startOnLogin: boolean;
  pauseOnLock: boolean;
}
interface TimerStatus {
  phase: Phase;
  pausedFrom: ActivePhase | null;
  remainingSeconds: number;
  workSeconds: number;
  restSeconds: number;
  snoozeSeconds: number;
}
interface DailyStatsSummary {
  date: string;
  focusedSeconds: number;
  restSeconds: number;
  completedBreaks: number;
}
interface EyeRestAPI {
  getStatus(): Promise<TimerStatus>;
  getStats(): Promise<DailyStatsSummary>;
  getSettings(): Promise<TimerSettings>;
  setSettings(settings: TimerSettings): Promise<TimerSettings>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  snooze(): Promise<void>;
  skipRest(): Promise<void>;
  minimize(): Promise<void>;
  hideWindow(): Promise<void>;
  minimizeReminder(): Promise<void>;
  closeReminder(): Promise<void>;
  onStatus(callback: (status: TimerStatus) => void): () => void;
  onStats(callback: (stats: DailyStatsSummary) => void): () => void;
}

const api = (window as Window & { eyeRest: EyeRestAPI }).eyeRest;
const isReminder = window.location.hash.includes("/reminder");
const status = ref<TimerStatus>({
  phase: "working",
  pausedFrom: null,
  remainingSeconds: 1200,
  workSeconds: 1200,
  restSeconds: 20,
  snoozeSeconds: 300,
});
const settings = ref<TimerSettings>({
  workMinutes: 20,
  restSeconds: 20,
  startOnLogin: false,
  pauseOnLock: false,
});
const stats = ref<DailyStatsSummary>({
  date: "",
  focusedSeconds: 0,
  restSeconds: 0,
  completedBreaks: 0,
});
const view = ref<"timer" | "settings" | "stats">("timer");
const isEditingWork = ref(false);
const workMinutesInput = ref(20);
const restSecondsInput = ref(20);
const startOnLoginInput = ref(false);
const pauseOnLockInput = ref(false);
const settingsError = ref("");
const isSaving = ref(false);
const workDurationInput = ref<HTMLInputElement | null>(null);
let unsubscribeStatus: (() => void) | undefined;
let unsubscribeStats: (() => void) | undefined;

onMounted(async () => {
  unsubscribeStatus = api.onStatus((s) => {
    status.value = s;
  });
  unsubscribeStats = api.onStats((s) => {
    stats.value = s;
  });
  const [nextStatus, savedSettings, todayStats] = await Promise.all([
    api.getStatus(),
    api.getSettings(),
    api.getStats(),
  ]);
  status.value = nextStatus;
  settings.value = savedSettings;
  workMinutesInput.value = savedSettings.workMinutes;
  restSecondsInput.value = savedSettings.restSeconds;
  startOnLoginInput.value = savedSettings.startOnLogin;
  pauseOnLockInput.value = savedSettings.pauseOnLock;
  stats.value = todayStats;
});

onUnmounted(() => {
  unsubscribeStatus?.();
  unsubscribeStats?.();
});

const formatted = computed(() => {
  const n = status.value.remainingSeconds;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
});
const activePhase = computed<ActivePhase>(() =>
  status.value.phase === "paused"
    ? (status.value.pausedFrom ?? "working")
    : status.value.phase,
);
const progress = computed(() => {
  const total =
    activePhase.value === "resting"
      ? status.value.restSeconds
      : activePhase.value === "snoozed"
        ? status.value.snoozeSeconds
        : status.value.workSeconds;
  return Math.min(
    100,
    Math.max(0, 100 * (1 - status.value.remainingSeconds / total)),
  );
});
const ringCircumference = 2 * Math.PI * 107;
const ringDashArray = computed(
  () => `${(ringCircumference * progress.value) / 100} ${ringCircumference}`,
);
const title = computed(() =>
  status.value.phase === "paused"
    ? "已暂停"
    : activePhase.value === "resting"
      ? "该让眼睛休息了"
      : activePhase.value === "snoozed"
        ? "稍后提醒中"
        : "工作中",
);
const timerLabel = computed(() =>
  activePhase.value === "resting"
    ? "本次休息还剩"
    : activePhase.value === "snoozed"
      ? "下次提醒还有"
      : "距离下次休息",
);
const timerCaption = computed(() =>
  status.value.phase === "paused"
    ? "继续后恢复倒计时"
    : activePhase.value === "resting"
      ? "放松眼睛"
      : activePhase.value === "snoozed"
        ? "稍后再次提醒"
        : "正在计时",
);

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0)
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
  return `${seconds} 秒`;
}

function openSettings(): void {
  workMinutesInput.value = settings.value.workMinutes;
  restSecondsInput.value = settings.value.restSeconds;
  startOnLoginInput.value = settings.value.startOnLogin;
  pauseOnLockInput.value = settings.value.pauseOnLock;
  settingsError.value = "";
  view.value = "settings";
}

async function openWorkAdjustment(): Promise<void> {
  await api.reset();
  workMinutesInput.value = settings.value.workMinutes;
  settingsError.value = "";
  isEditingWork.value = true;
  await nextTick();
  workDurationInput.value?.focus();
  workDurationInput.value?.select();
}

async function startWorkWithEditedDuration(): Promise<void> {
  const workMinutes = Number(workMinutesInput.value);
  if (!Number.isInteger(workMinutes) || workMinutes < 1 || workMinutes > 240) {
    settingsError.value = "请填写 1–240 分钟。";
    return;
  }

  isSaving.value = true;
  settingsError.value = "";
  try {
    if (workMinutes !== settings.value.workMinutes) {
      settings.value = await api.setSettings({
        ...settings.value,
        workMinutes,
      });
    }
    await api.resume();
    isEditingWork.value = false;
  } catch {
    settingsError.value = "设置未保存，请重试。";
  } finally {
    isSaving.value = false;
  }
}

async function saveSettings(): Promise<void> {
  const workMinutes = Number(workMinutesInput.value);
  const restSeconds = Number(restSecondsInput.value);
  if (
    !Number.isInteger(workMinutes) ||
    workMinutes < 1 ||
    workMinutes > 240 ||
    !Number.isInteger(restSeconds) ||
    restSeconds < 1 ||
    restSeconds > 300
  ) {
    settingsError.value = "请填写 1–240 分钟和 1–300 秒。";
    return;
  }

  isSaving.value = true;
  settingsError.value = "";
  try {
    settings.value = await api.setSettings({
      workMinutes,
      restSeconds,
      startOnLogin: startOnLoginInput.value,
      pauseOnLock: pauseOnLockInput.value,
    });
    view.value = "timer";
  } catch {
    settingsError.value = "设置未保存，请重试。";
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <main
    :class="['app-shell', `state-${activePhase}`, { reminder: isReminder }]"
  >
    <a class="skip-link" href="#page-content">跳到主要内容</a>
    <header class="app-bar">
      <div class="brand">
        <img :src="appIcon" width="26" height="23" alt="" aria-hidden="true" />
        <span>护眼提醒</span>
      </div>

      <div
        v-if="isReminder"
        class="window-actions"
        role="group"
        aria-label="休息提醒窗口操作"
      >
        <button
          class="bar-button"
          type="button"
          aria-label="最小化休息提醒"
          title="最小化"
          @click="api.minimizeReminder()"
        >
          <RemoveOutline aria-hidden="true" />
        </button>
        <button
          class="bar-button close-button"
          type="button"
          aria-label="关闭休息提醒"
          title="关闭提醒"
          @click="api.closeReminder()"
        >
          <CloseOutline aria-hidden="true" />
        </button>
      </div>

      <div v-else class="window-actions" role="group" aria-label="应用操作">
        <button
          v-if="view !== 'timer'"
          class="bar-button"
          type="button"
          aria-label="返回计时"
          title="返回计时"
          @click="view = 'timer'"
        >
          <ChevronBackOutline aria-hidden="true" />
        </button>
        <template v-else>
          <button
            class="bar-button"
            type="button"
            aria-label="查看今日统计"
            title="今日统计"
            @click="view = 'stats'"
          >
            <BarChartOutline aria-hidden="true" />
          </button>
          <button
            class="bar-button"
            type="button"
            aria-label="调整提醒时间和选项"
            title="设置"
            @click="openSettings"
          >
            <SettingsOutline aria-hidden="true" />
          </button>
        </template>
        <button
          class="bar-button"
          type="button"
          aria-label="最小化"
          title="最小化"
          @click="api.minimize()"
        >
          <RemoveOutline aria-hidden="true" />
        </button>
        <button
          class="bar-button close-button"
          type="button"
          aria-label="隐藏窗口"
          title="隐藏窗口"
          @click="api.hideWindow()"
        >
          <CloseOutline aria-hidden="true" />
        </button>
      </div>
    </header>

    <section
      v-if="isReminder"
      id="page-content"
      class="reminder-content"
      aria-labelledby="reminder-title"
      tabindex="-1"
    >
      <div class="reminder-mark" aria-hidden="true">
        <EyeOutline aria-hidden="true" />
      </div>
      <h1 id="reminder-title">{{ title }}</h1>
      <p class="hint">看向 6 米外，让眼睛放松</p>
      <div class="rest-time">{{ formatted }}</div>
      <div class="actions reminder-actions">
        <button class="secondary" type="button" @click="api.snooze()">
          5 分钟后提醒
        </button>
        <button
          v-if="status.phase === 'resting'"
          class="primary"
          type="button"
          @click="api.skipRest()"
        >
          结束休息
        </button>
      </div>
    </section>

    <section
      v-else-if="view === 'stats'"
      id="page-content"
      class="stats-content"
      aria-labelledby="stats-title"
      tabindex="-1"
    >
      <div class="section-heading">
        <h1 id="stats-title">今日统计</h1>
        <p>按本机日期统计实际计时时长</p>
      </div>
      <div class="stats-list">
        <article class="stat-card">
          <h2>工作时长</h2>
          <strong>{{ formatDuration(stats.focusedSeconds) }}</strong>
        </article>
        <article class="stat-card">
          <h2>休息时长</h2>
          <strong>{{ formatDuration(stats.restSeconds) }}</strong>
        </article>
        <article class="stat-card">
          <h2>完整休息次数</h2>
          <strong>{{ stats.completedBreaks }}<small> 次</small></strong>
        </article>
      </div>
      <p class="stats-note">未完成或跳过的休息不计入次数</p>
    </section>

    <section
      v-else-if="view === 'settings'"
      id="page-content"
      class="settings-content"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="section-heading">
        <h1 id="settings-title">提醒设置</h1>
        <p>修改时长后，当前倒计时会重新开始</p>
      </div>
      <form class="settings-form" @submit.prevent="saveSettings">
        <label class="setting-row">
          <span class="setting-copy"
            ><strong>工作时长</strong><small>1–240 分钟</small></span
          >
          <span class="number-control"
            ><input
              v-model.number="workMinutesInput"
              type="number"
              name="workMinutes"
              min="1"
              max="240"
              step="1"
              inputmode="numeric"
              autocomplete="off"
              required
            /><span>分钟</span></span
          >
        </label>
        <label class="setting-row">
          <span class="setting-copy"
            ><strong>休息时长</strong><small>1–300 秒</small></span
          >
          <span class="number-control"
            ><input
              v-model.number="restSecondsInput"
              type="number"
              name="restSeconds"
              min="1"
              max="300"
              step="1"
              inputmode="numeric"
              autocomplete="off"
              required
            /><span>秒</span></span
          >
        </label>
        <label class="setting-toggle">
          <span class="setting-copy"><strong>登录 Windows 后启动</strong></span>
          <input
            v-model="startOnLoginInput"
            type="checkbox"
            role="switch"
            name="startOnLogin"
            autocomplete="off"
          />
        </label>
        <label class="setting-toggle">
          <span class="setting-copy"
            ><strong>锁屏时暂停</strong><small>解锁后继续计时</small></span
          >
          <input
            v-model="pauseOnLockInput"
            type="checkbox"
            role="switch"
            name="pauseOnLock"
            autocomplete="off"
          />
        </label>
        <p
          v-if="settingsError"
          class="settings-error"
          role="alert"
          aria-live="polite"
        >
          {{ settingsError }}
        </p>
        <button class="primary save-button" type="submit" :disabled="isSaving">
          {{ isSaving ? "正在保存…" : "保存设置" }}
        </button>
      </form>
    </section>

    <section
      v-else
      id="page-content"
      class="timer-content"
      aria-labelledby="timer-title"
      tabindex="-1"
    >
      <div class="headline">
        <h1 id="timer-title">{{ title }}</h1>
        <p>
          每 {{ settings.workMinutes }} 分钟，远眺 6 米外
          {{ settings.restSeconds }} 秒
        </p>
      </div>
      <div
        class="timer-circle"
        :role="isEditingWork ? undefined : 'timer'"
        :aria-label="isEditingWork ? undefined : `${timerLabel} ${formatted}`"
      >
        <svg class="timer-ring" viewBox="0 0 220 220" aria-hidden="true">
          <circle class="timer-ring-track" cx="110" cy="110" r="107" />
          <circle
            class="timer-ring-progress"
            cx="110"
            cy="110"
            r="107"
            :style="{
              strokeDasharray: ringDashArray,
              opacity: progress > 0 ? 1 : 0,
            }"
          />
        </svg>
        <div class="timer-inner">
          <span class="timer-label">{{ timerLabel }}</span>
          <input
            v-if="isEditingWork"
            ref="workDurationInput"
            v-model.number="workMinutesInput"
            class="timer-edit-input"
            type="number"
            name="workMinutes"
            min="1"
            max="240"
            step="1"
            inputmode="numeric"
            autocomplete="off"
            aria-label="工作时长，分钟"
            @keydown.enter.prevent="startWorkWithEditedDuration"
          />
          <strong v-else>{{ formatted }}</strong>
          <span class="timer-caption">{{ timerCaption }}</span>
        </div>
      </div>
      <div class="actions main-actions">
        <template v-if="isEditingWork">
          <button
            class="primary"
            type="button"
            :disabled="isSaving"
            @click="startWorkWithEditedDuration"
          >
            {{ isSaving ? "正在保存…" : "开始计时" }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="status.phase === 'paused'"
            class="primary"
            type="button"
            @click="api.resume()"
          >
            继续计时
          </button>
          <button v-else class="primary" type="button" @click="api.pause()">
            暂停计时
          </button>
          <button
            v-if="status.phase === 'paused'"
            class="secondary"
            type="button"
            @click="openWorkAdjustment"
          >
            调整工作时长
          </button>
          <button
            v-if="status.phase === 'resting'"
            class="secondary"
            type="button"
            @click="api.skipRest()"
          >
            结束休息
          </button>
        </template>
      </div>
      <p
        v-if="isEditingWork && settingsError"
        class="settings-error timer-edit-error"
        role="alert"
        aria-live="polite"
      >
        {{ settingsError }}
      </p>
      <p v-if="!isEditingWork && status.phase !== 'paused'" class="footnote">
        隐藏窗口后，提醒仍会继续
      </p>
    </section>
  </main>
</template>
