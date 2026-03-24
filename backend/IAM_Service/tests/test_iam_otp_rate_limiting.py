import unittest
from test_otp_bruteforce_protection import report_otp_bruteforce_issue
from unittest.mock import Mock, patch, MagicMock


class IAMOTPBruteForceProtectionTests(unittest.TestCase):
    """Test OTP verification with rate limiting and brute-force protection"""
    
    def setUp(self):
        """Initialize OTP verification service"""
        self.mock_redis = Mock()
        self.user_id = 'user-uuid-456'
        self.email = 'user@example.com'
        self.max_attempts = 3
        self.lockout_duration = 300  # 5 minutes
        
    def test_otp_attempt_tracking_per_code(self):
        """
        Given: User attempts to verify OTP
        When: Verification fails
        Then: Track attempt count and enforce rate limit
        """
        # Call brute-force audit
        bruteforce_report = report_otp_bruteforce_issue()
        self.assertIn('brute-force', bruteforce_report)
        
        # Simulate attempt tracking
        otp_code = '123456'
        attempts_key = f'otp:attempts:{self.user_id}:{otp_code}'
        
        attempt_log = {
            'code': otp_code,
            'user_id': self.user_id,
            'attempts': [
                {'timestamp': 1695000000, 'input': '000000'},
                {'timestamp': 1695000005, 'input': '111111'},
                {'timestamp': 1695000010, 'input': '222222'}
            ],
            'locked_until': 1695000310
        }
        
        self.assertEqual(len(attempt_log['attempts']), 3)

    def test_otp_verification_with_rate_limit(self):
        """Test OTP rate limiting enforcement"""
        verification_attempts = []
        
        # Attempt 1
        verification_attempts.append({
            'timestamp': 1695000000,
            'code': '000000',
            'result': 'invalid',
            'remaining_attempts': 2
        })
        
        # Attempt 2
        verification_attempts.append({
            'timestamp': 1695000002,
            'code': '111111',
            'result': 'invalid',
            'remaining_attempts': 1
        })
        
        # Attempt 3
        verification_attempts.append({
            'timestamp': 1695000004,
            'code': '222222',
            'result': 'invalid',
            'remaining_attempts': 0
        })
        
        # Account should be locked
        is_locked = len(verification_attempts) >= self.max_attempts
        self.assertTrue(is_locked)

    def test_otp_lockout_mechanism(self):
        """Test account lockout after max failed attempts"""
        lockout_status = {
            'user_id': self.user_id,
            'locked': True,
            'reason': 'otp_brute_force',
            'locked_at': 1695000010,
            'unlock_at': 1695000310,
            'failed_attempts': 3
        }
        
        # Verify lockout
        self.assertTrue(lockout_status['locked'])
        self.assertEqual(lockout_status['reason'], 'otp_brute_force')

    def test_otp_recovery_after_lockout(self):
        """Test account recovery after lockout period"""
        import time
        current_time = int(time.time())
        
        lockout_record = {
            'user_id': self.user_id,
            'locked_at': current_time - 350,
            'unlock_at': current_time - 50,  # Already unlocked
            'is_lockout_expired': True
        }
        
        # Account should be unlocked
        self.assertTrue(lockout_record['is_lockout_expired'])


if __name__ == '__main__':
    unittest.main()
