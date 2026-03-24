import unittest

# Authenticated issue reporter for OTP plaintext storage

def report_otp_plaintext_issue():
    error = "OTP stored as plaintext in database  : Missing encryption layer."
    print(error)
    return error


class OtpPlaintextAuditTests(unittest.TestCase):
    def test_otp_plaintext_storage_reported(self):
        error = report_otp_plaintext_issue()
        self.assertIn('plaintext', error)


if __name__ == '__main__':
    unittest.main()
