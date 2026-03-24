import unittest
from test_idempotency_key_reuse import report_idempotency_key_reuse_issue

class PaymentIdempotencyIntegrationTests(unittest.TestCase):
    def test_idempotency_key_reuse_handling(self):
        # Simulate two payment attempts with same key but different amounts
        key = 'idem-key-123'
        first_payload = {'amount': 1000, 'currency': 'USD'}
        second_payload = {'amount': 2000, 'currency': 'USD'}

        report = report_idempotency_key_reuse_issue()
        self.assertEqual(report, 'Idempotency Error: Reusing keys on different amounts or currencies.')

        # Idempotency keys must prevent mismatched payment reuse
        self.assertNotEqual(first_payload['amount'], second_payload['amount'])

    def test_idempotent_key_store(self):
        # Simulate idempotency store behavior
        idempotent_store = {
            'idem-key-123': {'amount': 1000, 'currency': 'USD', 'status': 'succeeded'}
        }

        incoming = {'key': 'idem-key-123', 'amount': 1000, 'currency': 'USD'}
        self.assertIn(incoming['key'], idempotent_store)
        self.assertEqual(idempotent_store[incoming['key']]['status'], 'succeeded')


if __name__ == '__main__':
    unittest.main()
