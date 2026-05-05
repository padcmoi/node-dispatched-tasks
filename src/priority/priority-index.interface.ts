export interface ReadyClaim {
  publicId: string;
  score: number;
}

export interface PriorityIndex {
  enqueueReady: (publicId: string, score: number) => Promise<void>;
  enqueueDelayed: (publicId: string, scheduledAtMs: number) => Promise<void>;
  popReady: () => Promise<ReadyClaim | null>;
  removeReady: (publicId: string) => Promise<void>;
  promoteDueDelayed: (nowMs: number) => Promise<number>;
  acquireIdempotency: (key: string, publicId: string, ttlSeconds: number) => Promise<string>;
  getIdempotencyOwner: (key: string) => Promise<string | null>;
  trackRunning: (publicId: string, ttlSeconds: number) => Promise<void>;
  untrackRunning: (publicId: string) => Promise<void>;
  countReady: () => Promise<number>;
  countDelayed: () => Promise<number>;
}
