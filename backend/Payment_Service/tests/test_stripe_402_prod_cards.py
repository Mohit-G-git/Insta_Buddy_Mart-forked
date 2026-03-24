import unittest

# Authenticated issue reporter for Stripe 402 test card use in prod

def report_stripe_402_test_card_prod_issue():
    error = "Stripe 402: Using test cards in a production environment."
    print(error)
    return error


class Stripe402ProdCardIssueTests(unittest.TestCase):
    def test_stripe_402_test_card_in_prod_reported(self):
        error = report_stripe_402_test_card_prod_issue()
        self.assertIn('test cards', error)


if __name__ == '__main__':
    unittest.main()
