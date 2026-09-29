import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ToolCallContext {
  sessionId?: string;
  clientIp?: string;
  explicitTaskId?: string;
  cacheHit?: "HIT" | "MISS" | "N/A";
}

export interface ToolCallRecord {
  id: string;
  taskId: string;
  step: number;
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  cacheHit: "HIT" | "MISS" | "N/A";
  status: "success" | "error";
  error?: string;
  resultSummary?: string;
  sizeBytes?: number;
  sessionId?: string;
  clientIp?: string;
}

export interface TaskRecord {
  taskId: string;
  sessionId?: string;
  clientIp?: string;
  startTime: string;
  endTime: string;
  totalCalls: number;
  totalDurationMs: number;
  tools: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  calls: ToolCallRecord[];
}

export interface ToolStats {
  calls: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: string;
}

export interface CacheProviderStats {
  name: string;
  size: () => number;
  hits: () => number;
  misses: () => number;
}

interface ActiveSessionTask {
  task: TaskRecord;
  inactivityTimer: NodeJS.Timeout | null;
  lastCallTimeMs: number;
}

export class McpTelemetry {
  private static instance: McpTelemetry | null = null;

  public static getInstance(): McpTelemetry {
    if (!McpTelemetry.instance) {
      McpTelemetry.instance = new McpTelemetry();
    }
    return McpTelemetry.instance;
  }

  private readonly asyncLocalStorage = new AsyncLocalStorage<ToolCallContext>();
  private readonly startTimestamp = Date.now();
  private readonly taskInactivityTimeoutMs: number;
  private readonly logFilePath?: string;

  private activeSessionTasks = new Map<string, ActiveSessionTask>();
  private taskCounter = 0;

  // History rolling buffers
  private recentCalls: ToolCallRecord[] = [];
  private readonly maxRecentCalls = 200;

  private recentTasks: TaskRecord[] = [];
  private readonly maxRecentTasks = 50;

  private slowestCalls: ToolCallRecord[] = [];
  private readonly maxSlowestCalls = 20;

  // Aggregate stats per tool
  private toolStatsMap = new Map<
    string,
    {
      calls: number;
      totalMs: number;
      minMs: number;
      maxMs: number;
      latencies: number[];
      errors: number;
      cacheHits: number;
      cacheMisses: number;
    }
  >();

  // Registered cache inspectors
  private cacheProviders = new Map<string, CacheProviderStats>();

  constructor(options: { taskInactivityTimeoutMs?: number; logDir?: string } = {}) {
    this.taskInactivityTimeoutMs = options.taskInactivityTimeoutMs ?? 5_000;
    if (options.logDir) {
      try {
        if (!existsSync(options.logDir)) {
          mkdirSync(options.logDir, { recursive: true });
        }
        this.logFilePath = join(options.logDir, "mcp-access.log");
      } catch {
        // Logging directory not writable; ignore file logging
      }
    }
  }

  public registerCache(provider: CacheProviderStats): void {
    this.cacheProviders.set(provider.name, provider);
  }

  public runWithContext<T>(context: ToolCallContext, fn: () => T): T {
    return this.asyncLocalStorage.run(context, fn);
  }

  public getCurrentContext(): ToolCallContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  public markCacheHit(): void {
    const ctx = this.getCurrentContext();
    if (ctx) ctx.cacheHit = "HIT";
  }

  public markCacheMiss(): void {
    const ctx = this.getCurrentContext();
    if (ctx) ctx.cacheHit = "MISS";
  }

  /**
   * Acquire or continue a task record for the incoming tool call.
   */
  public getOrCreateTask(sessionId?: string, explicitTaskId?: string): { task: TaskRecord; step: number } {
    const key = sessionId || explicitTaskId || "default_session";
    const nowMs = Date.now();
    const existing = this.activeSessionTasks.get(key);

    if (existing) {
      if (existing.inactivityTimer) {
        clearTimeout(existing.inactivityTimer);
        existing.inactivityTimer = null;
      }

      // If call happened within inactivity window or explicit task ID matches, continue task
      const isWithinWindow = nowMs - existing.lastCallTimeMs < this.taskInactivityTimeoutMs;
      const isExplicitMatch = explicitTaskId && existing.task.taskId === explicitTaskId;

      if (isWithinWindow || isExplicitMatch) {
        existing.lastCallTimeMs = nowMs;
        existing.task.totalCalls += 1;
        const step = existing.task.totalCalls;

        // Reset inactivity timer
        existing.inactivityTimer = setTimeout(() => {
          this.finalizeSessionTask(key);
        }, this.taskInactivityTimeoutMs);
        if (existing.inactivityTimer?.unref) existing.inactivityTimer.unref();

        return { task: existing.task, step };
      }

      // Otherwise previous task expired; finalize it and start new one
      this.finalizeSessionTask(key);
    }

    // Start a new task
    this.taskCounter += 1;
    const taskId = explicitTaskId || `task-${this.taskCounter}`;
    const newTask: TaskRecord = {
      taskId,
      sessionId,
      startTime: new Date(nowMs).toISOString(),
      endTime: new Date(nowMs).toISOString(),
      totalCalls: 1,
      totalDurationMs: 0,
      tools: {},
      cacheHits: 0,
      cacheMisses: 0,
      calls: [],
    };

    const sessionTask: ActiveSessionTask = {
      task: newTask,
      lastCallTimeMs: nowMs,
      inactivityTimer: setTimeout(() => {
        this.finalizeSessionTask(key);
      }, this.taskInactivityTimeoutMs),
    };
    if (sessionTask.inactivityTimer?.unref) sessionTask.inactivityTimer.unref();

    this.activeSessionTasks.set(key, sessionTask);
    return { task: newTask, step: 1 };
  }

  /**
   * Finalize the task for the given session key, logging the task summary.
   */
  public finalizeSessionTask(sessionKey: string): void {
    const active = this.activeSessionTasks.get(sessionKey);
    if (!active) return;

    if (active.inactivityTimer) {
      clearTimeout(active.inactivityTimer);
      active.inactivityTimer = null;
    }
    this.activeSessionTasks.delete(sessionKey);

    const task = active.task;
    task.endTime = new Date().toISOString();

    // Add to recent tasks rolling buffer
    this.recentTasks.unshift(task);
    if (this.recentTasks.length > this.maxRecentTasks) {
      this.recentTasks.pop();
    }

    // Emit Task Summary Log to stderr
    this.logTaskSummary(task);
  }

  /**
   * Record a tool invocation, update aggregates, and emit formatted stderr log.
   */
  public recordCall(record: ToolCallRecord): void {
    // 1. Update task aggregates
    const sessionKey = record.sessionId || record.taskId;
    const active = this.activeSessionTasks.get(sessionKey);
    if (active) {
      active.task.totalDurationMs = Number((active.task.totalDurationMs + record.durationMs).toFixed(2));
      active.task.tools[record.tool] = (active.task.tools[record.tool] || 0) + 1;
      if (record.cacheHit === "HIT") active.task.cacheHits += 1;
      if (record.cacheHit === "MISS") active.task.cacheMisses += 1;
      active.task.calls.push(record);
    }

    // 2. Update tool stats
    let toolStat = this.toolStatsMap.get(record.tool);
    if (!toolStat) {
      toolStat = {
        calls: 0,
        totalMs: 0,
        minMs: record.durationMs,
        maxMs: record.durationMs,
        latencies: [],
        errors: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };
      this.toolStatsMap.set(record.tool, toolStat);
    }
    toolStat.calls += 1;
    toolStat.totalMs += record.durationMs;
    toolStat.minMs = Math.min(toolStat.minMs, record.durationMs);
    toolStat.maxMs = Math.max(toolStat.maxMs, record.durationMs);
    toolStat.latencies.push(record.durationMs);
    if (toolStat.latencies.length > 500) {
      toolStat.latencies.shift();
    }
    if (record.status === "error") toolStat.errors += 1;
    if (record.cacheHit === "HIT") toolStat.cacheHits += 1;
    if (record.cacheHit === "MISS") toolStat.cacheMisses += 1;

    // 3. Rolling buffers
    this.recentCalls.unshift(record);
    if (this.recentCalls.length > this.maxRecentCalls) {
      this.recentCalls.pop();
    }

    // 4. Update slowest calls
    this.insertSlowestCall(record);

    // 5. Emit formatted console log
    this.logToolCall(record);

    // 6. Optional file log
    this.appendLogFile(record);
  }

  private insertSlowestCall(record: ToolCallRecord): void {
    if (
      this.slowestCalls.length < this.maxSlowestCalls ||
      record.durationMs > (this.slowestCalls[this.slowestCalls.length - 1]?.durationMs ?? 0)
    ) {
      this.slowestCalls.push(record);
      this.slowestCalls.sort((a, b) => b.durationMs - a.durationMs);
      if (this.slowestCalls.length > this.maxSlowestCalls) {
        this.slowestCalls.pop();
      }
    }
  }

  private logToolCall(record: ToolCallRecord): void {
    const speedTag = this.formatSpeedTag(record.durationMs);
    const sanitizedArgs = this.sanitizeArgs(record.args);
    const argsJson = JSON.stringify(sanitizedArgs);
    const sizeStr = record.sizeBytes ? ` | size: ${(record.sizeBytes / 1024).toFixed(1)}KB` : "";
    const hitsStr = record.resultSummary ? ` | ${record.resultSummary}` : "";
    const cacheStr = record.cacheHit !== "N/A" ? ` | cache: ${record.cacheHit}` : "";

    if (record.status === "error") {
      console.error(
        `[mcp:tool:error] [${record.taskId} | Step ${record.step}] ❌ FAILED (${record.durationMs.toFixed(
          1,
        )}ms) | ${record.tool} | args: ${argsJson} | error: ${record.error ?? "unknown"}${cacheStr}`,
      );
    } else {
      console.error(
        `[mcp:tool] [${record.taskId} | Step ${record.step}] ${speedTag} | ${record.tool} | args: ${argsJson}${cacheStr}${hitsStr}${sizeStr}`,
      );
    }
  }

  private logTaskSummary(task: TaskRecord): void {
    const toolSummary = Object.entries(task.tools)
      .map(([tool, count]) => `${tool}(x${count})`)
      .join(", ");
    const totalCache = task.cacheHits + task.cacheMisses;
    const hitRate = totalCache > 0 ? ((task.cacheHits / totalCache) * 100).toFixed(1) + "%" : "N/A";

    console.error(
      `[mcp:task:summary] 📦 [${task.taskId} FINISHED] Total: ${task.totalDurationMs.toFixed(
        1,
      )}ms | ${task.totalCalls} call${task.totalCalls > 1 ? "s" : ""} (${toolSummary}) | Cache: ${task.cacheHits} hit, ${task.cacheMisses} miss (${hitRate})`,
    );
  }

  private formatSpeedTag(durationMs: number): string {
    if (durationMs < 50) return `⚡ FAST (${durationMs.toFixed(1)}ms)`;
    if (durationMs < 200) return `⏱️ (${durationMs.toFixed(1)}ms)`;
    if (durationMs < 800) return `🐢 [SLOW] (${durationMs.toFixed(1)}ms)`;
    return `🚨 [VERY SLOW] (${durationMs.toFixed(1)}ms)`;
  }

  private sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (/token|auth|key|secret/i.test(key)) {
        result[key] = "[REDACTED]";
      } else if (typeof value === "string" && value.length > 80) {
        result[key] = value.slice(0, 80) + "...";
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private appendLogFile(record: ToolCallRecord): void {
    if (!this.logFilePath) return;
    try {
      appendFileSync(this.logFilePath, JSON.stringify(record) + "\n", "utf8");
    } catch {
      // Do not crash server on disk write failures
    }
  }

  /**
   * Generates aggregated metrics payload for the GET /metrics / GET /diagnostics endpoint.
   */
  public getMetricsJson(): Record<string, unknown> {
    const uptimeSeconds = Math.floor((Date.now() - this.startTimestamp) / 1000);
    let totalCalls = 0;
    let totalErrors = 0;
    const toolMetrics: Record<string, ToolStats> = {};

    for (const [tool, stat] of this.toolStatsMap.entries()) {
      totalCalls += stat.calls;
      totalErrors += stat.errors;
      const sorted = [...stat.latencies].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p95 = sorted[p95Index] ?? stat.maxMs;
      const totalCacheAttempts = stat.cacheHits + stat.cacheMisses;
      const hitRatio =
        totalCacheAttempts > 0
          ? ((stat.cacheHits / totalCacheAttempts) * 100).toFixed(1) + "%"
          : "N/A";

      toolMetrics[tool] = {
        calls: stat.calls,
        totalMs: Number(stat.totalMs.toFixed(1)),
        minMs: Number(stat.minMs.toFixed(1)),
        maxMs: Number(stat.maxMs.toFixed(1)),
        avgMs: Number((stat.totalMs / (stat.calls || 1)).toFixed(1)),
        p95Ms: Number(p95.toFixed(1)),
        errors: stat.errors,
        cacheHits: stat.cacheHits,
        cacheMisses: stat.cacheMisses,
        cacheHitRatio: hitRatio,
      };
    }

    const cacheMetrics: Record<string, unknown> = {};
    for (const [name, provider] of this.cacheProviders.entries()) {
      const hits = provider.hits();
      const misses = provider.misses();
      const total = hits + misses;
      cacheMetrics[name] = {
        size: provider.size(),
        hits,
        misses,
        hitRatio: total > 0 ? ((hits / total) * 100).toFixed(1) + "%" : "N/A",
      };
    }

    // Task aggregate calculations
    const completedTasks = this.recentTasks.length;
    const totalTaskCalls = this.recentTasks.reduce((sum, t) => sum + t.totalCalls, 0);
    const totalTaskDuration = this.recentTasks.reduce((sum, t) => sum + t.totalDurationMs, 0);

    return {
      service: "gamesmcp-mcp",
      uptimeSeconds,
      taskSummary: {
        completedTasks,
        avgCallsPerTask: completedTasks > 0 ? Number((totalTaskCalls / completedTasks).toFixed(1)) : 0,
        avgTaskDurationMs:
          completedTasks > 0 ? Number((totalTaskDuration / completedTasks).toFixed(1)) : 0,
      },
      summary: {
        totalCalls,
        totalErrors,
        activeTasks: this.activeSessionTasks.size,
      },
      caches: cacheMetrics,
      tools: toolMetrics,
      slowestQueries: this.slowestCalls.map((c) => ({
        timestamp: c.timestamp,
        taskId: c.taskId,
        tool: c.tool,
        durationMs: c.durationMs,
        args: c.args,
        cacheHit: c.cacheHit,
      })),
      recentTasks: this.recentTasks.slice(0, 10).map((t) => ({
        taskId: t.taskId,
        startTime: t.startTime,
        endTime: t.endTime,
        totalCalls: t.totalCalls,
        totalDurationMs: t.totalDurationMs,
        tools: t.tools,
        cacheHits: t.cacheHits,
        cacheMisses: t.cacheMisses,
      })),
      recentCalls: this.recentCalls.slice(0, 30),
    };
  }
}

/**
 * Universal Tool Wrapper that intercepts invocations, records execution timing,
 * links to Task state machine, and captures cache status.
 */
export function instrumentTool<TArgs extends Record<string, unknown>, TResult>(
  toolName: string,
  handler: (args: TArgs, extra: unknown) => Promise<TResult>,
  telemetry: McpTelemetry = McpTelemetry.getInstance(),
): (args: TArgs, extra: unknown) => Promise<TResult> {
  return async (args: TArgs, extra: unknown): Promise<TResult> => {
    const ctx = telemetry.getCurrentContext() || {};
    const { task, step } = telemetry.getOrCreateTask(ctx.sessionId, ctx.explicitTaskId);
    const startMs = performance.now();
    const id = `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    try {
      const result = await handler(args, extra);
      const durationMs = Number((performance.now() - startMs).toFixed(2));
      const effectiveCacheHit = ctx.cacheHit ?? "N/A";

      // Result inspection
      let isError = false;
      let resultSummary: string | undefined;
      let sizeBytes: number | undefined;

      if (result && typeof result === "object") {
        const res = result as Record<string, unknown>;
        if (res.isError === true) {
          isError = true;
        }
        if (Array.isArray(res.content) && res.content.length > 0) {
          const first = res.content[0] as { type?: string; text?: string };
          if (first && typeof first.text === "string") {
            sizeBytes = Buffer.byteLength(first.text, "utf8");
            try {
              const parsed = JSON.parse(first.text);
              if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.hits)) {
                  resultSummary = `hits: ${parsed.hits.length}`;
                } else if (Array.isArray(parsed.games)) {
                  resultSummary = `games: ${parsed.games.length}`;
                } else if (parsed.name) {
                  resultSummary = `entity: "${parsed.name}"`;
                }
              }
            } catch {
              // Not JSON text; ignore summary parsing
            }
          }
        }
      }

      telemetry.recordCall({
        id,
        taskId: task.taskId,
        step,
        timestamp,
        tool: toolName,
        args: (args || {}) as Record<string, unknown>,
        durationMs,
        cacheHit: effectiveCacheHit,
        status: isError ? "error" : "success",
        error: isError ? "tool_error" : undefined,
        resultSummary,
        sizeBytes,
        sessionId: ctx.sessionId,
        clientIp: ctx.clientIp,
      });

      return result;
    } catch (error) {
      const durationMs = Number((performance.now() - startMs).toFixed(2));
      const errorMessage = error instanceof Error ? error.message : String(error);

      telemetry.recordCall({
        id,
        taskId: task.taskId,
        step,
        timestamp,
        tool: toolName,
        args: (args || {}) as Record<string, unknown>,
        durationMs,
        cacheHit: ctx.cacheHit ?? "N/A",
        status: "error",
        error: errorMessage,
        sessionId: ctx.sessionId,
        clientIp: ctx.clientIp,
      });

      throw error;
    }
  };
}
