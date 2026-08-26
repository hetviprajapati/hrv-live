export type LogEntry = {
  id: number;
  timestamp: string;
  /** Exactly what the sensor reported. Never altered. */
  rr: number;
  /** True = flagged by the rule. Shown in red, not counted. */
  bad: boolean;
  reason: string;
  demo?: boolean;
};
