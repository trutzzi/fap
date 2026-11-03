import type { Logger } from 'pino';

/**
 * Sends text messages. `send` resolves to `true` once a provider accepted the message and
 * to `false` when none is configured; it throws when the provider refuses it.
 */
export interface SmsSender {
  send(to: string, text: string): Promise<boolean>;
}

export interface SmsLinkConfig {
  connectionId: string;
  password: string;
  /** Approved sender name; SMSLink's numeric short number when empty. */
  sender?: string;
  /** SMSLink test mode: the request is validated but no SMS is sent. */
  test?: boolean;
}

const SMSLINK_URL = 'https://secure.smslink.ro/sms/gateway/communicate/index.php';
const TIMEOUT_MS = 10_000;

/**
 * SMSLink.ro HTTP gateway. It answers in plain text: `MESSAGE;…` when accepted,
 * `ERROR;<code>;<description>` otherwise. Recipients are `07…` (or `00…` abroad).
 */
export function smsLinkSender(config: SmsLinkConfig, fetchImpl: typeof fetch = fetch): SmsSender {
  return {
    async send(to, text) {
      const body = new URLSearchParams({
        connection_id: config.connectionId,
        password: config.password,
        to,
        message: text,
      });
      if (config.sender) body.set('sender', config.sender);
      if (config.test) body.set('test', '1');
      const res = await fetchImpl(SMSLINK_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const answer = (await res.text()).trim();
      if (!res.ok || !answer.startsWith('MESSAGE;')) {
        // The error ends up in the admin logs: never include the request, and hide the
        // gateway password, which some answers echo ("ERROR;7;Password '…' is not approved!").
        const reason = answer.split(config.password).join('***').slice(0, 200);
        throw new Error(`SMSLink: ${reason || `HTTP ${res.status}`}`);
      }
      return true;
    },
  };
}

/** No provider configured (development): the SMS is only logged, without the text. */
export function logSmsSender(logger?: Pick<Logger, 'info'>): SmsSender {
  return {
    send(to) {
      (logger ?? console).info(`SMS not sent to ${to}: no SMS provider is configured`);
      return Promise.resolve(false);
    },
  };
}
