import type { HtmlEscapedString } from 'hono/utils/html';

import type { QueueStatusResult } from '../services/queue-status.js';

const HEADERS = ['PENDING', 'QUEUED', 'RUNNING', 'FAILED'] as const;

export function renderNodeStatus(status: QueueStatusResult): HtmlEscapedString {
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
      </body>
    </html>
  ) as HtmlEscapedString;
}
