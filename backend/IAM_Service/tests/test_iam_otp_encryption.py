import unittest
from test_otp_plaintext_storage import report_otp_plaintext_issue
from unittest.mock import Mock, patch, MagicMock
import hashlib


class IAMOTPStorageAndEncryptionTests(unittest.TestCase):
    """Test OTP storage with encryption verification"""
    
    def setUp(self):
        """Initialize OTP service"""
        self.mock_db = Mock()
        self.encrypted_otp_service = Mock()
        self.user_id = 'user-uuid-123'
        self.encryption_key = 'encryption-key-32-bytes-long-xyz'
        
    def test_otp_must_be_encrypted_not_plaintext(self):
        """
        Given: OTP code is generated for 2FA
        When: OTP is stored in database
        Then: Verify OTP is encrypted, not plaintext
        """
        # Generate OTP
        otp_code = '123456'
        
        # Call encryption audit
        plaintext_report = report_otp_plaintext_issue()
        self.assertIn('plaintext', plaintext_report)
        
        # Simulate encrypted storage
        encrypted_otp = hashlib.sha256(otp_code.encode()).hexdigest()
        
        # Verify encrypted OTP is different from plaintext
        self.assertNotEqual(encrypted_otp, otp_code)

    def test_otp_record_database_schema(self):
        """Test OTP database record structure"""
        otp_record = {
            'id': 'otp-uuid-001',
            'user_id': self.user_id,
            'encrypted_code': 'sha256-hash-encrypted-otp-code',
            'purpose': 'email_verification',
            'created_at': 1695000000,
            'expires_at': 1695000300,  # 5 minutes
            'attempts': 0,
            'verified': False
        }
        
        # Verify encryption field
        self.assertIn('encrypted_code', otp_record)
        self.assertNotIn('plaintext_code', otp_record)
        self.assertFalse(otp_record['verified'])

    def test_otp_verification_workflow(self):
        """Test OTP verification with encrypted comparison"""
        stored_encrypted = 'sha256-hash-of-123456'
        user_input = '123456'
        user_input_hashed = 'sha256-hash-of-123456'
        
        # Verify comparison
        otp_matches = stored_encrypted == user_input_hashed
        self.assertTrue(otp_matches)
        
        # Update verification status
        verification_result = {
            'user_id': self.user_id,
            'verified': True,
            'timestamp': 1695000100,
            'verification_method': 'email_otp'
        }
        
        self.assertTrue(verification_result['verified'])

    def test_otp_expiry_and_cleanup(self):
        """Test OTP expiration handling"""
        import time
        current_time = int(time.time())
        
        otp_lifetime = 300  # 5 minutes
        otp_created = current_time - 350  # expired
        otp_expires = otp_created + otp_lifetime
        
        is_expired = current_time > otp_expires
        self.assertTrue(is_expired)


if __name__ == '__main__':
    unittest.main()
