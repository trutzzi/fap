import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

/**
 * Request logging without personal data or credentials (GDPR): no headers (they carry the
 * session cookie), and paths without query strings (searches contain member names/phones).
 */
export function httpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' },
    serializers: {
      req: (req: IncomingMessage & { id?: unknown }) => ({
        id: req.id,
        method: req.method,
        path: (req.url ?? '').split('?')[0],
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  });
}
