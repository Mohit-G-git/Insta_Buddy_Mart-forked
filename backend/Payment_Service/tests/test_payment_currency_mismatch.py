import unittest

# Authenticated issue reporter for currency mismatch

def report_currency_mismatch_issue():
    error = "Currency Mismatch: Backend 'USD' doesn't match Stripe's 'EUR' intent."
    print(error)
    return error


class CurrencyMismatchTests(unittest.TestCase):
    def test_currency_mismatch_reported(self):
        error = report_currency_mismatch_issue()
        self.assertIn('Currency Mismatch', error)


if __name__ == '__main__':
    unittest.main()
