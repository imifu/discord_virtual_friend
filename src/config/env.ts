import 'dotenv/config';
import { ConfigError } from '../utils/errors.js';
import { DEFAULT_AIR_READING_PROMPT } from './air-reading.js';

function requireString(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new ConfigError(`環境変数 ${name} が設定されていません。.env を確認してください。`);
  }
  return value;
}

function optionalString(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`環境変数 ${name} は数値である必要があります (現在値: "${raw}")。`);
  }
  return parsed;
}

function optionalFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`環境変数 ${name} は数値である必要があります (現在値: "${raw}")。`);
  }
  return parsed;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function optionalUnitFloat(name: string, fallback: number): number {
  const value = optionalFloat(name, fallback);
  if (value < 0 || value > 1) {
    throw new ConfigError(`環境変数 ${name} は0以上1以下である必要があります (現在値: "${value}")。`);
  }
  return value;
}

function optionalNonNegativeInt(name: string, fallback: number): number {
  const value = optionalInt(name, fallback);
  if (value < 0) {
    throw new ConfigError(`環境変数 ${name} は0以上である必要があります (現在値: "${value}")。`);
  }
  return value;
}

export interface AppConfig {
  discord: {
    token: string;
    clientId: string;
    guildId: string;
  };
  devices: {
    discordToGpt?: string;
    gptToDiscord?: string;
  };
  input: {
    sampleRate: number;
    channels: number;
  };
  output: {
    sampleRate: number;
    channels: number;
  };
  logLevel: string;
  vad: {
    threshold: number;
    gptSpeakingHoldMs: number;
    ducking: boolean;
    duckingLevel: number;
  };
  messagePosting: {
    enabled: boolean;
    channelId?: string;
    triggerKeywords: string[];
    replyHoldMs: number;
  };
  bargeIn: {
    enabled: boolean;
    gptPlaybackLevel: number;
    voiceThreshold: number;
    attackMs: number;
    releaseMs: number;
  };
  airReading: {
    enabled: boolean;
    prompt: string;
  };
  transcriptLog: {
    enabled: boolean;
    toFile: boolean;
    toThread: boolean;
    threadChannelId?: string;
    fileDir: string;
    gptUtteranceHoldMs: number;
  };
  github: {
    token?: string;
    repo?: string;
  };
  feed: {
    /** Cosine similarity (0-1) an open issue must reach before /feed comments on it instead of
     *  creating a new issue. 0.65 was picked from real Xenova/paraphrase-multilingual-MiniLM-L12-v2
     *  measurements (README section 21): differently-worded repeats of the same request scored
     *  0.68-0.93, unrelated feedback scored 0.23-0.36. Issue #7 still flags this as something to
     *  keep tuning from real usage, not a permanently validated constant. */
    similarityThreshold: number;
  };
}

let cached: AppConfig | undefined;

/** Loads and validates configuration from process.env. Throws ConfigError on invalid required values. */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const config: AppConfig = {
    discord: {
      token: requireString('DISCORD_TOKEN'),
      clientId: requireString('DISCORD_CLIENT_ID'),
      guildId: requireString('DISCORD_GUILD_ID'),
    },
    devices: {
      discordToGpt: optionalString('DISCORD_TO_GPT_DEVICE'),
      gptToDiscord: optionalString('GPT_TO_DISCORD_DEVICE'),
    },
    input: {
      sampleRate: optionalInt('INPUT_SAMPLE_RATE', 48000),
      channels: optionalInt('INPUT_CHANNELS', 2),
    },
    output: {
      sampleRate: optionalInt('OUTPUT_SAMPLE_RATE', 48000),
      channels: optionalInt('OUTPUT_CHANNELS', 2),
    },
    logLevel: optionalString('LOG_LEVEL') ?? 'info',
    vad: {
      threshold: optionalFloat('VOICE_ACTIVITY_THRESHOLD', 0.02),
      gptSpeakingHoldMs: optionalInt('GPT_SPEAKING_HOLD_MS', 500),
      ducking: optionalBool('DISCORD_INPUT_DUCKING', true),
      duckingLevel: optionalUnitFloat('DISCORD_INPUT_DUCKING_LEVEL', 0.1),
    },
    bargeIn: {
      enabled: optionalBool('BARGE_IN_ENABLED', true),
      gptPlaybackLevel: optionalUnitFloat('BARGE_IN_GPT_PLAYBACK_LEVEL', 0.2),
      voiceThreshold: optionalUnitFloat('BARGE_IN_VOICE_THRESHOLD', 0.025),
      attackMs: optionalNonNegativeInt('BARGE_IN_ATTACK_MS', 100),
      releaseMs: optionalNonNegativeInt('BARGE_IN_RELEASE_MS', 400),
    },
    airReading: {
      enabled: optionalBool('AIR_READING_ENABLED', true),
      prompt: (optionalString('AIR_READING_PROMPT') ?? DEFAULT_AIR_READING_PROMPT).replace(/\\n/g, '\n'),
    },
    messagePosting: {
      enabled: optionalBool('MESSAGE_POST_ENABLED', false),
      channelId: optionalString('MESSAGE_POST_CHANNEL_ID'),
      triggerKeywords: (
        optionalString('MESSAGE_POST_TRIGGER_KEYWORDS') ?? '投稿して,とうこうして,送信して,そうしんして,送って,おくって'
      )
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      replyHoldMs: optionalInt('MESSAGE_POST_REPLY_HOLD_MS', 1500),
    },
    transcriptLog: {
      enabled: optionalBool('TRANSCRIPT_LOG_ENABLED', false),
      toFile: optionalBool('TRANSCRIPT_LOG_TO_FILE', true),
      toThread: optionalBool('TRANSCRIPT_LOG_TO_THREAD', false),
      threadChannelId: optionalString('TRANSCRIPT_LOG_CHANNEL_ID'),
      fileDir: optionalString('TRANSCRIPT_LOG_DIR') ?? 'logs',
      gptUtteranceHoldMs: optionalInt('TRANSCRIPT_GPT_UTTERANCE_HOLD_MS', 1500),
    },
    github: {
      token: optionalString('GITHUB_TOKEN'),
      repo: optionalString('GITHUB_REPO'),
    },
    feed: {
      similarityThreshold: optionalUnitFloat('FEED_SIMILARITY_THRESHOLD', 0.65),
    },
  };

  cached = config;
  return config;
}

/** Ensures both virtual device names are configured; throws ConfigError otherwise. Call before starting the relay. */
export function requireDeviceConfig(config: AppConfig): { discordToGpt: string; gptToDiscord: string } {
  const { discordToGpt, gptToDiscord } = config.devices;
  if (!discordToGpt || !gptToDiscord) {
    throw new ConfigError(
      'DISCORD_TO_GPT_DEVICE と GPT_TO_DISCORD_DEVICE を .env に設定してください。/devices で利用可能なデバイス名を確認できます。',
    );
  }
  return { discordToGpt, gptToDiscord };
}

/** Ensures GitHub PAT + "owner/repo" are configured; throws ConfigError otherwise. Call before using /feed. */
export function requireGithubConfig(config: AppConfig): { token: string; owner: string; repo: string } {
  const { token, repo } = config.github;
  if (!token || !repo) {
    throw new ConfigError('GITHUB_TOKEN と GITHUB_REPO を .env に設定してください。/feedコマンドを使うには両方が必要です。');
  }
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName || repo.split('/').length !== 2) {
    throw new ConfigError(`GITHUB_REPO は "owner/repo" 形式で指定してください (現在値: "${repo}")。`);
  }
  return { token, owner, repo: repoName };
}
