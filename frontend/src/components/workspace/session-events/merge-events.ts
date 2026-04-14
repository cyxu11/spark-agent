import { type RunEvent } from "@/core/run-events/types";

export interface MergedToolCall {
  id: string;
  name: string;
  args: string;
}

export interface ProcessedEvent extends RunEvent {
  /** 合并后的文本内容（仅 messages 类型有意义） */
  mergedContent?: string;
  /** 合并后的 tool calls */
  mergedToolCalls?: MergedToolCall[];
  /** 该条目合并了多少个原始 chunk */
  chunkCount?: number;
}

function extractContent(chunk: Record<string, unknown>): string {
  const c = chunk.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return (c as Array<{ text?: string }>)
      .map((item) => item?.text ?? "")
      .join("");
  }
  return "";
}

function mergeToolCalls(groups: RunEvent[]): MergedToolCall[] {
  // 按 index 聚合 tool_call_chunks 的 args
  const byIndex = new Map<number, MergedToolCall>();

  for (const ev of groups) {
    const chunk = (ev.data as unknown[])[0] as Record<string, unknown>;

    // tool_calls 包含完整的 name/id（通常在第一个 chunk 里）
    const toolCalls = chunk.tool_calls as Array<{ id: string; name: string; args: Record<string, unknown> }> | undefined;
    if (toolCalls?.length) {
      for (const tc of toolCalls) {
        if (tc.id && tc.name) {
          // 用 id 找 index（tool_call_chunks 里有 index）
          const chunks = chunk.tool_call_chunks as Array<{ index: number; id?: string; name?: string }> | undefined;
          const idx = chunks?.find((c) => c.id === tc.id)?.index ?? byIndex.size;
          if (!byIndex.has(idx)) {
            byIndex.set(idx, { id: tc.id, name: tc.name, args: "" });
          } else {
            const existing = byIndex.get(idx)!;
            if (!existing.name && tc.name) existing.name = tc.name;
            if (!existing.id && tc.id) existing.id = tc.id;
          }
        }
      }
    }

    // tool_call_chunks 包含流式的 args 片段
    const tcc = chunk.tool_call_chunks as Array<{ index: number; id?: string; name?: string; args?: string }> | undefined;
    if (tcc?.length) {
      for (const c of tcc) {
        const idx = c.index ?? 0;
        if (!byIndex.has(idx)) {
          byIndex.set(idx, { id: c.id ?? "", name: c.name ?? "", args: c.args ?? "" });
        } else {
          const entry = byIndex.get(idx)!;
          entry.args += c.args ?? "";
          if (!entry.id && c.id) entry.id = c.id;
          if (!entry.name && c.name) entry.name = c.name;
        }
      }
    }
  }

  return Array.from(byIndex.values()).filter((tc) => tc.name);
}

/**
 * 将连续的相同 message id 的 `messages` 事件合并成一条 ProcessedEvent。
 * 其他类型的事件直接透传。
 */
export function mergeMessageEvents(events: RunEvent[]): ProcessedEvent[] {
  const result: ProcessedEvent[] = [];
  let i = 0;

  while (i < events.length) {
    const ev = events[i];
    if (!ev) {
      i++;
      continue;
    }

    if (
      ev.event === "messages" &&
      Array.isArray(ev.data) &&
      (ev.data as unknown[]).length > 0
    ) {
      const firstChunk = (ev.data as unknown[])[0] as Record<string, unknown>;
      const msgId = firstChunk?.id as string | undefined;

      // 收集同一个 msgId 的连续 messages 事件
      const group: RunEvent[] = [ev];
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        if (
          !next ||
          next.event !== "messages" ||
          !Array.isArray(next.data) ||
          ((next.data as unknown[])[0] as Record<string, unknown> | undefined)?.id !== msgId
        ) {
          break;
        }
        group.push(next);
        j++;
      }

      const mergedContent = group
        .map((e) => extractContent((e.data as unknown[])[0] as Record<string, unknown>))
        .join("");

      const mergedToolCalls = mergeToolCalls(group);

      result.push({
        ...ev,
        chunkCount: group.length,
        mergedContent,
        mergedToolCalls: mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
      });
      i = j;
    } else {
      result.push(ev);
      i++;
    }
  }

  return result;
}
