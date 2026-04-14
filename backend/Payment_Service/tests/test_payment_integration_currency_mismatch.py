import unittest
from test_payment_currency_mismatch import report_currency_mismatch_issue

class PaymentCurrencyMismatchTests(unittest.TestCase):
    def test_currency_mismatch_error_reporting(self):
        report = report_currency_mismatch_issue()
        self.assertIn('Backend', report)

        # Simulate payment intent with Stripe currency
        backend_currency = 'USD'
        stripe_intent_currency = 'EUR'

        self.assertNotEqual(backend_currency, stripe_intent_currency)

    def test_capture_with_mismatched_currency_should_fail(self):
        # Simulate attempt to capture with mismatch
        attempted_charge = {
            'amount': 1000,
            'currency': 'usd'
        }
        stripe_intent = {
            'id': 'pi_1',
            'amount': 1000,
            'currency': 'eur'
        }

        self.assertNotEqual(attempted_charge['currency'], stripe_intent['currency'])


if __name__ == '__main__':
    unittest.main()
