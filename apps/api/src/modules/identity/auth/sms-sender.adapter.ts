import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '../lib/phone';

export const SMS_SENDER_ADAPTER = 'SMS_SENDER_ADAPTER';

export interface SmsSenderAdapter {
  send(phone: string, body: string): Promise<void>;
}

// No SMS delivery vendor is contracted yet (docs/open-questions.md #18) — this mock
// never actually delivers anything. `body` carries the real OTP text (parity with a
// future real adapter's contract), but the log line deliberately never includes it —
// only the masked phone — so the code is never written to stdout even in dev/CI.
@Injectable()
export class MockSmsSenderAdapter implements SmsSenderAdapter {
  private readonly logger = new Logger('SmsSenderAdapter');

  async send(phone: string, _body: string): Promise<void> {
    this.logger.log(`[stub] OTP sent to ${maskPhone(phone)}`);
  }
}
