// Test script to manually spawn the agent like the plugin does
const { spawn } = require('child_process');

console.log('Testing agent spawn...');

const agent = spawn('claude-code-acp', [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: 'test-key', // Replace with real key
    NODE_ENV: 'production'
  }
});

let output = '';

agent.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  console.log('STDOUT:', text.substring(0, 200));
});

agent.stderr.on('data', (data) => {
  const text = data.toString();
  output += text;
  console.log('STDERR:', text.substring(0, 200));
});

agent.on('error', (error) => {
  console.error('ERROR:', error);
  process.exit(1);
});

agent.on('close', (code) => {
  console.log('Process closed with code:', code);
  process.exit(code);
});

// Send initialize request
setTimeout(() => {
  console.log('Sending initialize request...');
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      agentId: 'claude-code-acp',
      capabilities: {}
    }
  };
  agent.stdin.write(JSON.stringify(initRequest) + '\n');
}, 1000);

// Timeout after 10 seconds
setTimeout(() => {
  console.log('TIMEOUT - no response after 10 seconds');
  console.log('Total output:', output);
  agent.kill();
  process.exit(1);
}, 10000);
