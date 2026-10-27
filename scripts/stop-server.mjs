/**
 * Frees the app's port by stopping whatever is listening on it.
 *
 * Exists because two Axiom servers sharing one build directory leave the
 * running one serving broken assets, so `npm run dev` refuses to start while
 * the port is taken — and hunting down a stray process by hand is tedious.
 *
 * Usage:  npm run stop          (port 3000, or $PORT)
 */
import { execSync } from 'node:child_process';

const port = Number(process.env.PORT ?? 3000);

function pidsOnPort() {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return [
        ...new Set(
          out
            .split('\n')
            .map((line) => line.trim().split(/\s+/))
            // Only rows whose local address ends with exactly this port.
            .filter((cols) => cols.length >= 5 && cols[1]?.endsWith(`:${port}`))
            .map((cols) => cols[cols.length - 1])
            .filter((pid) => pid && pid !== '0')
        )
      ];
    }
    const out = execSync(`lsof -ti:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
  } catch {
    // Both netstat/findstr and lsof exit non-zero when nothing matches.
    return [];
  }
}

const pids = pidsOnPort();

if (pids.length === 0) {
  console.log(`nothing listening on port ${port}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: ['ignore', 'ignore', 'ignore'] });
    } else {
      process.kill(Number(pid), 'SIGKILL');
    }
    console.log(`stopped pid ${pid} (was holding port ${port})`);
  } catch (err) {
    console.error(`could not stop pid ${pid}: ${err?.message ?? err}`);
  }
}
