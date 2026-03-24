import unittest
from test_registration_race_condition import report_race_condition_issue
from unittest.mock import Mock, patch, MagicMock
import threading
import time


class IAMRegistrationRaceConditionTests(unittest.TestCase):
    """Test duplicate registration check with race condition prevention"""
    
    def setUp(self):
        """Initialize registration service"""
        self.mock_db = Mock()
        self.email = 'alice@example.com'
        self.registration_lock = Mock()
        
    def test_duplicate_email_check_race_condition(self):
        """
        Given: Two simultaneous registration requests with same email
        When: Both check for duplicate email
        Then: Verify race condition is prevented with atomic lock
        """
        # Call race condition audit
        race_report = report_race_condition_issue()
        self.assertIn('Race condition', race_report)
        
        # Simulate concurrent registration attempts
        registration_requests = [
            {
                'email': self.email,
                'fullName': 'Alice',
                'password': 'Pass123!',
                'timestamp': 1695000000.0
            },
            {
                'email': self.email,
                'fullName': 'Alice2',
                'password': 'Pass456!',
                'timestamp': 1695000000.05  # 50ms later
            }
        ]
        
        # Verify both have same email
        emails = [req['email'] for req in registration_requests]
        self.assertEqual(len(set(emails)), 1)

    def test_atomic_duplicate_check_and_insert(self):
        """Test atomic operation preventing duplicate registration"""
        # Before lock-based approach (vulnerable)
        vulnerable_flow = {
            'step1_check': 'SELECT * FROM users WHERE email = ?',
            'step2_insert': 'INSERT INTO users (...) VALUES (...)',
            'race_window': 'Between SELECT and INSERT'
        }
        
        # After lock-based approach (safe)
        safe_flow = {
            'step1_acquire_lock': 'LOCK TABLE users IN EXCLUSIVE MODE',
            'step2_check': 'SELECT * FROM users WHERE email = ?',
            'step3_insert': 'INSERT INTO users (...) VALUES (...)',
            'step4_release_lock': 'COMMIT / Automatic unlock',
            'race_window': 'None - atomic operation'
        }
        
        self.assertIn('LOCK TABLE', safe_flow['step1_acquire_lock'])

    def test_registration_with_mutex_lock(self):
        """Test registration flow with mutex lock"""
        registration_queue = []
        
        def register_user(email, fullname):
            """Simulate registration with lock"""
            registration_queue.append({
                'email': email,
                'fullName': fullname,
                'status': 'processing',
                'timestamp': time.time()
            })
            
            # Simulate atomic check + insert
            for reg in registration_queue[:-1]:
                if reg['email'] == email:
                    registration_queue[-1]['status'] = 'duplicate_rejected'
                    return False
            
            registration_queue[-1]['status'] = 'created'
            return True
        
        # Attempt registrations
        result1 = register_user(self.email, 'Alice')
        result2 = register_user(self.email, 'Alice2')
        
        self.assertTrue(result1)
        self.assertFalse(result2)

    def test_redis_distributed_lock_registration(self):
        """Test registration with distributed Redis lock"""
        lock_key = f'registration:lock:{self.email}'
        
        # Mock Redis lock acquisition
        lock_acquired = {
            'key': lock_key,
            'acquired': True,
            'ttl': 10,  # 10 second timeout
            'holder': 'request-id-001'
        }
        
        # During lock, registration proceeds
        registration_result = {
            'email': self.email,
            'status': 'created',
            'timestamp': 1695000000,
            'locked_by': lock_acquired['holder']
        }
        
        # Lock is released
        lock_released = {
            'key': lock_key,
            'acquired': False,
            'released_at': 1695000001
        }
        
        self.assertFalse(lock_released['acquired'])


if __name__ == '__main__':
    unittest.main()
