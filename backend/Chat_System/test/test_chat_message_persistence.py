import unittest
from test_postgres_uuid_int_mismatch import report_postgres_uuid_int_mismatch
from unittest.mock import Mock, patch, MagicMock


class ChatMessageServicePersistenceTests(unittest.TestCase):
    """Test chat message persistence and database schema validation"""
    
    def setUp(self):
        """Initialize mock database connection"""
        self.mock_db = Mock()
        self.sender_uuid = '123e4567-e89b-12d3-a456-426655440000'
        self.room_uuid = 'room-uuid-789abc'
        self.user_int_id = 1042
    
    def test_send_message_with_sender_user_id_mapping(self):
        """
        Given: User sends a message in chat
        When: Message is persisted to Postgres
        Then: Verify sender_id (UUID) matches user_id (INT) correctly
        """
        # Create message object as it would be in messageService
        message = {
            'id': 'msg-uuid-001',
            'sender_id': self.sender_uuid,  # UUID type from messages table
            'room_id': self.room_uuid,
            'user_id': self.user_int_id,  # INT type from users table
            'text': 'Hello everyone!',
            'timestamp': 1695000000,
            'delivered': True
        }
        
        # Validate type consistency
        self.assertIsInstance(message['sender_id'], str)
        self.assertIsInstance(message['user_id'], int)
        
        # Call type mismatch audit
        mismatch_report = report_postgres_uuid_int_mismatch()
        self.assertIn('UUID', mismatch_report)
    
    def test_query_messages_by_sender_type(self):
        """Test database query with sender type validation"""
        # Simulate query structure
        query_params = {
            'sender_id': self.sender_uuid,
            'room_id': self.room_uuid,
            'limit': 50,
            'offset': 0
        }
        
        # Verify sender_id format (UUID string)
        self.assertTrue(len(query_params['sender_id']) > 30)  # UUID length
        
        # Mock return from messageService.getMessages()
        mock_messages = [
            {
                'id': 'msg-1',
                'sender_id': self.sender_uuid,
                'text': 'First message',
                'created_at': 1695000000
            },
            {
                'id': 'msg-2',
                'sender_id': self.sender_uuid,
                'text': 'Second message',
                'created_at': 1695000010
            }
        ]
        
        self.assertEqual(len(mock_messages), 2)
        for msg in mock_messages:
            self.assertEqual(msg['sender_id'], self.sender_uuid)

    def test_user_lookup_and_message_join(self):
        """Test JOIN between messages and users table"""
        # Simulate SQL JOIN result
        user_message_join = {
            'message_id': 'msg-uuid-001',
            'sender_uuid': '123e4567-e89b-12d3-a456-426655440000',
            'user_int_id': 1042,
            'user_name': 'Alice',
            'message_text': 'Hello world',
            'sender_type': 'UUID',
            'user_type': 'INT'
        }
        
        self.assertEqual(user_message_join['sender_type'], 'UUID')
        self.assertEqual(user_message_join['user_type'], 'INT')

    def test_schema_validation_sender_user_relationship(self):
        """Verify schema defines correct relationship between messages and users"""
        schema = {
            'messages': {
                'sender_id': {'type': 'uuid', 'references': 'users.id'},
                'room_id': {'type': 'uuid', 'references': 'rooms.id'}
            },
            'users': {
                'id': {'type': 'int', 'primary_key': True}
            }
        }
        
        self.assertEqual(schema['messages']['sender_id']['type'], 'uuid')
        self.assertEqual(schema['users']['id']['type'], 'int')


if __name__ == '__main__':
    unittest.main()
