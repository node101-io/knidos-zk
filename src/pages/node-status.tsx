import type { HtmlEscapedString } from 'hono/utils/html';

import type { DeferredTaskResult, QueueStatusResult } from '../services/queue-status.js';

const HEADERS = ['PENDING', 'QUEUED', 'RUNNING', 'DEFERRED', 'FAILED'] as const;

export function renderNodeStatus(
  status: QueueStatusResult,
  deferredTasks: DeferredTaskResult[],
): HtmlEscapedString {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Node Status</title>
        <style>{`
          body { font-family: monospace; padding: 2rem; }
          table { border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 8px 16px; text-align: right; }
          td:first-child { text-align: left; font-weight: bold; }
        `}</style>
      </head>
      <body>
        <h2>Node Status</h2>
        <table>
          <tr>
            <th>pipeline</th>
            {HEADERS.map((h) => (
              <th>{h}</th>
            ))}
          </tr>
          {Object.entries(status).map(([type, counts]) => (
            <tr>
              <td>{type}</td>
              {HEADERS.map((h) => (
                <td>{counts[h] ?? 0}</td>
              ))}
            </tr>
          ))}
        </table>
        <h3>Deferred Tasks</h3>
        <table>
          <tr>
            <th>taskId</th>
            <th>pipeline</th>
            <th>symbol</th>
            <th>endTime</th>
            <th>deferReason</th>
            <th>deferUntil</th>
          </tr>
          {deferredTasks.length === 0 ? (
            <tr>
              <td colspan={6}>none</td>
            </tr>
          ) : (
            deferredTasks.map((task) => (
              <tr>
                <td>{task.taskId}</td>
                <td>{task.type}</td>
                <td>{task.symbol ?? '-'}</td>
                <td>{task.endTime?.toISOString() ?? '-'}</td>
                <td>{task.deferReason ?? '-'}</td>
                <td>{task.deferUntil?.toISOString() ?? '-'}</td>
              </tr>
            ))
          )}
        </table>
      </body>
    </html>
  ) as HtmlEscapedString;
}
