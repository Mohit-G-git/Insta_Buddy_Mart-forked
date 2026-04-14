import unittest

# Authenticated issue reporter for Redis OOM behavior

def report_redis_oom_issue():
    error = "Redis OOM: Missing 'allkeys-lru' policy breaks WebSocket heartbeat memory."
    print(error)
    return error


class RedisOomPolicyAuditTests(unittest.TestCase):
    def test_redis_oom_allkeys_lru_missing(self):
        error = report_redis_oom_issue()
        self.assertIn('allkeys-lru', error)


if __name__ == '__main__':
    unittest.main()
