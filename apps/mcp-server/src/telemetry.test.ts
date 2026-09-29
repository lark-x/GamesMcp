import { describe, expect, it, vi } from "vitest";
import { instrumentTool, McpTelemetry } from "./telemetry.js";

describe("McpTelemetry", () => {
  it("records tool calls and calculates stats correctly", () => {
    const telemetry = new McpTelemetry({ taskInactivityTimeoutMs: 1000 });

    telemetry.recordCall({
      id: "call-1",
      taskId: "task-1",
      step: 1,
      timestamp: new Date().toISOString(),
      tool: "get_character",
      args: { name: "钟离" },
      durationMs: 10,
      cacheHit: "HIT",
      status: "success",
    });

    telemetry.recordCall({
      id: "call-2",
      taskId: "task-1",
      step: 2,
      timestamp: new Date().toISOString(),
      tool: "get_character",
      args: { name: "雷电将军" },
      durationMs: 20,
      cacheHit: "MISS",
      status: "success",
    });

    const metrics = telemetry.getMetricsJson();
    expect(metrics.service).toBe("gamesmcp-mcp");
    expect((metrics.summary as { totalCalls: number }).totalCalls).toBe(2);

    const charStats = (metrics.tools as Record<string, Record<string, unknown>>)["get_character"]!;
    expect(charStats.calls).toBe(2);
    expect(charStats.minMs).toBe(10);
    expect(charStats.maxMs).toBe(20);
    expect(charStats.avgMs).toBe(15);
    expect(charStats.cacheHits).toBe(1);
    expect(charStats.cacheMisses).toBe(1);
    expect(charStats.cacheHitRatio).toBe("50.0%");
  });

  it("clusters sequential calls into a single task within inactivity timeout", () => {
    const telemetry = new McpTelemetry({ taskInactivityTimeoutMs: 500 });

    const call1 = telemetry.getOrCreateTask("session-a");
    expect(call1.task.taskId).toBe("task-1");
    expect(call1.step).toBe(1);

    const call2 = telemetry.getOrCreateTask("session-a");
    expect(call2.task.taskId).toBe("task-1");
    expect(call2.step).toBe(2);

    telemetry.finalizeSessionTask("session-a");
    const metrics = telemetry.getMetricsJson();
    expect((metrics.taskSummary as Record<string, unknown>).completedTasks).toBe(1);
  });

  it("handles slowest calls ranking up to limit", () => {
    const telemetry = new McpTelemetry();

    for (let i = 1; i <= 25; i++) {
      telemetry.recordCall({
        id: `call-${i}`,
        taskId: "task-test",
        step: i,
        timestamp: new Date().toISOString(),
        tool: "search",
        args: { query: `query-${i}` },
        durationMs: i * 10,
        cacheHit: "MISS",
        status: "success",
      });
    }

    const metrics = telemetry.getMetricsJson();
    const slowest = metrics.slowestQueries as Array<{ durationMs: number }>;
    expect(slowest.length).toBe(20); // max 20
    expect(slowest[0]?.durationMs).toBe(250); // descending order
    expect(slowest[19]?.durationMs).toBe(60);
  });

  it("instruments tool execution via instrumentTool", async () => {
    const telemetry = new McpTelemetry();
    const handler = vi.fn(async (args: { name: string }) => {
      return {
        content: [{ type: "text", text: JSON.stringify({ name: args.name, title: "Rock" }) }],
      };
    });

    const instrumented = instrumentTool("mock_tool", handler, telemetry);

    const result = await instrumented({ name: "钟离" }, {});
    expect(result).toBeDefined();
    expect(handler).toHaveBeenCalledTimes(1);

    const metrics = telemetry.getMetricsJson();
    const toolStats = (metrics.tools as Record<string, Record<string, unknown>>)["mock_tool"]!;
    expect(toolStats).toBeDefined();
    expect(toolStats.calls).toBe(1);
    expect(toolStats.errors).toBe(0);
  });

  it("properly records and rethrows tool handler errors", async () => {
    const telemetry = new McpTelemetry();
    const failingHandler = vi.fn(async () => {
      throw new Error("test_database_error");
    });

    const instrumented = instrumentTool("failing_tool", failingHandler, telemetry);

    await expect(instrumented({}, {})).rejects.toThrow("test_database_error");

    const metrics = telemetry.getMetricsJson();
    const toolStats = (metrics.tools as Record<string, Record<string, unknown>>)["failing_tool"]!;
    expect(toolStats.errors).toBe(1);
  });
});
