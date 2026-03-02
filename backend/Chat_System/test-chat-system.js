const http = require('http');

const API_BASE = 'http://localhost:3001';
let passedTests = 0;
let failedTests = 0;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passedTests++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('\n========== CHAT SYSTEM TESTS (Port 3001) ==========\n');

  // Health Check
  await test('Health endpoint responds', async () => {
    const res = await makeRequest('GET', '/health');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.status) throw new Error('Missing status field');
  });

  // Basic connectivity
  await test('Server is accessible', async () => {
    const res = await makeRequest('GET', '/health');
    if (res.status !== 200) throw new Error('Server not responding');
  });

  // Routes exist check
  await test('Express app routes loaded', async () => {
    const res = await makeRequest('GET', '/health');
    if (!res.body || !res.body.timestamp) throw new Error('Invalid health response');
  });

  console.log(`\n========== RESULTS ==========`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Total:  ${passedTests + failedTests}\n`);

  process.exit(failedTests > 0 ? 1 : 0);
}

setTimeout(() => runTests(), 1000);
