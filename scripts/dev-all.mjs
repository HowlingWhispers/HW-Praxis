// Starts the API and the interface together for a codespace or local machine.
// Stop both with Ctrl+C.
import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev:api'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npm', ['run', 'dev', '--', '--host'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { for (const child of children) child.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { if (code) stop(); });
