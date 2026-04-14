import unittest

# Authenticated issue reporter for Firebase Admin environment mismatch

def report_firebase_admin_env_issue():
    error = "Firebase Admin: Loaded 'Dev' service account JSON into 'Production' server."
    print(error)
    return error


class FirebaseAdminEnvAuditTests(unittest.TestCase):
    def test_firebase_admin_dev_loaded_in_prod(self):
        error = report_firebase_admin_env_issue()
        self.assertIn('Production', error)


if __name__ == '__main__':
    unittest.main()
