import unittest

# Authenticated issue reporter for JWT nbf drift

def report_jwt_nbf_drift_issue():
    error = "JWT 'nbf': Server clock drift makes tokens appear \"not valid yet\"."
    print(error)
    return error


class JwtNbfDriftAuditTests(unittest.TestCase):
    def test_jwt_nbf_server_clock_drift(self):
        error = report_jwt_nbf_drift_issue()
        self.assertIn('not valid yet', error)


if __name__ == '__main__':
    unittest.main()
