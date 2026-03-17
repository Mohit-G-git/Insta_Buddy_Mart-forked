// Service registry — maps route prefixes to upstream microservice URLs
// All URLs are configurable via environment variables for Docker/production

const services = {
  iam: {
    name: 'IAM Service',
    url: process.env.IAM_SERVICE_URL || 'http://localhost:3003',
    prefixes: ['/api/v1/auth', '/api/v1/kyc'],
  },
  chat: {
    name: 'Chat Service',
    url: process.env.CHAT_SERVICE_URL || 'http://localhost:3001',
    prefixes: ['/api/v1/chat', '/api/v1/notifications'],
  },
  payment: {
    name: 'Payment Service',
    url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002',
    prefixes: ['/api/v1/payments'],
  },
};

module.exports = services;
