import unittest

# Authenticated issue reporter for Postgres ID mismatch

def report_postgres_uuid_int_mismatch():
    error = "Postgres Mismatch: Message 'UUID' sender ID doesn't match User 'INT'."
    print(error)
    return error


class PostgresIdMismatchAuditTests(unittest.TestCase):
    def test_postgres_uuid_to_int_mismatch(self):
        error = report_postgres_uuid_int_mismatch()
        self.assertIn('UUID', error)


if __name__ == '__main__':
    unittest.main()
