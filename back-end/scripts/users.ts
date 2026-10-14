/**
 * Staff account management (there is no accounts screen yet).
 *
 *   npm run user:create -- --email ana@club.ro --name "Ana Pop" --role admin|reception|coach
 *   npm run user:password -- --email ana@club.ro
 *   npm run user:deactivate -- --email ana@club.ro
 *
 * Passwords are asked for interactively (hidden), or read from stdin with --password-stdin.
 */
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../src/lib/password.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'reception' },
    'password-stdin': { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readPassword(): Promise<string> {
  if (values['password-stdin']) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    return input.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (prompt: string) =>
    new Promise<string>((resolve) => {
      process.stdout.write(prompt);
      // Hide what is typed.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
      rl.question('', (answer) => {
        process.stdout.write('\n');
        resolve(answer);
      });
    });
  const first = await ask('Parolă: ');
  const second = await ask('Confirmă parola: ');
  rl.close();
  if (first !== second) fail('Parolele nu coincid.');
  return first;
}

async function newPasswordHash(): Promise<string> {
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`);
  }
  return hashPassword(password);
}

const email = values.email?.trim().toLowerCase() || fail('Lipsește --email.');
const db = createDb(loadConfig().DATABASE_URL);

try {
  switch (command) {
    case 'create': {
      const name = values.name?.trim() || fail('Lipsește --name.');
      const role = values.role;
      if (role !== 'admin' && role !== 'reception' && role !== 'coach')
        fail('--role trebuie să fie admin, reception sau coach.');
      if (await db.user.findUnique({ where: { email } }))
        fail(`Există deja un cont pentru ${email}.`);
      await db.user.create({ data: { email, name, role, passwordHash: await newPasswordHash() } });
      console.log(`Cont creat: ${name} <${email}> (${role}).`);
      break;
    }
    case 'password': {
      const user =
        (await db.user.findUnique({ where: { email } })) ?? fail(`Nu există contul ${email}.`);
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await newPasswordHash(), active: true },
      });
      await db.session.deleteMany({ where: { userId: user.id } });
      console.log(`Parola pentru ${email} a fost schimbată; sesiunile active au fost închise.`);
      break;
    }
    case 'deactivate': {
      const user =
        (await db.user.findUnique({ where: { email } })) ?? fail(`Nu există contul ${email}.`);
      await db.user.update({ where: { id: user.id }, data: { active: false } });
      await db.session.deleteMany({ where: { userId: user.id } });
      console.log(`Contul ${email} a fost dezactivat.`);
      break;
    }
    default:
      fail('Comenzi: create | password | deactivate');
  }
} finally {
  await db.$disconnect();
}
