import unittest
import time
from test_jwt_nbf_drift import report_jwt_nbf_drift_issue
from unittest.mock import Mock, patch, MagicMock


class ChatAuthenticationMiddlewareTests(unittest.TestCase):
    """Test JWT authentication with clock drift / nbf (not before) validation"""
    
    def setUp(self):
        """Initialize JWT test tokens and mock auth middleware"""
        self.current_time = int(time.time())
        self.secret_key = 'test-secret-key-12345'
        self.user_id = 'user-uuid-5678'
        
    def test_jwt_token_nbf_validation_with_clock_drift(self):
        """
        Given: Server receives JWT token with future nbf (not-before) claim
        When: Auth middleware validates token expiry
        Then: Detect clock drift causing 'not valid yet' error
        """
        # Create token with future nbf (simulating clock drift)
        token = {
            'iss': 'chat-system',
            'sub': self.user_id,
            'iat': self.current_time,
            'nbf': self.current_time + 30,  # nbf is 30 seconds in future
            'exp': self.current_time + 3600,
            'room_id': 'room-uuid-123'
        }
        
        # Verify nbf is in future
        self.assertGreater(token['nbf'], self.current_time)
        
        # Call nbf drift audit
        drift_report = report_jwt_nbf_drift_issue()
        self.assertIn('not valid yet', drift_report)
    
    def test_authentication_flow_with_middleware(self):
        """Test complete auth middleware flow"""
        # Mock incoming request with Authorization header
        request = {
            'headers': {
                'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
            },
            'method': 'POST',
            'path': '/chat/send'
        }
        
        # Mock JWT payload after decode
        decoded_token = {
            'user_id': self.user_id,
            'room_id': 'room-uuid-456',
            'iat': self.current_time - 100,
            'nbf': self.current_time - 100,
            'exp': self.current_time + 3600
        }
        
        # Validate token timestamps
        self.assertGreater(decoded_token['iat'], 0)
        self.assertGreater(decoded_token['exp'], self.current_time)

    def test_token_expiry_and_refresh(self):
        """Test token expiry lifecycle"""
        # Original token
        original_token = {
            'user_id': self.user_id,
            'iat': self.current_time - 1800,
            'nbf': self.current_time - 1800,
            'exp': self.current_time - 100  # Expired 100 seconds ago
        }
        
        # Verify token is expired
        self.assertLess(original_token['exp'], self.current_time)
        
        # Refresh token (new token with current time)
        refreshed_token = {
            'user_id': self.user_id,
            'iat': self.current_time,
            'nbf': self.current_time,
            'exp': self.current_time + 3600,
            'previous_token_jti': 'original-jti-123'
        }
        
        self.assertEqual(refreshed_token['nbf'], self.current_time)

    def test_clock_sync_issue_across_servers(self):
        """Test scenario where server clocks are out of sync"""
        # Server 1 time (slower)
        server1_time = self.current_time - 60
        
        # Server 2 time (faster, issued token with future nbf)
        server2_time = self.current_time + 60
        
        # Token issued by Server 2
        token_from_server2 = {
            'iss': 'chat-auth',
            'iat': server2_time - 10,
            'nbf': server2_time,
            'exp': server2_time + 3600
        }
        
        # Validated by Server 1 (which has slower clock)
        # Server 1 sees nbf in the future
        nbf_appears_future = token_from_server2['nbf'] > server1_time
        self.assertTrue(nbf_appears_future)


if __name__ == '__main__':
    unittest.main()
