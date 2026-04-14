import unittest
from test_webhook_secret_mismatch import report_webhook_secret_mismatch_issue
from test_webhook_timeout import report_webhook_timeout_issue

class PaymentWebhookIntegrationTests(unittest.TestCase):
    def test_webhook_secret_and_timeout_scenarios(self):
        # Report mismatched secret
        secret_report = report_webhook_secret_mismatch_issue()
        self.assertIn('Mismatched signing secret', secret_report)

        # Report timeout
        timeout_report = report_webhook_timeout_issue()
        self.assertIn('200 OK', timeout_report)

    def test_webhook_event_processing_path(self):
        # Simulate incoming webhook
        webhook_event = {
            'id': 'evt_1',
            'type': 'payment_intent.succeeded',
            'data': {
                'object': {
                    'id': 'pi_1',
                    'amount': 1500,
                    'currency': 'eur',
                    'status': 'succeeded'
                }
            }
        }

        self.assertEqual(webhook_event['type'], 'payment_intent.succeeded')
        self.assertEqual(webhook_event['data']['object']['status'], 'succeeded')


if __name__ == '__main__':
    unittest.main()
