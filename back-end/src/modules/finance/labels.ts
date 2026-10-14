import type { PaymentMethod } from '../../contract/models.js';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Numerar',
  card: 'Card',
  transfer: 'Transfer bancar',
};
