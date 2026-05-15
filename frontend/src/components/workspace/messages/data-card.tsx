import type { Message } from "@langchain/langgraph-sdk";
import { AlertCircleIcon, DatabaseIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { parseExecuteSqlResult } from "@/core/messages/utils";
import { cn } from "@/lib/utils";

const MAX_ROWS_VISIBLE = 50;

/**
 * Deterministic data-table card rendered from an executeSqlToolCallback tool result.
 * Shown independently of the LLM's text reply so the user always sees the actual
 * data returned by the SQL execution, even if the LLM's Step 5 summary is skipped
 * or rewritten.
 */
export function DataCard({
  message,
  className,
}: {
  message: Message;
  className?: string;
}) {
  const data = parseExecuteSqlResult(message);
  if (!data) return null;

  if (data.status === "REJECTED" || data.errorType) {
    return (
      <div
        className={cn(
          "border-destructive/40 bg-destructive/5 flex w-full items-start gap-2 rounded-lg border p-3",
          className,
        )}
      >
        <AlertCircleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="text-destructive font-medium">数据查询未成功</div>
          {data.errorMessage && (
            <div className="text-muted-foreground mt-1 text-xs">
              {data.errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  const columns = data.columns ?? [];
  const rows = data.rows ?? [];

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "text-muted-foreground border-border bg-muted/30 flex w-full items-center gap-2 rounded-lg border p-3 text-sm",
          className,
        )}
      >
        <DatabaseIcon className="size-4 shrink-0" />
        未检索到对应数据
      </div>
    );
  }

  const visibleRows = rows.slice(0, MAX_ROWS_VISIBLE);
  const totalRowCount = data.rowCount ?? rows.length;

  return (
    <div
      className={cn(
        "border-border bg-card w-full overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="bg-muted/40 flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">数据查询结果</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px] font-normal">
            {totalRowCount} 行
          </Badge>
          {data.truncated && (
            <Badge variant="outline" className="text-[10px] font-normal">
              已截断
            </Badge>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              {columns.map((col, i) => (
                <th
                  key={`${col}-${i}`}
                  className="border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => {
              const cells = Array.isArray(row) ? row : [];
              return (
                <tr key={ri} className="border-b last:border-b-0">
                  {cells.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-1.5 font-mono text-xs whitespace-nowrap"
                    >
                      {cell === null || cell === undefined
                        ? "—"
                        : String(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS_VISIBLE && (
        <div className="text-muted-foreground border-t px-3 py-1.5 text-xs">
          仅显示前 {MAX_ROWS_VISIBLE} 条,共 {totalRowCount} 条
        </div>
      )}
    </div>
  );
}
