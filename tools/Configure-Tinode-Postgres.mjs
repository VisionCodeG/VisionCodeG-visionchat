import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const password = process.argv[3];

if (!root || password == null) {
  console.error('Usage: node Configure-Tinode-Postgres.mjs <tinode-root> <postgres-password>');
  process.exit(2);
}

if (!fs.existsSync(root)) {
  console.error('Tinode root does not exist: ' + root);
  process.exit(4);
}

if (!fs.statSync(root).isDirectory()) {
  console.error('Tinode root is not a directory: ' + root);
  process.exit(5);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase() === 'tinode.conf') {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
if (!files.length) {
  console.error('No tinode.conf files found under: ' + root);
  process.exit(3);
}

const jsonPassword = JSON.stringify(String(password)).slice(1, -1);
const urlPassword = encodeURIComponent(String(password));

let serverConfig = '';
let dbConfig = '';

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  const original = text;

  text = text.replace(/"use_adapter"\s*:\s*""/g, '"use_adapter": "postgres"');
  text = text.replace(/"Passwd"\s*:\s*"[^"]*"/g, '"Passwd": "' + jsonPassword + '"');
  text = text.replace(
    /postgresql:\/\/postgres:[^@"\s]+@localhost:5432\/tinode\?sslmode=disable(?:&connect_timeout=10)?/g,
    'postgresql://postgres:' + urlPassword + '@localhost:5432/tinode?sslmode=disable'
  );

  if (text !== original) {
    fs.writeFileSync(file, text, 'utf8');
    console.log('Patched: ' + file);
  }

  if (!dbConfig && text.includes('"store_config"') && !text.includes('"listen"')) {
    dbConfig = file;
  }

  if (!serverConfig && text.includes('"store_config"') && (text.includes('"listen"') || text.includes('"api_path"') || text.includes('"grpc_listen"'))) {
    serverConfig = file;
  }
}

if (!dbConfig) {
  dbConfig = files.find((file) => file.toLowerCase().includes('tinode-db')) || files[0];
}

if (!serverConfig) {
  serverConfig = files.find((file) => file.toLowerCase().includes('server')) || files[files.length - 1];
}

const output = path.join(root, 'visionchat-native-paths.txt');
fs.writeFileSync(output, 'DB_CONFIG=' + dbConfig + '\nSERVER_CONFIG=' + serverConfig + '\n', 'utf8');

console.log('DB config: ' + dbConfig);
console.log('Server config: ' + serverConfig);
