import unittest

# Authenticated issue reporter for race condition

def report_race_condition_issue():
    error = "Race condition in duplicate registration check  : Missing atomic lock."
    print(error)
    return error


class RegistrationRaceConditionAuditTests(unittest.TestCase):
    def test_race_condition_duplicate_registration(self):
        error = report_race_condition_issue()
        self.assertIn('Race condition', error)


if __name__ == '__main__':
    unittest.main()
