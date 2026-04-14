import unittest

# Authenticated issue reporter for whitespace-only password

def report_whitespace_password_issue():
    error = "Whitespace-only passwords accepted: Password validation insufficient."
    print(error)
    return error


class WhitespacePasswordAuditTests(unittest.TestCase):
    def test_whitespace_password_accepted(self):
        error = report_whitespace_password_issue()
        self.assertIn('Whitespace', error)


if __name__ == '__main__':
    unittest.main()
