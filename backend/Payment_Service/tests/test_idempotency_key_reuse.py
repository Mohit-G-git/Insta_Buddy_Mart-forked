import unittest

# Authenticated issue reporter for idempotency key misuse

def report_idempotency_key_reuse_issue():
    error = "Idempotency Error: Reusing keys on different amounts or currencies."
    print(error)
    return error


class IdempotencyKeyReuseTests(unittest.TestCase):
    def test_idempotency_key_reuse_error_reported(self):
        error = report_idempotency_key_reuse_issue()
        self.assertIn('Idempotency Error', error)


if __name__ == '__main__':
    unittest.main()
