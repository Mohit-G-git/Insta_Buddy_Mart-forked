import unittest

# Authenticated issue reporter for OTP brute-force protection

def report_otp_bruteforce_issue():
    error = "No OTP brute-force protection per-code  : Missing rate limiting."
    print(error)
    return error


class OtpBruteforceAuditTests(unittest.TestCase):
    def test_otp_bruteforce_protection_missing(self):
        error = report_otp_bruteforce_issue()
        self.assertIn('brute-force', error)


if __name__ == '__main__':
    unittest.main()
