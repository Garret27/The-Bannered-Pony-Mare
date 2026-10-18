export const SETTINGS_VERSION = 1;
export const SECRET_MASK = "••••••";

export type MovieNightSettings = {
  version: number;
  tmdb: {
    apiKey: string;
  };
  vrchat: {
    userAgent: string;
    authCookie: string;
    photosDir: string;
  };
  smb: {
    user: string;
    pass: string;
  };
  movies: {
    roots: string;
    jellyfinUrl: string;
    jellyfinApiKey: string;
    jellyfinUserId: string;
    jellyfinPathEPrefix: string;
    jellyfinPathJPrefix: string;
    jellyfinPathHPrefix: string;
    /** Jellyfin server path for already-converted TV (exclude from /tv). */
    jellyfinPathHJellyfinPrefix: string;
  };
  opensubtitles: {
    apiKey: string;
    username: string;
    password: string;
  };
  bunny: {
    storageZone: string;
    storagePassword: string;
    storageRegion: string;
    cdnHostname: string;
    prefix: string;
  };
  converter: {
    agentUrl: string;
    handbrakeEncoder: string;
    jellyfinOutputLabel: string;
    tvJellyfinOutputLabel: string;
  };
  discord: {
    webhookMain: string;
    webhookHspc: string;
    roleMain: string;
    roleHspc: string;
    /** Main movie night start time (HH:MM) in announceTimezone — Saturdays */
    announceTimeMain: string;
    /** HSPC movie night start time (HH:MM) in announceTimezone — Tuesdays */
    announceTimeHspc: string;
    announceTimezone: string;
  };
  github: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
  };
};

export type SettingsSection = keyof Omit<MovieNightSettings, "version">;

export function defaultSettings(): MovieNightSettings {
  return {
    version: SETTINGS_VERSION,
    tmdb: { apiKey: "" },
    vrchat: {
      userAgent: "MovieNightManager/1.0.0 you@example.com",
      authCookie: "",
      photosDir: "/vrchat-photos",
    },
    smb: { user: "", pass: "" },
    movies: {
      roots: "/movies-e/Movies E Drive,/movies-j/Movies J Drive",
      jellyfinUrl: "http://192.168.0.130:8096",
      jellyfinApiKey: "",
      jellyfinUserId: "",
      jellyfinPathEPrefix: "",
      jellyfinPathJPrefix: "",
      jellyfinPathHPrefix: "/data/tv-shows-h-drive",
      jellyfinPathHJellyfinPrefix: "/data/tv-h",
    },
    opensubtitles: {
      apiKey: "",
      username: "",
      password: "",
    },
    bunny: {
      storageZone: "",
      storagePassword: "",
      storageRegion: "ny.storage.bunnycdn.com",
      cdnHostname: "GarretStorage.b-cdn.net",
      prefix: "Movies",
    },
    converter: {
      agentUrl: "http://converter-agent:8765",
      handbrakeEncoder: "nvenc_h264",
      jellyfinOutputLabel: "J:\\Movies J Drive - Jellyfin",
      tvJellyfinOutputLabel: "H:\\TV Shows H Drive - Jellyfin",
    },
    discord: {
      webhookMain: "",
      webhookHspc: "",
      roleMain: "",
      roleHspc: "",
      announceTimeMain: "17:00",
      announceTimeHspc: "18:00",
      announceTimezone: "America/Denver",
    },
    github: {
      token: "",
      owner: "Garret27",
      repo: "The-Bannered-Pony-Mare",
      branch: "main",
    },
  };
}
