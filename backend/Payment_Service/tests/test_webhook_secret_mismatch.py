import unittest

# Authenticated issue reporter for Stripe webhook secret mismatch

def report_webhook_secret_mismatch_issue():
    error = "Webhook Secret: Mismatched signing secret between Stripe and backend."
    print(error)
    return error


class WebhookSecretMismatchTests(unittest.TestCase):
    def test_webhook_secret_mismatch_reported(self):
        error = report_webhook_secret_mismatch_issue()
        self.assertIn('Mismatched signing secret', error)


if __name__ == '__main__':
    unittest.main()
